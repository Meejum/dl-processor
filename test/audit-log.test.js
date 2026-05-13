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

test('writeAuditLog: user auto-fills via currentUser() when not provided', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;
  writeAuditLog(db, {
    projectId: pid, unitNumberNorm: '101',
    tableName: 'master_data', field: 'price',
    oldValue: '100', newValue: '200',
    action: 'approve', source: 'review_pending'
  });
  const row = db.prepare("SELECT user FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.ok(row.user, 'expected user to be set');
  assert.notEqual(row.user, '');
});

test('writeAuditLog: explicit user overrides currentUser()', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;
  writeAuditLog(db, {
    projectId: pid, tableName: 'master_data', field: 'x',
    action: 'approve', source: 'review_pending',
    user: 'manager@sobha.ae'
  });
  const row = db.prepare("SELECT user FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.equal(row.user, 'manager@sobha.ae');
});

test('writeAuditLog: chains to prior row via chainAppend', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;

  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'price',
                       action: 'approve', source: 'review_pending' });
  const r1 = db.prepare("SELECT row_hash FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.match(r1.row_hash, /^[0-9a-f]{64}$/);

  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'buyer_name',
                       action: 'override', source: 'review_pending' });
  const r2 = db.prepare("SELECT prev_hash, row_hash FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.equal(r2.prev_hash, r1.row_hash);
  assert.notEqual(r2.row_hash, r1.row_hash);
});

test('writeAuditLog: tier2 flag is honored (0 or 1)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;

  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'price',
                       action: 'approve', source: 'review_pending' });
  const noFlag = db.prepare("SELECT tier2 FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.equal(noFlag.tier2, 0);

  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'price',
                       action: 'approve', source: 'review_pending', tier2: true });
  const withFlag = db.prepare("SELECT tier2 FROM audit_log ORDER BY audit_id DESC LIMIT 1").get();
  assert.equal(withFlag.tier2, 1);
});
