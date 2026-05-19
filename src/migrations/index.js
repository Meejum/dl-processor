const path = require('path');

// Order matters — each migration is applied in array order. New migrations
// always append to the END of this list. NEVER reorder.
const MIGRATIONS = [
  require('./2026-05-12-001-audit-log'),
  require('./2026-05-12-002-buyer-alias'),
  require('./2026-05-12-003-pending-change-v2'),
  require('./2026-05-12-004-buyer-alias-seed'),
  require('./2026-05-12-005-audit-log-source-widen'),
  require('./2026-05-13-006-sf-booking-step-cols'),
  require('./2026-05-13-007-audit-log-action-widen'),
  require('./2026-05-13-008-audit-hardening'),
  require('./2026-05-18-009-automation')
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const isApplied = db.prepare('SELECT 1 FROM schema_migration WHERE id = ?');
  const markApplied = db.prepare('INSERT INTO schema_migration (id) VALUES (?)');
  for (const m of MIGRATIONS) {
    if (isApplied.get(m.id)) continue;
    const apply = db.transaction(() => {
      m.up(db);
      markApplied.run(m.id);
    });
    apply();
  }
}

module.exports = { runMigrations, MIGRATIONS };
