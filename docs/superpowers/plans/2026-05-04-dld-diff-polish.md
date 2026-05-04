# DLD Diff Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small refinements to the existing month-over-month DLD diff: hide "missing" rows by default, accept a `--since YYYY-MM-DD` baseline override, and restructure the per-project terminal block to be scannable.

**Architecture:** Surgical edits to `src/diff.js` (engine: rename `REMOVED_*` → `MISSING_*`, add `includeMissing` option, add `pickBaseline` helper, return `hiddenMissingCount`) and `index.js cmdDiff` (parse new flags, restructure terminal output, add grand-total footer). One new test file `test/diff.test.js`. No DB schema changes. No new files in `src/`.

**Tech Stack:** Node.js (no transpiler), `better-sqlite3`, `node:test` + `node:assert/strict`. Tests build `:memory:` databases via `migrateSchema()` from `src/db.js`. CLI run via `node index.js`. Test run via `npm test` (`node --test "test/**/*.test.js"`).

**Spec:** `docs/superpowers/specs/2026-05-04-dld-diff-polish-design.md`

---

## File Map

- **Modify:** `src/diff.js` — engine semantics (rename, `includeMissing`, `pickBaseline`, `hiddenMissingCount`, HTML chip + meta tweaks).
- **Modify:** `index.js` — `cmdDiff` flag parsing, restructured terminal block, grand-total footer, updated `usage()` text.
- **Create:** `test/diff.test.js` — seven test cases covering the new behavior.

No other files are touched.

---

## Branch & Pre-flight

This work lands on `feat/dld-diff-polish` (already created off `master`, currently has the spec commit `e0af6bf`). Run all commands from `C:\projects\DL-Processor`.

- [ ] **Step 0.1: Verify branch and clean tree**

Run:
```
git branch --show-current
git status --short
```
Expected: `feat/dld-diff-polish` and no uncommitted changes (the README/xps/csv mess is on the other branch and stays there).

- [ ] **Step 0.2: Verify baseline tests pass before any changes**

Run:
```
npm test
```
Expected: all tests pass. Record the count from the summary line. The new tests added in this plan must keep this baseline green.

---

## Task 1: Engine — rename `REMOVED_*` change types to `MISSING_*`

The existing engine emits `REMOVED_UNIT` and `REMOVED_TX`. Rename to `MISSING_UNIT` / `MISSING_TX` and update the detail copy. This is a pure rename — no behavior change yet (filtering is added in Task 2).

**Files:**
- Modify: `src/diff.js` (around lines 100–110, 162–172, 194–202, 245)
- Test: `test/diff.test.js` (new file, first test)

- [ ] **Step 1.1: Create `test/diff.test.js` with the rename test (failing)**

Create `test/diff.test.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { diffProject, pickBaseline } = require('../src/diff');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  const info = db.prepare(
    `INSERT INTO dld_project (project_name) VALUES (?)`
  ).run(name);
  return info.lastInsertRowid;
}

function insertSnapshot(db, projectId, { snapshotDate, importedAt, sourceFormat = 'csv', sourceFile = 'fake.csv' }) {
  const info = db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, imported_at, total_units, total_tx)
     VALUES (?, ?, ?, ?, ?, 0, 0)`
  ).run(projectId, sourceFormat, sourceFile, snapshotDate, importedAt);
  return info.lastInsertRowid;
}

function insertUnit(db, snapshotId, projectId, { unitNumber, netArea = null, unitType = null }) {
  const norm = String(unitNumber).toUpperCase().replace(/\s+/g, '');
  const info = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area, unit_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(snapshotId, projectId, unitNumber, norm, netArea, unitType);
  return info.lastInsertRowid;
}

function insertTx(db, unitId, snapshotId, projectId, { partyName, txType = 'Sell', txDate = '2026-01-01', amountAed = 1000000 }) {
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date, amount_aed)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(unitId, snapshotId, projectId, partyName, txType, txDate, amountAed);
}

test('diffProject emits MISSING_UNIT (not REMOVED_UNIT) when includeMissing is true', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Alpha');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100, unitType: 'Apt' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid, { includeMissing: true });
  assert.equal(result.status, 'ok');
  const types = new Set(result.rows.map(r => r.change_type));
  assert.ok(types.has('MISSING_UNIT'), 'expected MISSING_UNIT, got: ' + [...types].join(','));
  assert.ok(!types.has('REMOVED_UNIT'), 'REMOVED_UNIT should no longer be emitted');
});
```

- [ ] **Step 1.2: Run the new test and verify it fails**

Run: `node --test test/diff.test.js`
Expected: FAIL — either `pickBaseline is not a function` or `MISSING_UNIT` not present (current code emits `REMOVED_UNIT`).

- [ ] **Step 1.3: Rename `REMOVED_UNIT` → `MISSING_UNIT` in `src/diff.js`**

In `src/diff.js`, locate the block at lines 100–109 (the `if (o && !n)` branch) and change:
```javascript
    if (o && !n) {
      push({
        ...unitRow(key, o, null),
        change_type: 'REMOVED_UNIT',
        category:    'unit',
        old_value:   `${o.unit_type || ''} · ${o.net_area || ''} sqm · ${o.transactions.length} tx`,
        new_value:   '',
        detail:      'unit disappeared from DLD snapshot'
      });
      continue;
    }
