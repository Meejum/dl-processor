// test/trending.test.js — Phase 7.1 backend tests for getTrendingProjects.
//
// We seed dld_project + dld_snapshot + pending_change with explicit
// imported_at / proposed_at values pinned relative to the *system's*
// current month (computed inside the SUT via date('now','start of month')).
// Tests use a Date helper to build SQL datetime strings the same way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { getTrendingProjects } = require('../src/trending');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

function seedProject(db, name) {
  return db.prepare("INSERT INTO dld_project (project_name) VALUES (?)").run(name).lastInsertRowid;
}

// Insert a dld_snapshot with an explicit imported_at. Returns snapshot_id.
function seedSnapshot(db, projectId, importedAt, opts = {}) {
  return db.prepare(`
    INSERT INTO dld_snapshot
      (project_id, source_format, source_file, snapshot_date, imported_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    projectId,
    opts.source_format ?? 'xps',
    opts.source_file ?? `f-${importedAt}.xps`,
    opts.snapshot_date ?? importedAt.slice(0, 10),
    importedAt
  ).lastInsertRowid;
}

// Insert n pending_change rows referencing the given snapshot. They will be
// bucketed by snapshot.imported_at.
function seedPendingFromSnapshot(db, projectId, snapshotId, n, unitBase = 100) {
  const stmt = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name,
       old_value, proposed_value, change_type, source_snapshot_id, decision)
    VALUES (?, ?, 'buyer_name', 'OLD', 'NEW', 'MISMATCH', ?, 'pending')
  `);
  for (let i = 0; i < n; i++) stmt.run(projectId, `U-${unitBase + i}`, snapshotId);
}

// Insert n SF_DRIFT pending rows (source_snapshot_id NULL) with an explicit
// proposed_at to control bucketing.
function seedPendingSfDrift(db, projectId, proposedAt, n, unitBase = 200) {
  const stmt = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name,
       old_value, proposed_value, change_type, source_snapshot_id, decision, proposed_at)
    VALUES (?, ?, 'purchase_price_aed', 'OLD', 'NEW', 'SF_DRIFT', NULL, 'pending', ?)
  `);
  for (let i = 0; i < n; i++) stmt.run(projectId, `S-${unitBase + i}`, proposedAt);
}

// Date helpers — build SQL datetime strings relative to the system's
// current month so tests track date('now').
function currentMonthDate(db) {
  return db.prepare("SELECT date('now', 'start of month') AS m").get().m; // 'YYYY-MM-01'
}
function monthsAgo(currentMonth, n) {
  const [y, m] = currentMonth.split('-').map(Number);
  const zero = (y * 12 + (m - 1)) - n;
  const yy = Math.floor(zero / 12);
  const mm = (zero % 12) + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`;
}
// Last day of a given month (passed as YYYY-MM-01).
function lastDayOfMonth(firstOfMonth) {
  return new Date(new Date(firstOfMonth + 'T00:00:00Z').getTime() +
    (daysInMonth(firstOfMonth) - 1) * 86400000)
    .toISOString().slice(0, 10);
}
function daysInMonth(firstOfMonth) {
  const [y, m] = firstOfMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ───── tests ─────

test('trending: empty DB → []', () => {
  const db = freshDb();
  assert.deepEqual(getTrendingProjects(db), []);
});

test('trending: below minBaseline → []', () => {
  const db = freshDb();
  const pid = seedProject(db, 'P-below-baseline');
  const now = currentMonthDate(db);
  // 4 this month, 0 trailing → ratio=Infinity but this_month < default 5 baseline.
  const snap = seedSnapshot(db, pid, `${now} 09:00:00`);
  seedPendingFromSnapshot(db, pid, snap, 4);
  assert.deepEqual(getTrendingProjects(db), []);
});

test('trending: below ratioThreshold → []', () => {
  const db = freshDb();
  const pid = seedProject(db, 'P-flat');
  const now = currentMonthDate(db);

  // 6 this month meets minBaseline.
  const snapNow = seedSnapshot(db, pid, `${now} 09:00:00`);
  seedPendingFromSnapshot(db, pid, snapNow, 6, 100);

  // Trailing 6 months avg = (6+6+6+6+6+6)/6 = 6 → ratio = 6/6 = 1.0 < 2.0.
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    const snap = seedSnapshot(db, pid, `${m} 09:00:00`, { source_file: `prev-${i}.xps` });
    seedPendingFromSnapshot(db, pid, snap, 6, 100 + i * 100);
  }

  assert.deepEqual(getTrendingProjects(db), []);
});

test('trending: meets baseline AND ratio → returned', () => {
  const db = freshDb();
  const pid = seedProject(db, 'P-trending');
  const now = currentMonthDate(db);

  // 10 this month.
  const snapNow = seedSnapshot(db, pid, `${now} 09:00:00`);
  seedPendingFromSnapshot(db, pid, snapNow, 10, 100);

  // Trailing 6 months: 6 months × 2 each = trailing_avg 2 → ratio = 10/2 = 5.0.
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    const snap = seedSnapshot(db, pid, `${m} 09:00:00`, { source_file: `prev-${i}.xps` });
    seedPendingFromSnapshot(db, pid, snap, 2, 100 + i * 100);
  }

  const out = getTrendingProjects(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].project_id, pid);
  assert.equal(out[0].project_name, 'P-trending');
  assert.equal(out[0].this_month, 10);
  assert.equal(out[0].trailing_avg, 2);
  assert.equal(out[0].ratio, 5);
});

