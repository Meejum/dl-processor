# Multi-applicant name matching + SQM area cross-check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (a) multi-applicant DLD-buyer matching against all SF applicant slots with an `A10` flag and (b) a staff-driven SQM area cross-check that emits an `A11` soft flag and an `AREA_MISMATCH` hard status, configurable per project, fed by a new template-generate / apply CLI workflow.

**Architecture:** Two additive features layered onto `src/compare.js`. New durable table `manual_area` (parallel to `manual_override`) holds staff-entered areas keyed by `(project_id, unit_number_norm)`. New `src/area-template.js` module emits and applies CSV templates. No refactors to existing match logic; the v0.9.11 "upgrade A1–A7 → MATCH" path is preserved.

**Tech Stack:** Node ≥ 18, better-sqlite3, csv-parse, xlsx (existing). Tests use built-in `node:test` + `node:assert/strict` against `:memory:` SQLite.

**Spec:** `docs/superpowers/specs/2026-05-01-multi-applicant-and-area-matching-design.md`

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `db/schema.sql` | modify | Declare `manual_area` table + `project_mapping.area_threshold_pct` column for fresh DBs |
| `src/db.js` | modify | Self-heal `migrateSchema()` adds the new table + column on existing DBs |
| `src/compare.js` | modify | A10 multi-applicant walk, area signal, AREA_MISMATCH status, new row fields, audit-task case |
| `src/compare-html.js` | modify | AREA stat card, three area columns, A10/A11 in `FLAG_INFO`, status legend |
| `src/project-mapping.js` | modify | Resolve `areaThresholdPct` per project (DB → config-override → defaults → 5) |
| `src/audit-report.js` | modify | "Area coverage" section in the `[V]` reconciliation |
| `src/menu.js` | modify | New `[Y] Area template` submenu |
| `src/area-template.js` | **create** | Emit and apply per-project area templates (≈ 130 lines) |
| `index.js` | modify | Register `area-template` and `apply-areas` CLI subcommands |
| `config/project-mapping.json` | modify | Add `defaults.areaThresholdPct: 5`; document `areaThresholdPct` per-project |
| `test/schema-migration.test.js` | modify | Add cases for `manual_area` table + `area_threshold_pct` column |
| `test/compare-multi-applicant.test.js` | **create** | A10 matching against applicant_2/3/4 + applicant_details |
| `test/area-signal.test.js` | **create** | `computeAreaSignal` truth table (none/flag/hard) |
| `test/area-classification.test.js` | **create** | End-to-end: AREA_MISMATCH escalation; non-MATCH rows keep their status + A11 |
| `test/area-threshold-resolve.test.js` | **create** | Resolution order: DB → config-override → defaults → 5 |
| `test/area-template.test.js` | **create** | Generate emits expected columns; apply upserts and skips blanks |

---

## Task 1: Schema — `manual_area` table + `project_mapping.area_threshold_pct`

**Files:**
- Modify: `db/schema.sql`
- Modify: `src/db.js:8-66` (extend `migrateSchema`)
- Modify: `test/schema-migration.test.js` (add two cases)

- [ ] **Step 1.1: Write the failing migration tests**

Append to `test/schema-migration.test.js` after the existing `match_scope` test:

```js
test('migrateSchema adds manual_area table', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  // Pre-condition: table absent
  const before = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='manual_area'`).get();
  assert.equal(before, undefined);
  migrateSchema(db);
  const after = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='manual_area'`).get();
  assert.ok(after, 'expected manual_area table to be created');
  const cols = colNames(db, 'manual_area');
  for (const c of ['manual_area_id','project_id','unit_number_norm','area_sqm','source_note','entered_by','created_at','updated_at']) {
    assert.ok(cols.has(c), 'manual_area missing column ' + c);
  }
});

test('migrateSchema adds area_threshold_pct to project_mapping', () => {
  const db = new Database(':memory:');
  db.exec(OLD_SCHEMA);
  assert.equal(colNames(db, 'project_mapping').has('area_threshold_pct'), false);
  migrateSchema(db);
  assert.ok(colNames(db, 'project_mapping').has('area_threshold_pct'));
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```
npm test -- --test-name-pattern "manual_area|area_threshold_pct"
```
Expected: FAIL — `manual_area` table not created; `area_threshold_pct` column missing.

- [ ] **Step 1.3: Add migration logic to `src/db.js`**

In `migrateSchema()` after the existing `match_scope` block (after line 31), insert:

```js
  // 4. Create manual_area table if missing (durable across SF re-imports).
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  if (!tables.includes('manual_area')) {
    db.exec(`
      CREATE TABLE manual_area (
        manual_area_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id        INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
        unit_number_norm  TEXT NOT NULL,
        area_sqm          REAL NOT NULL,
        source_note       TEXT,
        entered_by        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, unit_number_norm)
      );
      CREATE INDEX idx_manual_area_proj_unit ON manual_area(project_id, unit_number_norm);
    `);
  }

  // 5. Add area_threshold_pct column to project_mapping if missing.
  const pmCols2 = new Set(db.prepare('PRAGMA table_info(project_mapping)').all().map(r => r.name));
  if (!pmCols2.has('area_threshold_pct')) {
    db.exec(`ALTER TABLE project_mapping ADD COLUMN area_threshold_pct REAL`);
  }
