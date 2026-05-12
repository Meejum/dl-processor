module.exports = {
  id: '2026-05-12-002-buyer-alias',
  up(db) {
    db.exec(`
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
    `);
  }
};
