const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { diffProject, pickBaseline } = require('../src/diff');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  const info = db.prepare(
    `INSERT INTO dld_project (project_name) VALUES (?)`
  ).run(name);
  return info.lastInsertRowid;
}

function insertSnapshot(db, projectId, { snapshotDate, importedAt, sourceFormat = 'csv', sourceFile = 'fake.csv' }) {
  const info = db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, imported_at, total_units, total_tx)
     VALUES (?, ?, ?, ?, ?, 0, 0)`
  ).run(projectId, sourceFormat, sourceFile, snapshotDate, importedAt);
  return info.lastInsertRowid;
}

function insertUnit(db, snapshotId, projectId, { unitNumber, netArea = null, unitType = null }) {
  const norm = String(unitNumber).toUpperCase().replace(/\s+/g, '');
  const info = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area, unit_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(snapshotId, projectId, unitNumber, norm, netArea, unitType);
  return info.lastInsertRowid;
}

function insertTx(db, unitId, snapshotId, projectId, { partyName, txType = 'Sell', txDate = '2026-01-01', amountAed = 1000000 }) {
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date, amount_aed)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(unitId, snapshotId, projectId, partyName, txType, txDate, amountAed);
}

test('diffProject emits MISSING_UNIT (not REMOVED_UNIT) when includeMissing is true', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Alpha');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100, unitType: 'Apt' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid, { includeMissing: true });
  assert.equal(result.status, 'ok');
  const types = new Set(result.rows.map(r => r.change_type));
  assert.ok(types.has('MISSING_UNIT'), 'expected MISSING_UNIT, got: ' + [...types].join(','));
  assert.ok(!types.has('REMOVED_UNIT'), 'REMOVED_UNIT should no longer be emitted');
});

test('missing rows are hidden from rows and counted in hiddenMissingCount by default', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Beta');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const u = insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  insertTx(db, u, oldSnap, pid, { partyName: 'Alice' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid);
  assert.equal(result.status, 'ok');
  assert.equal(result.rows.length, 0, 'rows should be empty when missing are hidden');
  assert.deepEqual(result.hiddenMissingCount, { units: 1, txs: 1 });
});

test('hiddenMissingCount is zero when includeMissing is true', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Gamma');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const u = insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  insertTx(db, u, oldSnap, pid, { partyName: 'Alice' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid, { includeMissing: true });
  assert.equal(result.rows.length, 2, 'expected MISSING_UNIT + MISSING_TX rows');
  assert.deepEqual(result.hiddenMissingCount, { units: 0, txs: 0 });
});

test('hiddenMissingCount is zero when there are no missing rows', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Delta');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  const newSnap = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });
  insertUnit(db, newSnap, pid, { unitNumber: 'P-101', netArea: 105 });

  const result = diffProject(db, pid);
  assert.deepEqual(result.hiddenMissingCount, { units: 0, txs: 0 });
  assert.equal(result.rows.length, 1, 'expected one AREA_CHANGED row');
  assert.equal(result.rows[0].change_type, 'AREA_CHANGED');
});

test('pickBaseline with no since returns latest two', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-A');
  const s1 = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const s2 = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const r = pickBaseline(db, pid);
  assert.equal(r.status, 'ok');
  assert.equal(r.oldSnap.snapshot_id, s1);
  assert.equal(r.newSnap.snapshot_id, s2);
});

test('pickBaseline with since picks newest snapshot before that date as old', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-B');
  const s1 = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });
  const s2 = insertSnapshot(db, pid, { snapshotDate: '2026-03-01', importedAt: '2026-03-01 10:00:00' });
  const s3 = insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });

  const r = pickBaseline(db, pid, { since: '2026-03-15' });
  assert.equal(r.status, 'ok');
  assert.equal(r.oldSnap.snapshot_id, s2, 'baseline should be the March snapshot');
  assert.equal(r.newSnap.snapshot_id, s3, 'latest should still be the April snapshot');
});

test('pickBaseline with since returns no-baseline-before-date when nothing qualifies', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-C');
  insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });
  insertSnapshot(db, pid, { snapshotDate: '2026-05-01', importedAt: '2026-05-01 10:00:00' });

  const r = pickBaseline(db, pid, { since: '2026-01-01' });
  assert.equal(r.status, 'no-baseline-before-date');
  assert.equal(r.oldSnap, null);
});

test('pickBaseline throws on malformed since', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-D');
  insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });

  assert.throws(
    () => pickBaseline(db, pid, { since: 'not-a-date' }),
    /invalid --since date/
  );
});

test('pickBaseline with since returns no-baseline-before-date when project has no snapshots', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-E');
  const r = pickBaseline(db, pid, { since: '2026-03-15' });
  assert.equal(r.status, 'no-baseline-before-date');
});
