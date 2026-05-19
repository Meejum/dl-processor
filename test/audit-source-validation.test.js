const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const {
  writeAuditLog,
  validateAuditSource,
  auditSourceFor,
  VALID_AUDIT_SOURCES
} = require('../src/audit-log');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

test('VALID_AUDIT_SOURCES contains 7 values including new rule_fired + bulk_op', () => {
  assert.equal(VALID_AUDIT_SOURCES.size, 7);
  for (const v of ['review_pending', 'import_dld', 'import_sf', 'apply_pending', 'compare', 'rule_fired', 'bulk_op']) {
    assert.ok(VALID_AUDIT_SOURCES.has(v), `${v} should be valid`);
  }
});

test('validateAuditSource accepts all 7 enum values', () => {
  for (const v of VALID_AUDIT_SOURCES) {
    assert.equal(validateAuditSource(v), true, v);
  }
});

test('validateAuditSource rejects unknown values', () => {
  for (const v of ['', null, undefined, 'not_a_source', 'RULE_FIRED', 'rule:1000', 'bulk:abc']) {
    assert.equal(validateAuditSource(v), false, `${v} should be invalid`);
  }
});

test('auditSourceFor.rule() returns CHECK-safe rule_fired', () => {
  assert.equal(auditSourceFor.rule(), 'rule_fired');
  assert.equal(auditSourceFor.rule(1000), 'rule_fired'); // id ignored — pattern lives in user_note
});

test('auditSourceFor.bulk() returns CHECK-safe bulk_op', () => {
  assert.equal(auditSourceFor.bulk(), 'bulk_op');
  assert.equal(auditSourceFor.bulk('abc-123'), 'bulk_op'); // uuid ignored — lives in user_note
});

test('writeAuditLog throws with clear message on invalid source (fail-fast before CHECK)', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO dld_project (project_name) VALUES ('P1')`).run();
  const projectId = db.prepare(`SELECT project_id FROM dld_project WHERE project_name='P1'`).get().project_id;
  assert.throws(
    () => writeAuditLog(db, {
      projectId, tableName: 'master_data', field: 'buyer_name',
      action: 'approve', source: 'not_a_source'
    }),
    /invalid audit_log\.source/i,
    'should throw a validateAuditSource error, not a CHECK constraint error'
  );
});

test('writeAuditLog accepts rule_fired with rule_id in userNote', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO dld_project (project_name) VALUES ('P1')`).run();
  const projectId = db.prepare(`SELECT project_id FROM dld_project WHERE project_name='P1'`).get().project_id;
  assert.doesNotThrow(() =>
    writeAuditLog(db, {
      projectId, tableName: 'master_data', field: 'buyer_name',
      action: 'auto_apply', source: auditSourceFor.rule(),
      userNote: 'rule_id=1000; alias match'
    })
  );
  const row = db.prepare("SELECT source, user_note FROM audit_log WHERE source='rule_fired'").get();
  assert.equal(row.source, 'rule_fired');
  assert.match(row.user_note, /rule_id=1000/);
});
