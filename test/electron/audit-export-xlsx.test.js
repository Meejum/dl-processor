const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const { runMigrations } = require('../../src/migrations');
const { writeAuditLog } = require('../../src/audit-log');
const { globalHistory } = require('../../src/commands/audit-query');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('PROJ_A')").run();
  return db;
}

// The IPC handler isn't directly testable here (needs Electron), but we can
// test the same SHAPE — query globalHistory + assemble the xlsx + read it back.

function buildXlsxFromRows(rows, savePath) {
  const headers = [
    'Timestamp', 'User', 'Project', 'Unit', 'Field',
    'Old value', 'New value', 'Action', 'Source',
    'Tier-2', 'Justification', 'Row hash'
  ];
  const data = [headers, ...rows.map(r => [
    r.ts, r.user || '', r.project_name || '', r.unit_number_norm || '',
    r.field || '', r.old_value != null ? String(r.old_value) : '',
    r.new_value != null ? String(r.new_value) : '',
    r.action || '', r.source || '',
    r.tier2 ? 'TIER-2' : '', r.user_note || '', r.row_hash || ''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
  XLSX.writeFile(wb, savePath);
}

test('xlsx export: writes file with correct headers', () => {
  const db = freshDb();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;
  writeAuditLog(db, { projectId: pid, unitNumberNorm: '101',
                       tableName: 'master_data', field: 'price',
                       oldValue: '100', newValue: '200',
                       action: 'approve', source: 'review_pending' });
  const rows = globalHistory(db, { limit: 1000 });
  const tmp = path.join(os.tmpdir(), 'dlp-xlsx-test-' + Date.now() + '.xlsx');
  buildXlsxFromRows(rows, tmp);

  const wb = XLSX.readFile(tmp);
  const ws = wb.Sheets['Audit Log'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  assert.deepEqual(data[0], [
    'Timestamp', 'User', 'Project', 'Unit', 'Field',
    'Old value', 'New value', 'Action', 'Source',
    'Tier-2', 'Justification', 'Row hash'
  ]);
  assert.equal(data.length, 2);   // header + 1 data row
  try { fs.unlinkSync(tmp); } catch {}
});

test('xlsx export: honors filters (e.g., project filter)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('PROJ_B')").run();
  const pidA = db.prepare("SELECT project_id FROM dld_project WHERE project_name='PROJ_A'").get().project_id;
  const pidB = db.prepare("SELECT project_id FROM dld_project WHERE project_name='PROJ_B'").get().project_id;
  writeAuditLog(db, { projectId: pidA, tableName: 'master_data', field: 'x', action: 'approve', source: 'review_pending' });
  writeAuditLog(db, { projectId: pidB, tableName: 'master_data', field: 'x', action: 'approve', source: 'review_pending' });

  const onlyA = globalHistory(db, { projectId: pidA });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].project_name, 'PROJ_A');

  const tmp = path.join(os.tmpdir(), 'dlp-xlsx-filter-' + Date.now() + '.xlsx');
  buildXlsxFromRows(onlyA, tmp);
  const data = XLSX.utils.sheet_to_json(XLSX.readFile(tmp).Sheets['Audit Log'], { header: 1 });
  assert.equal(data.length, 2);   // header + only PROJ_A row
  assert.equal(data[1][2], 'PROJ_A');
  try { fs.unlinkSync(tmp); } catch {}
});

test('xlsx export: tier-2 column populated correctly', () => {
  const db = freshDb();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;
  // Non-tier-2 row
  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'price',
                       action: 'approve', source: 'review_pending', tier2: false });
  // Tier-2 row
  writeAuditLog(db, { projectId: pid, tableName: 'master_data', field: 'price',
                       action: 'approve', source: 'review_pending', tier2: true,
                       userNote: 'verified with manager' });
  const rows = globalHistory(db);
  const tmp = path.join(os.tmpdir(), 'dlp-xlsx-tier2-' + Date.now() + '.xlsx');
  buildXlsxFromRows(rows, tmp);
  const data = XLSX.utils.sheet_to_json(XLSX.readFile(tmp).Sheets['Audit Log'], { header: 1 });
  // data[0] is headers; rows come in DESC order from globalHistory (newest first)
  // so the tier-2 row is data[1], non-tier-2 is data[2]
  const tier2Idx = data[0].indexOf('Tier-2');
  const justIdx  = data[0].indexOf('Justification');
  assert.equal(data[1][tier2Idx], 'TIER-2');
  assert.equal(data[1][justIdx], 'verified with manager');
  assert.equal(data[2][tier2Idx], '');
  try { fs.unlinkSync(tmp); } catch {}
});
