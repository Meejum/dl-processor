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

// Mirrors the CSV format the HTML "Export decisions" button writes.
// Same 10-column shape that cmdReviewPending writes; cmdApplyPending only reads
// change_id, decision, notes — but other columns must be present and parse cleanly.
function htmlExportedCsv(rows) {
  const header = 'change_id,project_name,unit,field,old_value,proposed_value,source_snapshot_date,proposed_at,decision,notes';
  const body = rows.map(r =>
    [r.change_id, r.project_name, r.unit, r.field, r.old_value, r.proposed_value, r.source_snapshot_date, r.proposed_at, r.decision, r.notes || '']
      .map(v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; })
      .join(',')
  );
  return [header].concat(body).join('\r\n') + '\r\n';
}

// Apply CSV the same way cmdApplyPending does: parse, dispatch on `decision`.
function applyCsv(db, csv) {
  const rows = parse(csv, { relax_quotes: true, columns: true, skip_empty_lines: true });
  let approved = 0, rejected = 0;
  for (const r of rows) {
    const cid = parseInt(r.change_id, 10);
    if (isNaN(cid)) continue;
    const d = String(r.decision || '').trim().toLowerCase();
    if (d === 'approve') { applyDecision(db, cid, 'approve', r.notes || ''); approved += 1; }
    else if (d === 'reject') { applyDecision(db, cid, 'reject', r.notes || ''); rejected += 1; }
  }
  return { approved, rejected };
}

test('HTML-exported CSV applies cleanly via applyDecision (approve + reject + skip-omitted)', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  upsertMasterField(db, pid, '101', 'buyer_name',         'ALICE',   'staff');
  upsertMasterField(db, pid, '101', 'purchase_price_aed', 1000000,   'dld_approved');
  const c1 = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`).run(pid).lastInsertRowid;
  const c2 = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'purchase_price_aed', '1000000', '1100000')`).run(pid).lastInsertRowid;

  const csv = htmlExportedCsv([
    { change_id: c1, project_name: 'A', unit: '101', field: 'buyer',   old_value: 'ALICE',   proposed_value: 'BOB',     source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30', decision: 'approve', notes: 'verified' },
    { change_id: c2, project_name: 'A', unit: '101', field: 'price',   old_value: '1000000', proposed_value: '1100000', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30', decision: 'reject',  notes: 'bad'      }
  ]);
  const res = applyCsv(db, csv);
  assert.equal(res.approved, 1);
  assert.equal(res.rejected, 1);
  const m = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(m.buyer_name, 'BOB');
  assert.equal(m.purchase_price_aed, 1000000); // reject left it alone
});

test('roundtrip respects DLP_USER env var', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`).run(pid).lastInsertRowid;
  const csv = htmlExportedCsv([
    { change_id: cid, project_name: 'A', unit: '101', field: 'buyer', old_value: 'ALICE', proposed_value: 'BOB', source_snapshot_date: '', proposed_at: '', decision: 'approve', notes: '' }
  ]);
  const prev = process.env.DLP_USER;
  process.env.DLP_USER = 'mohammed';
  try { applyCsv(db, csv); }
  finally { if (prev === undefined) delete process.env.DLP_USER; else process.env.DLP_USER = prev; }
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decided_by, 'mohammed');
});

test('roundtrip ignores rows the HTML omitted (skipped) — they remain pending', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run('A').lastInsertRowid;
  const c1 = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`).run(pid).lastInsertRowid;
  const c2 = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '102', 'buyer_name', 'CAROL', 'DAN')`).run(pid).lastInsertRowid;
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const csv = htmlExportedCsv([
    { change_id: c1, project_name: 'A', unit: '101', field: 'buyer', old_value: 'ALICE', proposed_value: 'BOB', source_snapshot_date: '', proposed_at: '', decision: 'approve', notes: '' }
  ]);
  applyCsv(db, csv);
  const remaining = db.prepare(`SELECT * FROM pending_change WHERE decision='pending'`).all();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].change_id, c2);
});
