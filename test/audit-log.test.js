const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { writeAuditLog } = require('../src/audit-log');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

test('writeAuditLog inserts a row with all fields', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;

  writeAuditLog(db, {
    projectId: pid,
    unitNumberNorm: '101',
    tableName: 'master_data',
    field: 'purchase_price_aed',
    oldValue: '1485000',
    newValue: '1500000',
    action: 'override',
    source: 'review_pending',
    changeId: null,
    userNote: 'rounded up'
  });

  const row = db.prepare('SELECT * FROM audit_log').get();
  assert.equal(row.project_id, pid);
  assert.equal(row.unit_number_norm, '101');
  assert.equal(row.table_name, 'master_data');
  assert.equal(row.field, 'purchase_price_aed');
  assert.equal(row.old_value, '1485000');
  assert.equal(row.new_value, '1500000');
  assert.equal(row.action, 'override');
  assert.equal(row.source, 'review_pending');
  assert.equal(row.user_note, 'rounded up');
});

test('writeAuditLog rejects invalid action via CHECK', () => {
  const db = freshDb();
  assert.throws(() => writeAuditLog(db, {
    projectId: 1, unitNumberNorm: '1', tableName: 't', field: 'f',
    action: 'invalid_action', source: 'review_pending'
  }), /CHECK/);
});

test('writeAuditLog rejects invalid source via CHECK', () => {
  const db = freshDb();
  assert.throws(() => writeAuditLog(db, {
    projectId: 1, unitNumberNorm: '1', tableName: 't', field: 'f',
    action: 'approve', source: 'not_a_source'
  }), /CHECK/);
});

test('writeAuditLog allows null unit_number_norm for non-unit events', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;
  writeAuditLog(db, {
    projectId: pid,
    unitNumberNorm: null,
    tableName: 'buyer_alias',
    field: 'variant',
    oldValue: null,
    newValue: 'mohammad → mohamed',
    action: 'learn_alias',
    source: 'review_pending'
  });
  const row = db.prepare('SELECT * FROM audit_log').get();
  assert.equal(row.unit_number_norm, null);
});

test('AUDIT_FIELDS lists the 5 tracked master_data fields', () => {
  const { AUDIT_FIELDS } = require('../src/audit-fields');
  assert.deepEqual([...AUDIT_FIELDS].sort(),
    ['area_sqm', 'buyer_name', 'procedure_number', 'purchase_price_aed', 'status']);
});
