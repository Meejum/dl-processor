const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { compareProject } = require('../src/compare');
const { upsertMasterField } = require('../src/master-data');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function setupProjectWithUnit(db, projectName, unitNumber, dldBuyer, sfBuyer) {
  const pid = db.prepare(
    'INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix) VALUES (?, ?, ?)'
  ).run(projectName, projectName + ' Sub', 'P').lastInsertRowid;
  const sid = db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, total_units, total_tx)
     VALUES (?, 'csv', 'fake.csv', '2026-01-01', 1, 1)`
  ).run(pid).lastInsertRowid;
  const norm = String(unitNumber).toUpperCase();
  const uid = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area)
     VALUES (?, ?, ?, ?, 75.0)`
  ).run(sid, pid, unitNumber, norm).lastInsertRowid;
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed)
     VALUES (?, ?, ?, ?, 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1500000)`
  ).run(uid, sid, pid, dldBuyer);
  const sfSid = db.prepare(
    `INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 1)`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price)
     VALUES (?, ?, ?, ?, ?, 1500000)`
  ).run(sfSid, projectName + ' Sub', 'P-' + unitNumber, 'P-' + norm, sfBuyer);
  return pid;
}

test('compareProject uses master_data.buyer_name when set, ignoring DLD primary', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'BOB', 'ALICE');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'master ALICE matches SF ALICE — clean MATCH');
});

test('compareProject falls back to DLD primary when master_data has no row', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  // No master_data row.
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'fallback to DLD ALICE matches SF ALICE');
});

test('compareProject result row includes pending_changes array (empty by default)', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.ok(Array.isArray(row.pending_changes));
  assert.equal(row.pending_changes.length, 0);
});

test('compareProject populates pending_changes when open changes exist', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid);
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.pending_changes.length, 1);
  assert.equal(row.pending_changes[0].field_name, 'buyer_name');
  assert.equal(row.pending_changes[0].proposed_value, 'BOB');
  assert.ok(row.match_flags.includes('PENDING'), 'PENDING flag should be in match_flags');
});

test('compareProject SF matching uses canonical buyer (master if set, else DLD primary)', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'BOB', 'CAROL');
  upsertMasterField(db, pid, '101', 'buyer_name', 'CAROL', 'staff');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'master CAROL matches SF CAROL despite DLD saying BOB');
});
