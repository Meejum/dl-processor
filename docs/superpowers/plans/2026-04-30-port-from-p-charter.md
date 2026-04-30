# DL-Processor Port from p-charter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the working compare features (`match_scope`, `buildingTransforms`, plot fuzzy match, regex-based SF headers, explicit per-project overrides) from `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor` into `C:\projects\DL-Processor` so all 35 monthly DLD project files reconcile correctly against Salesforce.

**Architecture:** Surgical port. No new architecture. Five existing files modified, one new file created (`src/audit-report.js`), one new menu entry. Schema is already compatible — verified at start of plan. All 32 existing tests stay green; three new test suites cover the ported logic.

**Tech Stack:** Node.js 18+ (Node 24 in current env), better-sqlite3, xlsx, plain JS (CommonJS), `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-04-30-dl-processor-port-from-p-charter-design.md`

**Reference source (read-only baseline):** `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor`

---

## Pre-flight checklist

- [ ] **Confirm working directory is the worktree**

Run: `cd C:/projects/DL-Processor/.worktrees/dl-improvements && git rev-parse --abbrev-ref HEAD`
Expected: `feat/dl-processor-improvements`. If not, stop — the worktree set-up is wrong.

- [ ] **Confirm tests are green at the starting line**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 32` and `ℹ fail 0`. If not, fix the failures before starting the port.

- [ ] **Confirm schema has every required column**

Run: `node -e "const Database=require('better-sqlite3');const db=new Database(':memory:');const fs=require('fs');db.exec(fs.readFileSync('db/schema.sql','utf8'));const cols=(t)=>db.prepare('PRAGMA table_info('+t+')').all().map(r=>r.name);console.log('sf_booking has applicant_2_name:', cols('sf_booking').includes('applicant_2_name'));console.log('sf_booking has applicant_details:', cols('sf_booking').includes('applicant_details'));console.log('project_mapping has match_scope:', cols('project_mapping').includes('match_scope'));"`
Expected: three `true` lines. If any is `false`, stop — schema is older than expected; work outside this plan is needed before continuing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `config/project-mapping.json` | replace | Explicit DLD→SF overrides for ~25 active projects + the existing single Hartland Waves entry |
| `src/project-mapping.js` | modify | `buildMappingFor` adds `match_scope`; `expectedSfUnit` accepts `buildingName`; preserve empty `sf_unit_prefix` |
| `src/salesforce.js` | replace `HEADER_LABELS`/`resolveSfColumns` with regex-based resolver; import `applicantDetails`, `applicant2/3/4Name`, `nationality`, `docusignComplete`; add CSV path |
| `src/compare.js` | modify | Read `match_scope` from `project_mapping`; query SF by `project=` when scope is `'project'`; plot detection; `findSfByBuyerPrice`; generic-token stripping |
| `src/audit-report.js` | create | Pure read-only function `runAudit({ db, out })` printing a text reconciliation summary |
| `src/menu.js` | modify | One new menu entry `[A] Audit Report` invoking `runAudit` |
| `test/salesforce-headers.test.js` | rewrite | Tests regex-based resolver instead of exact-string |
| `test/match-scope.test.js` | create | Unit tests for `match_scope='project'` SF query routing |
| `test/building-transforms.test.js` | create | Unit tests for `expectedSfUnit` with `buildingTransforms` argument |
| `test/plot-fuzzy-match.test.js` | create | Unit tests for plot detection + `findSfByBuyerPrice` (Jaccard, price tolerance, generic-token strip) |
| `test/audit-report.test.js` | create | Smoke test that `runAudit` produces non-empty output and returns the headline object |

---

## Task 1 — Port `expectedSfUnit` to accept `buildingName` + preserve empty prefix (TDD)

Background: `expectedSfUnit` currently maps a DLD unit number to its SF counterpart using `mapping.sf_unit_prefix` and `mapping.unitTransforms`. The port adds a third argument `buildingName`, prefers `mapping.buildingTransforms[buildingName]` over `mapping.unitTransforms` when present, and treats an empty-string `sf_unit_prefix` as "use the transform output verbatim, no prefix".

**Files:**
- Modify: `src/project-mapping.js`
- Test: `test/building-transforms.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/building-transforms.test.js` with this exact content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedSfUnit } = require('../src/project-mapping');

test('falls back to unitTransforms when buildingName is not in buildingTransforms', () => {
  const mapping = {
    sf_unit_prefix: 'W',
    unitTransforms: [{ match: '^RETAIL\\s*(\\d+)$', replace: 'R$1' }]
  };
  assert.equal(expectedSfUnit('RETAIL 5', mapping, 'Some Building'), 'W-R5');
});

test('uses buildingTransforms[buildingName] when key matches', () => {
  const mapping = {
    sf_unit_prefix: '',
    buildingTransforms: {
      'Sobha One - A': [{ match: '^A(\\d+)$', replace: 'SO-A$1' }],
      'Sobha One - B': [{ match: '^B(\\d+)$', replace: 'SO-B$1' }]
    }
  };
  assert.equal(expectedSfUnit('A1001', mapping, 'Sobha One - A'), 'SO-A1001');
  assert.equal(expectedSfUnit('B1001', mapping, 'Sobha One - B'), 'SO-B1001');
});

test('empty sf_unit_prefix returns transform output verbatim (no prepend)', () => {
  const mapping = {
    sf_unit_prefix: '',
    unitTransforms: [{ match: '^(\\d+)$', replace: '310 RSC-$1' }]
  };
  assert.equal(expectedSfUnit('101', mapping, null), '310 RSC-101');
});

test('non-empty prefix prepends to transform output', () => {
  const mapping = {
    sf_unit_prefix: 'CG',
    unitTransforms: [{ match: '^([ABC])(\\d+)$', replace: '$1$2' }]
  };
  assert.equal(expectedSfUnit('A1001', mapping, null), 'CG-A1001');
});

test('returns null for empty unit', () => {
  assert.equal(expectedSfUnit(null, { sf_unit_prefix: 'W' }, null), null);
  assert.equal(expectedSfUnit('', { sf_unit_prefix: 'W' }, null), null);
});

test('buildingTransforms takes priority even when unitTransforms also matches', () => {
  const mapping = {
    sf_unit_prefix: '',
    unitTransforms:    [{ match: '^A(\\d+)$', replace: 'GENERIC-$1' }],
    buildingTransforms: { 'Tower X': [{ match: '^A(\\d+)$', replace: 'TX-$1' }] }
  };
  assert.equal(expectedSfUnit('A100', mapping, 'Tower X'), 'TX-100');
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npm test 2>&1 | grep -E "building-transforms|^(✔|✖)" | head -10`
Expected: at least the `uses buildingTransforms` and `empty sf_unit_prefix` tests fail. The current `expectedSfUnit` only accepts two arguments and coerces empty prefix to `null`.

- [ ] **Step 3: Replace `expectedSfUnit` in `src/project-mapping.js`**

Find the existing function (currently at the bottom of the module, ~line 159) and replace with:

```js
function expectedSfUnit(dldUnitNumberNorm, mapping, buildingName) {
  if (!dldUnitNumberNorm) return null;
  let transformed = dldUnitNumberNorm;
  if (buildingName && mapping.buildingTransforms && mapping.buildingTransforms[buildingName]) {
    transformed = applyUnitTransforms(dldUnitNumberNorm, mapping.buildingTransforms[buildingName]);
  } else if (mapping.unitTransforms && mapping.unitTransforms.length > 0) {
    transformed = applyUnitTransforms(dldUnitNumberNorm, mapping.unitTransforms);
  }
  // Empty string is meaningful: "transform produced the full SF unit name, do not prepend".
  if (!mapping.sf_unit_prefix) return transformed;
  return `${mapping.sf_unit_prefix}-${transformed}`;
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 38` (`32 + 6 new building-transforms tests`), `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/project-mapping.js test/building-transforms.test.js
git commit -m "feat: expectedSfUnit accepts buildingName + preserves empty prefix

Ports the per-building transform support from p-charter. When the DLD
unit's building name has an entry in mapping.buildingTransforms, those
rules are applied in preference to the global unitTransforms. Empty
sf_unit_prefix is preserved (not coerced to null) so transforms can
produce the full SF unit verbatim, e.g. '310 RSC-101'."
```

---

## Task 2 — Add `match_scope` to `buildMappingFor` + `saveMappingToDb`

Background: An override config entry can specify `"match_scope": "project"` (default `"sub_project"`). When `'project'`, the SF query in `compareProject` filters by `project=`, allowing one DLD project to roll up across multiple SF sub-projects.

**Files:**
- Modify: `src/project-mapping.js`