```

- [ ] **Step 1.4: Update `db/schema.sql` for fresh DBs**

After the `project_mapping` `CREATE TABLE` block, change the column list to include the new column and add the `manual_area` block. Replace the existing `project_mapping` block with:

```sql
CREATE TABLE IF NOT EXISTS project_mapping (
  project_id          INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
  sf_sub_project      TEXT,
  sf_unit_prefix      TEXT,
  sf_project          TEXT,
  match_scope         TEXT NOT NULL DEFAULT 'sub_project',
  source              TEXT NOT NULL DEFAULT 'auto',
  notes               TEXT,
  area_threshold_pct  REAL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

After the `project_mapping` block (and before the `manual_audit_*` blocks), insert:

```sql
CREATE TABLE IF NOT EXISTS manual_area (
  manual_area_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm  TEXT NOT NULL,
  area_sqm          REAL NOT NULL,
  source_note       TEXT,
  entered_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);
CREATE INDEX IF NOT EXISTS idx_manual_area_proj_unit ON manual_area(project_id, unit_number_norm);
```

- [ ] **Step 1.5: Run all tests**

```
npm test
```
Expected: PASS, including the two new migration tests; existing 11 test files still pass.

- [ ] **Step 1.6: Commit**

```
git add db/schema.sql src/db.js test/schema-migration.test.js
git commit -m "feat(schema): add manual_area table and project_mapping.area_threshold_pct"
```

---

## Task 2: Multi-applicant matching (A10)

**Files:**
- Modify: `src/compare.js:200-243` (`classifyMatch`)
- Modify: `src/compare.js` (export `findMatchingApplicant`, `SF_APPLICANT_FIELDS` for tests)
- Create: `test/compare-multi-applicant.test.js`

- [ ] **Step 2.1: Write failing tests for `findMatchingApplicant`**

Create `test/compare-multi-applicant.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { findMatchingApplicant, SF_APPLICANT_FIELDS } = require('../src/compare');

test('returns null when buyer is empty', () => {
  assert.equal(findMatchingApplicant(null, { applicant_name: 'JOHN DOE' }), null);
  assert.equal(findMatchingApplicant('', { applicant_name: 'JOHN DOE' }), null);
});

test('returns "applicant_name" when primary matches', () => {
  const sfRow = { applicant_name: 'JOHN DOE' };
  assert.equal(findMatchingApplicant('JOHN DOE', sfRow), 'applicant_name');
});

test('returns "applicant_2_name" when only applicant_2 matches', () => {
  const sfRow = { applicant_name: 'JOHN DOE', applicant_2_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_2_name');
});

test('returns "applicant_3_name" when only applicant_3 matches', () => {
  const sfRow = { applicant_name: 'A', applicant_2_name: 'B', applicant_3_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_3_name');
});

test('returns "applicant_4_name" when only applicant_4 matches', () => {
  const sfRow = { applicant_name: 'A', applicant_2_name: 'B', applicant_3_name: 'C', applicant_4_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_4_name');
});

test('returns "applicant_details" when only applicant_details matches', () => {
  const sfRow = { applicant_name: 'A', applicant_details: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_details');
});

test('primary takes precedence when multiple slots could match', () => {
  const sfRow = { applicant_name: 'JANE SMITH', applicant_2_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_name');
});

test('returns null when no slot matches', () => {
  const sfRow = { applicant_name: 'A B', applicant_2_name: 'C D' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), null);
});

test('SF_APPLICANT_FIELDS lists the five slots in priority order', () => {
  assert.deepEqual(SF_APPLICANT_FIELDS, [
    'applicant_name',
    'applicant_2_name',
    'applicant_3_name',
    'applicant_4_name',
    'applicant_details'
  ]);
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```
npm test -- --test-name-pattern "applicant"
```
Expected: FAIL — `findMatchingApplicant is not a function`.

- [ ] **Step 2.3: Implement `findMatchingApplicant` and update `classifyMatch`**

In `src/compare.js`, after the `namesOverlap` function (around line 173), add:

```js
const SF_APPLICANT_FIELDS = [
  'applicant_name',
  'applicant_2_name',
  'applicant_3_name',
  'applicant_4_name',
  'applicant_details'
];

function findMatchingApplicant(dldBuyer, sfRow) {
  if (!dldBuyer) return null;
  for (const f of SF_APPLICANT_FIELDS) {
    const v = sfRow ? sfRow[f] : null;
    if (!v) continue;
    if (namesOverlap(dldBuyer, v)) return f;
  }
  return null;
}
```

In `classifyMatch` (around line 220–222), replace:

```js
  let nameState;
  if (!dldBuyer || !haveSfName) nameState = 'unknown';
  else nameState = namesOverlap(dldBuyer, sfRow.applicant_name) ? 'match' : 'mismatch';
```

with:

```js
  let nameState, matchedApplicantField = null;
  if (!dldBuyer || !haveSfName) {
    nameState = 'unknown';
  } else {
    matchedApplicantField = findMatchingApplicant(dldBuyer, sfRow);
    nameState = matchedApplicantField ? 'match' : 'mismatch';
  }
```

In the same function, the existing return statements add `matchedApplicantField` to the result. Locate the three `return { status: ... }` lines (around lines 231, 238, 241–242) and add `matchedApplicantField` to each so callers can read it. For the BUYER_MISMATCH return:

```js
    return { status: 'BUYER_MISMATCH', reasons, priceDelta: delta, nameState, usedOverride, matchedApplicantField: null };
```

For the PRICE_*/MATCH returns add `matchedApplicantField`:

```js
    return { status, reasons, priceDelta: delta, nameState, usedOverride, matchedApplicantField };
```
```js
  if (usedOverride) return { status: 'MATCH', reasons: ['override'], priceDelta: delta, nameState, usedOverride, matchedApplicantField };
  return { status: 'MATCH', reasons: [], priceDelta: delta, nameState, usedOverride, matchedApplicantField };
```

In the DLD_ONLY early-return at the top of `classifyMatch` (line 201–207), add `matchedApplicantField: null`.

At the bottom of the file, extend the export:

```js
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap, findMatchingApplicant, SF_APPLICANT_FIELDS };
```

- [ ] **Step 2.4: Run multi-applicant tests; verify pass**

```
npm test -- --test-name-pattern "applicant"
```
Expected: 9 passing.

- [ ] **Step 2.5: Wire A10 flag emission and `match_reasons` annotation in `compareProject`**

In `compareProject`, after the `cls = classifyMatch(...)` line (around line 380), add A10 reason and prepare the row's flag list. Locate the section that builds row output and append:

```js
    // A10: matched via co-applicant (non-primary). cls.matchedApplicantField is null
    // when nameState !== 'match' (mismatch or unknown).
    let auditFlags = [];
    if (cls.matchedApplicantField && cls.matchedApplicantField !== 'applicant_name') {
      auditFlags.push('A10');
      cls.reasons = (cls.reasons || []).concat(['co-applicant:' + cls.matchedApplicantField]);
    }
```

Add `audit_flags: auditFlags.join('|')` and `matched_applicant_field: cls.matchedApplicantField || null` to the `rows.push({...})` object. Also add the same fields (with empty/null) to the `SF_ONLY` push later in the function.

- [ ] **Step 2.6: Run full suite to confirm no regression**

```
npm test
```
Expected: all green.

- [ ] **Step 2.7: Commit**

```
git add src/compare.js test/compare-multi-applicant.test.js
git commit -m "feat(compare): match DLD buyer against all SF applicant slots, emit A10"
```

---

## Task 3: Threshold resolution (`getAreaThreshold`)

**Files:**
- Modify: `src/project-mapping.js` (export `getAreaThreshold`)
- Create: `test/area-threshold-resolve.test.js`

- [ ] **Step 3.1: Write failing tests**

Create `test/area-threshold-resolve.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getAreaThreshold } = require('../src/project-mapping');

