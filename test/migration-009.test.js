const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

test('migration 009: creates automation_rule table', () => {
  const db = freshDb();
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='automation_rule'"
  ).get();
  assert.ok(row, 'automation_rule must exist');
  assert.match(row.sql, /priority\s+INTEGER NOT NULL/);
  assert.match(row.sql, /builtin\s+INTEGER NOT NULL DEFAULT 0/);
  assert.match(row.sql, /when_json\s+TEXT NOT NULL/);
  assert.match(row.sql, /then_json\s+TEXT NOT NULL/);
});

test('migration 009: creates priority index on automation_rule', () => {
  const db = freshDb();
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='automation_rule'"
  ).all();
  assert.ok(idx.some(r => r.name === 'idx_automation_rule_priority'),
    'idx_automation_rule_priority must exist');
});

test('migration 009: adds pending_change.anomaly column', () => {
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(pending_change)').all();
  const anomaly = cols.find(c => c.name === 'anomaly');
  assert.ok(anomaly, 'anomaly column must exist');
  assert.equal(anomaly.type.toUpperCase(), 'TEXT');
  assert.equal(anomaly.notnull, 0, 'anomaly must be nullable');
  assert.equal(anomaly.dflt_value, null, 'anomaly default must be NULL');
});

test('migration 009: widens audit_log.source CHECK to include rule_fired + bulk_op', () => {
  const db = freshDb();
  const newSources = ['rule_fired', 'bulk_op'];
  const insertSql = `
    INSERT INTO audit_log
      (ts, table_name, field, action, source)
    VALUES (?, ?, ?, ?, ?)
  `;
  for (const src of newSources) {
    assert.doesNotThrow(
      () => db.prepare(insertSql).run(new Date().toISOString(), 'master_data', 'buyer_name', 'approve', src),
      `source=${src} must be accepted by widened CHECK`
    );
  }
  // Old source values still accepted
  for (const src of ['review_pending', 'import_dld', 'import_sf', 'apply_pending', 'compare']) {
    assert.doesNotThrow(
      () => db.prepare(insertSql).run(new Date().toISOString(), 'master_data', 'buyer_name', 'approve', src),
      `legacy source=${src} must remain accepted`
    );
  }
  // Unknown source still rejected
  assert.throws(
    () => db.prepare(insertSql).run(new Date().toISOString(), 'master_data', 'buyer_name', 'approve', 'not_a_source'),
    /CHECK/
  );
});

test('migration 009: seeds 4 built-in rules', () => {
  const db = freshDb();
  const rules = db.prepare(
    "SELECT id, name, builtin, enabled, priority FROM automation_rule WHERE builtin=1 ORDER BY id"
  ).all();
  assert.equal(rules.length, 4);
  assert.deepEqual(rules.map(r => r.id), [1000, 1001, 1002, 1003]);
  for (const r of rules) {
    assert.equal(r.builtin, 1);
    assert.equal(r.enabled, 1);
    assert.ok(r.priority >= 1000, `built-in priority must be >=1000, got ${r.priority}`);
  }
  // Spot-check rule 1000 — alias auto-approve
  const r1000 = db.prepare("SELECT when_json, then_json FROM automation_rule WHERE id=1000").get();
  const when = JSON.parse(r1000.when_json);
  assert.equal(when.op, 'and');
  assert.ok(when.clauses.some(c => c.field === 'alias_exists' && c.value === true));
  const then = JSON.parse(r1000.then_json);
  assert.equal(then.action, 'auto_approve');
});

test('migration 009: is idempotent — second run does not duplicate built-ins', () => {
  const db = freshDb();
  runMigrations(db);  // second run
  const count = db.prepare("SELECT COUNT(*) AS n FROM automation_rule WHERE builtin=1").get().n;
  assert.equal(count, 4, 'built-ins must not duplicate on second migration run');
});
