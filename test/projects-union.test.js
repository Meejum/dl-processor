const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');

function freshDb() {
  const db = new Database(':memory:');
  // Apply real schema so we have dld_project, sf_booking, etc.
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

test('listProjects returns DLD-only projects', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('PROJECT_A')").run();
  const { listProjects } = require('../src/commands/projects');
  const rows = listProjects(db);
  assert.deepEqual(rows.map(r => r.project_name), ['PROJECT_A']);
  assert.equal(rows[0].source, 'DLD only');
  // DLD-side projects expose their dld_project.project_id so callers
  // (renderer History filter) can pass it through to audit_log queries.
  assert.equal(typeof rows[0].project_id, 'number');
});

test('listProjects returns SF-only projects (via sf_booking)', () => {
  const db = freshDb();
  // Need at least one snapshot to attach a booking to
  db.prepare("INSERT INTO sf_snapshot (source_file) VALUES ('test.xlsx')").run();
  const ssid = db.prepare("SELECT sf_snapshot_id FROM sf_snapshot").get().sf_snapshot_id;
  db.prepare("INSERT INTO sf_booking (sf_snapshot_id, sub_project) VALUES (?, 'PROJECT_B')").run(ssid);
  const { listProjects } = require('../src/commands/projects');
  const rows = listProjects(db);
  assert.deepEqual(rows.map(r => r.project_name), ['PROJECT_B']);
  assert.equal(rows[0].source, 'SF only');
  // SF-only projects have no dld_project row, so project_id is NULL.
  assert.equal(rows[0].project_id, null);
});

test('listProjects merges DLD + SF projects with correct source labels', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A'), ('BOTH')").run();
  db.prepare("INSERT INTO sf_snapshot (source_file) VALUES ('x')").run();
  const ssid = db.prepare("SELECT sf_snapshot_id FROM sf_snapshot").get().sf_snapshot_id;
  db.prepare("INSERT INTO sf_booking (sf_snapshot_id, sub_project) VALUES (?, 'BOTH'), (?, 'B_SF_ONLY')").run(ssid, ssid);
  const { listProjects } = require('../src/commands/projects');
  const rows = listProjects(db);
  const byName = Object.fromEntries(rows.map(r => [r.project_name, r.source]));
  assert.equal(byName['A'],         'DLD only');
  assert.equal(byName['BOTH'],      'DLD+SF');
  assert.equal(byName['B_SF_ONLY'], 'SF only');
});

test('listProjects ignores rows with NULL project_name', () => {
  const db = freshDb();
  db.prepare("INSERT INTO sf_snapshot (source_file) VALUES ('x')").run();
  const ssid = db.prepare("SELECT sf_snapshot_id FROM sf_snapshot").get().sf_snapshot_id;
  db.prepare("INSERT INTO sf_booking (sf_snapshot_id, sub_project) VALUES (?, NULL)").run(ssid);
  const { listProjects } = require('../src/commands/projects');
  assert.equal(listProjects(db).length, 0);
});
