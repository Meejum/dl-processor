const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../../src/migrations');
const {
  listBps, approveBp, rejectBp, acknowledgeBp, parseBpId
} = require('../../src/commands/review-bps');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'PROJ_A')").run();
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (2, 'PROJ_B')").run();
  // A DLD snapshot so source_snapshot_id has a valid FK target.
  db.prepare(`
    INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file, snapshot_date)
    VALUES (100, 1, 'csv', 'fake.csv', '2026-05-13')
  `).run();
  db.prepare(`
    INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file, snapshot_date)
    VALUES (101, 2, 'csv', 'fake-b.csv', '2026-05-13')
  `).run();
  // master_data baselines so approve writes don't silently no-op.
  db.prepare(`
    INSERT INTO master_data (project_id, unit_number_norm, buyer_name, purchase_price_aed, procedure_number,
      buyer_source, price_source, procedure_source)
    VALUES (1, '101', 'Ali', 1485000, 'P-OLD', 'staff', 'staff', 'staff')
  `).run();
  db.prepare(`
    INSERT INTO master_data (project_id, unit_number_norm, buyer_name, purchase_price_aed,
      buyer_source, price_source)
    VALUES (1, '102', 'Bob', 2000000, 'staff', 'staff')
  `).run();
  return db;
}

function seedPending(db, override = {}) {
  const row = Object.assign({
    project_id: 1, unit_number_norm: '101', field_name: 'purchase_price_aed',
    old_value: '1485000', proposed_value: '1500000',
    change_type: 'MISMATCH', decision: 'pending', source_snapshot_id: 100
  }, override);
  const info = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value,
       change_type, decision, source_snapshot_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.project_id, row.unit_number_norm, row.field_name, row.old_value,
         row.proposed_value, row.change_type, row.decision, row.source_snapshot_id);
  return info.lastInsertRowid;
}

