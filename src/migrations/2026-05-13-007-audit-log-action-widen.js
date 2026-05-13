module.exports = {
  id: '2026-05-13-007-audit-log-action-widen',
  up(db) {
    // SQLite can't ALTER a CHECK constraint in place — rebuild the table.
    // Same pattern as migration 005 (widened `source`); 007 widens `action`
    // to add the BP-level umbrella actions used by v2.0 card-level controls.
    //
    // Guard 1: if audit_log doesn't exist (some unit tests use bare DBs), skip.
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).get();
    if (!exists) return;

    // Guard 2: if the CHECK already lists 'approve_bp' (fresh DB from updated
    // schema.sql), skip — nothing to do.
    const created = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).get();
    if (created && created.sql && created.sql.includes("'approve_bp'")) return;

    db.exec(`
      CREATE TABLE audit_log_new (
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
                             'approve_bp','reject_bp','acknowledge_bp')),
        source            TEXT NOT NULL CHECK (source IN
                            ('review_pending','import_dld','import_sf','apply_pending','compare')),
        change_id         INTEGER,
        user_note         TEXT
      );
      INSERT INTO audit_log_new SELECT * FROM audit_log;
      DROP TABLE audit_log;
      ALTER TABLE audit_log_new RENAME TO audit_log;
      CREATE INDEX audit_log_unit_ts    ON audit_log (project_id, unit_number_norm, ts DESC);
      CREATE INDEX audit_log_project_ts ON audit_log (project_id, ts DESC);
      CREATE INDEX audit_log_change     ON audit_log (change_id);
    `);
  }
};
