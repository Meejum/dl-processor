const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../../src/migrations');
const {
  listPending, approvePending, rejectPending, teachAliasAndApprove
} = require('../../src/commands/review-pending');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'PROJ_A')").run();
  db.prepare(`
    INSERT INTO master_data (project_id, unit_number_norm, buyer_name, purchase_price_aed,
      buyer_source, price_source) VALUES (1, '101', 'Ali', 1485000, 'staff', 'staff')
  `).run();
  return db;
}

function seedPending(db, override = {}) {
  const row = Object.assign({
    project_id: 1, unit_number_norm: '101', field_name: 'purchase_price_aed',
    old_value: '1485000', proposed_value: '1500000', change_type: 'MISMATCH', decision: 'pending'
  }, override);
  const info = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value, change_type, decision)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.project_id, row.unit_number_norm, row.field_name, row.old_value,
         row.proposed_value, row.change_type, row.decision);
  return info.lastInsertRowid;
}

test('listPending returns pending+actionable rows only (default tab = "needs_review")', () => {
  const db = freshDb();
  seedPending(db);
  seedPending(db, { unit_number_norm: '102', change_type: 'DLD_DRIFT', decision: 'auto_applied' });
  const out = listPending(db, { tab: 'needs_review' });
  assert.equal(out.length, 1);
  assert.equal(out[0].unit_number_norm, '101');
});

test('listPending tab=drift returns auto_applied rows only', () => {
  const db = freshDb();
  seedPending(db);
  seedPending(db, { unit_number_norm: '102', change_type: 'DLD_DRIFT', decision: 'auto_applied' });
  const out = listPending(db, { tab: 'drift' });
  assert.equal(out.length, 1);
  assert.equal(out[0].change_type, 'DLD_DRIFT');
});

test('approvePending without override writes master_data with proposed_value', () => {
  const db = freshDb();
  const cid = seedPending(db);
  approvePending(db, cid);
  const md = db.prepare("SELECT purchase_price_aed, price_source FROM master_data WHERE unit_number_norm='101'").get();
  assert.equal(md.purchase_price_aed, 1500000);
  assert.equal(md.price_source, 'dld_approved');
  const pc = db.prepare("SELECT decision, decided_at, override_value FROM pending_change WHERE change_id=?").get(cid);
  assert.equal(pc.decision, 'approved');
  assert.ok(pc.decided_at);
  assert.equal(pc.override_value, null);
  const a = db.prepare("SELECT action, old_value, new_value FROM audit_log WHERE change_id=?").get(cid);
  assert.equal(a.action, 'approve');
  assert.equal(a.new_value, '1500000');
});

test('approvePending WITH override writes user-typed value + action=override', () => {
  const db = freshDb();
  const cid = seedPending(db);
  approvePending(db, cid, '1495000');
  const md = db.prepare("SELECT purchase_price_aed FROM master_data WHERE unit_number_norm='101'").get();
  assert.equal(md.purchase_price_aed, 1495000);
  const pc = db.prepare("SELECT override_value FROM pending_change WHERE change_id=?").get(cid);
  assert.equal(pc.override_value, '1495000');
  const a = db.prepare("SELECT action, new_value FROM audit_log WHERE change_id=?").get(cid);
  assert.equal(a.action, 'override');
  assert.equal(a.new_value, '1495000');
});

test('rejectPending leaves master_data unchanged + writes reject audit row', () => {
  const db = freshDb();
  const cid = seedPending(db);
  rejectPending(db, cid);
  const md = db.prepare("SELECT purchase_price_aed FROM master_data WHERE unit_number_norm='101'").get();
  assert.equal(md.purchase_price_aed, 1485000);
  const pc = db.prepare("SELECT decision FROM pending_change WHERE change_id=?").get(cid);
  assert.equal(pc.decision, 'rejected');
  const a = db.prepare("SELECT action, new_value FROM audit_log WHERE change_id=?").get(cid);
  assert.equal(a.action, 'reject');
  assert.equal(a.new_value, null);
});

test('approvePending: tier-2 flag set when threshold crossed + userNote provided', () => {
  const db = freshDb();
  // Price change 1485000 → 1800000 = 21% > 10% default → tier-2
  const cid = seedPending(db, { old_value: '1485000', proposed_value: '1800000' });
  const thresholds = { tier2_price_pct: 10, tier2_price_abs: 50000, tier2_area_pct: 5 };
  approvePending(db, cid, null, { userNote: 'verified with manager', thresholds });
  const auditRow = db.prepare(
    "SELECT tier2, user_note FROM audit_log WHERE change_id = ? ORDER BY audit_id DESC LIMIT 1"
  ).get(cid);
  assert.equal(auditRow.tier2, 1);
  assert.equal(auditRow.user_note, 'verified with manager');
});

test('approvePending: tier-2 flag NOT set when below threshold', () => {
  const db = freshDb();
  // Price change 1485000 → 1500000 = ~1% < 10% AND $15K abs < $50K → NOT tier-2
  const cid = seedPending(db);
  const thresholds = { tier2_price_pct: 10, tier2_price_abs: 50000, tier2_area_pct: 5 };
  approvePending(db, cid, null, { thresholds });
  const auditRow = db.prepare(
    "SELECT tier2, user_note FROM audit_log WHERE change_id = ? ORDER BY audit_id DESC LIMIT 1"
  ).get(cid);
  assert.equal(auditRow.tier2, 0);
  assert.equal(auditRow.user_note, null);
});

test('teachAliasAndApprove inserts buyer_alias + auto-approves sibling buyer rows', () => {
  const db = freshDb();
  // Seed two BUYER_MISMATCH rows with the same name pair, plus an unrelated row
  const cidA = seedPending(db, { unit_number_norm: '201', field_name: 'buyer_name',
    old_value: 'Ali Alghumlasi', proposed_value: 'Ali AlGhumlasi' });
  db.prepare("INSERT INTO master_data (project_id, unit_number_norm, buyer_name, buyer_source) VALUES (1, '202', 'Ali Alghumlasi', 'staff')").run();
  const cidB = seedPending(db, { unit_number_norm: '202', field_name: 'buyer_name',
    old_value: 'Ali Alghumlasi', proposed_value: 'Ali AlGhumlasi' });
  db.prepare("INSERT INTO master_data (project_id, unit_number_norm, buyer_name, buyer_source) VALUES (1, '301', 'Different', 'staff')").run();
  const cidC = seedPending(db, { unit_number_norm: '301', field_name: 'buyer_name',
    old_value: 'Different', proposed_value: 'Other' });

  teachAliasAndApprove(db, cidA, { scope: 'project' });

  // Alias inserted
  const alias = db.prepare("SELECT * FROM buyer_alias WHERE project_id=1").get();
  assert.ok(alias);

  // Sibling row B auto-approved
  assert.equal(db.prepare("SELECT decision FROM pending_change WHERE change_id=?").get(cidB).decision, 'approved');
  // Unrelated row C still pending
  assert.equal(db.prepare("SELECT decision FROM pending_change WHERE change_id=?").get(cidC).decision, 'pending');
  // Audit log has learn_alias + 2 approves
  const actions = db.prepare("SELECT action FROM audit_log ORDER BY audit_id").all().map(r => r.action);
  assert.ok(actions.includes('learn_alias'));
  assert.equal(actions.filter(a => a === 'approve').length, 2);
});