- [ ] **Step 1: Modify `buildMappingFor` to surface `match_scope`**

In `src/project-mapping.js`, find `buildMappingFor` (around line 54). The override branch currently returns five fields. Add `match_scope` and preserve empty-string `sf_unit_prefix`:

Replace the override branch:

```js
  if (overrides[dldProjectName]) {
    const o = overrides[dldProjectName];
    return {
      source: 'override',
      sf_project:     o.sf_project || null,
      sf_sub_project: o.sf_sub_project,
      sf_unit_prefix: o.sf_unit_prefix,
      unitTransforms: Array.isArray(o.unitTransforms) ? o.unitTransforms : []
    };
  }
```

with:

```js
  if (overrides[dldProjectName]) {
    const o = overrides[dldProjectName];
    return {
      source: 'override',
      sf_project:     o.sf_project || null,
      sf_sub_project: o.sf_sub_project || null,
      // Preserve empty string — meaningful: "no prefix to prepend, use transforms only"
      sf_unit_prefix: o.sf_unit_prefix != null ? o.sf_unit_prefix : null,
      match_scope:    o.match_scope || 'sub_project',
      unitTransforms: Array.isArray(o.unitTransforms) ? o.unitTransforms : []
    };
  }
```

In the same function, find the auto/inferred branch and the unknown branch. Add `match_scope: 'sub_project'` to both return shapes. After edit:

```js
  const guess = guessSubProjectFromDldName(dldProjectName, inferred);
  if (guess) {
    const info = inferred.get(guess);
    return {
      source: 'auto',
      sf_project:     info.project || null,
      sf_sub_project: guess,
      sf_unit_prefix: info.prefix,
      match_scope:    'sub_project',
      unitTransforms: []
    };
  }

  return {
    source: 'unknown',
    sf_project:     null,
    sf_sub_project: null,
    sf_unit_prefix: null,
    match_scope:    'sub_project',
    unitTransforms: []
  };
```

- [ ] **Step 2: Modify `saveMappingToDb` to write the column**

Find `saveMappingToDb` (around line 165). The `INSERT ... ON CONFLICT` statement must include `match_scope`:

Replace the function body with:

