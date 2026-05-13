const { canonicalize, computeRowHash, GENESIS_PREV_HASH } = require('../audit-hash');

// v2.1 audit hardening — one migration that does three things in one
// idempotent pass:
//
//   A — Adds 4 nullable columns to audit_log: user, tier2, prev_hash,
//       row_hash. Guarded by PRAGMA table_info so re-runs are safe.
//   B — Widens audit_log.action CHECK to include 'revert' alongside
//       the existing 8 actions. Uses SQLite's rebuild-table pattern
//       (same as 003/005/007). Idempotency: skipped if 'revert' is
//       already in the CHECK clause.
//   C — Backfills prev_hash + row_hash for any audit_log rows that
//       still have row_hash IS NULL. Walks in (ts, audit_id) order.
//       First row chains from GENESIS (64 zeros); subsequent rows
//       chain from prior row's row_hash. If a later run finds some
//       rows already chained, the backfill continues from the last
//       chained row's row_hash rather than restarting from genesis.

module.exports = {
  id: '2026-05-13-008-audit-hardening',
  up(db) {
    // Guard 1: audit_log must exist (migration 001 creates it; fresh-DB tests
    // sometimes skip schema.sql).
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).get();
    if (!exists) return;

    // ---- Step A: add the 4 new columns (idempotent) ----
    const cols = db.prepare("PRAGMA table_info(audit_log)").all().map(c => c.name);
    const adds = [];
    if (!cols.includes('user'))      adds.push("ALTER TABLE audit_log ADD COLUMN user      TEXT");
    if (!cols.includes('tier2'))     adds.push("ALTER TABLE audit_log ADD COLUMN tier2     INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes('prev_hash')) adds.push("ALTER TABLE audit_log ADD COLUMN prev_hash TEXT");
    if (!cols.includes('row_hash'))  adds.push("ALTER TABLE audit_log ADD COLUMN row_hash  TEXT");
    for (const sql of adds) db.exec(sql);

    // ---- Step B: widen action CHECK to include 'revert' ----
    // Idempotency guard: check if 'revert' is already in the CHECK clause.
    const sqlRow = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).get();
    const alreadyHasRevert = sqlRow && sqlRow.sql && sqlRow.sql.includes("'revert'");
    if (!alreadyHasRevert) {
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
                               'approve_bp','reject_bp','acknowledge_bp','revert')),
          source            TEXT NOT NULL CHECK (source IN
                              ('review_pending','import_dld','import_sf','apply_pending','compare')),
          change_id         INTEGER,
          user_note         TEXT,
          user              TEXT,
          tier2             INTEGER NOT NULL DEFAULT 0,
          prev_hash         TEXT,
          row_hash          TEXT
        );
        INSERT INTO audit_log_new SELECT
          audit_id, ts, project_id, unit_number_norm, table_name, field,
          old_value, new_value, action, source, change_id, user_note,
          user, tier2, prev_hash, row_hash
        FROM audit_log;
        DROP TABLE audit_log;
        ALTER TABLE audit_log_new RENAME TO audit_log;
        CREATE INDEX audit_log_unit_ts    ON audit_log (project_id, unit_number_norm, ts DESC);
        CREATE INDEX audit_log_project_ts ON audit_log (project_id, ts DESC);
        CREATE INDEX audit_log_change     ON audit_log (change_id);
      `);
    }

    // ---- Step C: backfill prev_hash + row_hash for any existing rows ----
    // Walk rows in (ts, audit_id) order. If row_hash is NULL, compute and UPDATE.
    // Rows with non-NULL row_hash are left alone (already chained).
    const rows = db.prepare(`
      SELECT * FROM audit_log WHERE row_hash IS NULL ORDER BY ts, audit_id
    `).all();

    if (rows.length > 0) {
      // Find the last already-chained row's row_hash (if any) so the new chain
      // continues from there rather than starting from genesis.
      const lastChained = db.prepare(`
        SELECT row_hash FROM audit_log
        WHERE row_hash IS NOT NULL
        ORDER BY ts DESC, audit_id DESC LIMIT 1
      `).get();
      let prev = lastChained ? lastChained.row_hash : GENESIS_PREV_HASH;
      const upd = db.prepare('UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE audit_id = ?');
      for (const row of rows) {
        const rh = computeRowHash(prev, row);
        upd.run(prev, rh, row.audit_id);
        prev = rh;
      }
    }
  }
};
