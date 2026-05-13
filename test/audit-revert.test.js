const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const { revertAuditEntry } = require('../src/commands/audit-revert');
const { writeAuditLog } = require('../src/audit-log');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  return db;
}

function seedApprovedChange(db, oldVal, newVal) {
  const pid = db.prepare("SELECT project_id FROM dld_project WHERE project_name='A'").get().project_id;
  // Set master_data to the new value (simulate post-approve state)
  db.prepare(`
    INSERT INTO master_data (project_id, unit_number_norm, purchase_price_aed, price_source, price_decided_at)
    VALUES (?, '101', ?, 'dld_approved', datetime('now'))
  `).run(pid, newVal);
  // Write an approve audit_log row capturing the change
  writeAuditLog(db, {
    projectId: pid, unitNumberNorm: '101',
    tableName: 'master_data', field: 'purchase_price_aed',
    oldValue: String(oldVal), newValue: String(newVal),
    action: 'approve', source: 'review_pending'
  });
  const auditId = db.prepare("SELECT audit_id FROM audit_log ORDER BY audit_id DESC LIMIT 1").get().audit_id;
  return { pid, auditId };
}

test('revertAuditEntry: restores master_data to old_value + writes revert audit row', () => {
  const db = freshDb();
  const { pid, auditId } = seedApprovedChange(db, 1000000, 1500000);
  revertAuditEntry(db, auditId);

  // master_data restored to 1000000
  const md = db.prepare("SELECT purchase_price_aed, price_source FROM master_data WHERE project_id = ? AND unit_number_norm = '101'").get(pid);
  assert.equal(md.purchase_price_aed, 1000000);
  assert.equal(md.price_source, 'staff');   // revert sets source to staff

  // A new revert audit row exists
  const rev = db.prepare("SELECT * FROM audit_log WHERE action = 'revert' ORDER BY audit_id DESC LIMIT 1").get();
  assert.ok(rev);
  assert.equal(rev.field, 'purchase_price_aed');
  assert.equal(rev.old_value, '1500000');   // the value we just undid
  assert.equal(rev.new_value, '1000000');   // restored to
  assert.match(rev.user_note, /revert of audit_id=/);
});

test('revertAuditEntry: refuses non-revertable action (auto_apply)', () => {
  const db = freshDb();
  const pid = db.prepare("SELECT project_id FROM dld_project WHERE project_name='A'").get().project_id;
  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'purchase_price_aed',
                       oldValue: '100', newValue: '200', action: 'auto_apply', source: 'compare' });
  const auditId = db.prepare("SELECT audit_id FROM audit_log ORDER BY audit_id DESC LIMIT 1").get().audit_id;
  assert.throws(() => revertAuditEntry(db, auditId), /cannot revert action='auto_apply'/);
});

test('revertAuditEntry: refuses non-master_data table', () => {
  const db = freshDb();
  const pid = db.prepare("SELECT project_id FROM dld_project WHERE project_name='A'").get().project_id;
  writeAuditLog(db, { projectId: pid, tableName: 'buyer_alias', field: 'variant',
                       oldValue: null, newValue: 'mohammad → mohamed',
                       action: 'learn_alias', source: 'review_pending' });
  const auditId = db.prepare("SELECT audit_id FROM audit_log ORDER BY audit_id DESC LIMIT 1").get().audit_id;
  // learn_alias is not revertable AND table is not master_data — either error is fine,
  // but it must throw
  assert.throws(() => revertAuditEntry(db, auditId));
});

test('revertAuditEntry: throws on unknown audit_id', () => {
  const db = freshDb();
  assert.throws(() => revertAuditEntry(db, 999999), /audit row not found/);
});

test('revertAuditEntry: atomic — master_data + audit_log change together', () => {
  const db = freshDb();
  const { pid, auditId } = seedApprovedChange(db, 1000000, 1500000);
  const auditCountBefore = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
  revertAuditEntry(db, auditId);
  const auditCountAfter = db.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n;
  const md = db.prepare("SELECT purchase_price_aed FROM master_data").get();
  // Both effects landed
  assert.equal(auditCountAfter, auditCountBefore + 1);
  assert.equal(md.purchase_price_aed, 1000000);
});

test('revertAuditEntry: multi-step revert walks back through audit history', () => {
  const db = freshDb();
  const pid = db.prepare("SELECT project_id FROM dld_project WHERE project_name='A'").get().project_id;
  // Seed: master_data starts at 100
  db.prepare(`INSERT INTO master_data (project_id, unit_number_norm, purchase_price_aed, price_source) VALUES (?, '101', 100, 'staff')`).run(pid);
  // approve to 200
  writeAuditLog(db, { projectId: pid, unitNumberNorm: '101', tableName: 'master_data',
                       field: 'purchase_price_aed', oldValue: '100', newValue: '200',
                       action: 'approve', source: 'review_pending' });
  db.prepare("UPDATE master_data SET purchase_price_aed = 200").run();
  const aid1 = db.prepare("SELECT audit_id FROM audit_log ORDER BY audit_id DESC LIMIT 1").get().audit_id;
  // override to 300
  writeAuditLog(db, { projectId: pid, unitNumberNorm: '101', tableName: 'master_data',
                       field: 'purchase_price_aed', oldValue: '200', newValue: '300',
                       action: 'override', source: 'review_pending' });
  db.prepare("UPDATE master_data SET purchase_price_aed = 300").run();
  const aid2 = db.prepare("SELECT audit_id FROM audit_log ORDER BY audit_id DESC LIMIT 1").get().audit_id;

  // Revert the override (step back to 200)
  revertAuditEntry(db, aid2);
  assert.equal(db.prepare("SELECT purchase_price_aed FROM master_data").get().purchase_price_aed, 200);

  // Revert the approve (step further back to 100)
  revertAuditEntry(db, aid1);
  assert.equal(db.prepare("SELECT purchase_price_aed FROM master_data").get().purchase_price_aed, 100);
});