test('returns hard default 5 when nothing supplied', () => {
  assert.equal(getAreaThreshold({}, {}, 'Sobha One'), 5);
  assert.equal(getAreaThreshold(null, null, 'Sobha One'), 5);
});

test('uses config defaults.areaThresholdPct when no project override', () => {
  const config = { defaults: { areaThresholdPct: 7 } };
  assert.equal(getAreaThreshold({}, config, 'Sobha One'), 7);
});

test('config per-project override beats config defaults', () => {
  const config = {
    defaults: { areaThresholdPct: 5 },
    overrides: { 'Sobha Reserve': { areaThresholdPct: 8 } }
  };
  assert.equal(getAreaThreshold({}, config, 'Sobha Reserve'), 8);
  assert.equal(getAreaThreshold({}, config, 'Sobha One'), 5);
});

test('DB project_mapping.area_threshold_pct beats everything', () => {
  const mapping = { area_threshold_pct: 12 };
  const config = {
    defaults: { areaThresholdPct: 5 },
    overrides: { 'Sobha Reserve': { areaThresholdPct: 8 } }
  };
  assert.equal(getAreaThreshold(mapping, config, 'Sobha Reserve'), 12);
});

test('null/undefined DB value falls through', () => {
  const mapping = { area_threshold_pct: null };
  const config = { defaults: { areaThresholdPct: 6 } };
  assert.equal(getAreaThreshold(mapping, config, 'X'), 6);
});

test('zero is rejected as invalid; falls through', () => {
  const mapping = { area_threshold_pct: 0 };
  const config = { defaults: { areaThresholdPct: 6 } };
  assert.equal(getAreaThreshold(mapping, config, 'X'), 6);
});
```

- [ ] **Step 3.2: Run test; verify fail**

```
npm test -- --test-name-pattern "area threshold|areaThreshold"
```
Expected: FAIL — `getAreaThreshold is not a function`.

- [ ] **Step 3.3: Implement `getAreaThreshold` in `src/project-mapping.js`**

At the end of `src/project-mapping.js`, before `module.exports`, add:

```js
const HARD_DEFAULT_AREA_THRESHOLD_PCT = 5;

function getAreaThreshold(mappingRow, config, projectName) {
  const dbVal = mappingRow && mappingRow.area_threshold_pct;
  if (typeof dbVal === 'number' && dbVal > 0) return dbVal;
  const overrides = (config && config.overrides) || {};
  const projOverride = overrides[projectName];
  if (projOverride && typeof projOverride.areaThresholdPct === 'number' && projOverride.areaThresholdPct > 0) {
    return projOverride.areaThresholdPct;
  }
  const defaults = (config && config.defaults) || {};
  if (typeof defaults.areaThresholdPct === 'number' && defaults.areaThresholdPct > 0) {
    return defaults.areaThresholdPct;
  }
  return HARD_DEFAULT_AREA_THRESHOLD_PCT;
}
```

Update the `module.exports` of `src/project-mapping.js` to include `getAreaThreshold` and `HARD_DEFAULT_AREA_THRESHOLD_PCT`.

- [ ] **Step 3.4: Run test to confirm pass**

```
npm test -- --test-name-pattern "area threshold|areaThreshold"
```
Expected: PASS (6 tests).

- [ ] **Step 3.5: Commit**

```
git add src/project-mapping.js test/area-threshold-resolve.test.js
git commit -m "feat(mapping): resolve area_threshold_pct with DB > config-override > defaults > 5 precedence"
```

---

## Task 4: Area signal (`computeAreaSignal`)

**Files:**
- Modify: `src/compare.js` (add helper, export it)
- Create: `test/area-signal.test.js`

- [ ] **Step 4.1: Write failing tests**

Create `test/area-signal.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAreaSignal } = require('../src/compare');

test('returns kind="none" when either side is null', () => {
  assert.equal(computeAreaSignal(null, 100, 5).kind, 'none');
  assert.equal(computeAreaSignal(100, null, 5).kind, 'none');
});

test('returns kind="none" when either side is non-positive', () => {
  assert.equal(computeAreaSignal(0, 100, 5).kind, 'none');
  assert.equal(computeAreaSignal(100, -5, 5).kind, 'none');
});

test('returns kind="none" when |Δ%| < 0.5', () => {
  // 100.4 vs 100 = 0.4%, below noise floor
  const s = computeAreaSignal(100.4, 100, 5);
  assert.equal(s.kind, 'none');
});

test('returns kind="flag" when |Δ%| ≥ 0.5 and < threshold', () => {
  // 102 vs 100 = 2%, threshold 5
  const s = computeAreaSignal(102, 100, 5);
  assert.equal(s.kind, 'flag');
  assert.equal(Math.round(s.diff), 2);
  assert.ok(Math.abs(s.pct - 2) < 0.001);
});

test('returns kind="hard" when |Δ%| ≥ threshold', () => {
  // 110 vs 100 = 10%, threshold 5
  const s = computeAreaSignal(110, 100, 5);
  assert.equal(s.kind, 'hard');
  assert.equal(Math.round(s.diff), 10);
  assert.ok(Math.abs(s.pct - 10) < 0.001);
});

test('threshold boundary is inclusive of "hard"', () => {
  // exactly 5%
  const s = computeAreaSignal(105, 100, 5);
  assert.equal(s.kind, 'hard');
});

test('negative direction (DLD smaller than recorded) escalates by absolute value', () => {
  const s = computeAreaSignal(90, 100, 5);
  assert.equal(s.kind, 'hard');
  assert.equal(Math.round(s.diff), -10);
});

