const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { migrateSchema } = require('../src/db');
const { upsertMasterField } = require('../src/master-data');
const { applyDecision } = require('../src/pending-change');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

// Mirror of the HTML "Export decisions" CSV format — 11 columns,
// applied_value between proposed_value and source_snapshot_date.
function htmlExportedCsv(rows) {
  const header = 'change_id,project_name,unit,field,old_value,proposed_value,applied_value,source_snapshot_date,proposed_at,decision,notes';
  const body = rows.map(r =>
    [r.change_id, r.project_name, r.unit, r.field, r.old_value, r.proposed_value, r.applied_value || '', r.source_snapshot_date || '', r.proposed_at || '', r.decision, r.notes || '']
      .map(v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; })
      .join(',')
  );
  return [header].concat(body).join('\r\n') + '\r\n';
}

// Mirror of cmdApplyPending's parse → dispatch loop.
function applyCsv(db, csv) {
  const rows = parse(csv, { relax_quotes: true, columns: true, skip_empty_lines: true });
  let approved = 0, rejected = 0;
  for (const r of rows) {
    const cid = parseInt(r.change_id, 10);
    if (isNaN(cid)) continue;
    const d = String(r.decision || '').trim().toLowerCase();
    const applied = r.applied_value === '' || r.applied_value == null ? null : r.applied_value;
    if (d === 'approve') { applyDecision(db, cid, 'approve', r.notes || '', applied); approved += 1; }
    else if (d === 'reject') { applyDecision(db, cid, 'reject', r.notes || '', applied); rejected += 1; }
  }
  return { approved, rejected };
}

test('override roundtrip: edited applied_value lands in master_data; pending_change preserves DLD original', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  upsertMasterField(db, pid, '101', 'purchase_price_aed', 1000000, 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'purchase_price_aed', '1000000', '1100000')`
  ).run(pid).lastInsertRowid;

  const csv = htmlExportedCsv([
    { change_id: cid, project_name: 'A', unit: '101', field: 'price',
      old_value: '1000000', proposed_value: '1100000', applied_value: '1234567',
      source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
      decision: 'approve', notes: 'staff-corrected per buyer email' }
  ]);
  const res = applyCsv(db, csv);
  assert.equal(res.approved, 1);

  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(m.purchase_price_aed, 1234567);
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.proposed_value, '1100000');
  assert.match(pc.decision_notes, /^override: 1234567 \(DLD: 1100000\) — staff-corrected per buyer email$/);
});

test('override roundtrip: untouched applied_value (= proposed) takes legacy path, no override prefix', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  upsertMasterField(db, pid, '101', 'purchase_price_aed', 1000000, 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'purchase_price_aed', '1000000', '1100000')`
  ).run(pid).lastInsertRowid;

  const csv = htmlExportedCsv([
    { change_id: cid, project_name: 'A', unit: '101', field: 'price',
      old_value: '1000000', proposed_value: '1100000', applied_value: '1100000',
      source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
      decision: 'approve', notes: 'looks right' }
  ]);
  applyCsv(db, csv);
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(m.purchase_price_aed, 1100000);
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision_notes, 'looks right', 'no override prefix when applied equals proposed');
});

test('override roundtrip: legacy 10-column CSV (no applied_value) still parses cleanly', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid).lastInsertRowid;

  const oldCsv =
    'change_id,project_name,unit,field,old_value,proposed_value,source_snapshot_date,proposed_at,decision,notes\r\n' +
    cid + ',A,101,buyer,ALICE,BOB,,,approve,\r\n';
  applyCsv(db, oldCsv);
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(m.buyer_name, 'BOB', 'legacy CSV still applies the proposed value');
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision_notes, '', 'no override prefix on legacy path');
});