```js
function saveMappingToDb(db, projectId, mapping) {
  // Skip projects with no inferred mapping. project_mapping.sf_sub_project is
  // NOT NULL in the schema; an INSERT with null would crash. compareProject()
  // already handles unmapped projects by returning status:'no-mapping'.
  if (!mapping.sf_sub_project && mapping.match_scope !== 'project') return;
  // For match_scope='project' the row keys off sf_project, not sf_sub_project,
  // so it's allowed to have a null sub_project. The schema permits this only
  // when match_scope='project'; check before insert.
  if (mapping.match_scope === 'project' && !mapping.sf_project) return;

  db.prepare(`
    INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source, updated_at)
    VALUES (@pid, @sub, @prefix, @proj, @scope, @source, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      sf_sub_project = excluded.sf_sub_project,
      sf_unit_prefix = excluded.sf_unit_prefix,
      sf_project     = excluded.sf_project,
      match_scope    = excluded.match_scope,
      source         = excluded.source,
      updated_at     = datetime('now')
  `).run({
    pid:    projectId,
    sub:    mapping.sf_sub_project,
    prefix: mapping.sf_unit_prefix,
    proj:   mapping.sf_project,
    scope:  mapping.match_scope || 'sub_project',
    source: mapping.source
  });
  db.prepare(`
    UPDATE dld_project SET sf_project=?, sf_sub_project=?, sf_unit_prefix=? WHERE project_id=?
  `).run(mapping.sf_project, mapping.sf_sub_project, mapping.sf_unit_prefix, projectId);
}
```

- [ ] **Step 3: Verify schema accepts match_scope='project' with null sub_project**

Run: `node -e "const Database=require('better-sqlite3');const db=new Database(':memory:');const fs=require('fs');db.exec(fs.readFileSync('db/schema.sql','utf8'));db.prepare(\"INSERT INTO dld_project (project_name) VALUES ('Test')\").run();db.prepare(\"INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope) VALUES (1, NULL, '', 'Test SF', 'project')\").run();console.log('OK — accepts null sf_sub_project when match_scope=project');"`
Expected: `OK — accepts null sf_sub_project when match_scope=project`. If it fails with NOT NULL constraint, the schema's `project_mapping.sf_sub_project` is still NOT NULL and needs migration. Stop and tell the user.

- [ ] **Step 4: Run all existing tests — confirm none break**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: still `ℹ pass 38`, `ℹ fail 0`. The buildMappingFor return shape now has an extra `match_scope` field; existing tests should ignore it.

- [ ] **Step 5: Commit**

```bash
git add src/project-mapping.js
git commit -m "feat: buildMappingFor + saveMappingToDb support match_scope

buildMappingFor now reads match_scope from override config (default
'sub_project') and surfaces it on the returned mapping object. It also
preserves an empty-string sf_unit_prefix instead of coercing to null.
saveMappingToDb writes match_scope to the project_mapping table and
skips the insert when both sf_sub_project and (for project scope)
sf_project are absent."
```

---

## Task 3 — Replace SF header parsing with regex-based resolver

Background: Phase C's exact-string `HEADER_LABELS` map is replaced with a regex-pattern array (`SF_FIELD_HEADERS`) that allows multiple header variants per field, scans for the header row automatically (top 13 rows looking for ≥6 known fields), and silently sets unmappable fields to `null`. This is required because the new SF exports don't always start the header at row index 9 and use different column names than the older SSRS report. Also imports the four extra applicant fields.

**Files:**
- Modify: `src/salesforce.js`
- Rewrite: `test/salesforce-headers.test.js`

- [ ] **Step 1: Rewrite the salesforce-headers test for the new contract**

The current test expects `resolveSfColumns(headerRow)` to take a single argument and throw on missing required headers. The new contract: `detectHeaderRow(aoa)` scans an array of arrays, returns `{ row, idx, count }`; the resolver is forgiving for optional fields.

Replace the entire content of `test/salesforce-headers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectHeaderRow, buildSfHeaderIndex } = require('../src/salesforce');

const HEADERS_FULL = [
  null,
  'Business Process: Business Process Name',
  null,
  'Booking: Sub Project',
  'Unit',
  'Booking: Booking Name',
  'Project',
  'Booking: Tower Name',
  'Booking: Primary Applicant Name',
  'Booking: Purchase Price',
  'Booking: DLD Amount'
];

test('buildSfHeaderIndex maps known headers to column indices', () => {
  const idx = buildSfHeaderIndex(HEADERS_FULL);
  assert.equal(idx.bpName, 1);
  assert.equal(idx.subProject, 3);
  assert.equal(idx.unit, 4);
  assert.equal(idx.applicantName, 8);
  assert.equal(idx.purchasePrice, 9);
});

test('buildSfHeaderIndex matches "Applicant Name" alias', () => {
  const idx = buildSfHeaderIndex([null, 'Applicant Name']);
  assert.equal(idx.applicantName, 1);
});

test('buildSfHeaderIndex returns empty object for unrecognized headers', () => {
  const idx = buildSfHeaderIndex(['random', 'unrelated', 'columns']);
  // Only meta key _natCols may be present; no real fields.
  for (const k of Object.keys(idx)) assert.equal(k, '_natCols', 'unexpected mapped field: ' + k);
});

test('buildSfHeaderIndex is case-insensitive and ignores extra whitespace', () => {
  const idx = buildSfHeaderIndex([null, '  BOOKING:  PRIMARY  APPLICANT  NAME  ']);
  assert.equal(idx.applicantName, 1);
});

test('detectHeaderRow finds the header row when buried under preamble', () => {
  const aoa = [
    [null], ['Some title'], ['Generated 2026-04-21'], [null], [null], [null], [null], [null], [null],
    HEADERS_FULL
  ];
  const { row, count } = detectHeaderRow(aoa);
  assert.equal(row, 9);
  assert.ok(count >= 6, 'expected ≥6 fields mapped, got ' + count);
});

test('detectHeaderRow scans rows 0..12 for best match', () => {
  const aoa = [HEADERS_FULL, [null], [null]];
  const { row } = detectHeaderRow(aoa);
  assert.equal(row, 0);
});

test('detectHeaderRow collects nationality columns into _natCols', () => {
  const headers = [null, 'Booking: Nationality', 'Unit', 'Booking: Primary Applicant Name', 'Booking: Sub Project', 'Project', 'Booking: Booking Name', 'Nationality'];
  const idx = buildSfHeaderIndex(headers);
  assert.deepEqual(idx._natCols, [1, 7]);
});
```

- [ ] **Step 2: Run tests — confirm they fail (the new functions don't exist yet)**

Run: `npm test 2>&1 | grep -E "salesforce-headers|^(✔|✖)" | head -10`
Expected: failures with messages like `detectHeaderRow is not a function` or `buildSfHeaderIndex is not a function`.

- [ ] **Step 3: Replace `src/salesforce.js`**

Overwrite the file with this exact content:

```js
const path = require('path');
const XLSX = require('xlsx');
const { sha256OfFile } = require('./db');

// Map each field → regex patterns for header-name matching. First-match wins.
// Headers are normalized via hnorm before matching: lowercase, single spaces.
const SF_FIELD_HEADERS = [
  { field: 'bpName',                 patterns: [/^business\s*process:?\s*business\s*process\s*name/i, /^bp\s*name$/i, /^business\s*process(?:\s*name)?$/i] },
  { field: 'subProject',             patterns: [/^(?:booking:?\s*)?sub[\s_-]*project$/i] },
  { field: 'unit',                   patterns: [/^unit$/i] },
  { field: 'bookingName',            patterns: [/^(?:booking:?\s*)?booking\s*name$/i] },
  { field: 'project',                patterns: [/^project$/i] },
  { field: 'towerName',              patterns: [/^(?:booking:?\s*)?tower\s*name$/i, /^tower$/i] },
  { field: 'applicantName',          patterns: [/^(?:booking:?\s*)?primary\s*applicant\s*name$/i, /^applicant\s*name$/i] },
  { field: 'purchasePrice',          patterns: [/^(?:booking:?\s*)?purchase\s*price$/i] },
  { field: 'dldAmount',              patterns: [/^(?:booking:?\s*)?dld\s*amount$/i] },
  { field: 'bpCreatedDate',          patterns: [/^business\s*process:?\s*created\s*date$/i, /^bp\s*created\s*date$/i] },
  { field: 'preRegStatus',           patterns: [/^(?:booking:?\s*)?pre-?\s*registration$/i, /^pre-?reg\s*status$/i] },
  { field: 'currentStepName',        patterns: [/^current\s*step\s*name$/i] },
  { field: 'status',                 patterns: [/^status$/i] },
  { field: 'rmProcessStatus',        patterns: [/^rm\s*process\s*status$/i] },
  { field: 'dldProcessStatus',       patterns: [/^dld\s*process\s*status$/i] },
  { field: 'totalDldPaid',           patterns: [/^(?:booking:?\s*)?total\s*dld(?:\s*amt|\s*amount)?\s*paid?$/i, /^total\s*dld\s*paid$/i] },
  { field: 'dldShortfall',           patterns: [/^(?:booking:?\s*)?shortfall/i, /^dld\s*shortfall$/i] },
  { field: 'dldBalance',             patterns: [/^dld\s*balance$/i] },
  { field: 'bookingRecordId',        patterns: [/^(?:booking:?\s*)?record\s*id$/i, /^booking\s*record\s*id$/i] },
  { field: 'endDate',                patterns: [/^end\s*date$/i] },
  { field: 'preRegCompletionDate',   patterns: [/^(?:booking:?\s*)?date\s*of\s*pre-?\s*reg(?:istration)?$/i, /^pre-?reg\s*completion\s*date$/i] },
  { field: 'procedureNumber',        patterns: [/^procedure\s*number$/i] },
  { field: 'paymentReferenceNumber', patterns: [/^payment\s*reference\s*number$/i] },
  { field: 'paymentDate',            patterns: [/^payment\s*date$/i] },
  { field: 'nationality',            patterns: [/^(?:booking:?\s*)?nationality$/i] },
  { field: 'applicantDetails',       patterns: [/^(?:booking:?\s*)?applicant\s*details$/i] },
  { field: 'applicant2Name',         patterns: [/^(?:booking:?\s*)?applicant\s*2\s*name$/i] },
  { field: 'applicant3Name',         patterns: [/^(?:booking:?\s*)?applicant\s*3\s*name$/i] },
  { field: 'applicant4Name',         patterns: [/^(?:booking:?\s*)?applicant\s*4\s*name$/i] },
  { field: 'docusignComplete',       patterns: [/^(?:booking:?\s*)?(?:applicant\s*)?docusign\s*complete$/i] }
];

function hnorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

function buildSfHeaderIndex(headerRow) {
  const idx = {};
  const used = new Set();
  for (let col = 0; col < (headerRow || []).length; col++) {
    const h = hnorm(headerRow[col]);
    if (!h) continue;
    for (const entry of SF_FIELD_HEADERS) {
      if (used.has(entry.field)) continue;
      if (entry.patterns.some(rx => rx.test(h))) {
        idx[entry.field] = col;
        used.add(entry.field);
        break;
      }
    }
  }
  // Collect every column that matches "Nationality" — SF reports sometimes have
  // it twice (one empty config artefact, one with real data).
  idx._natCols = [];
  for (let col = 0; col < (headerRow || []).length; col++) {
    if (/^(?:booking:?\s*)?nationality$/i.test(hnorm(headerRow[col]))) idx._natCols.push(col);
  }
  return idx;
}

function detectHeaderRow(aoa) {
  const maxScan = Math.min(13, aoa.length);
  let best = { row: -1, idx: {}, count: 0 };
  for (let i = 0; i < maxScan; i++) {
    const idx = buildSfHeaderIndex(aoa[i] || []);
    const count = Object.keys(idx).filter(k => k !== '_natCols').length;
    if (count > best.count) best = { row: i, idx, count };
  }
  return best;
}

function cellOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function readSfWorkbook(filePath) {
  const origErr = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === 'string' && /Bad uncompressed size/.test(msg)) return;
    return origErr(msg, ...rest);
  };
  let wb;
  try { wb = XLSX.readFile(filePath); }
  finally { console.error = origErr; }
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });

  const { row: headerRow, idx, count: mappedCount } = detectHeaderRow(aoa);
  if (headerRow < 0 || mappedCount < 6) {
    throw new Error('readSfWorkbook: could not find SF header row (need ≥6 known field headers). File: ' + path.basename(filePath));
  }

  let generatedAt = null;
  for (let i = 0; i < headerRow; i++) {
    const r = aoa[i] || [];
    for (const c of r) {
      if (typeof c === 'string' && /^as\s*of\b/i.test(c.trim())) { generatedAt = c.trim(); break; }
    }
    if (generatedAt) break;
  }

  const get = (r, f) => idx[f] != null ? r[idx[f]] : null;
  const getNat = (r) => {
    for (const c of (idx._natCols || [])) { const v = r[c]; if (v != null && v !== '') return v; }
    return null;
  };
  const rows = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(get(r, 'bpName'));
    const unit = cellOrNull(get(r, 'unit'));
    const bookingName = cellOrNull(get(r, 'bookingName'));
    if (!bpName && !unit && !bookingName) continue;
    rows.push({
      bpName,
      subProject:             cellOrNull(get(r, 'subProject')),
      unit,
      bookingName,
      project:                cellOrNull(get(r, 'project')),
      towerName:              cellOrNull(get(r, 'towerName')),
      applicantName:          cellOrNull(get(r, 'applicantName')),
      purchasePrice:          asNumberOrNull(get(r, 'purchasePrice')),
      dldAmount:              asNumberOrNull(get(r, 'dldAmount')),
      bpCreatedDate:          cellOrNull(get(r, 'bpCreatedDate')),
      preRegStatus:           cellOrNull(get(r, 'preRegStatus')),
      currentStepName:        cellOrNull(get(r, 'currentStepName')),
      status:                 cellOrNull(get(r, 'status')),
      rmProcessStatus:        cellOrNull(get(r, 'rmProcessStatus')),
      dldProcessStatus:       cellOrNull(get(r, 'dldProcessStatus')),
      totalDldPaid:           asNumberOrNull(get(r, 'totalDldPaid')),
      dldShortfall:           asNumberOrNull(get(r, 'dldShortfall')),
      dldBalance:             asNumberOrNull(get(r, 'dldBalance')),
      bookingRecordId:        cellOrNull(get(r, 'bookingRecordId')),
      endDate:                cellOrNull(get(r, 'endDate')),
      preRegCompletionDate:   cellOrNull(get(r, 'preRegCompletionDate')),
      procedureNumber:        cellOrNull(get(r, 'procedureNumber')),
      paymentReferenceNumber: cellOrNull(get(r, 'paymentReferenceNumber')),
      paymentDate:            cellOrNull(get(r, 'paymentDate')),
      nationality:            cellOrNull(getNat(r)),
      applicantDetails:       cellOrNull(get(r, 'applicantDetails')),
      applicant2Name:         cellOrNull(get(r, 'applicant2Name')),
      applicant3Name:         cellOrNull(get(r, 'applicant3Name')),
      applicant4Name:         cellOrNull(get(r, 'applicant4Name')),
      docusignComplete:       cellOrNull(get(r, 'docusignComplete'))
    });
  }
  return { generatedAt, rows, _meta: { headerRow, mappedFields: mappedCount } };
}

function readSfCsv(filePath) {
  const origErr = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === 'string' && /Bad uncompressed size/.test(msg)) return;
    return origErr(msg, ...rest);
  };
  let wb;
  try { wb = XLSX.readFile(filePath, { type: 'file', raw: false }); }
  finally { console.error = origErr; }
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });

  const { row: headerRow, idx, count: mappedCount } = detectHeaderRow(aoa);
  if (headerRow < 0 || mappedCount < 6) {
    throw new Error('readSfCsv: could not find SF header row (need ≥6 known field headers). File: ' + path.basename(filePath));
  }

  const get = (r, f) => idx[f] != null ? r[idx[f]] : null;
  const getNat = (r) => {
    for (const c of (idx._natCols || [])) { const v = r[c]; if (v != null && v !== '') return v; }
    return null;
  };
  const rows = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(get(r, 'bpName'));
    const unit = cellOrNull(get(r, 'unit'));
    const bookingName = cellOrNull(get(r, 'bookingName'));
    if (!bpName && !unit && !bookingName) continue;
    rows.push({
      bpName,
      subProject:             cellOrNull(get(r, 'subProject')),
      unit,
      bookingName,
      project:                cellOrNull(get(r, 'project')),
      towerName:              cellOrNull(get(r, 'towerName')),
      applicantName:          cellOrNull(get(r, 'applicantName')),
      purchasePrice:          asNumberOrNull(get(r, 'purchasePrice')),
      dldAmount:              asNumberOrNull(get(r, 'dldAmount')),
      bpCreatedDate:          cellOrNull(get(r, 'bpCreatedDate')),
      preRegStatus:           cellOrNull(get(r, 'preRegStatus')),
      currentStepName:        cellOrNull(get(r, 'currentStepName')),
      status:                 cellOrNull(get(r, 'status')),
      rmProcessStatus:        cellOrNull(get(r, 'rmProcessStatus')),
      dldProcessStatus:       cellOrNull(get(r, 'dldProcessStatus')),
      totalDldPaid:           asNumberOrNull(get(r, 'totalDldPaid')),
      dldShortfall:           asNumberOrNull(get(r, 'dldShortfall')),
      dldBalance:             asNumberOrNull(get(r, 'dldBalance')),
      bookingRecordId:        cellOrNull(get(r, 'bookingRecordId')),
      endDate:                cellOrNull(get(r, 'endDate')),
      preRegCompletionDate:   cellOrNull(get(r, 'preRegCompletionDate')),
      procedureNumber:        cellOrNull(get(r, 'procedureNumber')),
      paymentReferenceNumber: cellOrNull(get(r, 'paymentReferenceNumber')),
      paymentDate:            cellOrNull(get(r, 'paymentDate')),
      nationality:            cellOrNull(getNat(r)),
      applicantDetails:       cellOrNull(get(r, 'applicantDetails')),
      applicant2Name:         cellOrNull(get(r, 'applicant2Name')),
      applicant3Name:         cellOrNull(get(r, 'applicant3Name')),
      applicant4Name:         cellOrNull(get(r, 'applicant4Name')),
      docusignComplete:       cellOrNull(get(r, 'docusignComplete'))
    });
  }
  return { generatedAt: null, rows, _meta: { headerRow, mappedFields: mappedCount } };
}

function importSfRows({ db, rows, generatedAt, sourceFile, sourceSha256 }) {
  const insSnap = db.prepare(`
    INSERT INTO sf_snapshot (source_file, source_sha256, generated_at, total_rows)
    VALUES (?, ?, ?, ?)
  `);
  const insBooking = db.prepare(`
    INSERT INTO sf_booking (
      sf_snapshot_id, bp_name, sub_project, unit, unit_norm, booking_name, project,
      tower_name, applicant_name, purchase_price, dld_amount, pre_reg_status, status,
      rm_process_status, dld_process_status, bp_created_date, pre_reg_completion_date,
      procedure_number, payment_reference_number, payment_date, booking_record_id,
      total_dld_paid, dld_shortfall, dld_balance, current_step_name, end_date,
      nationality, applicant_details,
      applicant_2_name, applicant_3_name, applicant_4_name, docusign_complete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const snapInfo = insSnap.run(sourceFile, sourceSha256 || null, generatedAt || null, rows.length);
    const sid = snapInfo.lastInsertRowid;
    for (const r of rows) {
      const unitNorm = r.unit ? String(r.unit).trim().toUpperCase() : null;
      insBooking.run(
        sid, r.bpName, r.subProject, r.unit, unitNorm, r.bookingName, r.project,
        r.towerName, r.applicantName, r.purchasePrice, r.dldAmount, r.preRegStatus, r.status,
        r.rmProcessStatus, r.dldProcessStatus, r.bpCreatedDate, r.preRegCompletionDate,
        r.procedureNumber, r.paymentReferenceNumber, r.paymentDate, r.bookingRecordId,
        r.totalDldPaid, r.dldShortfall, r.dldBalance, r.currentStepName, r.endDate,
        r.nationality, r.applicantDetails,
        r.applicant2Name || null, r.applicant3Name || null, r.applicant4Name || null,
        r.docusignComplete || null
      );
    }
    return { sfSnapshotId: sid, rowsInserted: rows.length, generatedAt };
  });
  return run();
}

