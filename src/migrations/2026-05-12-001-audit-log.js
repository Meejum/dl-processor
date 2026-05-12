module.exports = {
  id: '2026-05-12-001-audit-log',
  up(db) {
    db.exec(`
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
                              ('approve','override','reject','auto_apply','learn_alias')),
        source            TEXT NOT NULL CHECK (source IN
                              ('review_pending','import_dld','import_sf','apply_pending')),
        change_id         INTEGER,
        user_note         TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_log_unit_ts    ON audit_log (project_id, unit_number_norm, ts DESC);
      CREATE INDEX IF NOT EXISTS audit_log_project_ts ON audit_log (project_id, ts DESC);
      CREATE INDEX IF NOT EXISTS audit_log_change     ON audit_log (change_id);
    `);
  }
};
