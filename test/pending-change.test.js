const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { upsertMasterField, seedMasterFromDld } = require('../src/master-data');
const {
  queueMasterDiffs,
  listPending,
  applyDecision,
  proposalAlreadyRejected
} = require('../src/pending-change');

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

function insertSnapshot(db, projectId) {
  return db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, total_units, total_tx)
     VALUES (?, 'csv', 'fake.csv', '2026-01-01', 1, 1)`
  ).run(projectId).lastInsertRowid;
}

function insertUnitWithBuyer(db, snapshotId, projectId, unitNumber, buyerName) {
  const norm = String(unitNumber).toUpperCase().replace(/\s+/g, '');
  const uid = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area)
     VALUES (?, ?, ?, ?, ?)`
  ).run(snapshotId, projectId, unitNumber, norm, 75.0).lastInsertRowid;
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed)
     VALUES (?, ?, ?, ?, 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1500000)`
  ).run(uid, snapshotId, projectId, buyerName);
  return uid;
}

test('queueMasterDiffs creates pending row when DLD differs from master', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'BOB');
  // Pre-existing master with different buyer:
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  const buyerRow = pending.find(p => p.field_name === 'buyer_name' && p.unit_number_norm === '101');
  assert.ok(buyerRow);
  assert.equal(buyerRow.proposed_value, 'BOB');
  assert.equal(buyerRow.old_value, 'ALICE');
  assert.equal(buyerRow.decision, 'pending');
});

test('queueMasterDiffs skips fields that match master', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'ALICE');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.find(p => p.field_name === 'buyer_name'), undefined);
});

test('queueMasterDiffs does NOT queue when no master row exists; bootstrap seeds master instead', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'ALICE');
  // No master row exists for this unit.
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 0, 'no pending changes for bootstrap');
  // master_data should now have a seeded row with dld_approved source.
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.ok(master);
  assert.equal(master.buyer_name, 'ALICE');
  assert.equal(master.buyer_source, 'dld_approved');
});

test('proposalAlreadyRejected returns true for matching rejected row', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  // Insert a rejected pending row directly:
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  assert.equal(proposalAlreadyRejected(db, pid, '101', 'buyer_name', 'BOB'), true);
  assert.equal(proposalAlreadyRejected(db, pid, '101', 'buyer_name', 'CAROL'), false);
});

test('queueMasterDiffs skips when proposal matches a rejected one (sticky reject)', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'BOB');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 0, 'sticky reject suppresses re-queueing');
});

test('queueMasterDiffs re-queues when proposed_value differs from a rejected one', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'CAROL');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].proposed_value, 'CAROL');
});

test('applyDecision approve updates master_data and marks pending row approved', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid).lastInsertRowid;
  applyDecision(db, cid, 'approve', 'OK');
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(master.buyer_name, 'BOB');
  assert.equal(master.buyer_source, 'dld_approved');
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision, 'approved');
  assert.ok(pc.decided_at);
  assert.equal(pc.decision_notes, 'OK');
  assert.equal(pc.decided_by, 'ali');
});

test('applyDecision reject leaves master_data alone', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid).lastInsertRowid;
  applyDecision(db, cid, 'reject', 'wrong');
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(master.buyer_name, 'ALICE');
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision, 'rejected');
  assert.equal(pc.decision_notes, 'wrong');
});

test('applyDecision throws on non-existent change_id', () => {
  const db = buildDb();
  assert.throws(() => applyDecision(db, 99999, 'approve', ''), /change_id 99999 not found/);
});

test('applyDecision throws on already-decided row (idempotency check)', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'BOB', 'approved', '2026-01-01 10:00:00', 'ali')`
  ).run(pid).lastInsertRowid;
  assert.throws(() => applyDecision(db, cid, 'approve', ''), /already decided/);
});

test('listPending returns only decision=pending rows by default', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision)
     VALUES (?, '101', 'buyer_name', 'BOB', 'pending')`
  ).run(pid);
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '102', 'buyer_name', 'CAROL', 'approved', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  const rows = listPending(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proposed_value, 'BOB');
});

test('listPending filters by project name when provided', () => {
  const db = buildDb();
  const a = insertProject(db, 'A');
  const b = insertProject(db, 'B');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value)
     VALUES (?, '101', 'buyer_name', 'BOB')`
  ).run(a);
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value)
     VALUES (?, '102', 'buyer_name', 'CAROL')`
  ).run(b);
  const rowsA = listPending(db, 'A');
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].proposed_value, 'BOB');
});
