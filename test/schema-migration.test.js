const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');

const OLD_SCHEMA = `
CREATE TABLE dld_project (
  project_id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT UNIQUE NOT NULL
);
CREATE TABLE sf_snapshot (
  sf_snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sf_booking (
  sf_booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sf_snapshot_id INTEGER NOT NULL REFERENCES sf_snapshot,
  bp_name TEXT,
  applicant_name TEXT,
  end_date TEXT
);
CREATE TABLE project_mapping (
  project_id     INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
  sf_sub_project TEXT NOT NULL,
  sf_unit_prefix TEXT NOT NULL,
  sf_project     TEXT,
  source         TEXT NOT NULL DEFAULT 'auto',
  notes          TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function colNames(db, table) {
  return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name));
}

function colNotNull(db, table, name) {
  const r = db.prepare('PRAGMA table_info(' + table + ')').all().find(c => c.name === name);
  return r ? r.notnull === 1 : null;
}

test('migrateSchema adds missing sf_booking columns', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  assert.equal(colNames(db, 'sf_booking').has('nationality'), false, 'pre-condition: column missing');
  migrateSchema(db);
  const cols = colNames(db, 'sf_booking');
  for (const c of ['nationality', 'applicant_details', 'applicant_2_name', 'applicant_3_name', 'applicant_4_name', 'docusign_complete']) {
    assert.ok(cols.has(c), 'expected sf_booking to have column ' + c);
  }
});

test('migrateSchema adds match_scope column to project_mapping', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  assert.equal(colNames(db, 'project_mapping').has('match_scope'), false);
  migrateSchema(db);
  assert.ok(colNames(db, 'project_mapping').has('match_scope'));
});

test('migrateSchema drops NOT NULL on project_mapping.sf_sub_project and sf_unit_prefix', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  assert.equal(colNotNull(db, 'project_mapping', 'sf_sub_project'), true, 'pre-condition: NOT NULL');
  assert.equal(colNotNull(db, 'project_mapping', 'sf_unit_prefix'), true);
  migrateSchema(db);
  assert.equal(colNotNull(db, 'project_mapping', 'sf_sub_project'), false);
  assert.equal(colNotNull(db, 'project_mapping', 'sf_unit_prefix'), false);
});

test('migrateSchema preserves existing project_mapping rows during rebuild', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'Test')").run();
  db.prepare("INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, source) VALUES (1, 'Sub', 'PRE', 'Proj', 'override')").run();
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM project_mapping WHERE project_id = 1').get();
  assert.equal(row.sf_sub_project, 'Sub');
  assert.equal(row.sf_unit_prefix, 'PRE');
  assert.equal(row.sf_project, 'Proj');
  assert.equal(row.source, 'override');
  assert.equal(row.match_scope, 'sub_project');
});

test('migrateSchema is idempotent (running twice leaves DB unchanged)', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  migrateSchema(db);
  const colsAfter1 = colNames(db, 'sf_booking');
  migrateSchema(db);
  const colsAfter2 = colNames(db, 'sf_booking');
  assert.deepEqual([...colsAfter1].sort(), [...colsAfter2].sort());
  // project_mapping should still have nullable sub_project after second run
  assert.equal(colNotNull(db, 'project_mapping', 'sf_sub_project'), false);
});

test('migrateSchema adds manual_area table', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  // Pre-condition: table absent
  const before = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='manual_area'`).get();
  assert.equal(before, undefined);
  migrateSchema(db);
  const after = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='manual_area'`).get();
  assert.ok(after, 'expected manual_area table to be created');
  const cols = colNames(db, 'manual_area');
  for (const c of ['manual_area_id','project_id','unit_number_norm','area_sqm','source_note','entered_by','created_at','updated_at']) {
    assert.ok(cols.has(c), 'manual_area missing column ' + c);
  }
});

test('migrateSchema adds area_threshold_pct to project_mapping', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  assert.equal(colNames(db, 'project_mapping').has('area_threshold_pct'), false);
  migrateSchema(db);
  assert.ok(colNames(db, 'project_mapping').has('area_threshold_pct'));
});

test('openDb on a fresh path produces a schema with all expected columns', () => {
  const { openDb } = require('../src/db');
  const tmpPath = require('path').join(require('os').tmpdir(), 'dlp-schema-test-' + Date.now() + '.sqlite');
  const db = openDb(tmpPath);
  try {
    const sfCols = colNames(db, 'sf_booking');
    assert.ok(sfCols.has('applicant_2_name'));
    assert.ok(sfCols.has('docusign_complete'));
    const pmCols = colNames(db, 'project_mapping');
    assert.ok(pmCols.has('match_scope'));
    assert.equal(colNotNull(db, 'project_mapping', 'sf_sub_project'), false);
  } finally {
    db.close();
    require('fs').unlinkSync(tmpPath);
  }
});