function importSfSnapshot({ db, filePath }) {
  const ext = path.extname(filePath).toLowerCase();
  const { generatedAt, rows } = ext === '.csv' ? readSfCsv(filePath) : readSfWorkbook(filePath);
  return importSfRows({
    db, rows, generatedAt,
    sourceFile: path.basename(filePath),
    sourceSha256: sha256OfFile(filePath)
  });
}

module.exports = {
  readSfWorkbook,
  readSfCsv,
  importSfSnapshot,
  importSfRows,
  detectHeaderRow,
  buildSfHeaderIndex,
  SF_FIELD_HEADERS
};
```

- [ ] **Step 4: Run tests — confirm green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass` rises (32 + 6 building-transforms + 7 salesforce-headers = 45), `ℹ fail 0`.

- [ ] **Step 5: Smoke test against the real SF export**

Run: `node -e "const {readSfWorkbook}=require('./src/salesforce.js');const r=readSfWorkbook('../../sf-input/DLD -ALL-2026-04-21-09-56-12.xlsx');console.log('rows:',r.rows.length);console.log('first row applicantName:',r.rows[0].applicantName);console.log('first row applicant2Name:',r.rows[0].applicant2Name);console.log('first row purchasePrice:',r.rows[0].purchasePrice);console.log('headerRow detected at:',r._meta.headerRow,'/ mappedFields:',r._meta.mappedFields);"`
Expected: rows count similar to before (~29344), applicantName looks like a person's name, purchasePrice is a number, headerRow is 9 (or near it). If `applicant2Name` is null for the first row that's OK — many SF rows have no co-applicant.

- [ ] **Step 6: Commit**

```bash
git add src/salesforce.js test/salesforce-headers.test.js
git commit -m "feat: regex-based SF header parsing + extra applicant fields

Replaces the exact-string HEADER_LABELS map with a regex-pattern array
(SF_FIELD_HEADERS). detectHeaderRow scans the first 13 rows for the
header line and accepts any row that maps ≥6 known fields. Optional
fields fall back to null silently — only the file is rejected when the
overall mapping count is too low.

Imports the four extra applicant fields the schema already has columns
for: applicant_details, applicant_2_name, applicant_3_name,
applicant_4_name, plus nationality and docusign_complete. CSV path
added via readSfCsv (xlsx library handles CSV natively)."
```

---

## Task 4 — Port `compareProject` to support `match_scope`, plot detection, plot fuzzy match

Background: `compareProject` is the reconciliation core. The port adds three branches: (1) read `match_scope` and route the SF query accordingly; (2) detect plot-based (villa) projects via `landShare`; (3) when a unit-keyed match fails on a plot project, fall back to fuzzy buyer+price match via `findSfByBuyerPrice`. Generic commercial tokens are stripped during the fuzzy match so unrelated companies don't false-match.

**Files:**
- Modify: `src/compare.js`
- Test: `test/match-scope.test.js`, `test/plot-fuzzy-match.test.js`