test('per-project threshold honoured', () => {
  // 7% gap, threshold 8 → flag (not hard)
  const s = computeAreaSignal(107, 100, 8);
  assert.equal(s.kind, 'flag');
});
```

- [ ] **Step 4.2: Run test to verify fail**

```
npm test -- --test-name-pattern "computeAreaSignal|area signal"
```
Expected: FAIL — not exported.

- [ ] **Step 4.3: Implement `computeAreaSignal`**

In `src/compare.js`, after `computePriceDelta` (around line 184), add:

```js
function computeAreaSignal(dldArea, manualArea, thresholdPct) {
  if (dldArea == null || manualArea == null) return { kind: 'none', diff: null, pct: null };
  if (!(dldArea > 0) || !(manualArea > 0))   return { kind: 'none', diff: null, pct: null };
  const diff = dldArea - manualArea;
  const pct  = (diff / manualArea) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.5)          return { kind: 'none', diff, pct };
  if (absPct < thresholdPct) return { kind: 'flag', diff, pct };
  return { kind: 'hard', diff, pct };
}
```

Add `computeAreaSignal` to the `module.exports` list.

- [ ] **Step 4.4: Run tests to verify pass**

```
npm test -- --test-name-pattern "computeAreaSignal|area signal"
```
Expected: PASS (8 tests).

- [ ] **Step 4.5: Commit**

```
git add src/compare.js test/area-signal.test.js
git commit -m "feat(compare): add computeAreaSignal helper (none/flag/hard)"
```

---

## Task 5: Wire area signal into `compareProject` + AREA_MISMATCH status

**Files:**
- Modify: `src/compare.js` (`compareProject`, `STATUS_PRIORITY`, `STATUS_ORDER`, `summarize`, `writeAuditTasks`)
- Create: `test/area-classification.test.js`

- [ ] **Step 5.1: Write end-to-end failing tests**

Create `test/area-classification.test.js`. This test exercises `compareProject` against a `:memory:` DB with a small fixture:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { compareProject } = require('../src/compare');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildFixture() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);

  // One project
  const projInfo = db.prepare(`INSERT INTO dld_project (project_name) VALUES (?)`).run('Test Project');
  const projectId = projInfo.lastInsertRowid;
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, source) VALUES (?, ?, ?, ?)`)
    .run(projectId, 'Test Sub', 'T', 'manual');

  // DLD snapshot, 4 units with varying net_area
  const snapInfo = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, total_units, total_tx) VALUES (?, 'csv', 'fixture.csv', 4, 4)`).run(projectId);
  const snapshotId = snapInfo.lastInsertRowid;
  const insUnit = db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, dld_unit_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insTx = db.prepare(`INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date_iso, amount_aed) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  function addUnit(num, netArea, buyer, price) {
    const u = insUnit.run(snapshotId, projectId, 'D' + num, num, num, 'Apartment', netArea);
    insTx.run(u.lastInsertRowid, snapshotId, projectId, buyer, 'Sale', '2026-01-15', price);
  }
  addUnit('101', 100.0, 'JOHN DOE', 1000000);   // area exact match
  addUnit('102', 102.0, 'JANE DOE', 2000000);   // 2% drift → flag
  addUnit('103', 110.0, 'BOB ROE', 3000000);    // 10% drift, name match → AREA_MISMATCH
  addUnit('104', 110.0, 'WRONG NAME', 4000000); // 10% drift + buyer mismatch → BUYER_MISMATCH + A11

  // SF snapshot
  const sfSnap = db.prepare(`INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 4)`).run();
  const sfId = sfSnap.lastInsertRowid;
  const insSf = db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, ?, ?, ?, ?, ?)`);
  insSf.run(sfId, 'Test Sub', 'T-101', 'T-101', 'JOHN DOE', 1000000);
  insSf.run(sfId, 'Test Sub', 'T-102', 'T-102', 'JANE DOE', 2000000);
  insSf.run(sfId, 'Test Sub', 'T-103', 'T-103', 'BOB ROE', 3000000);
  insSf.run(sfId, 'Test Sub', 'T-104', 'T-104', 'CORRECT NAME', 4000000);

  // manual_area for all four units
  const insArea = db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`);
  insArea.run(projectId, '101', 100.0);
  insArea.run(projectId, '102', 100.0);
  insArea.run(projectId, '103', 100.0);
  insArea.run(projectId, '104', 100.0);

  return { db, projectId };
}

test('unit with exact area + name match → MATCH, no A11', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH');
  assert.ok(!(row.audit_flags || '').includes('A11'));
});

test('unit with 2% area drift → MATCH + A11 flag', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '102');
  assert.equal(row.match_status, 'MATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
});

test('unit with 10% area drift but exact name + price → AREA_MISMATCH', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '103');
  assert.equal(row.match_status, 'AREA_MISMATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
  assert.ok(Math.abs(row.area_diff_pct - 10) < 0.001);
  assert.equal(Math.round(row.area_diff_sqm), 10);
});

test('unit with buyer mismatch + 10% area drift → BUYER_MISMATCH (not escalated to AREA_MISMATCH), A11 still flagged', () => {
  const { db, projectId } = buildFixture();
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '104');
  assert.equal(row.match_status, 'BUYER_MISMATCH');
  assert.ok((row.audit_flags || '').includes('A11'));
});

test('manual_area absent → area signal silent (kind=none)', () => {
  const { db, projectId } = buildFixture();
  db.prepare(`DELETE FROM manual_area WHERE unit_number_norm = ?`).run('103');
  const result = compareProject(db, projectId, {});
  const row = result.rows.find(r => r.dld_unit_number === '103');
  assert.equal(row.match_status, 'MATCH');
  assert.equal(row.area_diff_pct, null);
});

test('summarize includes AREA_MISMATCH', () => {
  const { db, projectId } = buildFixture();
  const { summarize } = require('../src/compare');
  const result = compareProject(db, projectId, {});
  const counts = summarize(result.rows);
  assert.ok('AREA_MISMATCH' in counts);
  assert.equal(counts.AREA_MISMATCH, 1);
});
```

- [ ] **Step 5.2: Run tests; verify fail**

```
npm test -- --test-name-pattern "area drift|area signal silent|AREA_MISMATCH"
```
Expected: FAIL — area fields absent on rows; status never AREA_MISMATCH.

- [ ] **Step 5.3: Wire `manualAreaMap` and threshold into `compareProject`**

In `src/compare.js`, near the top of `compareProject` (after `dldUnits` is loaded, around line 278), add:

```js
  const { getAreaThreshold } = require('./project-mapping');
  const areaThresholdPct = getAreaThreshold(mappingRow, cachedConfig, project.project_name);
  const manualAreaRows = db.prepare(`SELECT unit_number_norm, area_sqm FROM manual_area WHERE project_id = ?`).all(projectId);
  const manualAreaMap = new Map();
  for (const r of manualAreaRows) manualAreaMap.set(r.unit_number_norm, r.area_sqm);
```

In the per-unit loop, after `cls = classifyMatch(...)` and the existing `auditFlags` from Task 2 (Step 2.5), insert:

```js
    const manualAreaSqm = manualAreaMap.get(u.unit_number_norm) ?? null;
    const areaSig = computeAreaSignal(u.net_area, manualAreaSqm, areaThresholdPct);
    let finalStatus = cls.status;
    if (areaSig.kind === 'flag') {
      auditFlags.push('A11');
      const sign = areaSig.pct >= 0 ? '+' : '';
      cls.reasons = (cls.reasons || []).concat(['area Δ ' + sign + areaSig.pct.toFixed(1) + '% (' + sign + Math.round(areaSig.diff) + ' sqm)']);
    } else if (areaSig.kind === 'hard') {
      auditFlags.push('A11');
      const sign = areaSig.pct >= 0 ? '+' : '';
      cls.reasons = (cls.reasons || []).concat(['area Δ ' + sign + areaSig.pct.toFixed(1) + '% (' + sign + Math.round(areaSig.diff) + ' sqm)']);
      if (cls.status === 'MATCH') finalStatus = 'AREA_MISMATCH';
    }