function seedSfBooking(db, override = {}) {
  // Ensure an sf_snapshot row.
  const existing = db.prepare('SELECT sf_snapshot_id FROM sf_snapshot WHERE source_file = ?').get('sf.csv');
  let sid;
  if (existing) sid = existing.sf_snapshot_id;
  else {
    sid = db.prepare(`
      INSERT INTO sf_snapshot (source_file) VALUES ('sf.csv')
    `).run().lastInsertRowid;
  }
  const row = Object.assign({
    sub_project: 'PROJ_A', unit_norm: '101', bp_name: 'BP-1', tower_name: 'T1',
    applicant_name: 'Ali', purchase_price: 1500000, pre_reg_status: null,
    status: 'In Progress', dld_process_status: null, rm_process_status: null,
    bp_created_date: '2026-04-01', procedure_number: 'P-NEW',
    current_step_name: null, current_step_assigned_name: null, comments: null,
    booking_record_id: null, payment_date: null
  }, override);
  return db.prepare(`
    INSERT INTO sf_booking
      (sf_snapshot_id, bp_name, sub_project, unit_norm, tower_name, applicant_name,
       purchase_price, pre_reg_status, status, dld_process_status, rm_process_status,
       bp_created_date, procedure_number, current_step_name, current_step_assigned_name,
       comments, booking_record_id, payment_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sid, row.bp_name, row.sub_project, row.unit_norm, row.tower_name, row.applicant_name,
         row.purchase_price, row.pre_reg_status, row.status, row.dld_process_status,
         row.rm_process_status, row.bp_created_date, row.procedure_number,
         row.current_step_name, row.current_step_assigned_name, row.comments,
         row.booking_record_id, row.payment_date).lastInsertRowid;
}

// ─────────────────────────────────────────────────────────────────────
// 1. listBps grouping
// ─────────────────────────────────────────────────────────────────────
test('listBps groups multiple field rows for one unit into a single BP', () => {
  const db = freshDb();
  seedPending(db, { field_name: 'buyer_name', old_value: 'Ali', proposed_value: 'Carol' });
  seedPending(db, { field_name: 'purchase_price_aed', old_value: '1485000', proposed_value: '1500000' });
  seedPending(db, { field_name: 'procedure_number', old_value: 'P-OLD', proposed_value: 'P-NEW' });
  const out = listBps(db);
  assert.equal(out.length, 1, 'one BP group');
  assert.equal(out[0].rows.length, 3, 'three field rows under it');
  assert.equal(out[0].unit_number_norm, '101');
  assert.equal(out[0].project_id, 1);
  assert.equal(out[0].project_name, 'PROJ_A');
});

// ─────────────────────────────────────────────────────────────────────
// 2. listBps multiple BPs
// ─────────────────────────────────────────────────────────────────────
test('listBps returns multiple BPs when units differ', () => {
  const db = freshDb();
  seedPending(db, { unit_number_norm: '101' });
  seedPending(db, { unit_number_norm: '102' });
  const out = listBps(db);
  assert.equal(out.length, 2);
  const units = out.map(b => b.unit_number_norm).sort();
  assert.deepEqual(units, ['101', '102']);
});

// ─────────────────────────────────────────────────────────────────────
// 3. listBps joins sfContext from latest sf_booking
// ─────────────────────────────────────────────────────────────────────
test('listBps populates sfContext from latest sf_booking row', () => {
  const db = freshDb();
  seedPending(db);
  seedSfBooking(db, { applicant_name: 'Carol', tower_name: 'T-Latest', status: 'Completed' });
  const out = listBps(db);
  assert.equal(out.length, 1);
  assert.ok(out[0].sfContext);
  assert.equal(out[0].sfContext.applicant_name, 'Carol');
  assert.equal(out[0].sfContext.tower_name, 'T-Latest');
  assert.equal(out[0].tower_name, 'T-Latest');
});

// ─────────────────────────────────────────────────────────────────────
// 4. listBps NO_SF_ROW state
// ─────────────────────────────────────────────────────────────────────
test('listBps returns state=NO_SF_ROW when no matching sf_booking exists', () => {
  const db = freshDb();
  seedPending(db);
  const out = listBps(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'NO_SF_ROW');
  assert.equal(out[0].sfContext, null);
});

// ─────────────────────────────────────────────────────────────────────
// 5. listBps READY state
// ─────────────────────────────────────────────────────────────────────
test('listBps returns state=READY when sf_booking.status=Completed and no DLD issue', () => {
  const db = freshDb();
  seedPending(db);
  seedSfBooking(db, { status: 'Completed', dld_process_status: null });
  const out = listBps(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'READY');
});

// ─────────────────────────────────────────────────────────────────────
// 6. listBps drift_log tab
// ─────────────────────────────────────────────────────────────────────
test('listBps tab=drift_log returns groups built from decision=auto_applied rows', () => {
  const db = freshDb();
  seedPending(db, { decision: 'pending' });
  seedPending(db, { unit_number_norm: '102', decision: 'auto_applied', change_type: 'DLD_DRIFT' });
  const out = listBps(db, { tab: 'drift_log' });
  assert.equal(out.length, 1);
  assert.equal(out[0].unit_number_norm, '102');
});

// ─────────────────────────────────────────────────────────────────────
// 7. listBps projectId filter
// ─────────────────────────────────────────────────────────────────────
test('listBps projectId filter narrows results', () => {
  const db = freshDb();
  // Need a master row for project 2 unit 201, else the comparison context is fine
  // but we just need the pending row joinable to dld_project.
  seedPending(db, { project_id: 1, unit_number_norm: '101' });
  seedPending(db, { project_id: 2, unit_number_norm: '201', source_snapshot_id: 101 });
  const outA = listBps(db, { projectId: 1 });
  assert.equal(outA.length, 1);
  assert.equal(outA[0].project_id, 1);
  const outB = listBps(db, { projectId: 2 });
  assert.equal(outB.length, 1);
  assert.equal(outB[0].project_id, 2);
});

// ─────────────────────────────────────────────────────────────────────
// 8. approveBp atomic — N rows + 1 umbrella audit entry
// ─────────────────────────────────────────────────────────────────────
test('approveBp approves every pending row in the BP and writes umbrella audit entry', () => {
  const db = freshDb();
  seedPending(db, { field_name: 'buyer_name', old_value: 'Ali', proposed_value: 'Carol' });
  seedPending(db, { field_name: 'purchase_price_aed', old_value: '1485000', proposed_value: '1500000' });
  seedPending(db, { field_name: 'procedure_number', old_value: 'P-OLD', proposed_value: 'P-NEW' });
  const groups = listBps(db);
  assert.equal(groups.length, 1);
  const bpId = groups[0].bp_id;

  approveBp(db, bpId);

  // All three pending_change rows now approved.
  const pcRows = db.prepare("SELECT decision FROM pending_change WHERE project_id=1 AND unit_number_norm='101'").all();
  assert.equal(pcRows.length, 3);
  for (const r of pcRows) assert.equal(r.decision, 'approved');

  // master_data updated to the proposed values.
  const md = db.prepare("SELECT * FROM master_data WHERE project_id=1 AND unit_number_norm='101'").get();
  assert.equal(md.buyer_name, 'Carol');
  assert.equal(md.purchase_price_aed, 1500000);
  assert.equal(md.procedure_number, 'P-NEW');

  // audit_log has per-row 'approve' entries PLUS one 'approve_bp' umbrella.
  const perRow = db.prepare("SELECT * FROM audit_log WHERE action='approve' AND project_id=1").all();
  assert.equal(perRow.length, 3);
  const umbrella = db.prepare("SELECT * FROM audit_log WHERE action='approve_bp' AND project_id=1").all();
  assert.equal(umbrella.length, 1);
  assert.equal(umbrella[0].new_value, bpId);
  assert.match(umbrella[0].user_note || '', /3 fields/);
});

// ─────────────────────────────────────────────────────────────────────
// 9. approveBp overrides honored
// ─────────────────────────────────────────────────────────────────────
test('approveBp overrides map applies user-typed values and records override action', () => {
  const db = freshDb();
  const cid1 = seedPending(db, { field_name: 'buyer_name', old_value: 'Ali', proposed_value: 'Carol' });
  const cid2 = seedPending(db, { field_name: 'purchase_price_aed', old_value: '1485000', proposed_value: '1500000' });
  const groups = listBps(db);
  const bpId = groups[0].bp_id;

  // Override buyer name to a hand-corrected value.
  approveBp(db, bpId, { [cid1]: 'Carol Smith' });

  const md = db.prepare("SELECT * FROM master_data WHERE project_id=1 AND unit_number_norm='101'").get();
  assert.equal(md.buyer_name, 'Carol Smith', 'override wins');
  assert.equal(md.purchase_price_aed, 1500000, 'no override → proposed wins');

  // Per the underlying approvePending logic, override rows write action='override'.
  const overrideEntries = db.prepare("SELECT * FROM audit_log WHERE action='override' AND change_id=?").all(cid1);
  assert.equal(overrideEntries.length, 1);
  const approveEntries = db.prepare("SELECT * FROM audit_log WHERE action='approve' AND change_id=?").all(cid2);
  assert.equal(approveEntries.length, 1);
});

// ─────────────────────────────────────────────────────────────────────
// 10. rejectBp — N rows rejected, master_data unchanged
// ─────────────────────────────────────────────────────────────────────
test('rejectBp marks all rows rejected, leaves master_data untouched, writes reject_bp umbrella', () => {
  const db = freshDb();
  seedPending(db, { field_name: 'buyer_name', old_value: 'Ali', proposed_value: 'Carol' });
  seedPending(db, { field_name: 'purchase_price_aed', old_value: '1485000', proposed_value: '1500000' });
  const groups = listBps(db);
  const bpId = groups[0].bp_id;

  rejectBp(db, bpId);

  const pcRows = db.prepare("SELECT decision FROM pending_change WHERE project_id=1 AND unit_number_norm='101'").all();
  for (const r of pcRows) assert.equal(r.decision, 'rejected');

  // master_data unchanged.
  const md = db.prepare("SELECT * FROM master_data WHERE project_id=1 AND unit_number_norm='101'").get();
  assert.equal(md.buyer_name, 'Ali');
  assert.equal(md.purchase_price_aed, 1485000);

  // Umbrella audit entry.
  const umbrella = db.prepare("SELECT * FROM audit_log WHERE action='reject_bp' AND project_id=1").all();
  assert.equal(umbrella.length, 1);
  assert.equal(umbrella[0].new_value, bpId);
});

// ─────────────────────────────────────────────────────────────────────
// 11. acknowledgeBp — same effect as reject but action='acknowledge_bp'
// ─────────────────────────────────────────────────────────────────────
test('acknowledgeBp marks rows rejected and writes acknowledge_bp umbrella', () => {
  const db = freshDb();
  seedPending(db, { field_name: 'buyer_name', old_value: 'Ali', proposed_value: 'Carol' });
  seedPending(db, { field_name: 'purchase_price_aed', old_value: '1485000', proposed_value: '1500000' });
  const groups = listBps(db);
  const bpId = groups[0].bp_id;

  acknowledgeBp(db, bpId);

  const pcRows = db.prepare("SELECT decision FROM pending_change WHERE project_id=1 AND unit_number_norm='101'").all();
  for (const r of pcRows) assert.equal(r.decision, 'rejected');

  // master_data unchanged.
  const md = db.prepare("SELECT * FROM master_data WHERE project_id=1 AND unit_number_norm='101'").get();
  assert.equal(md.buyer_name, 'Ali');

  const umbrella = db.prepare("SELECT * FROM audit_log WHERE action='acknowledge_bp' AND project_id=1").all();
  assert.equal(umbrella.length, 1);
  assert.equal(umbrella[0].new_value, bpId);
  // No reject_bp umbrella for acknowledge.
  const rejectUmbrella = db.prepare("SELECT * FROM audit_log WHERE action='reject_bp' AND project_id=1").all();
  assert.equal(rejectUmbrella.length, 0);
});

// ─────────────────────────────────────────────────────────────────────
// 12. parseBpId round-trips and edge cases
// ─────────────────────────────────────────────────────────────────────
test('parseBpId round-trips synthetic IDs, handles NULL snapshot, returns null on malformed', () => {
  assert.deepEqual(parseBpId('100_1_101'), { source_snapshot_id: 100, project_id: 1, unit_number_norm: '101' });
  assert.deepEqual(parseBpId('NULL_1_101'), { source_snapshot_id: null, project_id: 1, unit_number_norm: '101' });
  // Unit numbers can contain underscores — everything after the second underscore is the unit.
  assert.deepEqual(parseBpId('100_2_BLK_A_101'), { source_snapshot_id: 100, project_id: 2, unit_number_norm: 'BLK_A_101' });
  // Malformed:
  assert.equal(parseBpId(''), null);
  assert.equal(parseBpId('100'), null);
  assert.equal(parseBpId('100_1'), null);
  assert.equal(parseBpId('NULL_xyz_101'), null, 'non-numeric project_id is malformed');
});
