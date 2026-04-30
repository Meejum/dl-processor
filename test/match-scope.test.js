const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { compareProject } = require('../src/compare');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

function seedProject(db, projectId, projectName) {
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (?, ?)').run(projectId, projectName);
}

function seedDldUnitWithTx(db, { snapshotId, unitId, projectId, unitNumber, buyer, price }) {
  db.prepare('INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, building_id) VALUES (?, ?, ?, ?, ?, NULL)')
    .run(unitId, snapshotId, projectId, unitNumber, unitNumber.toUpperCase());
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (?, ?, ?, 'Sale', '2026-01-01', ?, ?)`)
    .run(snapshotId, unitId, projectId, buyer, price);
}

function seedSf(db, sfSnapshotId, project, subProject, unit, applicant, price) {
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sfSnapshotId, project, subProject, unit, unit.toUpperCase(), applicant, price);
}

test('match_scope=project queries SF by project (not sub_project)', () => {
  const db = setupDb();
  seedProject(db, 1, 'Sobha One Multi');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, NULL, '', 'Sobha One', 'project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  seedSf(db, 1, 'Sobha One', 'Sobha One - A', 'SO-A1001', 'JANE DOE', 1000000);
  seedSf(db, 1, 'Sobha One', 'Sobha One - B', 'SO-B1001', 'JOHN DOE', 1000000);
  seedDldUnitWithTx(db, { snapshotId: 1, unitId: 1, projectId: 1, unitNumber: 'SO-A1001', buyer: 'JANE DOE', price: 1000000 });

  const result = compareProject(db, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.rows.length, 2);
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].sf_unit, 'SO-A1001');
});

test('match_scope=sub_project (default) queries SF by sub_project', () => {
  const db = setupDb();
  seedProject(db, 1, 'Just Waves');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Waves', 'W', 'Sobha Hartland', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  seedSf(db, 1, 'Sobha Hartland', 'Waves', 'W-101', 'JANE DOE', 500000);
  seedSf(db, 1, 'Sobha Hartland', 'Waves Grande', 'WG-101', 'JOHN DOE', 600000);
  seedDldUnitWithTx(db, { snapshotId: 1, unitId: 1, projectId: 1, unitNumber: '101', buyer: 'JANE DOE', price: 500000 });

  const result = compareProject(db, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].match_status, 'MATCH');
});