```
to:
```javascript
    if (o && !n) {
      push({
        ...unitRow(key, o, null),
        change_type: 'MISSING_UNIT',
        category:    'unit',
        old_value:   `${o.unit_type || ''} · ${o.net_area || ''} sqm · ${o.transactions.length} tx`,
        new_value:   '',
        detail:      'unit not present in latest snapshot (may be out of report scope)'
      });
      continue;
    }
```

- [ ] **Step 1.4: Rename `REMOVED_TX` → `MISSING_TX` in `src/diff.js`**

In `src/diff.js`, locate the block at lines 162–173 (the `for (const [k, t] of oTx.entries())` loop) and change:
```javascript
    for (const [k, t] of oTx.entries()) {
      if (!nTx.has(k)) {
        push({
          ...unitRow(key, o, n),
          change_type: 'REMOVED_TX',
          category:    'tx',
          old_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          new_value:   '',
          detail:      'transaction disappeared'
        });
      }
    }
```
to:
```javascript
    for (const [k, t] of oTx.entries()) {
      if (!nTx.has(k)) {
        push({
          ...unitRow(key, o, n),
          change_type: 'MISSING_TX',
          category:    'tx',
          old_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          new_value:   '',
          detail:      'transaction not present in latest snapshot (may be out of report scope)'
        });
      }
    }
```

- [ ] **Step 1.5: Update `CHANGE_CLASS` map in `src/diff.js`**

Locate lines 194–202 and change:
```javascript
const CHANGE_CLASS = {
  NEW_UNIT:         'ok',
  NEW_TX:           'ok',
  REMOVED_UNIT:     'warn',
  REMOVED_TX:       'warn',
  AMOUNT_CHANGED:   'amt',
  UNIT_TYPE_CHANGED:'dld',
  AREA_CHANGED:     'dld'
};
```
to:
```javascript
const CHANGE_CLASS = {
  NEW_UNIT:         'ok',
  NEW_TX:           'ok',
  MISSING_UNIT:     'warn',
  MISSING_TX:       'warn',
  AMOUNT_CHANGED:   'amt',
  UNIT_TYPE_CHANGED:'dld',
  AREA_CHANGED:     'dld'
};
```

- [ ] **Step 1.6: Update `knownChanges` array in `writeDiffHtml`**

Locate line 245 and change:
```javascript
  const knownChanges = ['NEW_UNIT','NEW_TX','AMOUNT_CHANGED','REMOVED_UNIT','REMOVED_TX','UNIT_TYPE_CHANGED','AREA_CHANGED'];
```
to:
```javascript
  const knownChanges = ['NEW_UNIT','NEW_TX','AMOUNT_CHANGED','MISSING_UNIT','MISSING_TX','UNIT_TYPE_CHANGED','AREA_CHANGED'];
