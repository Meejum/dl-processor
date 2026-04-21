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
  raw_json       TEXT,
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
  end_date       TEXT
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
  project_id     INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
  sf_sub_project TEXT NOT NULL,
  sf_unit_prefix TEXT NOT NULL,
  sf_project     TEXT,
  source         TEXT NOT NULL DEFAULT 'auto',
  notes          TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE VIEW IF NOT EXISTS v_unit_compare AS
  SELECT
    p.project_name               AS dld_project,
    pm.sf_sub_project            AS sf_sub_project,
    pm.sf_unit_prefix            AS sf_unit_prefix,
    u.unit_number                AS dld_unit,
    u.unit_number_norm           AS dld_unit_norm,
    pm.sf_unit_prefix || '-' || u.unit_number_norm AS expected_sf_unit,
    b.unit                       AS sf_unit,
    u.unit_type                  AS dld_unit_type,
    u.net_area                   AS dld_net_area,
    b.purchase_price             AS sf_purchase_price,
    b.dld_amount                 AS sf_dld_amount,
    b.applicant_name             AS sf_applicant,
    b.status                     AS sf_status,
    b.pre_reg_status             AS sf_pre_reg,
    b.procedure_number           AS sf_procedure_number,
    b.booking_name               AS sf_booking_name,
    CASE
      WHEN b.unit IS NOT NULL THEN 'MATCH'
      ELSE 'DLD_ONLY'
    END AS match_status
  FROM v_dld_unit_latest u
  JOIN dld_project p ON p.project_id = u.project_id
  LEFT JOIN project_mapping pm ON pm.project_id = u.project_id
  LEFT JOIN sf_booking b
    ON b.sf_snapshot_id = (SELECT sf_snapshot_id FROM v_latest_sf_snapshot)
   AND b.sub_project = pm.sf_sub_project
   AND b.unit_norm   = pm.sf_unit_prefix || '-' || u.unit_number_norm;
