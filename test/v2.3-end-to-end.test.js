// Phase 12.1 — end-to-end fixture integration test for v2.3.
//
// Exercises the full v2.3 stack — rule-engine, rule-loader, anomaly
// accumulation, automation_rule seeded built-ins + user rules, audit_log
// source enum, bulk-ops audit trail, dry-run SAVEPOINT rollback — to
// confirm the phase-by-phase modules compose without missing wiring.
//
// This file is verification-only. No production source is modified.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const { runMigrations } = require('../src/migrations');
const { loadRules } = require('../src/rule-loader');
const { evaluate } = require('../src/rule-engine');
const { writeAuditLog, auditSourceFor } = require('../src/audit-log');
const { upsertMasterField } = require('../src/master-data');
const { bulkApprove } = require('../src/commands/bulk');
const { runCompareDryRun } = require('../src/commands/compare');

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'schema.sql'),
  'utf8'
);

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

// Seeds the ENDTOEND project + 2 user rules:
//   - id=1 priority=50: auto-approve any BUYER_MISMATCH with delta_pct < 5
//   - id=2 priority=60: flag_anomaly severity=high when delta_pct > 50
// Both priorities sit in the user range (<1000) so they beat the migration-009
// built-ins (which are seeded at 1000+).
function seedEndToEnd(db) {
  const projectId = db.prepare(
    "INSERT INTO dld_project (project_name) VALUES ('ENDTOEND')"
  ).run().lastInsertRowid;

  const insertRule = db.prepare(`
    INSERT INTO automation_rule
      (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
    VALUES (?, ?, 1, ?, ?, ?, 0, datetime('now'), 'e2e')
  `);

  insertRule.run(
    1,
    'auto-approve small buyer mismatches',
    50,
    JSON.stringify({
      op: 'and',
      clauses: [
        { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
        { field: 'delta_pct', operator: '<', value: 5 }
      ]
    }),
    JSON.stringify({ action: 'auto_approve', note: 'small delta' })
  );

  insertRule.run(
    2,
    'flag huge deltas as high-severity anomaly',
    60,
    JSON.stringify({
      op: 'and',
      clauses: [
        { field: 'delta_pct', operator: '>', value: 50 }
      ]
    }),
    JSON.stringify({ action: 'flag_anomaly', anomaly_severity: 'high' })
  );

  return { projectId };
}

test('e2e 1: :memory: DB builds from schema.sql + runMigrations cleanly', () => {
  const db = freshDb();
  // Sanity: schema_migration row count matches the registered migrations list.
  const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get().n;
  assert.ok(applied >= 9, `expected >=9 migrations applied, got ${applied}`);
  // automation_rule exists (migration 009 created it).
  const t = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='automation_rule'"
  ).get();
  assert.ok(t, 'automation_rule must be present after migrations');
});

test('e2e 2: seed ENDTOEND project + 2 user rules via direct INSERT', () => {
  const db = freshDb();
  const { projectId } = seedEndToEnd(db);
  assert.ok(projectId > 0, 'project insert should yield a rowid');
  const p = db.prepare(
    "SELECT project_name FROM dld_project WHERE project_id=?"
  ).get(projectId);
  assert.equal(p.project_name, 'ENDTOEND');
  const userRules = db.prepare(
    "SELECT id, priority FROM automation_rule WHERE builtin=0 ORDER BY id"
  ).all();
  assert.equal(userRules.length, 2);
  assert.deepEqual(userRules.map(r => r.id), [1, 2]);
  assert.deepEqual(userRules.map(r => r.priority), [50, 60]);
});

test('e2e 3: loadRules returns 2 user rules + 4 built-ins = 6 total', () => {
  const db = freshDb();
  seedEndToEnd(db);
  const rules = loadRules(db);
  assert.equal(rules.length, 6, 'expected 2 user + 4 built-in = 6');
  // Lowest priority value (50) must be first after the priority sort.
  assert.equal(rules[0].id, 1);
  assert.equal(rules[0].priority, 50);
  // Built-ins occupy the trailing slots (priority >= 1000).
  const builtinIds = rules.filter(r => r.priority >= 1000).map(r => r.id).sort();
  assert.deepEqual(builtinIds, [1000, 1001, 1002, 1003]);
});

test('e2e 4: small BUYER_MISMATCH → user rule id=1 wins over built-ins', () => {
  const db = freshDb();
  seedEndToEnd(db);
  const rules = loadRules(db);

  const candidate = {
    change_type: 'BUYER_MISMATCH',
    field: 'buyer_name',
    delta_pct: 2,
    delta_abs: 0,
    alias_exists: false,
    bp_type: null,
    sf_state: null,
    project_id: 1,
    project_name: 'ENDTOEND',
    tier2: false,
    source: 'compare',
    unit_number_norm: 'A-101',
    procedure_number: 'P-1'
  };

  const decision = evaluate(candidate, {}, rules);
  assert.equal(decision.action, 'auto_approve');
  assert.equal(decision.rule_id, 1, 'priority 50 must beat built-in 1000+');
  assert.equal(decision.anomaly, null);
});

