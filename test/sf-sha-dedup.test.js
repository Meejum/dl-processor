const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');
const { importSfRows } = require('../src/salesforce');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migrateSchema(db);
  return db;
}

function writeTempXlsx(content) {
  const tmp = path.join(os.tmpdir(), 'sf-dedup-test-' + crypto.randomBytes(4).toString('hex') + '.txt');
  fs.writeFileSync(tmp, content, 'utf8');
  return tmp;
}

const SHA_A = crypto.createHash('sha256').update('file-content-a').digest('hex');
const SHA_B = crypto.createHash('sha256').update('file-content-b').digest('hex');

const SAMPLE_ROWS = [{ bpName: 'BP1', subProject: 'Waves', unit: 'W-101', bookingName: 'BK-1',
  project: 'P', towerName: null, applicantName: 'Alice', purchasePrice: 1000000, dldAmount: 40000,
  preRegStatus: null, status: 'Active', rmProcessStatus: null, dldProcessStatus: null,
  bpCreatedDate: null, preRegCompletionDate: null, procedureNumber: null,
  paymentReferenceNumber: null, paymentDate: null, bookingRecordId: null,
  totalDldPaid: null, dldShortfall: null, dldBalance: null, currentStepName: null,
  endDate: null, nationality: null, applicantDetails: null,
  applicant2Name: null, applicant3Name: null, applicant4Name: null, docusignComplete: null }];

test('importSfSnapshot dedups by source_sha256', () => {
  const db = makeDb();

  // First import with SHA_A — should insert a real snapshot
  const r1 = importSfRows({ db, rows: SAMPLE_ROWS, generatedAt: null, sourceFile: 'snap-a.xlsx', sourceSha256: SHA_A });
  assert.ok(r1.sfSnapshotId, 'first import should return a snapshot id');
  assert.equal(r1.rowsInserted, 1, 'first import should insert rows');
  assert.ok(!r1.deduped, 'first import should not be deduped');

  // Second import with same SHA_A — should dedup
  const r2 = importSfRows({ db, rows: SAMPLE_ROWS, generatedAt: null, sourceFile: 'snap-a-copy.xlsx', sourceSha256: SHA_A });
  assert.equal(r2.sfSnapshotId, r1.sfSnapshotId, 'deduped import should reuse the same snapshot id');
  assert.equal(r2.rowsInserted, 0, 'deduped import should insert zero rows');
  assert.equal(r2.deduped, true, 'deduped flag should be true');

  // Third import with SHA_B — should insert a new snapshot
  const r3 = importSfRows({ db, rows: SAMPLE_ROWS, generatedAt: null, sourceFile: 'snap-b.xlsx', sourceSha256: SHA_B });
  assert.notEqual(r3.sfSnapshotId, r1.sfSnapshotId, 'different sha should produce a new snapshot');
  assert.ok(!r3.deduped, 'different sha import should not be deduped');

  db.close();
});
