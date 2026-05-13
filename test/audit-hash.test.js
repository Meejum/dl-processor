const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const { canonicalize, computeRowHash, chainAppend, GENESIS_PREV_HASH } = require('../src/audit-hash');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  // Task 2 ships before Task 4 (migration 008 adds prev_hash + row_hash).
  // The chainAppend test needs those columns to exist on audit_log. Add them
  // inline so this test is self-sufficient until migration 008 lands; once
  // migration 008 is in place, these ALTERs become no-ops via try/catch.
  for (const sql of [
    'ALTER TABLE audit_log ADD COLUMN user TEXT',
    'ALTER TABLE audit_log ADD COLUMN tier2 INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE audit_log ADD COLUMN prev_hash TEXT',
    'ALTER TABLE audit_log ADD COLUMN row_hash TEXT'
  ]) {
    try { db.exec(sql); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  }
  return db;
}

test('canonicalize: stable output regardless of input property order', () => {
  const a = { audit_id: 1, ts: '2026-05-13', project_id: 7, action: 'approve', source: 'review_pending', table_name: 'master_data', field: 'price', old_value: '100', new_value: '200' };
  const b = { source: 'review_pending', action: 'approve', new_value: '200', old_value: '100', field: 'price', table_name: 'master_data', project_id: 7, ts: '2026-05-13', audit_id: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
});

test('computeRowHash: deterministic — same input twice gives same hash', () => {
  const row = { audit_id: 1, ts: '2026-05-13', action: 'approve', source: 'review_pending', table_name: 'master_data', field: 'price' };
  const h1 = computeRowHash(null, row);
  const h2 = computeRowHash(null, row);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('computeRowHash: genesis prev_hash is 64 zeros', () => {
  assert.equal(GENESIS_PREV_HASH, '0'.repeat(64));
  const row = { audit_id: 1, action: 'approve', source: 'review_pending', table_name: 'x', field: 'y' };
  const withNull = computeRowHash(null, row);
  const withZeros = computeRowHash(GENESIS_PREV_HASH, row);
  assert.equal(withNull, withZeros);
});

test('computeRowHash: changing ANY field produces a different hash', () => {
  const base = { audit_id: 1, ts: '2026-05-13', action: 'approve', source: 'review_pending', table_name: 'master_data', field: 'price', old_value: '100', new_value: '200', user: null, tier2: 0 };
  const h = computeRowHash(null, base);
  // Mutating any field must change the hash
  for (const key of ['audit_id', 'ts', 'action', 'source', 'table_name', 'field', 'old_value', 'new_value', 'user', 'tier2']) {
    const mutated = Object.assign({}, base, { [key]: (typeof base[key] === 'number' ? base[key] + 1 : 'MUTATED') });
    const h2 = computeRowHash(null, mutated);
    assert.notEqual(h, h2, 'mutating ' + key + ' did not change the hash');
  }
});

test('chainAppend: writes prev_hash + row_hash for the new row; chains to prior row', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  // First audit row
  const r1 = db.prepare(`INSERT INTO audit_log (table_name, field, action, source) VALUES ('master_data', 'price', 'approve', 'review_pending')`).run();
  chainAppend(db, r1.lastInsertRowid);
  const row1 = db.prepare('SELECT prev_hash, row_hash FROM audit_log WHERE audit_id = ?').get(r1.lastInsertRowid);
  assert.equal(row1.prev_hash, GENESIS_PREV_HASH);
  assert.match(row1.row_hash, /^[0-9a-f]{64}$/);

  // Second audit row — should chain to first
  const r2 = db.prepare(`INSERT INTO audit_log (table_name, field, action, source) VALUES ('master_data', 'buyer_name', 'override', 'review_pending')`).run();
  chainAppend(db, r2.lastInsertRowid);
  const row2 = db.prepare('SELECT prev_hash, row_hash FROM audit_log WHERE audit_id = ?').get(r2.lastInsertRowid);
  assert.equal(row2.prev_hash, row1.row_hash);
  assert.notEqual(row2.row_hash, row1.row_hash);
});
