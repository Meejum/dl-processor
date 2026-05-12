module.exports = {
  id: '2026-05-12-003-pending-change-v2',
  up(db) {
    // SQLite can't alter CHECK constraints in place. We must rebuild the
    // table: create new with widened CHECK, copy data, drop old, rename.
    //
    // Guard: if pending_change doesn't exist (e.g. truly fresh in-memory DB
    // used by unit tests), skip — there's nothing to widen.
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_change'"
    ).get();
    if (!exists) return;
    db.exec(`
      ALTER TABLE pending_change ADD COLUMN change_type    TEXT NOT NULL DEFAULT 'MISMATCH';
      ALTER TABLE pending_change ADD COLUMN override_value TEXT;

      CREATE TABLE pending_change_new (
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
        decided_by           TEXT
      );

      INSERT INTO pending_change_new
        (change_id, project_id, unit_number_norm, field_name, old_value, proposed_value,
         override_value, change_type, source_snapshot_id, decision, decision_notes,
         proposed_at, decided_at, decided_by)
      SELECT
        change_id, project_id, unit_number_norm, field_name, old_value, proposed_value,
        override_value, change_type, source_snapshot_id, decision, decision_notes,
        proposed_at, decided_at, decided_by
      FROM pending_change;

      DROP TABLE pending_change;
      ALTER TABLE pending_change_new RENAME TO pending_change;

      CREATE INDEX idx_pending_proj_unit ON pending_change(project_id, unit_number_norm);
      CREATE INDEX idx_pending_decision  ON pending_change(decision);
      CREATE INDEX idx_pending_type      ON pending_change(change_type);
    `);
  }
};