- [ ] **Step 1: Write the failing tests for match_scope**

Create `test/match-scope.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { compareProject } = require('../src/compare');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

function seedProject(db, projectId, projectName) {
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (?, ?)').run(projectId, projectName);
}

function seedDldUnitWithTx(db, { snapshotId, unitId, projectId, unitNumber, buyer, price, building }) {
  db.prepare('INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, building_id) VALUES (?, ?, ?, ?, ?, NULL)')
    .run(unitId, snapshotId, projectId, unitNumber, unitNumber.toUpperCase());
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (?, ?, 'Sale', '2026-01-01', ?, ?)`)
    .run(snapshotId, unitId, buyer, price);
}

function seedSf(db, sfSnapshotId, project, subProject, unit, applicant, price) {
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sfSnapshotId, project, subProject, unit, unit.toUpperCase(), applicant, price);
}

test('match_scope=project queries SF by project (not sub_project)', () => {
  const db = setupDb();
  seedProject(db, 1, 'Sobha One Multi');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, NULL, '', 'Sobha One', 'project', 'override')`).run();

  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  // Two SF rows under different sub_projects but same project.
  seedSf(db, 1, 'Sobha One', 'Sobha One - A', 'SO-A1001', 'JANE DOE', 1000000);
  seedSf(db, 1, 'Sobha One', 'Sobha One - B', 'SO-B1001', 'JOHN DOE', 1000000);

  // The DLD side matches one unit in tower A.
  seedDldUnitWithTx(db, { snapshotId: 1, unitId: 1, projectId: 1, unitNumber: 'SO-A1001', buyer: 'JANE DOE', price: 1000000 });

  const result = compareProject(db, 1);
  assert.equal(result.status, 'ok');
  assert.equal(result.rows.length, 2, 'expected 2 rows: 1 DLD-side + 1 SF-only from tower B');
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].sf_unit, 'SO-A1001');
});

test('match_scope=sub_project (default) queries SF by sub_project', () => {
  const db = setupDb();
  seedProject(db, 1, 'Just Waves');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Waves', 'W', 'Sobha Hartland', 'sub_project', 'override')`).run();

  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  seedSf(db, 1, 'Sobha Hartland', 'Waves', 'W-101', 'JANE DOE', 500000);
  seedSf(db, 1, 'Sobha Hartland', 'Waves Grande', 'WG-101', 'JOHN DOE', 600000);

  seedDldUnitWithTx(db, { snapshotId: 1, unitId: 1, projectId: 1, unitNumber: '101', buyer: 'JANE DOE', price: 500000 });

  const result = compareProject(db, 1);
  // Only Waves rows should be considered. WG-101 is a different sub_project, must not appear in rows.
  assert.equal(result.rows.length, 1, 'expected 1 row from Waves only');
  assert.equal(result.rows[0].match_status, 'MATCH');
});
```

- [ ] **Step 2: Write the failing tests for plot fuzzy match**

Create `test/plot-fuzzy-match.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { compareProject } = require('../src/compare');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

test('plot project — DLD unit numbers do not align with SF, matched by buyer+price', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  // SF villa V-42 is owned by JOHN SMITH at 5,000,000 AED.
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'JOHN SMITH', 5000000)`).run();

  // DLD side has a Land plot row (plot 9999) for the same buyer + price. Plot # doesn't align.
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 'Sale', '2026-01-01', 'JOHN SMITH', 5000000)`).run();

  const result = compareProject(db, 1);
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 1, 'expected plot fuzzy match to find the SF row');
  assert.equal(matches[0].sf_applicant, 'JOHN SMITH');
  assert.ok(matches[0].match_reasons.includes('plot match'), 'expected match_reasons to include "plot match", got: ' + matches[0].match_reasons);
});

test('plot match rejects when buyer name is too generic (only commercial tokens)', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'GENERAL INVESTMENTS GROUP HOLDINGS', 5000000)`).run();

  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 'Sale', '2026-01-01', 'INTERNATIONAL HOLDINGS COMPANY GROUP', 5000000)`).run();

  const result = compareProject(db, 1);
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 0, 'expected NO match — both sides are only generic tokens');
});

test('plot match rejects when price differs by more than 5%', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'JOHN SMITH', 5000000)`).run();

  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 'Sale', '2026-01-01', 'JOHN SMITH', 6000000)`).run();

  const result = compareProject(db, 1);
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 0, 'expected NO match — 20% price difference exceeds 5% tolerance');
});
```

- [ ] **Step 3: Run tests — confirm they fail**

Run: `npm test 2>&1 | grep -E "match_scope|plot-fuzzy|^(✔|✖)" | head -15`
Expected: failures on the new tests. The current `compareProject` doesn't support `match_scope='project'` or plot fuzzy.

- [ ] **Step 4: Modify `src/compare.js` — add helpers above `compareProject`**

In `src/compare.js`, find the section with `pickLatestPurchase`/`pickLatestMarketPrice` (around line 76-82). Add these helpers immediately after them:

```js
function findLatestNonBankParty(dldTxs) {
  if (!dldTxs || !dldTxs.length) return null;
  const sorted = dldTxs.slice().sort((a, b) => (b.tx_date_iso || '').localeCompare(a.tx_date_iso || ''));
  for (const t of sorted) {
    if (t.party_name && !BANK_PREFIX_RE.test(t.party_name)) return t.party_name;
  }
  return null;
}

const GENERIC_COMMERCIAL_TOKENS = new Set([
  'INVESTMENT','INVESTMENTS','HOLDING','HOLDINGS','TRADING','PROPERTIES','PROPERTY',
  'REAL','ESTATE','DEVELOPMENT','DEVELOPERS','GENERAL','GROUP','COMPANY','CO',
  'INTERNATIONAL','GLOBAL','BUSINESS','SERVICES','MANAGEMENT','CORPORATION'
]);

