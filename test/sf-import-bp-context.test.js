const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');
const { buildSfHeaderIndex, importSfRows } = require('../src/salesforce');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migrateSchema(db);
  return db;
}

// Minimal valid sf_booking row payload (used as a baseline; tests override the 3 new fields).
function baseRow(overrides = {}) {
  return Object.assign({
    bpName: 'BP-CTX-1', subProject: 'Waves', unit: 'W-101', bookingName: 'BK-CTX-1',
    project: 'P', towerName: null, applicantName: 'Alice', purchasePrice: 1000000, dldAmount: 40000,
    preRegStatus: null, status: 'Active', rmProcessStatus: null, dldProcessStatus: null,
    bpCreatedDate: null, preRegCompletionDate: null, procedureNumber: null,
    paymentReferenceNumber: null, paymentDate: null, bookingRecordId: null,
    totalDldPaid: null, dldShortfall: null, dldBalance: null,
    currentStepName: null, currentStepAssignedName: null, comments: null,
    endDate: null, nationality: null, applicantDetails: null,
    applicant2Name: null, applicant3Name: null, applicant4Name: null, docusignComplete: null
  }, overrides);
}

// --- Header-mapping tests (cases 1–4) ---

test('Task11/1: exact-as-listed headers map to the 3 new fields', () => {
  const idx = buildSfHeaderIndex([
    'Current Step Name',
    'Current Step: Assigned Name',
    'Comments'
  ]);
  assert.equal(idx.currentStepName, 0);
  assert.equal(idx.currentStepAssignedName, 1);
  assert.equal(idx.comments, 2);
});

test('Task11/2: case variations still map to the 3 new fields', () => {
  const idx = buildSfHeaderIndex([
    'current step name',
    'CURRENT STEP: ASSIGNED NAME',
    'comments'
  ]);
  assert.equal(idx.currentStepName, 0);
  assert.equal(idx.currentStepAssignedName, 1);
  assert.equal(idx.comments, 2);
});

test('Task11/3: leading/trailing whitespace in headers still maps', () => {
  const idx = buildSfHeaderIndex([
    '  Current Step Name  ',
    '  Current Step: Assigned Name  ',
    '   Comments   '
  ]);
  assert.equal(idx.currentStepName, 0);
  assert.equal(idx.currentStepAssignedName, 1);
  assert.equal(idx.comments, 2);
});

test('Task11/4: colon-less "Current Step Assigned Name" variant maps to currentStepAssignedName', () => {
  const idx = buildSfHeaderIndex([
    'Current Step Assigned Name'
  ]);
  assert.equal(idx.currentStepAssignedName, 0);
});

// --- Round-trip tests (cases 5–6) ---

test('Task11/5: v1.1 .xlsx lacking the 3 columns imports with NULL values (no errors)', () => {
  const db = makeDb();
  const rows = [baseRow()]; // currentStepName/currentStepAssignedName/comments all null
  const r = importSfRows({ db, rows, generatedAt: null, sourceFile: 'v1.1.xlsx', sourceSha256: null });
  assert.ok(r.sfSnapshotId, 'should insert snapshot');
  assert.equal(r.rowsInserted, 1);

  const row = db.prepare(`
    SELECT current_step_name, current_step_assigned_name, comments
    FROM sf_booking WHERE sf_snapshot_id = ?
  `).get(r.sfSnapshotId);
  assert.equal(row.current_step_name, null);
  assert.equal(row.current_step_assigned_name, null);
  assert.equal(row.comments, null);

  db.close();
});

test('Task11/6: comments with quotes and newlines round-trip verbatim', () => {
  const db = makeDb();
  const commentsText = 'Line 1 with "double quotes" and \'single quotes\'\nLine 2\r\nLine 3 — em-dash & ampersand.';
  const rows = [baseRow({
    currentStepName: 'DLD Completion with Payment',
    currentStepAssignedName: 'Ali Alghumlasi',
    comments: commentsText
  })];
  const r = importSfRows({ db, rows, generatedAt: null, sourceFile: 'v2.0.xlsx', sourceSha256: null });
  assert.equal(r.rowsInserted, 1);

  const row = db.prepare(`
    SELECT current_step_name, current_step_assigned_name, comments
    FROM sf_booking WHERE sf_snapshot_id = ?
  `).get(r.sfSnapshotId);
  assert.equal(row.current_step_name, 'DLD Completion with Payment');
  assert.equal(row.current_step_assigned_name, 'Ali Alghumlasi');
  assert.equal(row.comments, commentsText);

  db.close();
});