```

(This is a transitional change — Task 5 will replace `knownChanges` with a list computed from `result.rows` so chips only render for change types actually present.)

- [ ] **Step 1.7: Export `pickBaseline` (placeholder) so test 1 can require it without error**

At the bottom of `src/diff.js`, change:
```javascript
module.exports = { diffProject, summarizeDiff, writeDiffCsv, writeDiffHtml };
```
to:
```javascript
module.exports = { diffProject, summarizeDiff, writeDiffCsv, writeDiffHtml, pickBaseline };
```

Above the existing `latestTwoSnapshots` function (around line 21), add a placeholder `pickBaseline` that delegates to existing behavior — Task 3 will replace its body:
```javascript
function pickBaseline(db, projectId, { since } = {}) {
  if (since !== undefined) {
    throw new Error('pickBaseline: since not yet implemented');
  }
  const snaps = latestTwoSnapshots(db, projectId);
  if (snaps.length < 2) {
    return { status: 'not-enough-snapshots', oldSnap: null, newSnap: null };
  }
  return { status: 'ok', oldSnap: snaps[1], newSnap: snaps[0] };
}
```

- [ ] **Step 1.8: Run the test and verify it now passes**

Run: `node --test test/diff.test.js`
Expected: PASS (the single test).

- [ ] **Step 1.9: Run the full test suite and verify nothing regressed**

Run: `npm test`
Expected: all previously-passing tests still pass, plus the new one.

- [ ] **Step 1.10: Commit**

```
git add src/diff.js test/diff.test.js
git commit -m "feat(diff): rename REMOVED_* change types to MISSING_*"
```

---

## Task 2: Engine — `includeMissing` option (default false) and `hiddenMissingCount`

`diffProject` should detect missing rows internally but filter them out of the returned `rows` by default. Caller can pass `includeMissing: true` to include them. The result always exposes `hiddenMissingCount: { units, txs }`.

**Files:**
- Modify: `src/diff.js` (the `diffProject` function, lines ~55–177)
- Test: `test/diff.test.js`

- [ ] **Step 2.1: Add the failing test for default-hidden missing rows**

Append to `test/diff.test.js`:
```javascript
test('missing rows are hidden from rows and counted in hiddenMissingCount by default', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Beta');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const u = insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  insertTx(db, u, oldSnap, pid, { partyName: 'Alice' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid);
  assert.equal(result.status, 'ok');
  assert.equal(result.rows.length, 0, 'rows should be empty when missing are hidden');
  assert.deepEqual(result.hiddenMissingCount, { units: 1, txs: 1 });
});

test('hiddenMissingCount is zero when includeMissing is true', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Gamma');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const u = insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  insertTx(db, u, oldSnap, pid, { partyName: 'Alice' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid, { includeMissing: true });
  assert.equal(result.rows.length, 2, 'expected MISSING_UNIT + MISSING_TX rows');
  assert.deepEqual(result.hiddenMissingCount, { units: 0, txs: 0 });
});

test('hiddenMissingCount is zero when there are no missing rows', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Delta');
  const oldSnap = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  insertUnit(db, oldSnap, pid, { unitNumber: 'P-101', netArea: 100 });
  const newSnap = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });
  insertUnit(db, newSnap, pid, { unitNumber: 'P-101', netArea: 105 });

  const result = diffProject(db, pid);
  assert.deepEqual(result.hiddenMissingCount, { units: 0, txs: 0 });
  assert.equal(result.rows.length, 1, 'expected one AREA_CHANGED row');
  assert.equal(result.rows[0].change_type, 'AREA_CHANGED');
});
```

- [ ] **Step 2.2: Run and verify these new tests fail**

Run: `node --test test/diff.test.js`
Expected: the three new tests FAIL — `result.hiddenMissingCount` is undefined and missing rows are still in `result.rows`.

- [ ] **Step 2.3: Modify `diffProject` to accept `includeMissing` and return `hiddenMissingCount`**

In `src/diff.js`, replace the existing `diffProject` function signature and final return. The current signature is:
```javascript
function diffProject(db, projectId, { oldSnapshotId, newSnapshotId } = {}) {
```
Change to:
```javascript
function diffProject(db, projectId, { oldSnapshotId, newSnapshotId, includeMissing = false } = {}) {
```

After the loop that pushes rows (immediately before `return { project, status: 'ok', oldSnapshot: oldSnap, newSnapshot: newSnap, rows };` near line 176), insert filtering logic and replace the return:
```javascript
  let hiddenUnits = 0;
  let hiddenTxs = 0;
  let outRows = rows;
  if (!includeMissing) {
    outRows = [];
    for (const r of rows) {
      if (r.change_type === 'MISSING_UNIT') { hiddenUnits++; continue; }
      if (r.change_type === 'MISSING_TX')   { hiddenTxs++;   continue; }
      outRows.push(r);
    }
  }

  return {
    project,
    status: 'ok',
    oldSnapshot: oldSnap,
    newSnapshot: newSnap,
    rows: outRows,
    hiddenMissingCount: { units: hiddenUnits, txs: hiddenTxs }
  };
```

Also add `hiddenMissingCount: { units: 0, txs: 0 }` to the early-return path for `not-enough-snapshots` (around line 65). The existing return is:
```javascript
    if (snaps.length < 2) return { project, status: 'not-enough-snapshots', snaps };
```
Change to:
```javascript
    if (snaps.length < 2) return { project, status: 'not-enough-snapshots', snaps, hiddenMissingCount: { units: 0, txs: 0 } };
```

- [ ] **Step 2.4: Run the new tests and verify they pass**

Run: `node --test test/diff.test.js`
Expected: all four tests PASS.

- [ ] **Step 2.5: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2.6: Commit**

```
git add src/diff.js test/diff.test.js
git commit -m "feat(diff): hide MISSING_* by default; expose hiddenMissingCount"
```

---

## Task 3: Engine — `pickBaseline(db, projectId, { since })` helper

Replace the placeholder `pickBaseline` from Task 1 with a real implementation that supports `since`-based baseline selection.

`since` is an ISO date string `YYYY-MM-DD`. The newest snapshot is always the latest for the project. The older snapshot is the most recent whose `imported_at < since`. If none exists, return `status: 'no-baseline-before-date'`. Malformed `since` throws.

The relevant `imported_at` values are stored as `'YYYY-MM-DD HH:MM:SS'`. Lexical comparison of `'YYYY-MM-DD HH:MM:SS' < 'YYYY-MM-DD'` correctly excludes same-day imports because the longer string ranks higher.

**Files:**
- Modify: `src/diff.js` (the `pickBaseline` placeholder added in Task 1)
- Test: `test/diff.test.js`

- [ ] **Step 3.1: Add failing tests for `pickBaseline`**

Append to `test/diff.test.js`:
```javascript
test('pickBaseline with no since returns latest two', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-A');
  const s1 = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const s2 = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const r = pickBaseline(db, pid);
  assert.equal(r.status, 'ok');
  assert.equal(r.oldSnap.snapshot_id, s1);
  assert.equal(r.newSnap.snapshot_id, s2);
});

test('pickBaseline with since picks newest snapshot before that date as old', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-B');
  const s1 = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });
  const s2 = insertSnapshot(db, pid, { snapshotDate: '2026-03-01', importedAt: '2026-03-01 10:00:00' });
  const s3 = insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });

  const r = pickBaseline(db, pid, { since: '2026-03-15' });
  assert.equal(r.status, 'ok');
  assert.equal(r.oldSnap.snapshot_id, s2, 'baseline should be the March snapshot');
  assert.equal(r.newSnap.snapshot_id, s3, 'latest should still be the April snapshot');
});