function plotNormalizeName(s) {
  if (!s) return '';
  return String(s).toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plotTokenJaccard(aKey, bKey) {
  const a = new Set(aKey.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w)));
  const b = new Set(bKey.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w)));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / new Set([...a, ...b]).size;
}
```

- [ ] **Step 5: Replace `compareProject` body**

Find `compareProject` (currently around line 165). Replace the entire function body (down to the closing brace before `summarize` is defined) with this version:

```js
function compareProject(db, projectId, cachedConfig) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id=?').get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const mappingRow   = db.prepare('SELECT * FROM project_mapping WHERE project_id=?').get(projectId) || {};
  const scope        = mappingRow.match_scope    || 'sub_project';
  const sfSubProject = mappingRow.sf_sub_project || project.sf_sub_project;
  const sfProject    = mappingRow.sf_project     || null;
  const sfPrefix     = mappingRow.sf_unit_prefix != null ? mappingRow.sf_unit_prefix : project.sf_unit_prefix;

  // Read override config (cachedConfig if provided, otherwise from disk).
  const overridesData = cachedConfig
    ? (cachedConfig.overrides || {})
    : (function () {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'project-mapping.json'), 'utf8')).overrides || {}; }
        catch (_) { return {}; }
      })();
  const ov = overridesData[project.project_name] || {};
  const transforms          = Array.isArray(ov.unitTransforms) ? ov.unitTransforms : [];
  const buildingTransforms  = ov.buildingTransforms || null;
  const hasBuildingTransforms = !!buildingTransforms && Object.keys(buildingTransforms).length > 0;
  const hasUnitTransforms     = transforms.length > 0;

  // No-mapping only when prefix AND both transform paths are absent.
  if (sfPrefix == null && !hasBuildingTransforms && !hasUnitTransforms) {
    return { project, status: 'no-mapping', rows: [] };
  }
  if (scope === 'sub_project' && !sfSubProject) return { project, status: 'no-mapping', rows: [] };
  if (scope === 'project'     && !sfProject)    return { project, status: 'no-mapping', rows: [] };

  const dldSnap = getLatestSnapshotForProject(db, projectId);
  if (!dldSnap) return { project, status: 'no-dld-snapshot', rows: [] };
  const sfSnap  = getLatestSfSnapshot(db);
  if (!sfSnap)  return { project, status: 'no-sf-snapshot', rows: [] };

  const dldUnits = getUnitsForSnapshot(db, dldSnap.snapshot_id);
  let sfBookings;
  if (scope === 'project') {
    sfBookings = db.prepare(`SELECT * FROM sf_booking WHERE sf_snapshot_id=? AND project=?`)
      .all(sfSnap.sf_snapshot_id, sfProject);
  } else {
    sfBookings = getSfBookingsForSub(db, sfSnap.sf_snapshot_id, sfSubProject);
  }
  const sfByUnit = new Map();
  for (const b of sfBookings) {
    if (b.unit_norm) sfByUnit.set(b.unit_norm, b);
  }

  // Plot detection — villa projects where DLD plot # ≠ SF villa #.
  const landShare = dldUnits.length
    ? dldUnits.filter(u => (u.unit_type === 'Land' || u.building_name === 'Land')).length / dldUnits.length
    : 0;
  const bareMapping = (sfPrefix === '' && !hasUnitTransforms && !hasBuildingTransforms);
  const isPlotProject = landShare >= 0.3 || (bareMapping && landShare >= 0.05);

  // Build buyer-token index for plot fuzzy match.
  const sfByBuyer = new Map();
  if (isPlotProject) {
    const addTokens = (key, b) => {
      if (!key) return;
      for (const tok of new Set(key.split(' ').filter(w => w.length > 2))) {
        if (!sfByBuyer.has(tok)) sfByBuyer.set(tok, []);
        sfByBuyer.get(tok).push(b);
      }
    };
    for (const b of sfBookings) {
      addTokens(plotNormalizeName(b.applicant_name), b);
      if (b.applicant_2_name)  addTokens(plotNormalizeName(b.applicant_2_name),  b);
      if (b.applicant_3_name)  addTokens(plotNormalizeName(b.applicant_3_name),  b);
      if (b.applicant_4_name)  addTokens(plotNormalizeName(b.applicant_4_name),  b);
      if (b.applicant_details) addTokens(plotNormalizeName(b.applicant_details), b);
    }
  }

  function findSfByBuyerPrice(buyer, dldPrice, alreadyMatchedSet) {
    if (!buyer) return null;
    const key = plotNormalizeName(buyer);
    if (!key) return null;
    const keyTokens = key.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w));
    if (keyTokens.length === 0) return null;
    const candidates = new Map();
    for (const tok of new Set(keyTokens)) {
      const list = sfByBuyer.get(tok) || [];
      for (const b of list) candidates.set(b.sf_booking_id, b);
    }
    if (candidates.size === 0) return null;
    let best = null, bestScore = -Infinity;
    for (const b of candidates.values()) {
      if (alreadyMatchedSet.has(b.unit_norm)) continue;
      const sfKeys = [
        plotNormalizeName(b.applicant_name),
        b.applicant_2_name  ? plotNormalizeName(b.applicant_2_name)  : null,
        b.applicant_3_name  ? plotNormalizeName(b.applicant_3_name)  : null,
        b.applicant_4_name  ? plotNormalizeName(b.applicant_4_name)  : null,
        b.applicant_details ? plotNormalizeName(b.applicant_details) : null
      ].filter(Boolean);
      let bestJac = 0, matched = false;
      for (const sfKey of sfKeys) {
        const jac = plotTokenJaccard(key, sfKey);
        if (jac >= 0.5 || key === sfKey) { matched = true; if (jac > bestJac) bestJac = jac; }
      }
      if (!matched) continue;
      const priceDiff = (dldPrice != null && b.purchase_price)
        ? Math.abs((b.purchase_price - dldPrice) / b.purchase_price) : 1;
      if (priceDiff > 0.05) continue;
      const score = bestJac * 2 + (1 - Math.min(priceDiff, 1));
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  const overrideMap = getOverridesMapForProject(db, projectId);
  const rows = [];
  const matchedSfUnits = new Set();

  for (const u of dldUnits) {
    const expected = expectedSfUnit(u.unit_number_norm, {
      sf_unit_prefix:    sfPrefix,
      unitTransforms:    transforms,
      buildingTransforms: buildingTransforms
    }, u.building_name);
    let sfRow = expected ? sfByUnit.get(expected) : null;
    const dldTxs = getTxForUnit(db, u.unit_id);
    const purchase = pickLatestPurchase(dldTxs) || dldTxs[dldTxs.length - 1] || {};
    const latestTx = dldTxs[dldTxs.length - 1] || {};

    let matchedViaBuyer = false;
    if (!sfRow && isPlotProject) {
      const realBuyer = purchase && purchase.party_name && !BANK_PREFIX_RE.test(purchase.party_name)
        ? purchase.party_name
        : findLatestNonBankParty(dldTxs);
      if (realBuyer) {
        const marketPrice = pickLatestMarketPrice(dldTxs);
        const fb = findSfByBuyerPrice(realBuyer, marketPrice ? marketPrice.amount_aed : null, matchedSfUnits);
        if (fb) { sfRow = fb; matchedViaBuyer = true; }
      }
    }

    const overrideBuyer = overrideMap.get(u.unit_number_norm) || null;
    const cls = classifyMatch(u, dldTxs, sfRow, overrideBuyer);
    if (matchedViaBuyer) cls.reasons = (cls.reasons || []).concat(['plot match']);
    if (sfRow) matchedSfUnits.add(sfRow.unit_norm);

    rows.push({
      dld_project:              project.project_name,
      sf_sub_project:           sfSubProject || sfProject || '(' + scope + ')',
      dld_unit_number:          u.unit_number,
      expected_sf_unit:         expected,
      sf_unit:                  sfRow?.unit || null,
      dld_unit_id:              u.dld_unit_id,
      dld_unit_type:            u.unit_type,
      dld_building:             u.building_name,
      dld_net_area:             u.net_area,
      dld_tx_count:             dldTxs.length,
      dld_purchase_type:        purchase.tx_type || null,
      dld_purchase_date:        purchase.tx_date || null,
      dld_purchase_date_iso:    purchase.tx_date_iso || null,
      dld_purchase_amount:      purchase.amount_aed || null,
      dld_purchase_party:       purchase.party_name || null,
      price_diff_aed:           cls.priceDelta.diff != null ? Math.round(cls.priceDelta.diff) : null,
      price_diff_pct:           cls.priceDelta.pct != null ? +cls.priceDelta.pct.toFixed(2) : null,
      price_direction:          cls.priceDelta.direction,
      dld_last_tx_type:         latestTx.tx_type || null,
      dld_last_tx_date:         latestTx.tx_date || null,
      dld_last_amount_aed:      latestTx.amount_aed || null,
      dld_last_party:           latestTx.party_name || null,
      sf_applicant:             sfRow?.applicant_name || null,
      sf_purchase_price:        sfRow?.purchase_price || null,
      sf_dld_amount:            sfRow?.dld_amount || null,
      sf_status:                sfRow?.status || null,
      sf_pre_reg_status:        sfRow?.pre_reg_status || null,
      sf_procedure_number:      sfRow?.procedure_number || null,
      sf_booking_name:          sfRow?.booking_name || null,
      match_status:             cls.status,
      match_reasons:            (cls.reasons || []).join('; ')
    });
  }

  for (const b of sfBookings) {
    if (!matchedSfUnits.has(b.unit_norm)) {
      rows.push({
        dld_project:         project.project_name,
        sf_sub_project:      sfSubProject || sfProject || '(' + scope + ')',
        dld_unit_number:     null,
        expected_sf_unit:    b.unit_norm,
        sf_unit:             b.unit,
        dld_unit_id:         null,
        dld_unit_type:       null,
        dld_building:        null,
        dld_net_area:        null,
        dld_tx_count:        0,
        dld_purchase_type:   null,
        dld_purchase_date:   null,
        dld_purchase_amount: null,
        dld_purchase_party:  null,
        price_diff_aed:      null,
        price_diff_pct:      null,
        price_direction:     null,
        dld_last_tx_type:    null,
        dld_last_tx_date:    null,
        dld_last_amount_aed: null,
        dld_last_party:      null,
        sf_applicant:        b.applicant_name,
        sf_purchase_price:   b.purchase_price,
        sf_dld_amount:       b.dld_amount,
        sf_status:           b.status,
        sf_pre_reg_status:   b.pre_reg_status,
        sf_procedure_number: b.procedure_number,
        sf_booking_name:     b.booking_name,
        match_status:        'SF_ONLY',
        match_reasons:       'no DLD'
      });
    }
  }

  const STATUS_PRIORITY = {
    BUYER_MISMATCH: 0,
    DLD_ONLY:       1,
    SF_ONLY:        2,
    PRICE_DOWN:     3,
    PRICE_UP:       4,
    MATCH:          5
  };
  rows.sort((a, b) => {
    const pd = (STATUS_PRIORITY[a.match_status] ?? 9) - (STATUS_PRIORITY[b.match_status] ?? 9);
    if (pd !== 0) return pd;
    return (a.dld_unit_number || '').localeCompare(b.dld_unit_number || '', undefined, { numeric: true });
  });

  return { project, status: 'ok', rows, dldSnapshotId: dldSnap.snapshot_id, sfSnapshotId: sfSnap.sf_snapshot_id };
}
```

- [ ] **Step 6: Run tests — confirm green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass` rises (45 + 2 match-scope + 3 plot-fuzzy = 50), `ℹ fail 0`. If any pre-existing test fails (especially names-overlap or salesforce-headers), stop and inspect.

