const test = require('node:test');
const assert = require('node:assert/strict');
const { asAuditFlag, normName, normNameStripSobha, buildHeaderIndex, parseProjectSheet, inferProjectId } = require('../src/import-audit');
const Database = require('better-sqlite3');
const fs = require('fs');

test('asAuditFlag handles boolean true/false', () => {
  assert.equal(asAuditFlag(true), 1);
  assert.equal(asAuditFlag(false), 0);
});

test('asAuditFlag handles string TRUE/FALSE/YES/NO/Y/N (case-insensitive, trimmed)', () => {
  assert.equal(asAuditFlag('TRUE'), 1);
  assert.equal(asAuditFlag('  true  '), 1);
  assert.equal(asAuditFlag('FALSE'), 0);
  assert.equal(asAuditFlag('YES'), 1);
  assert.equal(asAuditFlag('No'), 0);
  assert.equal(asAuditFlag('y'), 1);
  assert.equal(asAuditFlag('N'), 0);
});

test('asAuditFlag handles numeric 0 and 1', () => {
  assert.equal(asAuditFlag(1), 1);
  assert.equal(asAuditFlag(0), 0);
});

test('asAuditFlag returns null for blank/unrecognized', () => {
  assert.equal(asAuditFlag(null), null);
  assert.equal(asAuditFlag(undefined), null);
  assert.equal(asAuditFlag(''), null);
  assert.equal(asAuditFlag('maybe'), null);
  assert.equal(asAuditFlag('unknown'), null);
});

test('normName lowercases, strips non-alphanumeric, drops trailing row count', () => {
  assert.equal(normName('Sobha Skyparks 684'), 'sobha skyparks');
  assert.equal(normName('SOBHA-HARTLAND/WAVES'), 'sobha hartland waves');
  assert.equal(normName('  Crest Grande 985  '), 'crest grande');
});

test('normNameStripSobha drops the leading "sobha "', () => {
  assert.equal(normNameStripSobha('Sobha Reserve'), 'reserve');
  assert.equal(normNameStripSobha('Reserve'), 'reserve');
});

test('buildHeaderIndex maps SF + DLD columns from row-1 audit sheet headers', () => {
  const headerRow = ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System', 'Count of Customers', 'Procedure Type'];
  const { idx } = buildHeaderIndex(headerRow);
  assert.equal(idx.sub_project, 0);
  assert.equal(idx.sf_unit, 1);
  assert.equal(idx.sf_booking_name, 2);
  assert.equal(idx.sf_applicant, 3);
  assert.equal(idx.sf_price, 4);
  assert.equal(idx.dld_unit, 5);
  assert.equal(idx.rooms, 6);
  assert.equal(idx.details, 7);
  assert.equal(idx.name_match, 8);
  assert.equal(idx.price_match, 9);
  assert.equal(idx.count_customers, 10);
  assert.equal(idx.procedure_type, 11);
});

test('buildHeaderIndex tracks audit-only columns separately', () => {
  const headerRow = ['Unit', 'Remarks', 'Notes', 'Name Match Status'];
  const { idx, auditCols } = buildHeaderIndex(headerRow);
  assert.equal(idx.sf_unit, 0);
  assert.ok(auditCols.length >= 1);
});

test('parseProjectSheet handles the canonical audit-sheet shape (banner row 0, headers row 1)', () => {
  const aoa = [
    ['Salesforce', null, null, null, null, 'Oqood Data', null, null, 'Checked by Registrations Team'],
    ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System'],
    ['Skyvue Solair', 'SSO-801', 'B-33447', 'Mrs. M K', 1819704, 'B801', '1 B/R', 'M K (35.22 F.T.) ...', 'TRUE', 'TRUE'],
    ['Skyvue Solair', 'SSO-802', 'B-30720', 'Mr. S D', 2366727.25, 'B802', '2 B/R', 'S D (90.67 F.T.) ...', 'TRUE', 'FALSE']
  ];
  const ws = require('xlsx').utils.aoa_to_sheet(aoa);
  const { rows } = parseProjectSheet(ws);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sub_project, 'Skyvue Solair');
  assert.equal(rows[0].sf_unit, 'SSO-801');
  assert.equal(rows[0].dld_unit, 'B801');
  assert.equal(rows[0].sf_price, 1819704);
  assert.equal(rows[0].name_match, 1);
  assert.equal(rows[0].price_match, 1);
  assert.equal(rows[1].name_match, 1);
  assert.equal(rows[1].price_match, 0);
});

