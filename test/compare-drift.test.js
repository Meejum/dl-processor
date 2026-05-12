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