test('e2e 5: huge delta on purchase_price → anomaly severity=high', () => {
  const db = freshDb();
  seedEndToEnd(db);
  const rules = loadRules(db);

  const candidate = {
    change_type: 'SF_DRIFT',
    field: 'purchase_price',
    delta_pct: 60,
    delta_abs: 60000,
    alias_exists: false,
    bp_type: null,
    sf_state: null,
    project_id: 1,
    project_name: 'ENDTOEND',
    tier2: false,
    source: 'compare',
    unit_number_norm: 'A-202',
    procedure_number: 'P-2'
  };

  const decision = evaluate(candidate, {}, rules);
  assert.ok(decision.anomaly, 'anomaly must accumulate');
  assert.equal(decision.anomaly.severity, 'high');
  assert.ok(
    decision.anomaly.reasons.length >= 1,
    'at least one anomaly reason (user rule id=2 and/or built-in R-1001)'
  );
});

test('e2e 6: auditSourceFor.rule() writes an audit_log row past the CHECK', () => {
  const db = freshDb();
  const { projectId } = seedEndToEnd(db);

  assert.doesNotThrow(() => {
    writeAuditLog(db, {
      projectId,
      unitNumberNorm: 'A-303',
      tableName: 'master_data',
      field: 'buyer_name',
      oldValue: 'OLD',
      newValue: 'NEW',
      action: 'auto_apply',
      source: auditSourceFor.rule(),
      userNote: 'rule_id=1'
    });
  });

  const row = db.prepare(
    "SELECT source, user_note FROM audit_log WHERE unit_number_norm='A-303'"
  ).get();
  assert.equal(row.source, 'rule_fired');
  assert.equal(row.user_note, 'rule_id=1');
});

test('e2e 7: bulkApprove on 3 rows → 3 approved + 3 bulk_op audit rows + master_data updated', () => {
  const db = freshDb();
  const { projectId } = seedEndToEnd(db);

  // Establish prior master_data so the approve-path updates rather than inserts.
  upsertMasterField(db, projectId, 'B-1', 'buyer_name', 'OLD ONE',   'staff');
  upsertMasterField(db, projectId, 'B-2', 'buyer_name', 'OLD TWO',   'staff');
  upsertMasterField(db, projectId, 'B-3', 'buyer_name', 'OLD THREE', 'staff');

  const insertPc = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value)
    VALUES (?, ?, 'buyer_name', ?, ?)
  `);
  const r1 = insertPc.run(projectId, 'B-1', 'OLD ONE',   'NEW ONE').lastInsertRowid;
  const r2 = insertPc.run(projectId, 'B-2', 'OLD TWO',   'NEW TWO').lastInsertRowid;
  const r3 = insertPc.run(projectId, 'B-3', 'OLD THREE', 'NEW THREE').lastInsertRowid;

  const result = bulkApprove(db, [r1, r2, r3], 'tier-2 just');
  assert.equal(result.applied, 3);
  assert.deepEqual(result.failed, []);

  const approved = db.prepare(
    "SELECT COUNT(*) AS n FROM pending_change WHERE decision='approved'"
  ).get().n;
  assert.equal(approved, 3);

  const logs = db.prepare(
    "SELECT source FROM audit_log WHERE source='bulk_op'"
  ).all();
  assert.equal(logs.length, 3);

  for (const unit of ['B-1', 'B-2', 'B-3']) {
    const md = db.prepare(
      'SELECT buyer_name, buyer_source FROM master_data WHERE project_id=? AND unit_number_norm=?'
    ).get(projectId, unit);
    assert.match(md.buyer_name, /^NEW /);
    assert.equal(md.buyer_source, 'dld_approved');
  }
});

test('e2e 8: dry-run rolls back inserted pending_change (SAVEPOINT) and reports would_write', () => {
  const db = freshDb();
  const { projectId } = seedEndToEnd(db);

  const pcBefore = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;

  const summary = runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      d.prepare(`
        INSERT INTO pending_change
          (project_id, unit_number_norm, field_name, old_value, proposed_value,
           change_type, decision)
        VALUES (?, 'DRY-1', 'buyer_name', 'OLD', 'NEW', 'MISMATCH', 'pending')
      `).run(projectId);
    }
  });

  const pcAfter = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  assert.equal(pcAfter, pcBefore, 'SAVEPOINT must restore pending_change to baseline');
  assert.equal(summary.would_write.pending_change, 1);
});
