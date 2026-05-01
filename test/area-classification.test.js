const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { compareProject, summarize } = require('../src/compare');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildFixture() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);

  const projInfo = db.prepare(`INSERT INTO dld_project (project_name) VALUES (?)`).run('Test Project');
  const projectId = projInfo.lastInsertRowid;
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, source) VALUES (?, ?, ?, ?)`)
    .run(projectId, 'Test Sub', 'T', 'manual');

  const snapInfo = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, total_units, total_tx) VALUES (?, 'csv', 'fixture.csv', 4, 4)`).run(projectId);
  const snapshotId = snapInfo.lastInsertRowid;
  const insUnit = db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, dld_unit_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insTx = db.prepare(`INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date_iso, amount_aed) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  function addUnit(num, netArea, buyer, price) {
    const u = insUnit.run(snapshotId, projectId, 'D' + num, num, num, 'Apartment', netArea);
    insTx.run(u.lastInsertRowid, snapshotId, projectId, buyer, 'Sale', '2026-01-15', price);
  }
  addUnit('101', 100.0, 'JOHN DOE', 1000000);
  addUnit('102', 102.0, 'JANE DOE', 2000000);
  addUnit('103', 110.0, 'BOB ROE', 3000000);
  addUnit('104', 110.0, 'WRONG NAME', 4000000);

  const sfSnap = db.prepare(`INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 4)`).run();
  const sfId = sfSnap.lastInsertRowid;
  const insSf = db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, ?, ?, ?, ?, ?)`);
  insSf.run(sfId, 'Test Sub', 'T-101', 'T-101', 'JOHN DOE', 1000000);
  insSf.run(sfId, 'Test Sub', 'T-102', 'T-102', 'JANE DOE', 2000000);
  insSf.run(sfId, 'Test Sub', 'T-103', 'T-103', 'BOB ROE', 3000000);
  insSf.run(sfId, 'Test Sub', 'T-104', 'T-104', 'CORRECT NAME', 4000000);

  const insArea = db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`);
  insArea.run(projectId, '101', 100.0);
  insArea.run(projectId, '102', 100.0);
  insArea.run(projectId, '103', 100.0);
  insArea.run(projectId, '104', 100.0);

  return { db, projectId };
}

test('exact area + name match → MATCH, no A11', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH');
  assert.ok(!(row.audit_flags || '').includes('A11'));
});

test('2% area drift → MATCH + A11 flag', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '102');
  assert.equal(row.match_status, 'MATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
});

test('10% area drift but exact name + price → AREA_MISMATCH', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '103');
  assert.equal(row.match_status, 'AREA_MISMATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
  assert.ok(Math.abs(row.area_diff_pct - 10) < 0.001);
  assert.equal(Math.round(row.area_diff_sqm), 10);
});

test('buyer mismatch + 10% area drift → BUYER_MISMATCH (not escalated to AREA_MISMATCH), A11 still flagged', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '104');
  assert.equal(row.match_status, 'BUYER_MISMATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
});

test('manual_area absent → area signal silent (kind=none)', () => {
  const { db, projectId } = buildFixture();
  db.prepare(`DELETE FROM manual_area WHERE unit_number_norm = ?`).run('103');
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '103');
  assert.equal(row.match_status, 'MATCH');
  assert.equal(row.area_diff_pct, null);
});

test('summarize includes AREA_MISMATCH', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const counts = summarize(result.rows);
  assert.ok('AREA_MISMATCH' in counts);
  assert.equal(counts.AREA_MISMATCH, 1);
});
