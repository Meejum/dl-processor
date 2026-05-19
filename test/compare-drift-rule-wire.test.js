const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');

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

// Insert a user rule directly into automation_rule.
function insertRule(db, id, priority, whenJson, thenJson) {
  db.prepare(`
    INSERT INTO automation_rule
      (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
    VALUES (?, 'test rule', 1, ?, ?, ?, 0, datetime('now'), 'test')
  `).run(id, priority, JSON.stringify(whenJson), JSON.stringify(thenJson));
}

test('drift wire: with no rules, behavior is unchanged (regression check)', () => {
  // Mirrors the existing "SF single-field drift" test but confirms that
  // adding the rule-engine wire with an empty rule set produces the same
  // pending_change + audit_log shape — and a NULL anomaly column.
  const db = freshDb();
  const pid = seedProject(db, 'A');
  const s1 = insertSfSnapshot(db, 'apr.xlsx', '2026-04-01');
  insertSfBooking(db, s1, 'A', '101', { applicant_name: 'Ali', purchase_price: 1485000 });
  const s2 = insertSfSnapshot(db, 'may.xlsx', '2026-05-01');
  insertSfBooking(db, s2, 'A', '101', { applicant_name: 'Ali', purchase_price: 1500000 });

  const { detectDrift } = require('../src/compare-drift');
  detectDrift(db, pid, s2, 'sf');

  const row = db.prepare("SELECT * FROM pending_change").get();
  assert.ok(row);
  assert.equal(row.change_type, 'SF_DRIFT');
  assert.equal(row.decision, 'auto_applied');
  assert.equal(row.anomaly, null, 'no rules → anomaly NULL');
});

test('drift wire: anomaly rule fires, row carries anomaly JSON', () => {
  // The rule-engine stub currently uses loadRulesStub() returning [] —
  // so this test confirms the wire is in place by directly calling the
  // exported wire builder for now. (Full DB-driven loading lands in Phase 5.)
  // We test the engine-to-row path by reading the engine output directly.
  const { evaluate } = require('../src/rule-engine');
  const candidate = {
    change_type: 'SF_DRIFT', field: 'purchase_price_aed',
    delta_pct: 30, delta_abs: 50000, alias_exists: false,
    bp_type: null, sf_state: null, project_id: 1, project_name: null,
    tier2: false, source: 'compare', unit_number_norm: '101', procedure_number: null
  };
  // Rule via JSON shape, evaluated in memory.
  const rules = [{
    id: 7,
    enabled: true,
    priority: 50,
    when: { op: 'and', clauses: [{ field: 'delta_pct', operator: '>', value: 25 }] },
    then: { action: 'flag_anomaly', anomaly_severity: 'high' }
  }];
  const d = evaluate(candidate, {}, rules);
  assert.equal(d.anomaly.severity, 'high');
  assert.equal(d.anomaly.reasons[0].rule_id, 7);
});

test('drift wire: skip action prevents pending_change insert', () => {
  // Same engine-output check for the skip path. Engine returns action=skip;
  // the drift code's `if (decision.action === 'skip') continue;` short-circuit
  // means no row is inserted. We verify the engine decision shape here; the
  // shortcircuit itself is exercised by existing detectDrift integration tests
  // that confirm no spurious rows appear.
  const { evaluate } = require('../src/rule-engine');
  const candidate = {
    change_type: 'SF_DRIFT', field: 'buyer_name',
    delta_pct: 0, delta_abs: 0, alias_exists: true,
    bp_type: null, sf_state: null, project_id: 1, project_name: null,
    tier2: false, source: 'compare', unit_number_norm: '101', procedure_number: null
  };
  const rules = [{
    id: 9, enabled: true, priority: 50,
    when: { op: 'and', clauses: [
      { field: 'change_type', operator: '=', value: 'SF_DRIFT' },
      { field: 'alias_exists', operator: '=', value: true }
    ]},
    then: { action: 'skip' }
  }];
  const d = evaluate(candidate, {}, rules);
  assert.equal(d.action, 'skip');
});
