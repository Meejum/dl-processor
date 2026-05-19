// Tests for `node . compare --dry-run` — Phase 8.1 of the v2.3 plan.
//
// We exercise runCompareDryRun() against an in-memory DB. The compare body
// is stubbed via the opts._bodyOverride test seam so we can deterministically
// insert pending_change + audit_log rows and verify:
//   1. SAVEPOINT rollback leaves the DB at pre-run counts.
//   2. The collected counts match what the body actually inserted.
//   3. JSON / text emission shapes are correct.
//   4. A throw inside the body still rolls back (try/finally).
//
// The body that would normally run (runCompareBody) is exercised by the
// existing compare-* suites. This file's responsibility is the dry-run
// wrapper specifically.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { runCompareDryRun, renderDryRunText } = require('../src/commands/compare');
const { writeAuditLog } = require('../src/audit-log');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

function seedProject(db, name) {
  return db.prepare(
    "INSERT INTO dld_project (project_name) VALUES (?)"
  ).run(name).lastInsertRowid;
}

// Inserts one pending_change + one auto_apply audit_log entry. Used as
// the body-override stand-in for the compare body so the test stays
// independent of full compare-pipeline state.
function insertOneChange(db, projectId, unit, field, oldV, newV, changeType) {
  const info = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value,
       change_type, decision)
    VALUES (?, ?, ?, ?, ?, ?, 'auto_applied')
  `).run(projectId, unit, field, oldV, newV, changeType);
  writeAuditLog(db, {
    projectId,
    unitNumberNorm: unit,
    tableName: 'master_data',
    field,
    oldValue: oldV,
    newValue: newV,
    action: 'auto_apply',
    source: 'compare',
    changeId: info.lastInsertRowid
  });
  return info.lastInsertRowid;
}

test('dry-run rolls back: pending_change + audit_log return to pre-run counts', () => {
  const db = freshDb();
  const pid = seedProject(db, 'ALPHA');

  const pcBefore = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  const alBefore = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      insertOneChange(d, pid, '101', 'buyer_name',         'Old A', 'New A', 'MISMATCH');
      insertOneChange(d, pid, '102', 'purchase_price_aed', '100',   '120',   'SF_DRIFT');
      insertOneChange(d, pid, '103', 'area_sqm',           '50',    '55',    'MISMATCH');
    }
  });

  const pcAfter = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  const alAfter = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  assert.equal(pcAfter, pcBefore, 'pending_change must be unchanged after dry-run');
  assert.equal(alAfter, alBefore, 'audit_log must be unchanged after dry-run');
});

test('summary counts match what a real (non-dry) compare WOULD have produced', () => {
  const db = freshDb();
  const pid = seedProject(db, 'BETA');

  const summary = runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      insertOneChange(d, pid, '201', 'buyer_name',         'X', 'Y', 'MISMATCH');
      insertOneChange(d, pid, '202', 'buyer_name',         'P', 'Q', 'MISMATCH');
      insertOneChange(d, pid, '203', 'purchase_price_aed', '1', '2', 'SF_DRIFT');
    }
  });

  assert.equal(summary.would_write.pending_change, 3);
  assert.equal(summary.would_write.audit_log_auto_apply, 3);
  // by_change_type sorted desc by total. MISMATCH (2) outranks SF_DRIFT (1).
  assert.equal(summary.by_change_type[0].type, 'MISMATCH');
  assert.equal(summary.by_change_type[0].total, 2);
  assert.equal(summary.by_change_type[1].type, 'SF_DRIFT');
  assert.equal(summary.by_change_type[1].total, 1);
  // by_project — single project
  assert.equal(summary.by_project.length, 1);
  assert.equal(summary.by_project[0].name, 'BETA');
  assert.equal(summary.by_project[0].total, 3);
  // samples include unit/field/old/new + decision
  assert.equal(summary.samples.length, 3);
  for (const s of summary.samples) {
    assert.ok(s.unit && s.field, 'each sample has unit + field');
    assert.equal(s.decision.action, 'auto_apply');
  }
});

test('by_project buckets join dld_project for the human-readable name', () => {
  const db = freshDb();
  const a = seedProject(db, 'ALPHA');
  const b = seedProject(db, 'BRAVO');

  const summary = runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      insertOneChange(d, a, '1', 'buyer_name', 'x', 'y', 'MISMATCH');
      insertOneChange(d, a, '2', 'buyer_name', 'x', 'y', 'MISMATCH');
      insertOneChange(d, b, '3', 'buyer_name', 'x', 'y', 'MISMATCH');
    }
  });

  const names = summary.by_project.map(p => p.name).sort();
  assert.deepEqual(names, ['ALPHA', 'BRAVO']);
  const alphaBucket = summary.by_project.find(p => p.name === 'ALPHA');
  assert.equal(alphaBucket.total, 2);
});

test('JSON output is valid JSON and matches spec §8.2 shape', () => {
  const db = freshDb();
  const pid = seedProject(db, 'GAMMA');

  // Sandbox stdout + file emission into a temp dir.
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dryrun-json-'));
  const prevDataRoot = process.env.DLP_DATA_ROOT;
  process.env.DLP_DATA_ROOT = tmp;
  const origWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => { captured += chunk; return true; };
  try {
    runCompareDryRun(db, null, {
      format: 'json',
      _bodyOverride: (d) => {
        insertOneChange(d, pid, '301', 'buyer_name', 'A', 'B', 'MISMATCH');
      }
    });
  } finally {
    process.stdout.write = origWrite;
    if (prevDataRoot === undefined) delete process.env.DLP_DATA_ROOT;
    else process.env.DLP_DATA_ROOT = prevDataRoot;
  }

  const parsed = JSON.parse(captured);
  assert.ok(parsed.would_write,        'has would_write');
  assert.ok(Array.isArray(parsed.by_change_type), 'has by_change_type array');
  assert.ok(Array.isArray(parsed.by_project),     'has by_project array');
  assert.ok(Array.isArray(parsed.samples),        'has samples array');
  assert.equal(parsed.would_write.pending_change, 1);

  // A dry-run-<ts>.json file was written under <tmp>/output/.
  const files = fs.readdirSync(path.join(tmp, 'output')).filter(f => f.startsWith('dry-run-') && f.endsWith('.json'));
  assert.ok(files.length >= 1, 'wrote at least one dry-run-<ts>.json file');
});

test('text output contains DRY-RUN banner and project totals', () => {
  const db = freshDb();
  const pid = seedProject(db, 'DELTA');
  const summary = runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      insertOneChange(d, pid, '401', 'buyer_name', 'A', 'B', 'MISMATCH');
    }
  });
  const text = renderDryRunText(summary);
  assert.match(text, /DRY-RUN/);
  assert.match(text, /pending_change rows/);
  assert.match(text, /MISMATCH/);
  assert.match(text, /DELTA/);
});

test('throwing inside the body still rolls back (try/finally)', () => {
  const db = freshDb();
  const pid = seedProject(db, 'EPSILON');

  const pcBefore = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  const alBefore = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  // The wrapper catches body errors and records them on summary.error —
  // it does NOT re-throw — so the call returns normally. The critical
  // contract is that the SAVEPOINT was rolled back.
  const summary = runCompareDryRun(db, null, {
    _emit: false,
    _bodyOverride: (d) => {
      insertOneChange(d, pid, '501', 'buyer_name', 'A', 'B', 'MISMATCH');
      insertOneChange(d, pid, '502', 'buyer_name', 'C', 'D', 'MISMATCH');
      throw new Error('synthetic body failure');
    }
  });

  const pcAfter = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  const alAfter = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  assert.equal(pcAfter, pcBefore, 'pending_change unchanged after body threw');
  assert.equal(alAfter, alBefore, 'audit_log unchanged after body threw');
  assert.match(summary.error || '', /synthetic body failure/);
  // The two inserts before the throw still count toward would_write,
  // because we measure delta BEFORE the rollback.
  assert.equal(summary.would_write.pending_change, 2);
});