test('trending: sorted by ratio DESC across multiple projects', () => {
  const db = freshDb();
  const now = currentMonthDate(db);

  // Project A: ratio 5 (10 this month, avg 2).
  const pA = seedProject(db, 'A');
  seedPendingFromSnapshot(db, pA, seedSnapshot(db, pA, `${now} 09:00:00`), 10, 100);
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    seedPendingFromSnapshot(db, pA,
      seedSnapshot(db, pA, `${m} 09:00:00`, { source_file: `A-${i}.xps` }), 2, 100 + i * 100);
  }

  // Project B: ratio 10 (20 this month, avg 2).
  const pB = seedProject(db, 'B');
  seedPendingFromSnapshot(db, pB, seedSnapshot(db, pB, `${now} 09:00:00`), 20, 100);
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    seedPendingFromSnapshot(db, pB,
      seedSnapshot(db, pB, `${m} 09:00:00`, { source_file: `B-${i}.xps` }), 2, 100 + i * 100);
  }

  // Project C: ratio 3 (6 this month, avg 2).
  const pC = seedProject(db, 'C');
  seedPendingFromSnapshot(db, pC, seedSnapshot(db, pC, `${now} 09:00:00`), 6, 100);
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    seedPendingFromSnapshot(db, pC,
      seedSnapshot(db, pC, `${m} 09:00:00`, { source_file: `C-${i}.xps` }), 2, 100 + i * 100);
  }

  const out = getTrendingProjects(db);
  assert.deepEqual(out.map(r => r.project_name), ['B', 'A', 'C']);
  assert.deepEqual(out.map(r => r.ratio), [10, 5, 3]);
});

test('trending: month boundary — snapshot imported on last day of last month buckets to last month', () => {
  const db = freshDb();
  const pid = seedProject(db, 'P-boundary');
  const now = currentMonthDate(db);
  const lastMonth = monthsAgo(now, 1);
  const lastDay = lastDayOfMonth(lastMonth);

  // 100 pending changes from a snapshot imported at 23:59:59 on the last day of last month.
  // If bucketing is correct (start-of-month), these belong to LAST month, not this.
  const snapEdge = seedSnapshot(db, pid, `${lastDay} 23:59:59`,
    { source_file: 'edge.xps', snapshot_date: lastDay });
  seedPendingFromSnapshot(db, pid, snapEdge, 100, 100);

  // Add 10 this-month rows so the project might trend IF the boundary bucket
  // wrongly slid forward (which would push this_month to 110 and trailing_avg
  // down). Correct bucketing: this_month=10, last_month=100, trailing_avg=100/6≈16.7,
  // ratio≈0.6 < 2.0 → filtered out.
  const snapNow = seedSnapshot(db, pid, `${now} 09:00:00`, { source_file: 'now.xps' });
  seedPendingFromSnapshot(db, pid, snapNow, 10, 500);

  const out = getTrendingProjects(db);
  assert.deepEqual(out, [],
    'last-day-of-last-month snapshot must bucket to last month, not current');
});

test('trending: SF_DRIFT rows bucket by proposed_at (snapshot id NULL)', () => {
  // Verifies the COALESCE fallback path — SF_DRIFT pending_change rows have
  // source_snapshot_id NULL, so bucketing uses proposed_at.
  const db = freshDb();
  const pid = seedProject(db, 'P-sf');
  const now = currentMonthDate(db);

  // 8 SF_DRIFT rows this month.
  seedPendingSfDrift(db, pid, `${now} 10:00:00`, 8, 100);

  // 1 SF_DRIFT row in each of the trailing 6 months → trailing_avg = 1, ratio = 8.
  for (let i = 1; i <= 6; i++) {
    seedPendingSfDrift(db, pid, `${monthsAgo(now, i)} 10:00:00`, 1, 100 + i * 100);
  }

  const out = getTrendingProjects(db);
  assert.equal(out.length, 1);
  assert.equal(out[0].this_month, 8);
  assert.equal(out[0].trailing_avg, 1);
  assert.equal(out[0].ratio, 8);
});

test('trending: settings override defaults (tighter thresholds filter more)', () => {
  const db = freshDb();
  const pid = seedProject(db, 'P-tight');
  const now = currentMonthDate(db);

  // 10 this month, trailing avg 2 → ratio 5. Passes defaults (5, 2.0); should
  // ALSO pass {minBaseline:10, ratioThreshold:3.0} (10>=10, 5>=3).
  seedPendingFromSnapshot(db, pid, seedSnapshot(db, pid, `${now} 09:00:00`), 10, 100);
  for (let i = 1; i <= 6; i++) {
    const m = monthsAgo(now, i);
    seedPendingFromSnapshot(db, pid,
      seedSnapshot(db, pid, `${m} 09:00:00`, { source_file: `t-${i}.xps` }), 2, 100 + i * 100);
  }

  assert.equal(getTrendingProjects(db, { minBaseline: 10, ratioThreshold: 3.0 }).length, 1,
    'project meets tighter thresholds');

  // Tighter still: ratio threshold 6.0 → filtered out (ratio 5 < 6).
  assert.deepEqual(getTrendingProjects(db, { minBaseline: 10, ratioThreshold: 6.0 }), []);

  // Tighter baseline: minBaseline 11 → filtered out (this_month 10 < 11).
  assert.deepEqual(getTrendingProjects(db, { minBaseline: 11, ratioThreshold: 2.0 }), []);
});