```

Add to the `rows.push({...})` object:

```js
      manual_area_sqm:  manualAreaSqm,
      area_diff_sqm:    areaSig.diff != null ? Math.round(areaSig.diff * 100) / 100 : null,
      area_diff_pct:    areaSig.pct  != null ? +areaSig.pct.toFixed(2)            : null,
      audit_flags:      auditFlags.join('|'),
      match_status:     finalStatus,
```

(Replacing the existing `match_status: cls.status` with `match_status: finalStatus`.)

For the SF_ONLY rows (later in the function), set `manual_area_sqm: null, area_diff_sqm: null, area_diff_pct: null, audit_flags: ''`.

- [ ] **Step 5.4: Update `STATUS_PRIORITY`, `STATUS_ORDER`, `summarize`**

In `src/compare.js`:

```js
  const STATUS_PRIORITY = {
    BUYER_MISMATCH: 0,
    AREA_MISMATCH:  1,
    DLD_ONLY:       2,
    SF_ONLY:        3,
    PRICE_DOWN:     4,
    PRICE_UP:       5,
    MATCH:          6
  };
```

```js
const STATUS_ORDER = ['MATCH', 'PRICE_UP', 'PRICE_DOWN', 'BUYER_MISMATCH', 'AREA_MISMATCH', 'DLD_ONLY', 'SF_ONLY'];
```

The `summarize` function already iterates `STATUS_ORDER`, so it now zero-initialises `AREA_MISMATCH`.

- [ ] **Step 5.5: Add audit-task case for AREA_MISMATCH**

In `writeAuditTasks` (around line 740), add a case:

```js
      case 'AREA_MISMATCH':
        priority = 'medium';
        action = `Verify area for ${r.expected_sf_unit}: DLD ${r.dld_net_area} sqm vs recorded ${r.manual_area_sqm} sqm (${r.area_diff_pct >= 0 ? '+' : ''}${(r.area_diff_pct ?? 0).toFixed(1)}%). Confirm the unit number is correct.`;
        break;
```

- [ ] **Step 5.6: Run all tests**

```
npm test
```
Expected: green, including the 6 new area-classification tests.

- [ ] **Step 5.7: Commit**

```
git add src/compare.js test/area-classification.test.js
git commit -m "feat(compare): wire area signal into compareProject; add AREA_MISMATCH status"
```

---

## Task 6: HTML output — AREA stat card, area columns, A10/A11 in FLAG_INFO

**Files:**
- Modify: `src/compare-html.js` (if it exists separately) OR `src/compare.js` `writeCompareHtml` (current location)

> **Note:** The codebase per the README references `src/compare-html.js` but the current `compare.js` has `writeCompareHtml` inline. If `src/compare-html.js` does not exist as a separate file, all changes in this task land in `src/compare.js` `writeCompareHtml`.

- [ ] **Step 6.1: Add the AREA stat card**

In `writeCompareHtml`, add to the `statusClass` map: `AREA_MISMATCH: 'area'`.
Add to `statusLabel`: `AREA_MISMATCH: 'AREA'`.

In the chips block of the generated HTML (the `<div class="controls">` section), insert a new chip between the BUYER and DLD-only chips:

```js
  <span class="chip area" data-status="AREA_MISMATCH">AREA ${counts.AREA_MISMATCH || 0} (${pct(counts.AREA_MISMATCH || 0)})</span>
