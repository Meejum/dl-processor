const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations, MIGRATIONS } = require('../src/migrations');

function freshDb() { return new Database(':memory:'); }
const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

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

test('003 is a no-op when schema.sql already created pending_change in v1.1 shape', () => {
  // Fresh DB initialized from updated schema.sql (which has the new shape).
  const db = freshDb();
  db.exec(SCHEMA_SQL);
  // Capture the table's CREATE SQL as produced by schema.sql.
  const sqlBefore = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_change'"
  ).get().sql;
  // Seed a row with the new 'auto_applied' decision directly.
  db.prepare(`INSERT INTO dld_project (project_name) VALUES ('P1')`).run();
  const projectId = db.prepare(`SELECT project_id FROM dld_project WHERE project_name = 'P1'`).get().project_id;
  const insertedChangeId = db.prepare(`
    INSERT INTO pending_change (project_id, unit_number_norm, field_name, decision)
    VALUES (?, '101', 'buyer_name', 'auto_applied')
  `).run(projectId).lastInsertRowid;
  // Run migrations — 003 must skip rebuilding the table.
  runMigrations(db);
  // The CREATE TABLE SQL should be unchanged (table NOT rebuilt).
  const sqlAfter = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_change'"
  ).get().sql;
  assert.equal(sqlAfter, sqlBefore, 'pending_change table was rebuilt — expected no-op');
  // The seeded row must still be present with the same change_id.
  const row = db.prepare(
    "SELECT change_id, decision FROM pending_change WHERE unit_number_norm = '101'"
  ).get();
  assert.equal(row.change_id, insertedChangeId);
  assert.equal(row.decision, 'auto_applied');
});

test('004 seeds at least 40 buyer_alias rows with project_id NULL', () => {
  const db = freshDb();
  runMigrations(db);
  const n = db.prepare("SELECT COUNT(*) AS n FROM buyer_alias WHERE project_id IS NULL").get().n;
  assert.ok(n >= 40, 'expected >=40 seeded global aliases, got ' + n);
});

test('REGRESSION: openDb on a v1.0-shaped DB upgrades cleanly (no "no such column: change_type")', () => {
  const os = require('node:os');
  const tmp = path.join(os.tmpdir(), 'dlp-upgrade-' + Date.now() + '.sqlite');
  // Seed a minimal v1.0-shape DB on disk (no audit_log, no buyer_alias,
  // no schema_migration; pending_change in OLD shape — no change_type,
  // narrow decision CHECK).
  const seed = new Database(tmp);
  seed.exec(`
    CREATE TABLE dld_project  (project_id INTEGER PRIMARY KEY AUTOINCREMENT, project_name TEXT);
    CREATE TABLE dld_snapshot (snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, source_format TEXT, source_file TEXT, snapshot_date TEXT);
    CREATE TABLE pending_change (
      change_id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
      unit_number_norm     TEXT NOT NULL,
      field_name           TEXT NOT NULL CHECK (field_name IN
        ('buyer_name','purchase_price_aed','status','procedure_number','area_sqm')),
      old_value            TEXT,
      proposed_value       TEXT,
      source_snapshot_id   INTEGER REFERENCES dld_snapshot ON DELETE SET NULL,
      decision             TEXT NOT NULL DEFAULT 'pending'
                           CHECK (decision IN ('pending','approved','rejected')),
      decision_notes       TEXT,
      proposed_at          TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at           TEXT,
      decided_by           TEXT
    );
    INSERT INTO dld_project (project_name) VALUES ('PROJ_OLD');
    INSERT INTO pending_change (project_id, unit_number_norm, field_name, decision)
      VALUES (1, '101', 'buyer_name', 'pending');
  `);
  seed.close();

  // openDb on the same file — must not throw and must upgrade in place.
  const { openDb } = require('../src/db');
  let db;
  assert.doesNotThrow(() => { db = openDb(tmp); });

  const cols = db.prepare('PRAGMA table_info(pending_change)').all().map(c => c.name);
  assert.ok(cols.includes('change_type'),    'expected change_type column after upgrade');
  assert.ok(cols.includes('override_value'), 'expected override_value column after upgrade');
  const row = db.prepare("SELECT change_type, decision FROM pending_change WHERE unit_number_norm = '101'").get();
  assert.equal(row.change_type, 'MISMATCH');
  assert.equal(row.decision, 'pending');

  db.prepare("INSERT INTO pending_change (project_id, unit_number_norm, field_name, decision) VALUES (1, '102', 'buyer_name', 'auto_applied')").run();

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('audit_log'));
  assert.ok(tables.includes('buyer_alias'));
  assert.ok(tables.includes('schema_migration'));

  db.close();
  try { fs.unlinkSync(tmp); } catch {}
});

test('006 adds 3 new columns to sf_booking', () => {
  // sf_booking is created by schema.sql, not by a migration; initialize the
  // DB from schema.sql so sf_booking exists for 006 to extend.
  const db = freshDb();
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  const cols = db.prepare('PRAGMA table_info(sf_booking)').all().map(c => c.name);
  assert.ok(cols.includes('current_step_name'),          'expected current_step_name');
  assert.ok(cols.includes('current_step_assigned_name'), 'expected current_step_assigned_name');
  assert.ok(cols.includes('comments'),                   'expected comments');
});

test('006 is idempotent — re-running does not error', () => {
  const db = freshDb();
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  // Drop the schema_migration entry and re-run; should be a no-op (columns already exist).
  db.prepare("DELETE FROM schema_migration WHERE id = '2026-05-13-006-sf-booking-step-cols'").run();
  assert.doesNotThrow(() => runMigrations(db));
});

test('007 widens audit_log.action CHECK to allow approve_bp / reject_bp / acknowledge_bp', () => {
  const db = freshDb();
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  // All 3 new actions should be insertable now.
  assert.doesNotThrow(() => {
    db.prepare("INSERT INTO audit_log (table_name, field, action, source) VALUES ('x','y','approve_bp','review_pending')").run();
    db.prepare("INSERT INTO audit_log (table_name, field, action, source) VALUES ('x','y','reject_bp','review_pending')").run();
    db.prepare("INSERT INTO audit_log (table_name, field, action, source) VALUES ('x','y','acknowledge_bp','review_pending')").run();
  });
});

test('007 preserves existing audit_log rows during rebuild', () => {
  // Fresh DB initialized from updated schema.sql, then seed an audit_log
  // row and re-run migrations. Existing row must be intact.
  const db = freshDb();
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT INTO audit_log (table_name, field, action, source) VALUES ('x','y','approve','review_pending')").run();
  runMigrations(db);
  const cnt = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
  assert.equal(cnt, 1);
});
