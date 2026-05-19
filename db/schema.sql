PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS dld_project (
  project_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name       TEXT UNIQUE NOT NULL,
  developer          TEXT,
  project_value_aed  REAL,
  start_date         TEXT,
  end_date           TEXT,
  total_investors    INTEGER,
  sf_project         TEXT,
  sf_sub_project     TEXT,
  sf_unit_prefix     TEXT,
  first_imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_imported_at   TEXT
);

CREATE TABLE IF NOT EXISTS dld_snapshot (
  snapshot_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  source_format  TEXT NOT NULL CHECK (source_format IN ('xps','csv')),
  source_file    TEXT NOT NULL,
  source_sha256  TEXT,
  snapshot_date  TEXT NOT NULL DEFAULT (date('now')),
  imported_at    TEXT NOT NULL DEFAULT (datetime('now')),
  total_units    INTEGER,
  total_tx       INTEGER,
  UNIQUE(project_id, snapshot_date, source_format)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_project ON dld_snapshot(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_date    ON dld_snapshot(snapshot_date);

CREATE TABLE IF NOT EXISTS dld_building (
  building_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   INTEGER NOT NULL REFERENCES dld_snapshot ON DELETE CASCADE,
  dld_id        TEXT,
  name          TEXT,
  type          TEXT
);

CREATE INDEX IF NOT EXISTS idx_building_snapshot ON dld_building(snapshot_id);

CREATE TABLE IF NOT EXISTS dld_unit (
  unit_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id    INTEGER NOT NULL REFERENCES dld_snapshot ON DELETE CASCADE,
  building_id    INTEGER REFERENCES dld_building ON DELETE SET NULL,
  project_id     INTEGER NOT NULL REFERENCES dld_project,
  dld_unit_id    TEXT,
  unit_number    TEXT,
  unit_number_norm TEXT,
  floor          TEXT,
  rooms          INTEGER,
  unit_type      TEXT,
  net_area       REAL,
  common_area    REAL,
  page_num       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_unit_snapshot ON dld_unit(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_unit_project_num ON dld_unit(project_id, unit_number_norm);

CREATE TABLE IF NOT EXISTS dld_transaction (
  tx_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id        INTEGER NOT NULL REFERENCES dld_unit ON DELETE CASCADE,
  snapshot_id    INTEGER NOT NULL REFERENCES dld_snapshot ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES dld_project,
  party_name     TEXT,
  ft_share       REAL,
  share_unit     TEXT,
  tx_type        TEXT,
  tx_date        TEXT,
  tx_date_iso    TEXT,
  amount_aed     REAL,
  amount_raw     TEXT
);

CREATE INDEX IF NOT EXISTS idx_tx_unit ON dld_transaction(unit_id);
CREATE INDEX IF NOT EXISTS idx_tx_snapshot ON dld_transaction(snapshot_id);

CREATE TABLE IF NOT EXISTS dld_breakdown (
  breakdown_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id    INTEGER NOT NULL REFERENCES dld_snapshot ON DELETE CASCADE,
  tx_type        TEXT NOT NULL,
  property_count INTEGER NOT NULL,
  UNIQUE(snapshot_id, tx_type)
);

CREATE TABLE IF NOT EXISTS sf_snapshot (
  sf_snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file    TEXT NOT NULL,
  source_sha256  TEXT,
  generated_at   TEXT,
  imported_at    TEXT NOT NULL DEFAULT (datetime('now')),
  total_rows     INTEGER
);

CREATE TABLE IF NOT EXISTS sf_booking (
  sf_booking_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  sf_snapshot_id INTEGER NOT NULL REFERENCES sf_snapshot ON DELETE CASCADE,
  bp_name        TEXT,
  sub_project    TEXT,
  unit           TEXT,
  unit_norm      TEXT,
  booking_name   TEXT,
  project        TEXT,
  tower_name     TEXT,
  applicant_name TEXT,
  purchase_price REAL,
  dld_amount     REAL,
  pre_reg_status TEXT,
  status         TEXT,
  rm_process_status TEXT,
  dld_process_status TEXT,
  bp_created_date TEXT,
  pre_reg_completion_date TEXT,
  procedure_number TEXT,
  payment_reference_number TEXT,
  payment_date   TEXT,
  booking_record_id TEXT,
  total_dld_paid REAL,
  dld_shortfall  REAL,
  dld_balance    REAL,
  current_step_name TEXT,
  end_date       TEXT,
  nationality       TEXT,
  applicant_details TEXT,
  applicant_2_name  TEXT,
  applicant_3_name  TEXT,
  applicant_4_name  TEXT,
  docusign_complete TEXT,
  current_step_assigned_name TEXT,
  comments       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sfb_snapshot ON sf_booking(sf_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sfb_sub_unit ON sf_booking(sub_project, unit_norm);
CREATE INDEX IF NOT EXISTS idx_sfb_unit     ON sf_booking(unit_norm);

CREATE TABLE IF NOT EXISTS manual_override (
  override_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm TEXT NOT NULL,
  actual_buyer     TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);
CREATE INDEX IF NOT EXISTS idx_override_proj_unit ON manual_override(project_id, unit_number_norm);

CREATE TABLE IF NOT EXISTS project_mapping (
  project_id          INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
  sf_sub_project      TEXT,
  sf_unit_prefix      TEXT,
  sf_project          TEXT,
  match_scope         TEXT NOT NULL DEFAULT 'sub_project',
  source              TEXT NOT NULL DEFAULT 'auto',
  notes               TEXT,
  area_threshold_pct  REAL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS manual_area (
  manual_area_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm  TEXT NOT NULL,
  area_sqm          REAL NOT NULL,
  source_note       TEXT,
  entered_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);
CREATE INDEX IF NOT EXISTS idx_manual_area_proj_unit ON manual_area(project_id, unit_number_norm);

CREATE TABLE IF NOT EXISTS manual_audit_snapshot (
  manual_audit_snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file              TEXT NOT NULL,
  source_sha256            TEXT NOT NULL,
  as_of_month              TEXT NOT NULL,
  workbook_modified_at     TEXT,
  workbook_modified_by     TEXT,
  total_rows               INTEGER,
  note                     TEXT,
  imported_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(as_of_month, source_sha256)
);

CREATE TABLE IF NOT EXISTS manual_audit_project (
  manual_audit_project_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_audit_snapshot_id INTEGER NOT NULL REFERENCES manual_audit_snapshot ON DELETE CASCADE,
  sheet_name               TEXT NOT NULL,
  project_name_inferred    TEXT,
  project_id               INTEGER REFERENCES dld_project ON DELETE SET NULL,
  auditor                  TEXT,
  row_count                INTEGER NOT NULL DEFAULT 0,
  name_false_count         INTEGER NOT NULL DEFAULT 0,
  price_false_count        INTEGER NOT NULL DEFAULT 0,
  both_true_count          INTEGER NOT NULL DEFAULT 0,
  blank_count              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_map_snapshot ON manual_audit_project(manual_audit_snapshot_id);

CREATE TABLE IF NOT EXISTS manual_audit_row (
  manual_audit_row_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_audit_project_id  INTEGER NOT NULL REFERENCES manual_audit_project ON DELETE CASCADE,
  sub_project              TEXT,
  sf_unit                  TEXT,
  unit_number_norm         TEXT,
  sf_booking_name          TEXT,
  sf_applicant             TEXT,
  sf_price                 REAL,
  dld_unit                 TEXT,
  size                     REAL,
  rooms                    TEXT,
  details                  TEXT,
  name_match               INTEGER,
  price_match              INTEGER,
  count_customers          INTEGER,
  procedure_type           TEXT
);

CREATE INDEX IF NOT EXISTS idx_mar_project ON manual_audit_row(manual_audit_project_id);

CREATE VIEW IF NOT EXISTS v_latest_dld_snapshot AS
  SELECT s.*
  FROM dld_snapshot s
  JOIN (
    SELECT project_id, MAX(imported_at) AS max_at
    FROM dld_snapshot GROUP BY project_id
  ) x ON x.project_id = s.project_id AND x.max_at = s.imported_at;

CREATE VIEW IF NOT EXISTS v_latest_sf_snapshot AS
  SELECT *
  FROM sf_snapshot
  WHERE imported_at = (SELECT MAX(imported_at) FROM sf_snapshot);

CREATE VIEW IF NOT EXISTS v_dld_unit_latest AS
  SELECT u.*, s.snapshot_date, s.source_format
  FROM dld_unit u
  JOIN v_latest_dld_snapshot s ON s.snapshot_id = u.snapshot_id;

-- ─────────────────────────────────────────────────────────────────────
-- master_data: one row per (project, unit). Wide. Single source of truth
-- once seeded. Compare reads from here when a row exists, falls back to
-- DLD's latest snapshot when not.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_data (
  master_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm     TEXT NOT NULL,
  -- Operational fields:
  buyer_name           TEXT,
  purchase_price_aed   REAL,
  status               TEXT,
  procedure_number     TEXT,
  area_sqm             REAL,
  -- Per-field provenance ('staff' = direct staff edit, 'dld_approved' = DLD proposal that was approved):
  buyer_source         TEXT CHECK (buyer_source         IN ('staff','dld_approved')),
  price_source         TEXT CHECK (price_source         IN ('staff','dld_approved')),
  status_source        TEXT CHECK (status_source        IN ('staff','dld_approved')),
  procedure_source     TEXT CHECK (procedure_source     IN ('staff','dld_approved')),
  area_source          TEXT CHECK (area_source          IN ('staff','dld_approved')),
  -- Per-field decision timestamps (when the value was last set/approved):
  buyer_decided_at     TEXT,
  price_decided_at     TEXT,
  status_decided_at    TEXT,
  procedure_decided_at TEXT,
  area_decided_at      TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);

CREATE INDEX IF NOT EXISTS idx_master_proj_unit ON master_data(project_id, unit_number_norm);

-- ─────────────────────────────────────────────────────────────────────
-- pending_change: tall. One row per (unit, field) DLD-proposed change.
-- Persists forever (audit trail). decision flips pending → approved/rejected.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_change (
  change_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm     TEXT NOT NULL,
  field_name           TEXT NOT NULL CHECK (field_name IN
    ('buyer_name','purchase_price_aed','status','procedure_number','area_sqm')),
  old_value            TEXT,
  proposed_value       TEXT,
  override_value       TEXT,
  change_type          TEXT NOT NULL DEFAULT 'MISMATCH'
                       CHECK (change_type IN ('MISMATCH','DLD_DRIFT','SF_DRIFT')),
  source_snapshot_id   INTEGER REFERENCES dld_snapshot ON DELETE SET NULL,
  decision             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (decision IN ('pending','approved','rejected','auto_applied')),
  decision_notes       TEXT,
  proposed_at          TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at           TEXT,
  decided_by           TEXT,
  anomaly              TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_proj_unit ON pending_change(project_id, unit_number_norm);
CREATE INDEX IF NOT EXISTS idx_pending_decision  ON pending_change(decision);
CREATE INDEX IF NOT EXISTS idx_pending_type      ON pending_change(change_type);

-- ─────────────────────────────────────────────────────────────────────
-- v1.1 — audit_log + buyer_alias. Migrations 001/002 also create these
-- for existing DBs; this section ensures fresh DBs get them in one shot.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TEXT NOT NULL DEFAULT (datetime('now')),
  project_id        INTEGER,
  unit_number_norm  TEXT,
  table_name        TEXT NOT NULL,
  field             TEXT NOT NULL,
  old_value         TEXT,
  new_value         TEXT,
  action            TEXT NOT NULL CHECK (action IN
                      ('approve','override','reject','auto_apply','learn_alias',
                       'approve_bp','reject_bp','acknowledge_bp','revert')),
  source            TEXT NOT NULL CHECK (source IN
                      ('review_pending','import_dld','import_sf','apply_pending',
                       'compare','rule_fired','bulk_op')),
  change_id         INTEGER,
  user_note         TEXT,
  user              TEXT,
  tier2             INTEGER NOT NULL DEFAULT 0,
  prev_hash         TEXT,
  row_hash          TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_unit_ts    ON audit_log (project_id, unit_number_norm, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_project_ts ON audit_log (project_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_change     ON audit_log (change_id);

CREATE TABLE IF NOT EXISTS buyer_alias (
  alias_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER,
  variant     TEXT NOT NULL,
  canonical   TEXT NOT NULL,
  display     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,
  UNIQUE (project_id, variant)
);
CREATE INDEX IF NOT EXISTS buyer_alias_lookup ON buyer_alias (project_id, variant);

-- ─────────────────────────────────────────────────────────────────────
-- v2.3 — automation_rule. Migration 009 also creates this for upgrade
-- DBs; this section ensures fresh DBs get it in one shot AND seeds the
-- 4 built-in rules (migration 009's INSERT OR IGNORE handles dedupe).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rule (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  priority      INTEGER NOT NULL,
  when_json     TEXT NOT NULL,
  then_json     TEXT NOT NULL,
  builtin       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  applied_count INTEGER NOT NULL DEFAULT 0,
  revert_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_automation_rule_priority
  ON automation_rule(enabled, priority);