test('pickBaseline with since returns no-baseline-before-date when nothing qualifies', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-C');
  insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });
  insertSnapshot(db, pid, { snapshotDate: '2026-05-01', importedAt: '2026-05-01 10:00:00' });

  const r = pickBaseline(db, pid, { since: '2026-01-01' });
  assert.equal(r.status, 'no-baseline-before-date');
  assert.equal(r.oldSnap, null);
});

test('pickBaseline throws on malformed since', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-D');
  insertSnapshot(db, pid, { snapshotDate: '2026-04-01', importedAt: '2026-04-01 10:00:00' });

  assert.throws(
    () => pickBaseline(db, pid, { since: 'not-a-date' }),
    /invalid --since date/
  );
});

test('pickBaseline with since returns no-baseline-before-date when project has no snapshots', () => {
  const db = buildDb();
  const pid = insertProject(db, 'PB-E');
  const r = pickBaseline(db, pid, { since: '2026-03-15' });
  assert.equal(r.status, 'no-baseline-before-date');
});
```

- [ ] **Step 3.2: Run and verify the new tests fail**

Run: `node --test test/diff.test.js`
Expected: the five `pickBaseline` tests FAIL — current placeholder throws on any `since`.

- [ ] **Step 3.3: Replace the `pickBaseline` placeholder with the real implementation**

In `src/diff.js`, replace the placeholder added in Task 1 with:
```javascript
function isValidIsoDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function pickBaseline(db, projectId, { since } = {}) {
  if (since === undefined || since === null) {
    const snaps = latestTwoSnapshots(db, projectId);
    if (snaps.length < 2) {
      return { status: 'not-enough-snapshots', oldSnap: null, newSnap: null };
    }
    return { status: 'ok', oldSnap: snaps[1], newSnap: snaps[0] };
  }

  if (!isValidIsoDate(since)) {
    throw new Error('invalid --since date: "' + since + '" (expected YYYY-MM-DD)');
  }

  const newSnap = db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId);

  const oldSnap = db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ? AND imported_at < ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId, since);

  if (!newSnap || !oldSnap) {
    return { status: 'no-baseline-before-date', oldSnap: null, newSnap: null };
  }
  return { status: 'ok', oldSnap, newSnap };
}
```

- [ ] **Step 3.4: Wire `pickBaseline` into `diffProject` for `since` support**

In `diffProject`, the current snapshot-picking block is:
```javascript
  let oldSnap, newSnap;
  if (oldSnapshotId && newSnapshotId) {
    oldSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(oldSnapshotId);
    newSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(newSnapshotId);
  } else {
    const snaps = latestTwoSnapshots(db, projectId);
    if (snaps.length < 2) return { project, status: 'not-enough-snapshots', snaps, hiddenMissingCount: { units: 0, txs: 0 } };
    newSnap = snaps[0];
    oldSnap = snaps[1];
  }
