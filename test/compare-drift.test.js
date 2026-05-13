const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { detectDrift } = require('../src/compare-drift');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

function seedProject(db, name = 'A') {
  db.prepare("INSERT INTO dld_project (project_name) VALUES (?)").run(name);
  return db.prepare("SELECT project_id FROM dld_project WHERE project_name = ?").get(name).project_id;
}

function insertSfSnapshot(db, sourceFile, generatedAt) {
  return db.prepare(
    "INSERT INTO sf_snapshot (source_file, generated_at) VALUES (?, ?)"
  ).run(sourceFile, generatedAt).lastInsertRowid;
}

function insertSfBooking(db, snapshotId, subProject, unitNorm, fields) {
  return db.prepare(`
    INSERT INTO sf_booking
      (sf_snapshot_id, sub_project, unit_norm,
       applicant_name, purchase_price, status, procedure_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId, subProject, unitNorm,
    fields.applicant_name ?? null,
    fields.purchase_price ?? null,
    fields.status ?? null,
    fields.procedure_number ?? null
  ).lastInsertRowid;
}

test('detectDrift SF: no drift when consecutive snapshots are identical', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertSfSnapshot(db, 'apr.xlsx', '2026-04-01');
  insertSfBooking(db, s1, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });
  const s2 = insertSfSnapshot(db, 'may.xlsx', '2026-05-01');
  insertSfBooking(db, s2, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });

  detectDrift(db, pid, s2, 'sf');

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  const auditCount   = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  assert.equal(pendingCount, 0);
  assert.equal(auditCount, 0);
});

test('detectDrift SF: single-field drift emits SF_DRIFT pending + auto_apply audit', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertSfSnapshot(db, 'apr.xlsx', '2026-04-01');
  insertSfBooking(db, s1, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });
  const s2 = insertSfSnapshot(db, 'may.xlsx', '2026-05-01');
  insertSfBooking(db, s2, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1500000, status: 'sold', procedure_number: 'P-001'
  });

  detectDrift(db, pid, s2, 'sf');

  const pendingRows = db.prepare("SELECT * FROM pending_change").all();
  assert.equal(pendingRows.length, 1);
  const p = pendingRows[0];
  assert.equal(p.project_id, pid);
  assert.equal(p.unit_number_norm, '101');
  assert.equal(p.field_name, 'purchase_price_aed');
  assert.equal(p.old_value, '1485000');
  assert.equal(p.proposed_value, '1500000');
  assert.equal(p.change_type, 'SF_DRIFT');
  assert.equal(p.decision, 'auto_applied');

  const auditRows = db.prepare("SELECT * FROM audit_log").all();
  assert.equal(auditRows.length, 1);
  const a = auditRows[0];
  assert.equal(a.project_id, pid);
  assert.equal(a.unit_number_norm, '101');
  assert.equal(a.table_name, 'master_data');
  assert.equal(a.field, 'purchase_price_aed');
  assert.equal(a.old_value, '1485000');
  assert.equal(a.new_value, '1500000');
  assert.equal(a.action, 'auto_apply');
  assert.equal(a.source, 'compare');
  assert.equal(a.change_id, p.change_id);
});

test('detectDrift SF: brand-new unit (no prior snapshot row) is silent', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  // First snapshot has unit 101 only
  const s1 = insertSfSnapshot(db, 'apr.xlsx', '2026-04-01');
  insertSfBooking(db, s1, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });
  // Second snapshot adds NEW unit 202 (which had no prior row)
  const s2 = insertSfSnapshot(db, 'may.xlsx', '2026-05-01');
  insertSfBooking(db, s2, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });
  insertSfBooking(db, s2, 'A', '202', {
    applicant_name: 'Sara', purchase_price: 2000000, status: 'sold', procedure_number: 'P-002'
  });

  detectDrift(db, pid, s2, 'sf');

  // No drift: 101 unchanged, 202 is brand-new (no prior row to diff against)
  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  const auditCount   = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  assert.equal(pendingCount, 0);
  assert.equal(auditCount, 0);
});

test('detectDrift SF: idempotent — second call does not duplicate pending row', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertSfSnapshot(db, 'apr.xlsx', '2026-04-01');
  insertSfBooking(db, s1, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1485000, status: 'sold', procedure_number: 'P-001'
  });
  const s2 = insertSfSnapshot(db, 'may.xlsx', '2026-05-01');
  insertSfBooking(db, s2, 'A', '101', {
    applicant_name: 'Ali', purchase_price: 1500000, status: 'sold', procedure_number: 'P-001'
  });

  detectDrift(db, pid, s2, 'sf');
  detectDrift(db, pid, s2, 'sf');

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  assert.equal(pendingCount, 1);
});

// ─── DLD-side drift tests (Task 3) ──────────────────────────────────────

function insertDldSnapshot(db, projectId, sourceFile, snapshotDate) {
  return db.prepare(
    "INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date) VALUES (?, 'csv', ?, ?)"
  ).run(projectId, sourceFile, snapshotDate).lastInsertRowid;
}

function insertDldUnit(db, snapshotId, projectId, unitNumberNorm, netArea) {
  return db.prepare(
    "INSERT INTO dld_unit (snapshot_id, project_id, unit_number_norm, net_area) VALUES (?, ?, ?, ?)"
  ).run(snapshotId, projectId, unitNumberNorm, netArea).lastInsertRowid;
}

function insertDldSaleTx(db, unitId, snapshotId, projectId, partyName, txDate, amountAed) {
  return db.prepare(
    "INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date, tx_date_iso, amount_aed) VALUES (?, ?, ?, ?, 'Sale', ?, ?, ?)"
  ).run(unitId, snapshotId, projectId, partyName, txDate, txDate, amountAed).lastInsertRowid;
}

test('detectDrift dld: no drift when consecutive snapshots are identical', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  const s2 = insertDldSnapshot(db, pid, 'may.csv', '2026-05-01');
  const u2 = insertDldUnit(db, s2, pid, '101', 100.5);
  insertDldSaleTx(db, u2, s2, pid, 'Ali', '2026-04-01', 1485000);

  detectDrift(db, pid, s2, 'dld');

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  const auditCount   = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  assert.equal(pendingCount, 0);
  assert.equal(auditCount, 0);
});

test('detectDrift dld: single-field drift (purchase_price) emits DLD_DRIFT pending + auto_apply audit', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  const s2 = insertDldSnapshot(db, pid, 'may.csv', '2026-05-01');
  const u2 = insertDldUnit(db, s2, pid, '101', 100.5);
  insertDldSaleTx(db, u2, s2, pid, 'Ali', '2026-05-01', 1500000);

  detectDrift(db, pid, s2, 'dld');

  const pendingRows = db.prepare("SELECT * FROM pending_change").all();
  assert.equal(pendingRows.length, 1);
  const p = pendingRows[0];
  assert.equal(p.project_id, pid);
  assert.equal(p.unit_number_norm, '101');
  assert.equal(p.field_name, 'purchase_price_aed');
  assert.equal(p.old_value, '1485000');
  assert.equal(p.proposed_value, '1500000');
  assert.equal(p.change_type, 'DLD_DRIFT');
  assert.equal(p.decision, 'auto_applied');
  assert.equal(p.source_snapshot_id, s2);

  const auditRows = db.prepare("SELECT * FROM audit_log").all();
  assert.equal(auditRows.length, 1);
  const a = auditRows[0];
  assert.equal(a.project_id, pid);
  assert.equal(a.unit_number_norm, '101');
  assert.equal(a.table_name, 'master_data');
  assert.equal(a.field, 'purchase_price_aed');
  assert.equal(a.old_value, '1485000');
  assert.equal(a.new_value, '1500000');
  assert.equal(a.action, 'auto_apply');
  assert.equal(a.source, 'compare');
  assert.equal(a.change_id, p.change_id);
});

test('detectDrift dld: multi-field drift (buyer + price) emits 2 DLD_DRIFT rows + 2 audits', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  const s2 = insertDldSnapshot(db, pid, 'may.csv', '2026-05-01');
  const u2 = insertDldUnit(db, s2, pid, '101', 100.5);
  insertDldSaleTx(db, u2, s2, pid, 'Sara', '2026-05-01', 1500000);

  detectDrift(db, pid, s2, 'dld');

  const pendingRows = db.prepare("SELECT * FROM pending_change ORDER BY field_name").all();
  assert.equal(pendingRows.length, 2);
  const byField = Object.fromEntries(pendingRows.map(r => [r.field_name, r]));
  assert.ok(byField.buyer_name);
  assert.equal(byField.buyer_name.old_value, 'Ali');
  assert.equal(byField.buyer_name.proposed_value, 'Sara');
  assert.equal(byField.buyer_name.change_type, 'DLD_DRIFT');
  assert.ok(byField.purchase_price_aed);
  assert.equal(byField.purchase_price_aed.old_value, '1485000');
  assert.equal(byField.purchase_price_aed.proposed_value, '1500000');
  assert.equal(byField.purchase_price_aed.change_type, 'DLD_DRIFT');

  const auditCount = db.prepare(
    "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'auto_apply' AND source = 'compare'"
  ).get().c;
  assert.equal(auditCount, 2);
});

test('detectDrift dld: brand-new unit in current snapshot (not in prev) is silent', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  const s2 = insertDldSnapshot(db, pid, 'may.csv', '2026-05-01');
  const u2 = insertDldUnit(db, s2, pid, '101', 100.5);
  insertDldSaleTx(db, u2, s2, pid, 'Ali', '2026-04-01', 1485000);
  // Brand-new unit 202 in s2 only — no prior to diff against
  const u2b = insertDldUnit(db, s2, pid, '202', 80.0);
  insertDldSaleTx(db, u2b, s2, pid, 'Hassan', '2026-05-01', 900000);

  detectDrift(db, pid, s2, 'dld');

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  const auditCount   = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  assert.equal(pendingCount, 0);
  assert.equal(auditCount, 0);
});

test('detectDrift dld: idempotent — second call does not duplicate DLD_DRIFT pending row', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  const s2 = insertDldSnapshot(db, pid, 'may.csv', '2026-05-01');
  const u2 = insertDldUnit(db, s2, pid, '101', 100.5);
  insertDldSaleTx(db, u2, s2, pid, 'Ali', '2026-05-01', 1500000);

  detectDrift(db, pid, s2, 'dld');
  detectDrift(db, pid, s2, 'dld');

  const pendingCount = db.prepare(
    "SELECT COUNT(*) AS c FROM pending_change WHERE change_type = 'DLD_DRIFT'"
  ).get().c;
  assert.equal(pendingCount, 1);
});

test('detectDrift dld: first-ever snapshot for a project is no-op', () => {
  const db = freshDb();
  const pid = seedProject(db, 'A');

  const s1 = insertDldSnapshot(db, pid, 'apr.csv', '2026-04-01');
  const u1 = insertDldUnit(db, s1, pid, '101', 100.5);
  insertDldSaleTx(db, u1, s1, pid, 'Ali', '2026-04-01', 1485000);

  detectDrift(db, pid, s1, 'dld');

  const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM pending_change").get().c;
  const auditCount   = db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  assert.equal(pendingCount, 0);
  assert.equal(auditCount, 0);
});

test('migration 005 widens audit_log.source CHECK to allow "compare"', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_name) VALUES ('A')").run();
  const pid = db.prepare("SELECT project_id FROM dld_project").get().project_id;

  // Direct INSERT with source='compare' should succeed after migration 005
  db.prepare(`
    INSERT INTO audit_log
      (project_id, unit_number_norm, table_name, field,
       old_value, new_value, action, source)
    VALUES (?, ?, 'master_data', 'status', 'x', 'y', 'auto_apply', 'compare')
  `).run(pid, '101');

  const row = db.prepare("SELECT * FROM audit_log WHERE source = 'compare'").get();
  assert.ok(row, 'expected audit_log row with source=compare');
  assert.equal(row.action, 'auto_apply');
});