```

In the `SOBHA_STYLE_CSS` (in `src/html-styles.js`), add a CSS class for the new color:

```css
.chip.area, .badge.area, tr.area td:first-child { background: #f59e0b; color: #fff; }
.chip.area.off { background: rgba(245,158,11,0.25); color: #6b3a04; }
```

(Locate the existing `.chip.warn` definitions and insert `.chip.area` near them with appropriate orange — `#f59e0b` matches Tailwind amber-500 and is visually distinct from BUYER's red.)

- [ ] **Step 6.2: Add the three area columns**

In the `columns` array of `writeCompareHtml` (around line 531), insert after `dld_net_area`:

```js
    { key: 'manual_area_sqm',     label: 'Manual SQM',       align: 'num'  },
    { key: 'area_diff_pct',       label: 'Area Δ %',         align: 'num'  },
    { key: 'area_diff_sqm',       label: 'Area Δ sqm',       align: 'num'  },
```

In `renderCell`, add render branches:

```js
    } else if (col.key === 'manual_area_sqm') {
      sortVal = raw == null ? '-1' : String(raw);
      if (raw == null) { html = ''; }
      else { const n = +raw; html = isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : ''; }
    } else if (col.key === 'area_diff_pct') {
      sortVal = raw == null ? '-99999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.5) { html = ''; cls.push('flat'); }
      else { html = (raw > 0 ? '+' : '') + raw.toFixed(1) + '%'; cls.push(raw > 0 ? 'up' : 'down'); }
    } else if (col.key === 'area_diff_sqm') {
      sortVal = raw == null ? '-99999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.01) { html = ''; }
      else { html = (raw > 0 ? '+' : '') + raw.toFixed(2).replace(/\.?0+$/, ''); cls.push(raw > 0 ? 'up' : 'down'); }
    }
```

(All three default to visible. If the codebase has a column-picker localStorage key like `compareHtmlCols`, set the new columns to default-hidden by appending to the hidden list. If not, leave them visible — registrars can use the existing column picker.)

- [ ] **Step 6.3: Add A10 / A11 to FLAG_INFO**

If `FLAG_INFO` exists in the file, add:

```js
A10: {
  title: 'Matched via co-applicant',
  body:  'DLD buyer matches a co-owner / additional applicant on the SF booking, not the primary applicant. No action needed — recorded for audit.',
  action: 'No action.'
},
A11: {
  title: 'Area mismatch flagged',
  body:  'DLD net area differs from the staff-recorded area. Fires either (a) when the gap is below the project threshold (default 5%) — usually common-area or saleable-vs-net rounding, or (b) when the gap is above threshold but the row already has a higher-precedence issue (BUYER_MISMATCH, PRICE_*, DLD_ONLY, SF_ONLY) so the area is recorded as a secondary signal rather than escalating the status.',
  action: 'For (a) spot-check a few; raise with engineering only if the pattern is systematic. For (b) fix the primary issue first; the area gap may resolve itself once the right SF row is matched.'
}
```

If `FLAG_INFO` does not yet exist (older code path), this work lands in the broader compare-html refactor. Skip the popovers — A10 and A11 still appear as plain chips. Track in followups.

- [ ] **Step 6.4: Smoke-test the HTML render**

```
node index.js compare "Test Project" 2>/dev/null || true
ls output/*.compare.html
```
Open the generated HTML in a browser. Verify the AREA chip is present and clickable, the three new columns render, and A10/A11 chips appear where expected.

- [ ] **Step 6.5: Commit**

```
git add src/compare.js src/html-styles.js src/compare-html.js
git commit -m "feat(html): AREA stat card, manual-area columns, A10/A11 flag info"
```

---

## Task 7: Audit-report (`[V]`) — Area coverage section

**Files:**
- Modify: `src/audit-report.js`

- [ ] **Step 7.1: Add area-coverage block**

In the function that generates the `[V]` reconciliation report (likely `runAudit` or similar in `src/audit-report.js`), add a new section. Locate the place where it iterates per project and prints per-project completeness counts; alongside, query `manual_area`:

```js
  const areaCoverageRows = db.prepare(`
    SELECT p.project_name,
           COUNT(DISTINCT u.unit_number_norm) AS dld_units,
           (SELECT COUNT(*) FROM manual_area ma WHERE ma.project_id = p.project_id) AS area_rows
    FROM dld_project p
    LEFT JOIN v_dld_unit_latest u ON u.project_id = p.project_id
    GROUP BY p.project_id, p.project_name
    ORDER BY p.project_name
  `).all();

  console.log('');
  console.log('Area cross-check coverage:');
  let totalDld = 0, totalArea = 0;
  for (const r of areaCoverageRows) {
    totalDld  += r.dld_units;
    totalArea += r.area_rows;
    const pct = r.dld_units > 0 ? Math.round((r.area_rows / r.dld_units) * 100) : 0;
    console.log(`  ${r.project_name.padEnd(40)} : ${String(r.area_rows).padStart(5)}/${String(r.dld_units).padEnd(5)} units (${pct}%)`);
  }
  const totalPct = totalDld > 0 ? Math.round((totalArea / totalDld) * 100) : 0;
  console.log(`  ${'TOTAL'.padEnd(40)} : ${String(totalArea).padStart(5)}/${String(totalDld).padEnd(5)} units (${totalPct}%)`);
```

- [ ] **Step 7.2: Smoke-test**

```
node index.js audit
```
Expected output: a new "Area cross-check coverage" block listing every DLD project with its `manual_area` row count.

- [ ] **Step 7.3: Commit**

```
git add src/audit-report.js
git commit -m "feat(audit): add area-coverage section to [V] reconciliation"
```

---

## Task 8: `src/area-template.js` — Generate template

**Files:**
- Create: `src/area-template.js`
- Create: `test/area-template.test.js`

- [ ] **Step 8.1: Write failing tests for `generateAreaTemplate`**

Create `test/area-template.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');
const { generateAreaTemplate, applyAreaTemplate } = require('../src/area-template');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function fixtureDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  const p = db.prepare(`INSERT INTO dld_project (project_name) VALUES ('P1')`).run();
  const projectId = p.lastInsertRowid;
  const s = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, total_units, total_tx) VALUES (?, 'csv', 'x.csv', 2, 0)`).run(projectId);
  const sid = s.lastInsertRowid;
  db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sid, projectId, '101', '101', 'Apartment', 100.5);
  db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, unit_type, net_area) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sid, projectId, '102', '102', 'Apartment', 200.0);
  return { db, projectId };
}

test('generateAreaTemplate emits one row per DLD unit with expected columns', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'area-tpl-' + Date.now() + '.csv');
  const result = generateAreaTemplate({ db, projectFilter: 'P1', outPath: tmp });
  assert.equal(result.rowCount, 2);
  const csv = fs.readFileSync(tmp, 'utf8');
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length, 3); // header + 2 units
  assert.ok(lines[0].includes('unit_number'));
  assert.ok(lines[0].includes('area_sqm'));
  assert.ok(lines[0].includes('dld_net_area'));
  fs.unlinkSync(tmp);
});

test('generateAreaTemplate pre-populates area_sqm from existing manual_area', () => {
  const { db, projectId } = fixtureDb();
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`).run(projectId, '101', 99.5);
  const tmp = path.join(os.tmpdir(), 'area-tpl-' + Date.now() + '.csv');
  generateAreaTemplate({ db, projectFilter: 'P1', outPath: tmp });
  const csv = fs.readFileSync(tmp, 'utf8');
  // Row for 101 should contain "99.5"
  assert.ok(csv.includes('99.5'), 'expected pre-populated area_sqm');
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate upserts rows and skips blanks', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  const csv = [
    'project,unit_number,dld_unit_id,dld_buyer,dld_unit_type,sf_unit,sf_applicant,dld_net_area,area_sqm,source_note',
    'P1,101,,,,,,,98.5,from drawings',
    'P1,102,,,,,,,,'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(tmp, csv, 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);
  const row = db.prepare(`SELECT area_sqm, source_note FROM manual_area WHERE project_id = ? AND unit_number_norm = ?`).get(projectId, '101');
  assert.equal(row.area_sqm, 98.5);
  assert.equal(row.source_note, 'from drawings');
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate updates an existing row on re-apply', () => {
  const { db, projectId } = fixtureDb();
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm) VALUES (?, ?, ?)`).run(projectId, '101', 50);
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nP1,101,77\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 1);
  const row = db.prepare(`SELECT area_sqm FROM manual_area WHERE project_id = ? AND unit_number_norm = ?`).get(projectId, '101');
  assert.equal(row.area_sqm, 77);
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate skips non-numeric area_sqm', () => {
  const { db, projectId } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nP1,101,abc\r\nP1,102,-5\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 2);
  fs.unlinkSync(tmp);
});