```
Add `since` to the destructured options and replace the `else` branch:
```javascript
function diffProject(db, projectId, { oldSnapshotId, newSnapshotId, includeMissing = false, since } = {}) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id = ?').get(projectId);
  if (!project) throw new Error('project not found');

  let oldSnap, newSnap;
  if (oldSnapshotId && newSnapshotId) {
    oldSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(oldSnapshotId);
    newSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(newSnapshotId);
  } else {
    const picked = pickBaseline(db, projectId, { since });
    if (picked.status !== 'ok') {
      return { project, status: picked.status, snaps: [], hiddenMissingCount: { units: 0, txs: 0 } };
    }
    oldSnap = picked.oldSnap;
    newSnap = picked.newSnap;
  }
```
(Replace just the snapshot-picking block; keep everything below it as-is.)

- [ ] **Step 3.5: Run the new tests and verify they pass**

Run: `node --test test/diff.test.js`
Expected: all `pickBaseline` tests PASS plus the earlier four still PASS.

- [ ] **Step 3.6: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 3.7: Commit**

```
git add src/diff.js test/diff.test.js
git commit -m "feat(diff): pickBaseline helper with --since YYYY-MM-DD support"
```

---

## Task 4: Engine — preserve existing change types under new behavior

Verify with one explicit test that `AREA_CHANGED`, `NEW_TX`, etc. still emit correctly and that `summarizeDiff` over a hidden-missing result has no `MISSING_*` keys.

**Files:**
- Test only: `test/diff.test.js`

- [ ] **Step 4.1: Add the regression test**

Append to `test/diff.test.js`:
```javascript
const { summarizeDiff } = require('../src/diff');

test('AREA_CHANGED and NEW_TX still emitted across snapshots', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Eps');
  const sOld = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const uOld = insertUnit(db, sOld, pid, { unitNumber: 'P-101', netArea: 100, unitType: 'Apt' });
  insertTx(db, uOld, sOld, pid, { partyName: 'Alice', txType: 'Sell', txDate: '2026-01-01', amountAed: 1000000 });

  const sNew = insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });
  const uNew = insertUnit(db, sNew, pid, { unitNumber: 'P-101', netArea: 110, unitType: 'Apt' });
  insertTx(db, uNew, sNew, pid, { partyName: 'Alice', txType: 'Sell', txDate: '2026-01-01', amountAed: 1000000 });
  insertTx(db, uNew, sNew, pid, { partyName: 'Bob',   txType: 'Sell', txDate: '2026-02-01', amountAed: 2000000 });

  const result = diffProject(db, pid);
  const types = result.rows.map(r => r.change_type).sort();
  assert.deepEqual(types, ['AREA_CHANGED', 'NEW_TX']);
  assert.deepEqual(result.hiddenMissingCount, { units: 0, txs: 0 });
});

test('summarizeDiff over hidden-missing result has no MISSING_* keys', () => {
  const db = buildDb();
  const pid = insertProject(db, 'Zeta');
  const sOld = insertSnapshot(db, pid, { snapshotDate: '2026-01-01', importedAt: '2026-01-01 10:00:00' });
  const u = insertUnit(db, sOld, pid, { unitNumber: 'P-101', netArea: 100 });
  insertTx(db, u, sOld, pid, { partyName: 'Alice' });
  insertSnapshot(db, pid, { snapshotDate: '2026-02-01', importedAt: '2026-02-01 10:00:00' });

  const result = diffProject(db, pid);
  const counts = summarizeDiff(result.rows);
  assert.equal(counts.MISSING_UNIT, undefined);
  assert.equal(counts.MISSING_TX, undefined);
});
```

- [ ] **Step 4.2: Run and verify both tests pass**

Run: `node --test test/diff.test.js`
Expected: PASS (no code changes needed — these verify behavior already implemented in Tasks 1–3).

- [ ] **Step 4.3: Commit**

```
git add test/diff.test.js
git commit -m "test(diff): regression coverage for existing change types"
```

---

## Task 5: HTML — render only chips for change types present, add hidden-rows meta

Today `writeDiffHtml` hardcodes a `knownChanges` array of seven types. Replace with the actual types present in `result.rows` (so `MISSING_*` chips appear only with `--show-missing`). Also add a meta line under the snapshot pair when `hiddenMissingCount > 0`. And add `--since` provenance suffix to the older snapshot card when applicable.

**Files:**
- Modify: `src/diff.js` — `writeDiffHtml` function (around lines 204–310)
- Test: smoke test only (manual visual confirmation; HTML structure not unit-tested)

- [ ] **Step 5.1: Replace `knownChanges` with present-types computation**

In `writeDiffHtml`, locate:
```javascript
  const knownChanges = ['NEW_UNIT','NEW_TX','AMOUNT_CHANGED','MISSING_UNIT','MISSING_TX','UNIT_TYPE_CHANGED','AREA_CHANGED'];
  const chipsHtml = knownChanges.map(ct => {
    const count = counts[ct] || 0;
    const cls = CHANGE_CLASS[ct] || '';
    return `<span class="chip ${cls}" data-change="${ct}">${ct.replace(/_/g,' ')} ${count}</span>`;
  }).join('');