test('parseProjectSheet handles banner-less sheet (headers on row 0)', () => {
  const aoa = [
    ['Sub Project', 'Unit', 'DLD Unit'],
    ['X', 'A-1', '1']
  ];
  const ws = require('xlsx').utils.aoa_to_sheet(aoa);
  const { rows } = parseProjectSheet(ws);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sf_unit, 'A-1');
  assert.equal(rows[0].dld_unit, '1');
});

test('inferProjectId fuzzy-matches sheet name with trailing row count', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name, sf_unit_prefix) VALUES (1, 'Sobha SkyParks', 'SO-SK')").run();
  const r = inferProjectId(db, 'Sobha Skyparks 684');
  assert.equal(r.projectId, 1);
  assert.equal(r.inferred, 'Sobha SkyParks');
  assert.equal(r.prefix, 'SO-SK');
});

test('inferProjectId returns null projectId when no match', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'Unrelated')").run();
  const r = inferProjectId(db, 'Sobha Reserve 123');
  assert.equal(r.projectId, null);
});

const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { importAuditWorkbook } = require('../src/import-audit');

function makeAuditFixture(tmpPath) {
  const wb = XLSX.utils.book_new();
  const aoa = [
    ['Salesforce', null, null, null, null, 'Oqood Data', null, null, 'Checked by Registrations Team', null],
    ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System'],
    ['Test Sub', 'A-1', 'B-1', 'JOHN DOE', 1000000, '1', '1 B/R', 'JOHN DOE (50.0 F.T.) ...', 'TRUE', 'TRUE'],
    ['Test Sub', 'A-2', 'B-2', 'JANE DOE', 2000000, '2', '2 B/R', 'JANE DOE (80.0 F.T.) ...', 'FALSE', 'TRUE']
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Test Project 99');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ignored']]), 'Report');
  XLSX.writeFile(wb, tmpPath);
}

test('importAuditWorkbook writes snapshot/project/row tables and skips the Report sheet', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'Test Project')").run();

  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const res = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04', note: 'unit-test' });
    assert.equal(res.status, 'ok');
    assert.equal(res.projects, 1, 'expected 1 project (Report sheet skipped)');
    assert.equal(res.matchedProjects, 1);
    assert.equal(res.inserted, 2);

    const snap = db.prepare('SELECT * FROM manual_audit_snapshot WHERE manual_audit_snapshot_id = ?').get(res.manualAuditSnapshotId);
    assert.equal(snap.as_of_month, '2026-04');
    assert.equal(snap.total_rows, 2);

    const rows = db.prepare('SELECT * FROM manual_audit_row ORDER BY manual_audit_row_id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sf_applicant, 'JOHN DOE');
    assert.equal(rows[0].name_match, 1);
    assert.equal(rows[0].price_match, 1);
    assert.equal(rows[1].name_match, 0, 'expected FALSE → 0');
    assert.equal(rows[1].price_match, 1);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('importAuditWorkbook returns duplicate when same file re-imported', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const r1 = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    assert.equal(r1.status, 'ok');
    const r2 = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    assert.equal(r2.status, 'duplicate');
    assert.equal(r2.manualAuditSnapshotId, r1.manualAuditSnapshotId);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('importAuditWorkbook computes name_false_count / price_false_count / both_true_count', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const res = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    const proj = db.prepare('SELECT * FROM manual_audit_project WHERE manual_audit_snapshot_id = ?').get(res.manualAuditSnapshotId);
    assert.equal(proj.row_count, 2);
    assert.equal(proj.name_false_count, 1);
    assert.equal(proj.price_false_count, 0);
    assert.equal(proj.both_true_count, 1);
    assert.equal(proj.blank_count, 0);
  } finally {
    fs.unlinkSync(tmp);
  }
});
