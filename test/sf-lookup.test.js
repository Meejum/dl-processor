const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { lookupSfUnit } = require('../src/sf-lookup');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name, sfSubProject, sfUnitPrefix) {
  return db.prepare(
    `INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix)
     VALUES (?, ?, ?)`
  ).run(name, sfSubProject || null, sfUnitPrefix || null).lastInsertRowid;
}

function insertMapping(db, projectId, opts) {
  return db.prepare(
    `INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source)
     VALUES (?, ?, ?, ?, ?, 'manual')`
  ).run(projectId, opts.sf_sub_project || null, opts.sf_unit_prefix || null, opts.sf_project || null, opts.match_scope || 'sub_project');
}

function insertSfSnapshot(db) {
  return db.prepare(
    `INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('fake.xlsx', 1)`
  ).run().lastInsertRowid;
}

function insertSfBooking(db, sfSnapshotId, opts) {
  return db.prepare(
    `INSERT INTO sf_booking (sf_snapshot_id, sub_project, project, unit, unit_norm, applicant_name, purchase_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sfSnapshotId, opts.sub_project || null, opts.project || null, opts.unit, opts.unit_norm, opts.applicant_name || null, opts.purchase_price || null);
}

test('lookupSfUnit: sub_project scope happy path', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Hartland II', 'Hartland-2', null);
  insertMapping(db, pid, { sf_sub_project: 'Hartland-2', match_scope: 'sub_project' });
  const sid = insertSfSnapshot(db);
  insertSfBooking(db, sid, { sub_project: 'Hartland-2', unit: 'A-101', unit_norm: 'A-101', applicant_name: 'Smith', purchase_price: 1000000 });
  const r = lookupSfUnit(db, pid, 'A-101');
  assert.deepEqual(r, { sf_unit: 'A-101', sf_applicant: 'Smith', sf_price: 1000000 });
});

test('lookupSfUnit: project scope happy path', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Sky', null, null);
  insertMapping(db, pid, { sf_project: 'Sky-Tower', match_scope: 'project' });
  const sid = insertSfSnapshot(db);
  insertSfBooking(db, sid, { project: 'Sky-Tower', unit: 'B-202', unit_norm: 'B-202', applicant_name: 'Jones', purchase_price: 2000000 });
  const r = lookupSfUnit(db, pid, 'B-202');
  assert.deepEqual(r, { sf_unit: 'B-202', sf_applicant: 'Jones', sf_price: 2000000 });
});

test('lookupSfUnit: sf_unit_prefix transform applied', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Creek', 'Creek-Sub', 'CV');
  insertMapping(db, pid, { sf_sub_project: 'Creek-Sub', sf_unit_prefix: 'CV', match_scope: 'sub_project' });
  const sid = insertSfSnapshot(db);
  insertSfBooking(db, sid, { sub_project: 'Creek-Sub', unit: 'CV-1101', unit_norm: 'CV-1101', applicant_name: 'Khan', purchase_price: 3000000 });
  const r = lookupSfUnit(db, pid, '1101');
  assert.ok(r);
  assert.equal(r.sf_unit, 'CV-1101');
  assert.equal(r.sf_applicant, 'Khan');
});

test('lookupSfUnit: returns null when no project_mapping exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Orphan', null, null);
  insertSfSnapshot(db);
  assert.equal(lookupSfUnit(db, pid, 'A-1'), null);
});

test('lookupSfUnit: returns null when no SF booking matches', () => {
  const db = buildDb();
  const pid = insertProject(db, 'P', 'P-sub', null);
  insertMapping(db, pid, { sf_sub_project: 'P-sub', match_scope: 'sub_project' });
  const sid = insertSfSnapshot(db);
  insertSfBooking(db, sid, { sub_project: 'P-sub', unit: 'X-1', unit_norm: 'X-1' });
  assert.equal(lookupSfUnit(db, pid, 'Y-99'), null);
});