```
Replace with:
```javascript
  const presentChanges = Array.from(new Set(result.rows.map(r => r.change_type)));
  // Stable display order: NEW_*, AMOUNT_CHANGED, AREA_CHANGED, UNIT_TYPE_CHANGED, MISSING_*
  const ORDER = ['NEW_UNIT','NEW_TX','AMOUNT_CHANGED','AREA_CHANGED','UNIT_TYPE_CHANGED','MISSING_UNIT','MISSING_TX'];
  presentChanges.sort((a, b) => {
    const ia = ORDER.indexOf(a); const ib = ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  const chipsHtml = presentChanges.map(ct => {
    const count = counts[ct] || 0;
    const cls = CHANGE_CLASS[ct] || '';
    return `<span class="chip ${cls}" data-change="${ct}">${ct.replace(/_/g,' ')} ${count}</span>`;
  }).join('');
```

- [ ] **Step 5.2: Add the hidden-rows meta line**

In `writeDiffHtml`, locate the `<div class="meta">` line at line 308:
```javascript
<div class="meta">${total.toLocaleString()} change row(s) detected between snapshots</div>
```
Replace with:
```javascript
<div class="meta">${total.toLocaleString()} change row(s) detected between snapshots</div>
${(() => {
  const hmc = result.hiddenMissingCount || { units: 0, txs: 0 };
  const hidden = (hmc.units || 0) + (hmc.txs || 0);
  if (hidden === 0) return '';
  const parts = [];
  if (hmc.units) parts.push(`${hmc.units} unit${hmc.units === 1 ? '' : 's'}`);
  if (hmc.txs)   parts.push(`${hmc.txs} transaction${hmc.txs === 1 ? '' : 's'}`);
  return `<div class="meta">${hidden} missing row(s) hidden (${parts.join(' · ')}) — re-run with --show-missing to include</div>`;
})()}
```

- [ ] **Step 5.3: Add `--since` provenance suffix on the older snapshot card**

In `writeDiffHtml`, near the top of the function (after the parameters are unpacked at lines 204–211), add a `sinceSuffix` derivation. The function should accept a third argument plus an options bag — but to avoid breaking existing callers, infer from `result.sinceUsed` (set by `cmdDiff` in Task 6). Locate:
```javascript
  const oldDate = result.oldSnapshot.snapshot_date + ' (' + result.oldSnapshot.source_format + ')';
```
and just below add:
```javascript
  const sinceSuffix = result.sinceUsed ? ` <small style="color:#666">(--since ${escHtml(result.sinceUsed)})</small>` : '';
```

Then locate the `<div class="snap">PREVIOUS<br>...` line near line 310:
```javascript
  <div class="snap">PREVIOUS<br><b>${escHtml(oldDate)}</b><br><small>${escHtml(oldFile)}</small></div>
```
Replace with:
```javascript
  <div class="snap">PREVIOUS<br><b>${escHtml(oldDate)}</b>${sinceSuffix}<br><small>${escHtml(oldFile)}</small></div>
```

- [ ] **Step 5.4: Manual smoke test of the HTML output**

Run the diff against your existing DB to make sure the page renders without error:
```
node index.js diff
```
Open one of the resulting `output/<project>.diff.html` files in a browser. Verify:
- Chips at the top match the change types actually present (no MISSING_* chips unless `--show-missing`).
- Page layout, search, sort still work.

If any project has at least 2 snapshots and would have produced a `MISSING_*` row before this change, the meta line "N missing row(s) hidden..." should appear (only after Task 6 wires `--show-missing`; for now just confirm no JS errors and chips render).

- [ ] **Step 5.5: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 5.6: Commit**

```
git add src/diff.js
git commit -m "feat(diff-html): render only present change types; show hidden-rows meta"
```

---

## Task 6: CLI — `--since` and `--show-missing` flags in `cmdDiff`

Add flag parsing and pass options through to `diffProject`. Also handle the new error states (`no-baseline-before-date`, malformed `--since`).

**Files:**
- Modify: `index.js` — `cmdDiff` (lines 188–224) and `usage()` (lines 27–41) and `main()` (line 322)

- [ ] **Step 6.1: Update `usage()` text**

In `index.js`, locate:
```javascript
  console.log('  node index.js diff     [name]  month-over-month DLD snapshot diff');
```
Replace with:
```javascript
  console.log('  node index.js diff     [name] [--since YYYY-MM-DD] [--show-missing]  month-over-month DLD snapshot diff');
```

- [ ] **Step 6.2: Replace `cmdDiff` to parse flags and call engine with options**

Replace the entire `cmdDiff` function (lines 188–224) with:
```javascript
function parseDiffArgs(rest) {
  const opts = { name: null, since: null, showMissing: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--show-missing') { opts.showMissing = true; continue; }
    if (a === '--since') {
      opts.since = rest[++i];
      if (!opts.since) throw new Error('--since requires a YYYY-MM-DD argument');
      continue;
    }
    if (a.startsWith('--since=')) { opts.since = a.slice('--since='.length); continue; }
    if (a.startsWith('--')) throw new Error('unknown flag: ' + a);
    if (!opts.name) { opts.name = a; continue; }
    throw new Error('unexpected argument: ' + a);
  }
  return opts;
}

function cmdDiff(rest) {
  let opts;
  try {
    opts = parseDiffArgs(Array.isArray(rest) ? rest : []);
  } catch (e) {
    console.log('  ' + e.message);
    return;
  }

  const db = openDb();
  const projects = db.prepare(
    opts.name
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project`
  ).all(...(opts.name ? [opts.name] : []));
  if (projects.length === 0) { console.log('  no projects in DB'); db.close(); return; }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const totals = { new: 0, changed: 0, hidden: 0, projects: 0 };

  for (const p of projects) {
    console.log(`  -> ${p.project_name}`);
    let result;
    try {
      result = diffProject(db, p.project_id, { since: opts.since, includeMissing: opts.showMissing });
    } catch (e) {
      console.log(`     error: ${e.message}`);
      continue;
    }
    if (result.status !== 'ok') {
      const reasons = {
        'not-enough-snapshots': '(need >= 2 snapshots)',
        'no-baseline-before-date': `(no snapshot before ${opts.since})`
      };
      console.log(`     skipped: ${result.status} ${reasons[result.status] || ''}`.trimEnd());
      continue;
    }
    if (opts.since) result.sinceUsed = opts.since;

    const counts = summarizeDiff(result.rows);
    const oldLabel = result.oldSnapshot.snapshot_date + ' ' + result.oldSnapshot.source_format;
    const newLabel = result.newSnapshot.snapshot_date + ' ' + result.newSnapshot.source_format;
    const sinceTag = opts.since ? ` (--since ${opts.since})` : '';

    const newUnits   = counts.NEW_UNIT   || 0;
    const newTxs     = counts.NEW_TX     || 0;
    const newTotal   = newUnits + newTxs;
    const changedAmt = counts.AMOUNT_CHANGED   || 0;
    const changedAr  = counts.AREA_CHANGED     || 0;
    const changedTy  = counts.UNIT_TYPE_CHANGED|| 0;
    const changedTot = changedAmt + changedAr + changedTy;
    const missingU   = counts.MISSING_UNIT || 0;
    const missingT   = counts.MISSING_TX   || 0;
    const missingTot = missingU + missingT;
    const hiddenU    = (result.hiddenMissingCount && result.hiddenMissingCount.units) || 0;
    const hiddenT    = (result.hiddenMissingCount && result.hiddenMissingCount.txs)   || 0;
    const hiddenTot  = hiddenU + hiddenT;
    const totalRows  = result.rows.length;

    console.log(`     baseline  ${oldLabel}${sinceTag}   ->   latest  ${newLabel}`);
    if (totalRows === 0 && hiddenTot === 0) {
      console.log('     no changes');
    } else {
      console.log(`     new       :  ${newTotal}  (units ${newUnits}, tx ${newTxs})`);
      console.log(`     changed   :  ${changedTot}  (amount ${changedAmt}, area ${changedAr}, type ${changedTy})`);
      if (opts.showMissing && missingTot > 0) {
        console.log(`     missing   :  ${missingTot}  (units ${missingU}, tx ${missingT})`);
      } else if (!opts.showMissing && hiddenTot > 0) {
        const noun = hiddenTot === 1 ? 'row' : 'rows';
        console.log(`     hidden    :  ${hiddenTot} missing ${noun} (use --show-missing to include)`);
      }
    }

    const base = p.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
    const csvOut  = path.join(OUTPUT_DIR, base + '.diff.csv');
    const htmlOut = path.join(OUTPUT_DIR, base + '.diff.html');
    writeDiffCsv(csvOut, result);
    writeDiffHtml(htmlOut, result, counts);
    console.log(`     wrote     :  ${path.relative(process.cwd(), csvOut)}`);
    console.log(`     wrote     :  ${path.relative(process.cwd(), htmlOut)}`);
    console.log('');

    totals.projects += 1;
    totals.new     += newTotal;
    totals.changed += changedTot;
    totals.hidden  += hiddenTot;
  }

  if (totals.projects > 0) {
    const hiddenSeg = (!opts.showMissing && totals.hidden > 0) ? `   hidden ${totals.hidden}` : '';
    console.log(`  TOTAL across ${totals.projects} project${totals.projects === 1 ? '' : 's'}:  new ${totals.new}   changed ${totals.changed}${hiddenSeg}`);
  }

  db.close();
}
```

- [ ] **Step 6.3: Update the call site in `main()`**

In `main()` near line 322, the existing call is:
```javascript
  if (cmd === 'diff') {
    cmdDiff(rest[0] || null);
    return;
  }
```
Change to:
```javascript
  if (cmd === 'diff') {
    cmdDiff(rest);
    return;
  }
```

Also update the call site in `cmdAll()` (line 282) — `cmdDiff(null);` becomes `cmdDiff([]);`:
```javascript
  console.log('  [4/5] month-over-month diff');
  cmdDiff([]);
```

- [ ] **Step 6.4: Manual CLI verification**

Run each of these and verify the output matches the spec's terminal block format:
```
node index.js diff
node index.js diff --show-missing
node index.js diff --since 2026-01-01
node index.js diff --since 2026-01-01 --show-missing
node index.js diff --since not-a-date
node index.js diff --since 2099-01-01
node index.js diff --bogus
```
Expected:
- The default run shows the new grouped block; `hidden` line appears if any project has missing rows.
- `--show-missing` replaces `hidden` line with a `missing` line and surfaces `MISSING_*` chips in the HTML.
- `--since 2026-01-01` runs against any earlier snapshot and adds `(--since 2026-01-01)` to the baseline label and the HTML snapshot card.
- `--since not-a-date` produces `error: invalid --since date: "not-a-date" (expected YYYY-MM-DD)` on the offending project (and the loop continues with the next project).
- `--since 2099-01-01` produces `skipped: no-baseline-before-date (no snapshot before 2099-01-01)`.
- `--bogus` aborts with `unknown flag: --bogus`.

- [ ] **Step 6.5: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6.6: Commit**

```
git add index.js
git commit -m "feat(diff-cli): --since, --show-missing, restructured terminal block"
```

---

## Task 7: Final integration check

A last whole-system check before declaring done.

- [ ] **Step 7.1: Run the full pipeline end-to-end**

Run:
```
node index.js
```
Expected:
- Step `[1/4]` through `[5/5]` complete without error.
- Step `[4/5] month-over-month diff` shows the new per-project block format and the `TOTAL across N projects` footer.
- HTML files in `output/` open cleanly.

- [ ] **Step 7.2: Run the full test suite once more**

Run: `npm test`
Expected: all tests pass. The new `test/diff.test.js` should contribute eleven tests in total (1 from Task 1 + 3 from Task 2 + 5 from Task 3 + 2 from Task 4). The Task 4 tests require no new production code — they verify behavior already in place after Tasks 1–3.

- [ ] **Step 7.3: Confirm git log**

Run:
```
git log --oneline master..HEAD
```
Expected (top to bottom is most recent first):
```
feat(diff-cli): --since, --show-missing, restructured terminal block
feat(diff-html): render only present change types; show hidden-rows meta
test(diff): regression coverage for existing change types
feat(diff): pickBaseline helper with --since YYYY-MM-DD support
feat(diff): hide MISSING_* by default; expose hiddenMissingCount
feat(diff): rename REMOVED_* change types to MISSING_*
docs: spec for DLD diff polish (--since, --show-missing, terminal cleanup)
```
Seven commits ahead of `master`.

- [ ] **Step 7.4: Final commit (optional cleanup)**

If the manual verification in Step 6.4 surfaced any small fixes (typos, formatting), commit them now:
```
git add -p
git commit -m "polish: <what changed>"
```

Otherwise this step is a no-op.

---

## Out of Scope Reminders

These are intentionally NOT in this plan (per spec Section 7):

- No DB schema changes.
- No menu UI changes — `[4] Month-over-Month Diff` keeps its existing zero-flag behavior.
- No master-data, approval-queue, buyers, or change_log tables.
- No SF-side change tracking.
- No new HTML report types.
- No "removed-in-scope" detection.

If any of these come up during implementation, stop and revisit the spec — they belong in a separate brainstorm (see `docs/superpowers/notes/2026-05-04-future-master-data-approval.md`).
