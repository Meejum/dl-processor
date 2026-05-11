const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { upsertMasterField } = require('../src/master-data');
const { queueMasterDiffs, listPending } = require('../src/pending-change');

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

function insertUnit(db, sid, pid, unitNum, buyer, price, area) {
  const norm = String(unitNum).toUpperCase().replace(/\s+/g, '');
  const uid = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sid, pid, unitNum, norm, area).lastInsertRowid;
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed)
     VALUES (?, ?, ?, ?, 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', ?)`
  ).run(uid, sid, pid, buyer, price);
  return { uid, norm };
}

test('auto-approve: price within 0.5% with dld_approved source applies + writes audit row, no pending', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1004000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name',         'BOB',     'dld_approved');
  upsertMasterField(db, pid, norm, 'purchase_price_aed', 1000000,   'dld_approved');
  upsertMasterField(db, pid, norm, 'area_sqm',           75,        'dld_approved');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.find(p => p.field_name === 'purchase_price_aed'), undefined);
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, norm);
  assert.equal(m.purchase_price_aed, 1004000);
  assert.equal(m.price_source, 'dld_approved');
  const audit = db.prepare(
    `SELECT * FROM pending_change WHERE project_id=? AND unit_number_norm=? AND field_name='purchase_price_aed'`
  ).get(pid, norm);
  assert.ok(audit);
  assert.equal(audit.decision, 'approved');
  assert.equal(audit.decided_by, 'auto');
  assert.equal(audit.proposed_value, '1004000');
  assert.equal(audit.old_value, '1000000');
  assert.ok(audit.decided_at);
});

test('auto-approve: price above tolerance queues pending instead', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1010000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name',         'BOB',     'dld_approved');
  upsertMasterField(db, pid, norm, 'purchase_price_aed', 1000000,   'dld_approved');
  upsertMasterField(db, pid, norm, 'area_sqm',           75,        'dld_approved');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  const priceRow = pending.find(p => p.field_name === 'purchase_price_aed');
  assert.ok(priceRow);
  assert.equal(priceRow.decision, 'pending');
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, norm);
  assert.equal(m.purchase_price_aed, 1000000);
});

test('auto-approve: skipped when master source is staff (sticky)', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1004000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name',         'BOB',     'dld_approved');
  upsertMasterField(db, pid, norm, 'purchase_price_aed', 1000000,   'staff');
  upsertMasterField(db, pid, norm, 'area_sqm',           75,        'dld_approved');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  const priceRow = pending.find(p => p.field_name === 'purchase_price_aed');
  assert.ok(priceRow, 'staff-source diff still queues as pending');
  assert.equal(priceRow.decision, 'pending');
});

test('auto-approve: identity fields (buyer_name) never auto-approve', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1000000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name',         'ALICE',   'dld_approved');
  upsertMasterField(db, pid, norm, 'purchase_price_aed', 1000000,   'dld_approved');
  upsertMasterField(db, pid, norm, 'area_sqm',           75,        'dld_approved');
  queueMasterDiffs(db, sid);
  const buyerRow = listPending(db).find(p => p.field_name === 'buyer_name');
  assert.ok(buyerRow);
  assert.equal(buyerRow.decision, 'pending');
});

test('auto-approve: first-time field set (master row exists, field null) takes per-field bootstrap path, not auto-approve', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1000000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name', 'BOB', 'dld_approved');
  queueMasterDiffs(db, sid);
  const auditAuto = db.prepare(
    `SELECT * FROM pending_change WHERE project_id=? AND decided_by='auto'`
  ).all(pid);
  assert.equal(auditAuto.length, 0, 'first-time field set must not write an auto audit row');
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, norm);
  assert.equal(m.purchase_price_aed, 1000000);
  assert.equal(m.price_source, 'dld_approved');
});

test('auto-approve: re-propose after rejection with tiny shift can auto-approve', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  const { norm } = insertUnit(db, sid, pid, '101', 'BOB', 1004000, 75);
  upsertMasterField(db, pid, norm, 'buyer_name',         'BOB',     'dld_approved');
  upsertMasterField(db, pid, norm, 'purchase_price_aed', 1000000,   'dld_approved');
  upsertMasterField(db, pid, norm, 'area_sqm',           75,        'dld_approved');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, ?, 'purchase_price_aed', '1000000', '1200000', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid, norm);
  queueMasterDiffs(db, sid);
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, norm);
  assert.equal(m.purchase_price_aed, 1004000);
  const auto = db.prepare(
    `SELECT * FROM pending_change WHERE project_id=? AND unit_number_norm=? AND field_name='purchase_price_aed' AND decided_by='auto'`
  ).get(pid, norm);
  assert.ok(auto);
});