test('applyAreaTemplate skips rows whose project name is unknown', () => {
  const { db } = fixtureDb();
  const tmp = path.join(os.tmpdir(), 'apply-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'project,unit_number,area_sqm\r\nUnknownProj,999,100\r\n', 'utf8');
  const result = applyAreaTemplate({ db, csvPath: tmp });
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.ok(result.warnings.length >= 1);
  fs.unlinkSync(tmp);
});
```

- [ ] **Step 8.2: Run tests; verify fail**

```
npm test -- --test-name-pattern "generateAreaTemplate|applyAreaTemplate"
```
Expected: FAIL — module does not exist.

- [ ] **Step 8.3: Implement `src/area-template.js`**

Create `src/area-template.js`:

```js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const TEMPLATE_HEADER = [
  'project',
  'unit_number',
  'dld_unit_id',
  'dld_buyer',
  'dld_unit_type',
  'sf_unit',
  'sf_applicant',
  'dld_net_area',
  'area_sqm',
  'source_note'
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function generateAreaTemplate({ db, projectFilter, outPath }) {
  const projects = db.prepare(
    projectFilter
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project ORDER BY project_name`
  ).all(...(projectFilter ? [projectFilter] : []));
  if (projects.length === 0) return { rowCount: 0, projects: 0 };

  const lines = [TEMPLATE_HEADER.join(',')];
  let rowCount = 0;

  for (const p of projects) {
    const snap = db.prepare(`SELECT * FROM dld_snapshot WHERE project_id = ? ORDER BY imported_at DESC LIMIT 1`).get(p.project_id);
    if (!snap) continue;
    const units = db.prepare(`SELECT * FROM dld_unit WHERE snapshot_id = ? ORDER BY CAST(unit_number AS INTEGER), unit_number`).all(snap.snapshot_id);
    const areaMap = new Map(
      db.prepare(`SELECT unit_number_norm, area_sqm, source_note FROM manual_area WHERE project_id = ?`)
        .all(p.project_id)
        .map(r => [r.unit_number_norm, r])
    );
    const sfBookings = db.prepare(`
      SELECT b.unit_norm, b.unit, b.applicant_name
      FROM sf_booking b
      JOIN sf_snapshot s ON s.sf_snapshot_id = b.sf_snapshot_id
      WHERE s.imported_at = (SELECT MAX(imported_at) FROM sf_snapshot)
        AND b.sub_project = ?
    `).all(p.sf_sub_project || '');
    const sfByUnitNorm = new Map(sfBookings.map(b => [b.unit_norm, b]));

    for (const u of units) {
      const tx = db.prepare(`SELECT party_name FROM dld_transaction WHERE unit_id = ? ORDER BY tx_id DESC LIMIT 1`).get(u.unit_id);
      const dldBuyer = tx ? (tx.party_name || '') : '';
      const expectedSfUnit = (p.sf_unit_prefix || '') + (p.sf_unit_prefix ? '-' : '') + u.unit_number_norm;
      const sfRow = sfByUnitNorm.get(expectedSfUnit) || null;
      const ma = areaMap.get(u.unit_number_norm) || {};
      const row = [
        p.project_name,
        u.unit_number || '',
        u.dld_unit_id || '',
        dldBuyer,
        u.unit_type || '',
        sfRow ? sfRow.unit : '',
        sfRow ? (sfRow.applicant_name || '') : '',
        u.net_area != null ? u.net_area : '',
        ma.area_sqm != null ? ma.area_sqm : '',
        ma.source_note || ''
      ];
      lines.push(row.map(csvEscape).join(','));
      rowCount++;
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
  return { rowCount, projects: projects.length, outPath };
}

function applyAreaTemplate({ db, csvPath }) {
  const buf = fs.readFileSync(csvPath, 'utf8');
  const records = parse(buf, { columns: true, skip_empty_lines: true, trim: true });
  const projCache = new Map();
  function getProject(name) {
    if (projCache.has(name)) return projCache.get(name);
    const row = db.prepare(`SELECT project_id FROM dld_project WHERE project_name = ?`).get(name);
    projCache.set(name, row || null);
    return row || null;
  }
  const upsert = db.prepare(`
    INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, source_note, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, unit_number_norm) DO UPDATE SET
      area_sqm    = excluded.area_sqm,
      source_note = excluded.source_note,
      updated_at  = datetime('now')
  `);
  let applied = 0, skipped = 0;
  const warnings = [];
  const tx = db.transaction(() => {
    for (const r of records) {
      const projName = (r.project || '').trim();
      const unit = (r.unit_number || '').trim();
      const areaRaw = (r.area_sqm == null ? '' : String(r.area_sqm)).trim();
      if (!projName || !unit || !areaRaw) { skipped++; continue; }
      const proj = getProject(projName);
      if (!proj) { skipped++; warnings.push('unknown project: ' + projName); continue; }
      const area = Number(areaRaw);
      if (!Number.isFinite(area) || area <= 0) { skipped++; continue; }
      const note = (r.source_note || '').trim() || null;
      upsert.run(proj.project_id, unit.toUpperCase(), area, note);
      applied++;
    }
  });
  tx();
  return { applied, skipped, warnings };
}

module.exports = { generateAreaTemplate, applyAreaTemplate, TEMPLATE_HEADER };
```

- [ ] **Step 8.4: Run tests; verify pass**

```
npm test -- --test-name-pattern "generateAreaTemplate|applyAreaTemplate"
```
Expected: 6 tests pass.

- [ ] **Step 8.5: Commit**

```
git add src/area-template.js test/area-template.test.js
git commit -m "feat(area-template): generate and apply staff-edited area CSVs"
```

---

## Task 9: CLI subcommands + audit-log entry

**Files:**
- Modify: `index.js` (register `area-template` and `apply-areas`)
- Modify: `src/audit-log.js` (if it exists) — log `apply-areas` runs

- [ ] **Step 9.1: Wire `area-template` and `apply-areas` in `index.js`**

In `index.js` `main()` function, after the `audit-delta` block, insert:

```js
  if (cmd === 'area-template') {
    const projectFilter = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
    const { generateAreaTemplate } = require('./src/area-template');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      const safe = (projectFilter || 'all').replace(/[^A-Za-z0-9_-]+/g, '_');
      const outPath = path.join(OUTPUT_DIR, 'area-template-' + safe + '.csv');
      const res = generateAreaTemplate({ db, projectFilter, outPath });
      console.log('  -> wrote ' + path.relative(process.cwd(), outPath));
      console.log('     ' + res.rowCount + ' rows across ' + res.projects + ' project(s)');
    } finally { db.close(); }
    return;
  }

  if (cmd === 'apply-areas') {
    const csvPath = process.argv[3];
    if (!csvPath) { console.error('usage: apply-areas <csv-file>'); process.exit(1); }
    const { applyAreaTemplate } = require('./src/area-template');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      const res = applyAreaTemplate({ db, csvPath });
      console.log('  -> applied ' + res.applied + ' rows; skipped ' + res.skipped);
      for (const w of res.warnings.slice(0, 20)) console.log('     warn: ' + w);
      // Log to audit trail if available
      try {
        const { writeAuditLog } = require('./src/audit-log');
        writeAuditLog({ command: 'apply-areas', source: csvPath, applied: res.applied, skipped: res.skipped });
      } catch (_) { /* audit log optional */ }
    } finally { db.close(); }
    return;
  }
```

Update `usage()` (around line 27) to add:

```js
  console.log('  node index.js area-template [project|all]   emit per-unit area CSV for staff to fill');
  console.log('  node index.js apply-areas   <csv>            apply filled-in area CSV to manual_area');
```

- [ ] **Step 9.2: Smoke-test the CLI**

```
node index.js area-template all
ls output/area-template-all.csv
```

Expected: file exists, has DLD project header + rows.

```
node index.js apply-areas output/area-template-all.csv
```

Expected: prints `applied N rows; skipped M` (likely all skipped since `area_sqm` column is blank — that's correct).

- [ ] **Step 9.3: Commit**

```
git add index.js
git commit -m "feat(cli): add area-template and apply-areas subcommands"
```

---

## Task 10: Menu wiring — `[Y] Area template`

**Files:**
- Modify: `src/menu.js`

- [ ] **Step 10.1: Add menu entry**

Locate the function in `src/menu.js` that prints the menu (look for the `[V]`, `[Q]` entries). Add a new entry `[Y] Area template`. The handler should prompt for sub-action and project, then either:

- Generate: spawn `node index.js area-template <projectOrAll>` (or call `generateAreaTemplate` directly, mirroring how other entries call into `src/*` directly).
- Apply: prompt for the CSV path (use `src/file-picker.js` patterns), then call `applyAreaTemplate`.

Concrete example (adapt to the actual menu shape — the file uses pure readline; mirror the existing entry handlers):

```js
// in printMenu — add the line:
console.log('  [Y]  Area template          generate / apply staff-filled SQM CSVs');

// in the dispatch switch / if-chain — add:
if (key === 'Y' || key === 'y') {
  await areaTemplateSubmenu();
  continue;
}

// new function:
async function areaTemplateSubmenu() {
  console.log('');
  console.log('  Area template');
  console.log('   [1] Generate template');
  console.log('   [2] Apply filled template');
  console.log('   [B] Back');
  const choice = await readLine('  > ');
  if (choice === '1') {
    const proj = (await readLine('  Project name (blank = all): ')).trim() || null;
    const { generateAreaTemplate } = require('./area-template');
    const { openDb } = require('./db');
    const db = openDb();
    try {
      const safe = (proj || 'all').replace(/[^A-Za-z0-9_-]+/g, '_');
      const outPath = path.join(__dirname, '..', 'output', 'area-template-' + safe + '.csv');
      const res = generateAreaTemplate({ db, projectFilter: proj, outPath });
      console.log('  -> wrote ' + path.relative(process.cwd(), outPath) + ' (' + res.rowCount + ' rows)');
    } finally { db.close(); }
  } else if (choice === '2') {
    const csvPath = await pickFile(path.join(__dirname, '..', 'output'), ['.csv']);
    if (!csvPath) return;
    const { applyAreaTemplate } = require('./area-template');
    const { openDb } = require('./db');
    const db = openDb();
    try {
      const res = applyAreaTemplate({ db, csvPath });
      console.log('  -> applied ' + res.applied + '  skipped ' + res.skipped);
    } finally { db.close(); }
  }
}
```

Replace `pickFile` with the actual function exported by `src/file-picker.js` (read that file to find the exact name — likely `pickFile`, `chooseFile`, or `promptForFile`).

- [ ] **Step 10.2: Manual smoke-test**

```
node src/menu.js
```
Press `Y` → choose `1` → enter `all` → confirm CSV is written.

- [ ] **Step 10.3: Commit**

```
git add src/menu.js
git commit -m "feat(menu): add [Y] Area template submenu"
```

---

## Task 11: Config defaults

**Files:**
- Modify: `config/project-mapping.json`

- [ ] **Step 11.1: Add `defaults` block**

Read the current file. If it has a top-level shape like:

```json
{
  "overrides": { ... }
}
```

— update to:

```json
{
  "defaults": {
    "areaThresholdPct": 5
  },
  "overrides": { ... }
}
```

If the file is currently a bare overrides object (no top-level wrapper), wrap the existing object under an `overrides` key and add a sibling `defaults` key. Verify `src/project-mapping.js` still reads the config correctly — it should already, since `getAreaThreshold` reads `config.defaults` and `config.overrides`.

- [ ] **Step 11.2: Run full test suite + smoke-test compare**

```
npm test
node index.js compare 2>&1 | head -20
```

Expected: tests pass, compare produces output without errors.

- [ ] **Step 11.3: Commit**

```
git add config/project-mapping.json
git commit -m "feat(config): add defaults.areaThresholdPct=5 to project-mapping.json"
```

---

## Self-review checklist

Run mentally before declaring the plan complete:

1. **Spec coverage:**
   - Section 1 schema → Task 1 ✓
   - Section 2 template/apply → Tasks 8, 9, 10 ✓
   - Section 3 A10 multi-applicant → Task 2 ✓
   - Section 4 area signal + AREA_MISMATCH → Tasks 4, 5 ✓
   - Section 5 threshold resolution → Task 3, Task 11 ✓
   - Section 6 HTML changes → Task 6 ✓
   - Section 7 audit-tasks + verify report → Task 5 (writeAuditTasks) + Task 7 (audit coverage) ✓

2. **Type / signature consistency:**
   - `findMatchingApplicant(buyer, sfRow)` returns `string | null` — consistent across Task 2.
   - `computeAreaSignal(dldArea, manualArea, thresholdPct)` returns `{ kind, diff, pct }` — consistent across Tasks 4, 5.
   - `getAreaThreshold(mappingRow, config, projectName)` returns a positive number — consistent across Tasks 3, 5.
   - `generateAreaTemplate({db, projectFilter, outPath})` and `applyAreaTemplate({db, csvPath})` signatures match between Tasks 8, 9, 10.
   - `manualAreaMap.get(unit_number_norm)` returns `area_sqm` (REAL) or undefined; treated as null in `computeAreaSignal` — consistent.

3. **No placeholders.** Each task has runnable test code, runnable implementation code, exact paths, exact commit messages. No "TBD", no "fill in", no "similar to Task N".

4. **Note on existing-file ambiguity:** Task 6 references `src/compare-html.js` but the current code has `writeCompareHtml` inside `src/compare.js`. The task notes this and instructs to land changes wherever `writeCompareHtml` actually lives.
