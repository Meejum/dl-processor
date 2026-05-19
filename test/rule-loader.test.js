const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { loadRules } = require('../src/rule-loader');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

// Helper: replace every builtin with a clean slate so each test starts from
// a known rule set without touching migration 009's seed behavior.
function clearRules(db) {
  db.prepare('DELETE FROM automation_rule').run();
}

function insertRule(db, row) {
  db.prepare(`
    INSERT INTO automation_rule
      (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'), 'test')
  `).run(
    row.id, row.name, row.enabled == null ? 1 : row.enabled, row.priority,
    typeof row.when === 'string' ? row.when : JSON.stringify(row.when),
    typeof row.then === 'string' ? row.then : JSON.stringify(row.then)
  );
}

test('loadRules: loads enabled rules and JSON-parses when/then', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 10, name: 'r10', priority: 100,
    when: { op: 'and', clauses: [{ field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }] },
    then: { action: 'auto_approve' }
  });
  const rules = loadRules(db);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 10);
  assert.equal(typeof rules[0].when, 'object');
  assert.equal(rules[0].when.op, 'and');
  assert.equal(rules[0].then.action, 'auto_approve');
  assert.equal(rules[0].enabled, true);
});

test('loadRules: skips disabled rules', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 20, name: 'on', priority: 100, enabled: 1,
    when: { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
    then: { action: 'auto_approve' }
  });
  insertRule(db, {
    id: 21, name: 'off', priority: 101, enabled: 0,
    when: { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
    then: { action: 'auto_approve' }
  });
  const rules = loadRules(db);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 20);
});

test('loadRules: sorts by priority ASC (lower wins first)', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 30, name: 'b', priority: 200,
    when: { field: 'change_type', operator: '=', value: 'A' },
    then: { action: 'auto_approve' }
  });
  insertRule(db, {
    id: 31, name: 'a', priority: 100,
    when: { field: 'change_type', operator: '=', value: 'A' },
    then: { action: 'auto_approve' }
  });
  insertRule(db, {
    id: 32, name: 'c', priority: 150,
    when: { field: 'change_type', operator: '=', value: 'A' },
    then: { action: 'auto_approve' }
  });
  const rules = loadRules(db);
  assert.deepEqual(rules.map(r => r.id), [31, 32, 30]);
  assert.deepEqual(rules.map(r => r.priority), [100, 150, 200]);
});

test('loadRules: malformed when_json disables the rule + writes audit_log source=rule_fired', () => {
  const db = freshDb();
  clearRules(db);
  // Insert raw with broken JSON in when_json.
  db.prepare(`
    INSERT INTO automation_rule
      (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
    VALUES (40, 'bad', 1, 100, '{not json', '{"action":"auto_approve"}', 0, datetime('now'), 'test')
  `).run();

  const rules = loadRules(db);
  assert.equal(rules.length, 0, 'malformed rule must be skipped');
  const after = db.prepare('SELECT enabled FROM automation_rule WHERE id=40').get();
  assert.equal(after.enabled, 0, 'malformed rule must be disabled in DB');
  const audit = db.prepare(
    "SELECT * FROM audit_log WHERE table_name='automation_rule' AND source='rule_fired' AND action='auto_apply' ORDER BY audit_id DESC LIMIT 1"
  ).get();
  assert.ok(audit, 'audit_log row must exist');
  assert.equal(audit.field, 'enabled');
  assert.equal(audit.old_value, '1');
  assert.equal(audit.new_value, '0');
  assert.match(audit.user_note || '', /disabled:/);
});

test('loadRules: unknown operator disables the rule', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 50, name: 'badop', priority: 100,
    when: { field: 'change_type', operator: '~~', value: 'X' },
    then: { action: 'auto_approve' }
  });
  const rules = loadRules(db);
  assert.equal(rules.length, 0);
  const row = db.prepare('SELECT enabled FROM automation_rule WHERE id=50').get();
  assert.equal(row.enabled, 0);
  const audit = db.prepare(
    "SELECT user_note FROM audit_log WHERE table_name='automation_rule' AND source='rule_fired' ORDER BY audit_id DESC LIMIT 1"
  ).get();
  assert.match(audit.user_note, /operator/);
});

test('loadRules: unknown field disables the rule', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 60, name: 'badfield', priority: 100,
    when: { field: 'not_a_field', operator: '=', value: 'X' },
    then: { action: 'auto_approve' }
  });
  const rules = loadRules(db);
  assert.equal(rules.length, 0);
  const row = db.prepare('SELECT enabled FROM automation_rule WHERE id=60').get();
  assert.equal(row.enabled, 0);
});

test('loadRules: flag_anomaly without anomaly_severity disables the rule', () => {
  const db = freshDb();
  clearRules(db);
  insertRule(db, {
    id: 70, name: 'badthen', priority: 100,
    when: { field: 'change_type', operator: '=', value: 'X' },
    then: { action: 'flag_anomaly' }  // missing anomaly_severity
  });
  const rules = loadRules(db);
  assert.equal(rules.length, 0);
  const row = db.prepare('SELECT enabled FROM automation_rule WHERE id=70').get();
  assert.equal(row.enabled, 0);
  const audit = db.prepare(
    "SELECT user_note FROM audit_log WHERE table_name='automation_rule' AND source='rule_fired' ORDER BY audit_id DESC LIMIT 1"
  ).get();
  assert.match(audit.user_note, /anomaly_severity/);
});

test('loadRules: built-in seeds (4 rules from migration 009) load cleanly', () => {
  const db = freshDb();
  // Don't clear — verify the migration-seeded rules pass validation.
  const rules = loadRules(db);
  // 4 built-ins from migration 009, all enabled.
  const ids = rules.map(r => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1000, 1001, 1002, 1003]);
});
