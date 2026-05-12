const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const { lookupAlias } = require('../src/alias-lookup');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dld_project (project_id INTEGER PRIMARY KEY, project_name TEXT);
    INSERT INTO dld_project (project_id, project_name) VALUES (1, 'ONE'), (2, 'TWO');
    -- pending_change is intentionally omitted: migration 003 no-ops when the
    -- table is absent (its Guard 1), avoiding a stub-vs-real-schema mismatch.
  `);
  runMigrations(db);
  return db;
}

test('returns null when no alias exists', () => {
  const db = freshDb();
  assert.equal(lookupAlias(db, 1, 'unknownvariant'), null);
});

test('finds project-scoped alias', () => {
  const db = freshDb();
  db.prepare("INSERT INTO buyer_alias (project_id, variant, canonical, display) VALUES (1, 'foo', 'bar', 'Bar')").run();
  assert.equal(lookupAlias(db, 1, 'foo'), 'bar');
});

test('finds global alias (project_id NULL)', () => {
  const db = freshDb();
  // Seeded by migration 004: 'mohammad' → 'mohamed'
  assert.equal(lookupAlias(db, 1, 'mohammad'), 'mohamed');
});

test('project-scoped alias takes precedence over global', () => {
  const db = freshDb();
  // Override the global 'mohammad' → 'mohamed' alias for project 1 only
  db.prepare("INSERT INTO buyer_alias (project_id, variant, canonical, display) VALUES (1, 'mohammad', 'muhammed_special', 'Muhammed Special')").run();
  assert.equal(lookupAlias(db, 1, 'mohammad'), 'muhammed_special');
  // Project 2 still uses the global alias
  assert.equal(lookupAlias(db, 2, 'mohammad'), 'mohamed');
});

test('returns null for null/empty variant', () => {
  const db = freshDb();
  assert.equal(lookupAlias(db, 1, null), null);
  assert.equal(lookupAlias(db, 1, ''), null);
});

test('returns null for missing project_id', () => {
  const db = freshDb();
  assert.equal(lookupAlias(db, null, 'mohammad'), null);
});
