const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations, MIGRATIONS } = require('../src/migrations');

function freshDb() { return new Database(':memory:'); }

test('runMigrations creates schema_migration table on fresh DB', () => {
  const db = freshDb();
  runMigrations(db);
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migration'").get();
  assert.equal(t.name, 'schema_migration');
});

test('runMigrations applies every migration on fresh DB', () => {
  const db = freshDb();
  runMigrations(db);
  const applied = db.prepare('SELECT id FROM schema_migration ORDER BY id').all().map(r => r.id);
  assert.deepEqual(applied, MIGRATIONS.map(m => m.id));
});

test('runMigrations is idempotent — second call is a no-op', () => {
  const db = freshDb();
  runMigrations(db);
  const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get().n;
  runMigrations(db);
  const after = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get().n;
  assert.equal(before, after);
});

test('001 creates audit_log with 3 indexes', () => {
  const db = freshDb();
  runMigrations(db);
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'").get();
  assert.match(t.sql, /audit_id\s+INTEGER PRIMARY KEY/);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log' AND sql IS NOT NULL").all();
  assert.equal(idx.length, 3);
});

test('002 creates buyer_alias with UNIQUE(project_id, variant)', () => {
  const db = freshDb();
  runMigrations(db);
  // Insert two rows with same project_id + variant — second must fail
  db.prepare("INSERT INTO buyer_alias (project_id, variant, canonical, display) VALUES (1, 'x', 'y', 'X')").run();
  assert.throws(() => {
    db.prepare("INSERT INTO buyer_alias (project_id, variant, canonical, display) VALUES (1, 'x', 'z', 'Z')").run();
  }, /UNIQUE/);
});

test('003 widens pending_change.decision CHECK to allow auto_applied', () => {
  // Seed an old-shape pending_change table BEFORE migrations
  const db = freshDb();
  db.exec(`
    CREATE TABLE dld_project (project_id INTEGER PRIMARY KEY);
    CREATE TABLE dld_snapshot (snapshot_id INTEGER PRIMARY KEY);
    INSERT INTO dld_project (project_id) VALUES (1);
    CREATE TABLE pending_change (
      change_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
      unit_number_norm TEXT NOT NULL,
      field_name TEXT NOT NULL CHECK (field_name IN
        ('buyer_name','purchase_price_aed','status','procedure_number','area_sqm')),
      old_value TEXT, proposed_value TEXT,
      source_snapshot_id INTEGER,
      decision TEXT NOT NULL DEFAULT 'pending'
        CHECK (decision IN ('pending','approved','rejected')),
      decision_notes TEXT,
      proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT, decided_by TEXT
    );
    INSERT INTO pending_change (project_id, unit_number_norm, field_name, decision)
    VALUES (1, '101', 'buyer_name', 'pending');
  `);
  runMigrations(db);
  // After migration, auto_applied must be insertable
  db.prepare(`
    INSERT INTO pending_change (project_id, unit_number_norm, field_name, decision)
    VALUES (1, '102', 'buyer_name', 'auto_applied')
  `).run();
  // And existing row preserved
  const row = db.prepare("SELECT decision FROM pending_change WHERE unit_number_norm = '101'").get();
  assert.equal(row.decision, 'pending');
  // New columns exist
  const cols = db.prepare("PRAGMA table_info(pending_change)").all().map(c => c.name);
  assert.ok(cols.includes('change_type'));
  assert.ok(cols.includes('override_value'));
});

test('004 seeds at least 40 buyer_alias rows with project_id NULL', () => {
  const db = freshDb();
  runMigrations(db);
  const n = db.prepare("SELECT COUNT(*) AS n FROM buyer_alias WHERE project_id IS NULL").get().n;
  assert.ok(n >= 40, 'expected >=40 seeded global aliases, got ' + n);
});
