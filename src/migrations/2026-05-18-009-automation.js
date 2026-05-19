// v2.3 workflow automation — one migration that:
//
//   A — Creates automation_rule table + priority index.
//   B — Adds pending_change.anomaly column (idempotent via PRAGMA check).
//   C — Widens audit_log.source CHECK to include 'rule_fired' and 'bulk_op'.
//       SQLite cannot ALTER a CHECK in place — rebuild pattern from
//       migrations 005/007/008 is reused. Preserves all columns added by
//       008 (user, tier2, prev_hash, row_hash) and the action CHECK from 007/008.
//   D — Seeds 4 built-in rules with INSERT OR IGNORE so re-runs are no-ops.
//
// Pattern validation for rule:<id> / bulk:<UUID> lives in the application
// layer (src/audit-log.js validateAuditSource + auditSourceFor helpers).
// SQLite CHECK does not support LIKE/GLOB; the enum is fixed.

module.exports = {
  id: '2026-05-18-009-automation',
  up(db) {
    // ---- A: automation_rule table ----
    db.exec(`
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
    `);

    // ---- B: pending_change.anomaly column ----
    const pcExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_change'"
    ).get();
    if (pcExists) {
      const pcCols = db.prepare('PRAGMA table_info(pending_change)').all();
      if (!pcCols.some(c => c.name === 'anomaly')) {
        db.exec('ALTER TABLE pending_change ADD COLUMN anomaly TEXT');
      }
    }

    // ---- C: widen audit_log.source CHECK ----
    const alExists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_log'"
    ).get();
    if (alExists) {
      const created = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'"
      ).get();
      // Idempotency: skip if 'rule_fired' is already present.
      const alreadyWidened = created && created.sql && created.sql.includes("'rule_fired'");
      if (!alreadyWidened) {
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
                                ('review_pending','import_dld','import_sf','apply_pending',
                                 'compare','rule_fired','bulk_op')),
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
          CREATE INDEX IF NOT EXISTS audit_log_unit_ts    ON audit_log (project_id, unit_number_norm, ts DESC);
          CREATE INDEX IF NOT EXISTS audit_log_project_ts ON audit_log (project_id, ts DESC);
          CREATE INDEX IF NOT EXISTS audit_log_change     ON audit_log (change_id);
        `);
      }
    }

    // ---- D: seed 4 built-in rules ----
    const seed = db.prepare(`
      INSERT OR IGNORE INTO automation_rule
        (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
      VALUES (?, ?, 1, ?, ?, ?, 1, datetime('now'), 'system')
    `);
    const builtins = [
      [1000, 'Auto-approve buyer-alias matches', 1000,
        JSON.stringify({ op: 'and', clauses: [
          { field: 'change_type',  operator: '=', value: 'BUYER_MISMATCH' },
          { field: 'alias_exists', operator: '=', value: true },
          { field: 'tier2',        operator: '=', value: false }
        ]}),
        JSON.stringify({ action: 'auto_approve', note: 'alias match, sub-threshold' })],
      [1001, 'Flag large price increases', 1001,
        JSON.stringify({ op: 'and', clauses: [
          { field: 'field',     operator: '=', value: 'purchase_price' },
          { field: 'delta_pct', operator: '>', value: 25 }
        ]}),
        JSON.stringify({ action: 'flag_anomaly', anomaly_severity: 'high' })],
      [1002, 'Flag large area changes', 1002,
        JSON.stringify({ op: 'and', clauses: [
          { field: 'field',     operator: '=', value: 'area_sqm' },
          { field: 'delta_pct', operator: '>', value: 10 }
        ]}),
        JSON.stringify({ action: 'flag_anomaly', anomaly_severity: 'high' })],
      [1003, 'Auto-acknowledge cancelled BPs', 1003,
        JSON.stringify({ op: 'and', clauses: [
          { field: 'bp_type',  operator: '=', value: 'REGISTRATION' },
          { field: 'sf_state', operator: '=', value: 'cancelled' }
        ]}),
        JSON.stringify({ action: 'auto_acknowledge_bp' })]
    ];
    for (const b of builtins) seed.run(...b);
  }
};