- [ ] **Step 7: Commit**

```bash
git add src/compare.js test/match-scope.test.js test/plot-fuzzy-match.test.js
git commit -m "feat: compareProject supports match_scope, plot fuzzy match

Three regressions recovered from p-charter baseline:

- match_scope='project' routes the SF query by project= instead of
  sub_project=, so one DLD project can roll up across multiple SF
  sub-projects (e.g. SOBHA ONE → Sobha One A/B/C/D/E/Podium).
- buildingTransforms (read from override config) provides per-tower
  unit-number translation. expectedSfUnit prefers them over the
  global unitTransforms when the DLD unit's building name matches.
- Plot/villa projects (landShare ≥ 0.3 OR bareMapping config hint)
  fall back to fuzzy buyer+price matching (Jaccard ≥ 0.5 over
  non-generic tokens, price within 5%) when unit-keyed match fails.
  Generic commercial tokens (INVESTMENTS, HOLDINGS, GROUP, etc.) are
  stripped so unrelated companies don't false-match.

Plot matches surface in match_reasons as 'plot match' so reviewers
can filter to those rows for spot-checking."
```

---

## Task 5 — Port `audit-report.js` and wire into menu

Background: A new menu entry `[A] Audit Report` runs `runAudit({ db })` from `src/audit-report.js`. The function prints a textual reconciliation summary (project/unit/SF row counts, snapshot status) — directly answering the user's "audit the input files" request.

