const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');
const { generateAreaTemplate, applyAreaTemplate } = require('../src/area-template');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function fixtureDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  const p = db.prepare(`INSERT INTO dld_project (project_name) VALUES ('P1')`).run();
  const projectId = p.lastInsertRowid;
  const s = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, total_units, total_tx) VALUES (?, 'csv', 'x.csv', 2, 0)`).run(projectId);
  const sid = s.lastInsertRowid;
  db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sid, projectId, '101', '101', 'Apartment', 100.5);
  db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sid, projectId, '102', '102', 'Apartment', 200.0);
  return { db, projectId };
}

test('generateAreaTemplate emits one row per DLD unit with expected columns', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'area-tpl-' + Date.now() + '.csv');
  const result = generateAreaTemplate({ db, projectFilter: 'P1', outPath: tmp });
  assert.equal(result.rowCount, 2);
  const csv = fs.readFileSync(tmp, 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('unit_number'));
  assert.ok(lines[0].includes('area_sqm'));
  assert.ok(lines[0].includes('dld_net_area'));
  fs.unlinkSync(tmp);
});

test('generateAreaTemplate pre-populates area_sqm from existing manual_area', () => {
  const { db, projectId } = fixtureDb();
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`).run(projectId, '101', 99.5);
  const tmp = path.join(os.tmpdir(), 'area-tpl-' + Date.now() + '.csv');
  generateAreaTemplate({ db, projectFilter: 'P1', outPath: tmp });
  const csv = fs.readFileSync(tmp, 'utf8');
  assert.ok(csv.includes('99.5'), 'expected pre-populated area_sqm');
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate upserts rows and skips blanks', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  const csv = [
    'project,unit_number,dld_unit_id,dld_buyer,dld_unit_type,sf_unit,sf_applicant,dld_net_area,area_sqm,source_note',
    'P1,101,,,,,,,98.5,from drawings',
    'P1,102,,,,,,,,'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(tmp, csv, 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);
  const row = db.prepare(`SELECT area_sqm, source_note FROM manual_area WHERE project_id = ? AND unit_number_norm = ?`).get(projectId, '101');
  assert.equal(row.area_sqm, 98.5);
  assert.equal(row.source_note, 'from drawings');
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate updates an existing row on re-apply', () => {
  const { db, projectId } = fixtureDb();
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`).run(projectId, '101', 50);
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nP1,101,77\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 1);
  const row = db.prepare(`SELECT area_sqm FROM manual_area WHERE project_id = ? AND unit_number_norm = ?`).get(projectId, '101');
  assert.equal(row.area_sqm, 77);
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate skips non-numeric area_sqm', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nP1,101,abc\r\nP1,102,-5\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 2);
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate skips rows whose project name is unknown', () => {
  const { db } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nUnknownProj,999,100\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.ok(result.warnings.length >= 1);
  fs.unlinkSync(tmp);
});
