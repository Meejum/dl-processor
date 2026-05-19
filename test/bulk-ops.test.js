const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { upsertMasterField } = require('../src/master-data');
const { bulkApprove, bulkReject } = require('../src/commands/bulk');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  return db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name).lastInsertRowid;
}

function insertPending(db, projectId, unitNumberNorm, fieldName, oldValue, proposedValue) {
  return db.prepare(
    `INSERT INTO pending_change
       (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, unitNumberNorm, fieldName, oldValue, proposedValue).lastInsertRowid;
}

let __seedCounter = 0;
function seedThree(db) {
  const pid = insertProject(db, 'P' + (++__seedCounter));
  // Establish prior master_data so approve-path's upsertMasterField updates
  // rather than inserts new rows.
  upsertMasterField(db, pid, 'A-101', 'buyer_name', 'OLD ONE',   'staff');
  upsertMasterField(db, pid, 'A-102', 'buyer_name', 'OLD TWO',   'staff');
  upsertMasterField(db, pid, 'A-103', 'buyer_name', 'OLD THREE', 'staff');
  const ids = [
    insertPending(db, pid, 'A-101', 'buyer_name', 'OLD ONE',   'NEW ONE'),
    insertPending(db, pid, 'A-102', 'buyer_name', 'OLD TWO',   'NEW TWO'),
    insertPending(db, pid, 'A-103', 'buyer_name', 'OLD THREE', 'NEW THREE')
  ];
  return { pid, ids };
}

test('bulkApprove: 3 rows → 3 approved + 3 audit_log rows + master_data updated', () => {
  const db = buildDb();
  const { pid, ids } = seedThree(db);
  const result = bulkApprove(db, ids);

  assert.equal(result.applied, 3);
  assert.deepEqual(result.failed, []);
  assert.equal(result.total, 3);
  assert.ok(result.batchId && typeof result.batchId === 'string');

  const approved = db.prepare(
    "SELECT COUNT(*) AS n FROM pending_change WHERE decision='approved'"
  ).get().n;
  assert.equal(approved, 3);

  const logs = db.prepare(
    "SELECT action, source, user_note FROM audit_log WHERE source='bulk_op' ORDER BY audit_id"
  ).all();
  assert.equal(logs.length, 3);
  for (const l of logs) {
    assert.equal(l.action, 'approve');
    assert.equal(l.source, 'bulk_op');
    assert.match(l.user_note, /^batch=/);
  }

  // master_data updated for all three units
  for (const unit of ['A-101', 'A-102', 'A-103']) {
    const md = db.prepare(
      'SELECT buyer_name, buyer_source FROM master_data WHERE project_id=? AND unit_number_norm=?'
    ).get(pid, unit);
    assert.match(md.buyer_name, /^NEW /);
    assert.equal(md.buyer_source, 'dld_approved');
  }
});

test('bulkReject: 3 rows → 3 rejected + no master_data writes', () => {
  const db = buildDb();
  const { pid, ids } = seedThree(db);
  // Snapshot master_data buyer_names before
  const before = db.prepare(
    'SELECT unit_number_norm, buyer_name FROM master_data WHERE project_id=? ORDER BY unit_number_norm'
  ).all(pid);

  const result = bulkReject(db, ids);
  assert.equal(result.applied, 3);
  assert.deepEqual(result.failed, []);

  const rejected = db.prepare(
    "SELECT COUNT(*) AS n FROM pending_change WHERE decision='rejected'"
  ).get().n;
  assert.equal(rejected, 3);

  // master_data unchanged (still 'OLD ...')
  const after = db.prepare(
    'SELECT unit_number_norm, buyer_name FROM master_data WHERE project_id=? ORDER BY unit_number_norm'
  ).all(pid);
  assert.deepEqual(after, before);
});

test('batch_id is the same across all rows in one call, different across two calls', () => {
  const db = buildDb();
  const { ids: ids1 } = seedThree(db);
  const r1 = bulkApprove(db, ids1);
  const notes1 = db.prepare(
    "SELECT user_note FROM audit_log WHERE source='bulk_op'"
  ).all().map(r => r.user_note);
  // All notes share the same batch id from this call.
  for (const n of notes1) assert.ok(n.includes('batch=' + r1.batchId));

  // Second call → fresh batch id.
  const { ids: ids2 } = seedThree(db);
  const r2 = bulkApprove(db, ids2);
  assert.notEqual(r1.batchId, r2.batchId);
});

test('chunked: 75 rowIds → all 75 processed', () => {
  const db = buildDb();
  const pid = insertProject(db, 'BIG');
  const ids = [];
  for (let i = 0; i < 75; i++) {
    const unit = 'U-' + i;
    upsertMasterField(db, pid, unit, 'buyer_name', 'OLD ' + i, 'staff');
    ids.push(insertPending(db, pid, unit, 'buyer_name', 'OLD ' + i, 'NEW ' + i));
  }
  const result = bulkApprove(db, ids);
  assert.equal(result.applied, 75);
  assert.deepEqual(result.failed, []);
  assert.equal(result.total, 75);

  const approved = db.prepare(
    "SELECT COUNT(*) AS n FROM pending_change WHERE decision='approved'"
  ).get().n;
  assert.equal(approved, 75);

  // All 75 audit rows share the same batch id.
  const notes = db.prepare(
    "SELECT DISTINCT user_note FROM audit_log WHERE source='bulk_op'"
  ).all();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_note, 'batch=' + result.batchId);
});

test('already-decided row counted as failed (not throw)', () => {
  const db = buildDb();
  const { ids } = seedThree(db);
  // Pre-decide the middle row.
  db.prepare("UPDATE pending_change SET decision='approved' WHERE change_id=?").run(ids[1]);

  const result = bulkApprove(db, ids);
  assert.equal(result.applied, 2);
  assert.deepEqual(result.failed, [ids[1]]);
  assert.equal(result.total, 3);
});

test('tier-2 row in selection passes justification through to user_note', () => {
  const db = buildDb();
  const pid = insertProject(db, 'P');
  upsertMasterField(db, pid, 'A-1', 'purchase_price_aed', 1000000, 'staff');
  // Big price jump → tier-2 (default threshold 10% / 50k AED).
  const cid = insertPending(db, pid, 'A-1', 'purchase_price_aed', '1000000', '1500000');

  const result = bulkApprove(db, [cid], 'big jump approved by manager');
  assert.equal(result.applied, 1);
  assert.deepEqual(result.failed, []);

  const log = db.prepare(
    "SELECT user_note, tier2 FROM audit_log WHERE source='bulk_op' AND change_id=?"
  ).get(cid);
  assert.match(log.user_note, /^batch=.*; tier2: big jump approved by manager$/);
  assert.equal(log.tier2, 1, 'tier2 column must be set for magnitude row');
});

test('missing row id in the list counts as failed', () => {
  const db = buildDb();
  const { ids } = seedThree(db);
  const phantomId = 999999;
  const result = bulkApprove(db, [ids[0], phantomId, ids[2]]);
  assert.equal(result.applied, 2);
  assert.deepEqual(result.failed, [phantomId]);
  assert.equal(result.total, 3);
});