**Files:**
- Create: `src/audit-report.js`
- Modify: `src/menu.js`
- Test: `test/audit-report.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/audit-report.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { Writable } = require('stream');
const { runAudit } = require('../src/audit-report');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

function captureStream() {
  const chunks = [];
  const w = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
  w.toString = () => Buffer.concat(chunks).toString('utf8');
  return w;
}

test('runAudit on empty DB prints headline and returns zero counts', () => {
  const db = setupDb();
  const out = captureStream();
  const result = runAudit({ db, out });
  const text = out.toString();
  assert.ok(text.includes('DL-PROCESSOR AUDIT'), 'expected header in output');
  assert.ok(text.includes('HEADLINE'), 'expected HEADLINE section');
  assert.equal(result.dldProjects, 0);
  assert.equal(result.sfBookings, 0);
});

test('runAudit reports DLD project count and SF booking count', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Test Project');
  db.prepare('INSERT INTO dld_snapshot (snapshot_id, project_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name) VALUES (1, 'P', 'S', 'U-1', 'U-1', 'X')`).run();

  const out = captureStream();
  const result = runAudit({ db, out });
  assert.equal(result.dldProjects, 1);
  assert.equal(result.sfBookings, 1);
  const text = out.toString();
  assert.ok(text.includes('1 projects'), 'expected "1 projects" in output, got: ' + text.slice(0, 500));
});
```

- [ ] **Step 2: Run test — confirm fails (file doesn't exist)**

Run: `npm test 2>&1 | grep -E "audit-report|^(✔|✖)" | head -10`
Expected: `Cannot find module '../src/audit-report'` or similar.

- [ ] **Step 3: Create `src/audit-report.js`**

Write this exact content to `src/audit-report.js`:

```js
function runAudit({ db, out = process.stdout }) {
  const println = (s = '') => out.write(s + '\n');
  const bar = '═'.repeat(75);

  const sfSnap  = db.prepare('SELECT * FROM sf_snapshot ORDER BY sf_snapshot_id DESC LIMIT 1').get();
  const dldProj = db.prepare('SELECT COUNT(*) n FROM dld_project').get().n;
  const dldUnitRow = (function () {
    try { return db.prepare(`
      SELECT COUNT(*) n FROM dld_unit u
      WHERE u.snapshot_id IN (
        SELECT MAX(snapshot_id) FROM dld_snapshot GROUP BY project_id
      )
    `).get(); } catch (_) { return { n: 0 }; }
  })();
  const dldUnit = dldUnitRow.n;
  const sfRows  = sfSnap ? db.prepare('SELECT COUNT(*) n FROM sf_booking WHERE sf_snapshot_id = ?').get(sfSnap.sf_snapshot_id).n : 0;

  const mappedCount = db.prepare(`
    SELECT COUNT(*) n FROM project_mapping
    WHERE (sf_sub_project IS NOT NULL AND sf_sub_project != '')
       OR (match_scope = 'project' AND sf_project IS NOT NULL)
  `).get().n;
  const unmappedCount = Math.max(0, dldProj - mappedCount);

  println(bar);
  println('  DL-PROCESSOR AUDIT  /  ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  println(bar);
  println('');
  println('▸ CURRENT SNAPSHOTS');
  println('  DLD DB:                ' + dldProj + ' projects · ' + dldUnit.toLocaleString() + ' units (latest snapshots)');
  if (sfSnap) {
    println('  SF snapshot:           #' + sfSnap.sf_snapshot_id + ' — ' + sfSnap.source_file);
    println('  SF rows:               ' + sfRows.toLocaleString() + ' bookings');
  } else {
    println('  SF snapshot:           (none yet — run import-sf)');
  }
  println('');

  println('▸ MAPPING COVERAGE');
  println('  mapped projects:       ' + mappedCount + ' / ' + dldProj);
  println('  unmapped projects:     ' + unmappedCount + '  (compare will skip these)');
  println('');

  const projectRows = db.prepare(`
    SELECT p.project_name, p.project_id,
           pm.sf_sub_project, pm.sf_project, pm.match_scope, pm.source
    FROM dld_project p
    LEFT JOIN project_mapping pm ON pm.project_id = p.project_id
    ORDER BY p.project_name
  `).all();
  if (projectRows.length > 0) {
    println('▸ PER-PROJECT MAPPING');
    println('  ' + 'project'.padEnd(45) + '  scope         source     SF target');
    println('  ' + '-'.repeat(73));
    for (const p of projectRows) {
      const target = p.match_scope === 'project'
        ? (p.sf_project || '(none)')
        : (p.sf_sub_project || '(none)');
      const scope = (p.match_scope || 'sub_project').padEnd(13);
      const source = (p.source || '(unmapped)').padEnd(10);
      println('  ' + p.project_name.padEnd(45).slice(0, 45) + '  ' + scope + ' ' + source + ' ' + target);
    }
    println('');
  }

  const allSf = db.prepare('SELECT COUNT(*) n FROM sf_snapshot').get().n;
  if (allSf > 3) {
    println('▸ SF SNAPSHOT HISTORY');
    println('  ' + allSf + ' SF snapshots on disk — older ones are dead weight. compare/diff use the latest.');
    println('');
  }

  println(bar);
  println('  HEADLINE');
  println(bar);
  println('  DLD projects in DB:              ' + dldProj);
  println('  DLD units (latest snapshots):    ' + dldUnit.toLocaleString());
  println('  SF bookings (latest snapshot):   ' + sfRows.toLocaleString());
  println('  Mapped projects:                 ' + mappedCount + ' / ' + dldProj);
  println('');

  return {
    dldProjects:    dldProj,
    dldUnits:       dldUnit,
    sfBookings:     sfRows,
    mappedProjects: mappedCount,
    unmappedProjects: unmappedCount
  };
}

module.exports = { runAudit };
```

- [ ] **Step 4: Run tests — confirm green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 52` (50 + 2 audit-report), `ℹ fail 0`.

- [ ] **Step 5: Wire into menu**

In `src/menu.js`, find the main menu rendering — search for the existing menu options. Find where commands are dispatched (typically a switch on a single character). Add a new option `'a'` that invokes:

```js
const { runAudit } = require('./audit-report');
const { openDb } = require('./db');
// inside the menu's command dispatcher, alongside other case branches:
case 'a':
case 'A': {
  const db = openDb();
  runAudit({ db });
  db.close();
  await waitForEnter('press ENTER to return');
  break;
}
```

If the menu uses a different pattern (printed list + `readline.question`), add a list line `[A] Audit Report`. If `waitForEnter` doesn't already exist in `menu.js`, use whatever return-to-menu helper the file already uses for other long-output commands.

Read the current `menu.js` first to find the exact pattern, then mirror it.

- [ ] **Step 6: Smoke test the new menu option manually**

Run: `node index.js` (interactively). Press `a`. Expected: the audit report prints, ending with `HEADLINE` block and "press ENTER to return". Press ENTER. The menu reappears.

- [ ] **Step 7: Commit**

```bash
git add src/audit-report.js src/menu.js test/audit-report.test.js
git commit -m "feat: audit-report.js + menu entry

New '[A] Audit Report' menu option prints a textual reconciliation
summary: DLD project/unit counts, SF row count, mapping coverage, per-
project mapping (scope + source + target), SF snapshot history.
Pure read-only — no side effects. Returns headline counts as an object
for future programmatic use."
```

---

## Task 6 — Port the override config

Background: Replace the current single-entry `config/project-mapping.json` with the rich version from p-charter that contains explicit overrides for ~25 active projects.

**Files:**
- Modify: `config/project-mapping.json`

- [ ] **Step 1: Verify p-charter source is reachable**

Run: `ls "C:/Users/ali.alghumlasi/Desktop/p-charter/dl-processor/config/project-mapping.json"`
Expected: file exists. If not, stop — the source baseline isn't where the spec says it is.

- [ ] **Step 2: Copy the override config**

Run: `cp "C:/Users/ali.alghumlasi/Desktop/p-charter/dl-processor/config/project-mapping.json" "C:/projects/DL-Processor/.worktrees/dl-improvements/config/project-mapping.json"`

- [ ] **Step 3: Validate JSON is well-formed**

Run: `node -e "const c=JSON.parse(require('fs').readFileSync('config/project-mapping.json','utf8'));console.log('overrides:',Object.keys(c.overrides).filter(k=>!k.startsWith('_')).length);"`
Expected: prints something like `overrides: 25`. If JSON parse fails, fix the syntax error and re-run.

- [ ] **Step 4: Verify the loader ignores `_`-prefixed keys**

Run: `node -e "const {loadOverrides}=require('./src/project-mapping.js');const o=loadOverrides();const keys=Object.keys(o);console.log('non-underscore overrides:',keys.filter(k=>!k.startsWith('_')).length);console.log('underscore keys leaking through:',keys.filter(k=>k.startsWith('_')));"`
Expected: non-underscore count matches Step 3. Underscore-key array should be empty (or just `_note`/`_villa_note`). If `_villa_note` etc. appear, that's harmless because `buildMappingFor` will not match a DLD project by that name — but for cleanliness, filter them in `loadOverrides`. If you want to filter them, edit `src/project-mapping.js` `loadOverrides` to:

```js
function loadOverrides() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const all = raw.overrides || {};
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('_')) out[k] = v;
    }
    return out;
  } catch (e) {
    console.warn('[mapping] could not read', CONFIG_PATH, '-', e.message);
    return {};
  }
}
```

- [ ] **Step 5: Run all tests — confirm green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: still `ℹ pass 52`, `ℹ fail 0`. The config change shouldn't affect any test (tests use synthetic in-memory data).

- [ ] **Step 6: Commit**

```bash
git add config/project-mapping.json src/project-mapping.js
git commit -m "config: port explicit DLD->SF overrides from p-charter

25 projects now have explicit mappings: Riverside Crescent 310-360,
SOBHA ONE (with multi-tower buildingTransforms), Sobha Solis (per-
tower transforms), SKYSCAPE, Sobha Central + Phase I/II, Crest Grande,
Creek Vistas Heights, Creek Vistas Reserve, Waves Opulence, Element at
Sobha One, Sobha Reserve / Elwood / Estates / Hartland Townhouses /
Villas Phase I/II (plot-based villa compare), and existing Hartland
Waves entry preserved.

loadOverrides now filters _-prefixed documentation keys."
```

---

## Task 7 — End-to-end acceptance test

Background: Re-run the same import + compare flow that produced the original audit, this time with the ported features in place. Confirm the regression cases now produce non-zero matches.

**Files:** none (runtime verification only)

- [ ] **Step 1: Reset the dev DB so we have a clean import**

Run: `ls data/`
If `dl-processor.sqlite` (or whatever the DB filename is) exists, **rename** it to `data/dl-processor.pre-port.sqlite` so Ali can roll back if anything goes wrong. **Do not delete.** Run:

`mv data/dl-processor.sqlite data/dl-processor.pre-port.sqlite 2>/dev/null || echo "(no existing DB — clean import)"`

- [ ] **Step 2: Re-import the same DLD files + SF export**

Tell Ali: "run `node index.js` from the worktree, walk the menu through 'parse all DLD files' (option 7 quick audit, or whatever maps to the bulk import), select all files in `input/`, then 'import SF', select the latest file in `sf-input/`. Once both imports complete, run the compare option."

(The plan can't run an interactive menu; Ali drives this step.)

- [ ] **Step 3: Capture the compare output**

After Ali runs compare, ask for the console output (the project-by-project lines like `MATCH: x  PRICE↑: y  ...`).

- [ ] **Step 4: Verify regression cases now match**

Compare against the pre-port run (the message Ali pasted earlier). Specifically:

- The six Sobha Hartland family projects (Greens Phase I, Villas Phase 1, Estates Townhouses, Greens Phase III, Villas Phase II, Villas Phase III) should NOT all show `SF-only: 105` anymore. Each should route to its own SF sub-project.
- 310/320/330/340/360 Riverside Crescent should each produce non-zero `MATCH` (no more `skipped: no-mapping`).
- Elwood Estates and Sobha Reserve should produce non-zero `MATCH` via plot fuzzy compare.
- The previously-good projects (SOBHA ONE, Orbis, Solis, Waves, Waves Grande, Seahaven, OPA, Verde, S Tower, Creek Vistas Grande) should keep their match counts within ±5% of the previous run.

If the numbers don't meet these expectations, raise the regressions to Ali before declaring done.

- [ ] **Step 5: Run the new audit-report from the menu**

Tell Ali: "press `a` from the main menu". Expected: a text report listing all 35 projects with their mapping (override / auto / unmapped) and SF target. Anything labelled `(unmapped)` or routing to the wrong SF target is a follow-up.

- [ ] **Step 6: Final commit (if any cleanup is needed)**

If Steps 4–5 surface any small fixes (typo in an override entry, etc.), patch them and commit:

```bash
git add config/project-mapping.json
git commit -m "fix: <specific override fix from acceptance run>"
```

If everything passes, no commit needed; the branch is ready for finishing.

---

## Final Verification

- [ ] **Step 1: Full test suite green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 52`, `ℹ fail 0`.

- [ ] **Step 2: Branch has the expected commit set**

Run: `git log --oneline feat/dl-processor-improvements ^master`
Expected: 6 prior commits (Phases A–D + 2 bug fixes) plus 7 new commits from this plan (one per Task 1–7 except Task 7 may be no-op). 12–13 commits total.

- [ ] **Step 3: Hand off to finishing-a-development-branch**

After acceptance, invoke `superpowers:finishing-a-development-branch` to merge / push / discard per Ali's choice.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| Config port (~25 entries) | Task 6 |
| `match_scope` in project-mapping.js | Task 2 |
| `buildingTransforms` in project-mapping.js | Task 1 (`expectedSfUnit`) + Task 4 (compare uses it) |
| Empty `sf_unit_prefix` preserved | Task 1 + Task 2 |
| `match_scope='project'` SF query in compare.js | Task 4 |
| Plot detection + plot fuzzy match | Task 4 |
| Generic-token stripping | Task 4 |
| Regex-based SF header parsing | Task 3 |
| Extra applicant fields (2/3/4, details, nationality, docusign) | Task 3 |
| `audit-report.js` new file | Task 5 |
| Menu wiring | Task 5 |
| Schema verification | Pre-flight |
| Three new test suites | Tasks 1, 4, 4 |
| Existing 32 tests stay green | verified after each task |
| Cleanup of p-charter directory | Manual step deferred to Ali, post-merge |

All spec items covered. No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/`fill in` in the plan. No "similar to Task N" without code repetition. Code blocks include full implementations.

**3. Type consistency:**
- `expectedSfUnit(unit, mapping, buildingName)` — same signature in Task 1, used in Task 4 ✓
- `match_scope` — string `'sub_project'` or `'project'` consistently ✓
- `runAudit({ db, out })` — same signature in Task 5 source + tests ✓
- `findSfByBuyerPrice(buyer, dldPrice, alreadyMatchedSet)` — defined and used in Task 4 ✓
- `SF_FIELD_HEADERS` is the new export name from Task 3, no test references the old `REQUIRED_HEADERS` ✓
- `match_reasons` includes `'plot match'` for plot-fuzzy hits — consistent in Task 4 source + Task 4 test ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-port-from-p-charter.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit here because Tasks 5 (menu wiring) and 7 (acceptance run) need user input mid-stream.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
