# Audit Workbook Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `import-audit.js` and `audit-delta.js` so the team's audit workbook becomes ground truth — every compare run produces a per-project delta report categorizing rows into AGREE_MATCH, AGREE_MISMATCH, TOOL_SOLVED, TOOL_STRICTER, MANUAL_ONLY, DL_ONLY, MANUAL_BLANK.

**Architecture:** Two new modules. `import-audit.js` parses the .xlsx workbook into the existing `manual_audit_*` tables. `audit-delta.js` re-runs `compareProject` and joins against the audit rows, categorizes, writes per-project HTML+CSV. Two new menu options + two new CLI subcommands. Schema is already in place from Task 0 of the prior plan. HTML uses the existing dark-theme styling (no `loadVendor` / Tabulator dependency from p-charter — that file isn't ported here).

**Tech Stack:** Node 18+ (24 in current env), better-sqlite3, xlsx, plain JS (CommonJS), `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-04-30-audit-workbook-integration-design.md`

**Reference baseline:** `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor` (the version where these files originate; HTML output style is intentionally simplified vs the baseline)

**Reference workbook for end-to-end test:** `C:\Users\ali.alghumlasi\Downloads\Projects Verification updated - 2026 - DONE 4 (1).xlsx`

---

## Pre-flight

- [ ] **Step 1: Confirm working directory**

Run: `cd C:/projects/DL-Processor/.worktrees/dl-improvements && git rev-parse --abbrev-ref HEAD`
Expected: `feat/dl-processor-improvements`. Stop if not.

- [ ] **Step 2: Confirm tests are green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 56`, `ℹ fail 0`.

- [ ] **Step 3: Confirm schema has manual_audit_* tables**

Run: `node -e "const Database=require('better-sqlite3');const db=new Database(':memory:');const fs=require('fs');db.exec(fs.readFileSync('db/schema.sql','utf8'));console.log('manual_audit_snapshot:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='manual_audit_snapshot'\").get() != null);console.log('manual_audit_project:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='manual_audit_project'\").get() != null);console.log('manual_audit_row:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='manual_audit_row'\").get() != null);"`
Expected: three `true` lines. If any is false, stop — Task 0 of the prior plan was supposed to add these.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/import-audit.js` | create | Parse audit workbook → `manual_audit_*` tables. Reads TRUE/FALSE columns. |
| `src/audit-delta.js` | create | Run compare for projects with audit data, categorize, write HTML+CSV. |
| `src/audit-report.js` | modify | Add a "Latest audit snapshot" block to `runAudit`. |
| `src/file-picker.js` | modify | Add `pickAuditFile()`. |
| `src/menu.js` | modify | Two new menu entries `[U]` and `[D]`. |
| `index.js` | modify | Two new CLI subcommands `import-audit` and `audit-delta`. |
| `test/import-audit.test.js` | create | Header detection + flag parsing + projectId inference + end-to-end DB write. |
| `test/audit-delta.test.js` | create | Categorization buckets against synthetic compare + audit fixtures. |

---

## Task 1: file-picker — `pickAuditFile`

**Files:**
- Modify: `src/file-picker.js`

- [ ] **Step 1: Read the file to confirm its current shape**

Run: `node -e "console.log(require('./src/file-picker').pickAuditFile)"`
Expected: `undefined`. (Function doesn't exist yet.)

- [ ] **Step 2: Add the new function below `pickSfFile`**

In `src/file-picker.js`, find `pickSfFile()`. Add immediately below it:

```js
function pickAuditFile() {
  return pickFile({
    title: 'Select audit workbook (xlsx) — team verification',
    filter: 'Audit workbook (*.xlsx)|*.xlsx|All files (*.*)|*.*',
    initialDir: DLD_INPUT_DIR,
    searchDir:  DLD_INPUT_DIR,
    extensions: ['.xlsx'],
    multi: false
  });
}
```

- [ ] **Step 3: Add to the module.exports**

Find the existing `module.exports = { pickFile, pickDldFiles, pickSfFile, listFilesInDir, parseSelection };` and replace with:

```js
module.exports = { pickFile, pickDldFiles, pickSfFile, pickAuditFile, listFilesInDir, parseSelection };
```

- [ ] **Step 4: Verify export**

Run: `node -e "console.log(typeof require('./src/file-picker').pickAuditFile)"`
Expected: `function`.

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: still `ℹ pass 56`, `ℹ fail 0` — no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/file-picker.js
git commit -m "feat: pickAuditFile — picks audit workbook from input/"
```

---

## Task 2: `import-audit.js` core helpers (TDD)

**Files:**
- Create: `src/import-audit.js`
- Create: `test/import-audit.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/import-audit.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { asAuditFlag, normName, normNameStripSobha, buildHeaderIndex, parseProjectSheet, inferProjectId } = require('../src/import-audit');
const Database = require('better-sqlite3');
const fs = require('fs');

test('asAuditFlag handles boolean true/false', () => {
  assert.equal(asAuditFlag(true), 1);
  assert.equal(asAuditFlag(false), 0);
});

test('asAuditFlag handles string TRUE/FALSE/YES/NO/Y/N (case-insensitive, trimmed)', () => {
  assert.equal(asAuditFlag('TRUE'), 1);
  assert.equal(asAuditFlag('  true  '), 1);
  assert.equal(asAuditFlag('FALSE'), 0);
  assert.equal(asAuditFlag('YES'), 1);
  assert.equal(asAuditFlag('No'), 0);
  assert.equal(asAuditFlag('y'), 1);
  assert.equal(asAuditFlag('N'), 0);
});

test('asAuditFlag handles numeric 0 and 1', () => {
  assert.equal(asAuditFlag(1), 1);
  assert.equal(asAuditFlag(0), 0);
});

test('asAuditFlag returns null for blank/unrecognized', () => {
  assert.equal(asAuditFlag(null), null);
  assert.equal(asAuditFlag(undefined), null);
  assert.equal(asAuditFlag(''), null);
  assert.equal(asAuditFlag('maybe'), null);
  assert.equal(asAuditFlag('unknown'), null);
});

test('normName lowercases, strips non-alphanumeric, drops trailing row count', () => {
  assert.equal(normName('Sobha Skyparks 684'), 'sobha skyparks');
  assert.equal(normName('SOBHA-HARTLAND/WAVES'), 'sobha hartland waves');
  assert.equal(normName('  Crest Grande 985  '), 'crest grande');
});

test('normNameStripSobha drops the leading "sobha "', () => {
  assert.equal(normNameStripSobha('Sobha Reserve'), 'reserve');
  assert.equal(normNameStripSobha('Reserve'), 'reserve');
});

test('buildHeaderIndex maps SF + DLD columns from row-1 audit sheet headers', () => {
  const headerRow = ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System', 'Count of Customers', 'Procedure Type'];
  const { idx } = buildHeaderIndex(headerRow);
  assert.equal(idx.sub_project, 0);
  assert.equal(idx.sf_unit, 1);
  assert.equal(idx.sf_booking_name, 2);
  assert.equal(idx.sf_applicant, 3);
  assert.equal(idx.sf_price, 4);
  assert.equal(idx.dld_unit, 5);
  assert.equal(idx.rooms, 6);
  assert.equal(idx.details, 7);
  assert.equal(idx.name_match, 8);
  assert.equal(idx.price_match, 9);
  assert.equal(idx.count_customers, 10);
  assert.equal(idx.procedure_type, 11);
});

test('buildHeaderIndex tracks audit-only columns separately', () => {
  const headerRow = ['Unit', 'Remarks', 'Notes', 'Name Match Status'];
  const { idx, auditCols } = buildHeaderIndex(headerRow);
  assert.equal(idx.sf_unit, 0);
  // Remarks/Notes/Name Match Status are recognized as audit/note columns, not data
  assert.ok(auditCols.length >= 1);
});

test('parseProjectSheet handles the canonical audit-sheet shape (banner row 0, headers row 1)', () => {
  const aoa = [
    ['Salesforce', null, null, null, null, 'Oqood Data', null, null, 'Checked by Registrations Team'],
    ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System'],
    ['Skyvue Solair', 'SSO-801', 'B-33447', 'Mrs. M K', 1819704, 'B801', '1 B/R', 'M K (35.22 F.T.) ...', 'TRUE', 'TRUE'],
    ['Skyvue Solair', 'SSO-802', 'B-30720', 'Mr. S D', 2366727.25, 'B802', '2 B/R', 'S D (90.67 F.T.) ...', 'TRUE', 'FALSE']
  ];
  const ws = require('xlsx').utils.aoa_to_sheet(aoa);
  const { rows } = parseProjectSheet(ws);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sub_project, 'Skyvue Solair');
  assert.equal(rows[0].sf_unit, 'SSO-801');
  assert.equal(rows[0].dld_unit, 'B801');
  assert.equal(rows[0].sf_price, 1819704);
  assert.equal(rows[0].name_match, 1);
  assert.equal(rows[0].price_match, 1);
  assert.equal(rows[1].name_match, 1);
  assert.equal(rows[1].price_match, 0);
});

test('parseProjectSheet handles banner-less sheet (headers on row 0)', () => {
  const aoa = [
    ['Sub Project', 'Unit', 'DLD Unit'],
    ['X', 'A-1', '1']
  ];
  const ws = require('xlsx').utils.aoa_to_sheet(aoa);
  const { rows } = parseProjectSheet(ws);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sf_unit, 'A-1');
  assert.equal(rows[0].dld_unit, '1');
});

test('inferProjectId fuzzy-matches sheet name with trailing row count', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name, sf_unit_prefix) VALUES (1, 'Sobha SkyParks', 'SO-SK')").run();
  const r = inferProjectId(db, 'Sobha Skyparks 684');
  assert.equal(r.projectId, 1);
  assert.equal(r.inferred, 'Sobha SkyParks');
  assert.equal(r.prefix, 'SO-SK');
});

test('inferProjectId returns null projectId when no match', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'Unrelated')").run();
  const r = inferProjectId(db, 'Sobha Reserve 123');
  assert.equal(r.projectId, null);
});
```

- [ ] **Step 2: Run tests — confirm fail**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ fail` greater than 0 (file doesn't exist yet).

- [ ] **Step 3: Create `src/import-audit.js` with helpers**

Create `src/import-audit.js`:

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

function sha256OfFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normName(s) {
  let v = String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  v = v.replace(/\s+\d{1,5}$/, '').trim();
  return v;
}

function normNameStripSobha(s) {
  return normName(s).replace(/^sobha\s+/, '').trim();
}

function normUnit(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function stripProjectPrefix(sfUnit, prefix) {
  if (!sfUnit) return '';
  const u = normUnit(sfUnit);
  if (!prefix) return u;
  const re = new RegExp('^' + prefix.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-', '');
  return u.replace(re, '');
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  return n == null ? null : Math.trunc(n);
}

// Coerce a TRUE/FALSE audit cell into 1 / 0 / null.
// Handles xlsx booleans, numeric 0/1, and string "TRUE"/"FALSE"/"YES"/"NO"/"Y"/"N".
function asAuditFlag(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s === 'TRUE'  || s === 'YES' || s === 'Y') return 1;
    if (s === 'FALSE' || s === 'NO'  || s === 'N') return 0;
  }
  return null;
}

function inferProjectId(db, sheetName) {
  const bare = normName(sheetName);
  if (!bare) return { projectId: null, inferred: null };
  const all = db.prepare('SELECT project_id, project_name, sf_unit_prefix FROM dld_project').all();

  for (const p of all) {
    if (normName(p.project_name) === bare) return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
  }
  for (const p of all) {
    const np = normName(p.project_name);
    if (np.length >= 5 && bare.length >= 5 && (bare.includes(np) || np.includes(bare))) {
      return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
    }
  }
  const bareAlt = normNameStripSobha(sheetName);
  for (const p of all) {
    const npAlt = normNameStripSobha(p.project_name);
    if (npAlt.length >= 5 && bareAlt.length >= 5 && (bareAlt.includes(npAlt) || npAlt.includes(bareAlt))) {
      return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
    }
  }
  return { projectId: null, inferred: null, prefix: null };
}

function hnorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_MAP = [
  { field: 'sub_project',     patterns: [/^sub[\s_]*project$/] },
  { field: 'sf_unit',         patterns: [/^unit$/] },
  { field: 'sf_booking_name', patterns: [/^booking\s*name$/] },
  { field: 'sf_applicant',    patterns: [/^primary\s*applicant/, /^applicant\s*name$/] },
  { field: 'sf_price',        patterns: [/^purchase\s*price$/] },
  { field: 'dld_unit',        patterns: [/^dld\s*unit$/, /^oqood\s*unit$/, /^dld\s*plot\s*number$/, /^bu?ilding\s*number\s*in\s*dld$/] },
  { field: 'size',            patterns: [/^size$/, /^area$/] },
  { field: 'rooms',           patterns: [/^rooms?$/, /^bedrooms?$/, /^roons$/] },
  { field: 'details',         patterns: [/^all\s*details$/, /^details$/, /^lease\s*finance$/] },
  { field: 'name_match',      patterns: [/name\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^name\s*match\b/] },
  { field: 'price_match',     patterns: [/(?:purchase\s*)?price\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^price\s*match\b/] },
  { field: 'count_customers', patterns: [/^count\s*of\s*customers?$/, /^customers?\s*count$/] },
  { field: 'procedure_type',  patterns: [/^procedure\s*type$/] }
];

const AUDIT_HEADER_PATTERNS = [
  /match\s*status$/,
  /^remarks?$/,
  /^notes?$/,
  /^status$/
];

function buildHeaderIndex(headerRow) {
  const idx = {};
  const auditCols = [];
  const unknownCols = [];
  const used = new Set();

  for (let col = 0; col < headerRow.length; col++) {
    const h = hnorm(headerRow[col]);
    if (!h) continue;

    let matched = false;
    for (const entry of HEADER_MAP) {
      if (used.has(entry.field)) continue;
      if (idx[entry.field] != null) continue;
      if (entry.patterns.some(rx => rx.test(h))) {
        idx[entry.field] = col;
        used.add(entry.field);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (AUDIT_HEADER_PATTERNS.some(rx => rx.test(h))) {
      auditCols.push({ col, header: headerRow[col] });
    } else {
      unknownCols.push({ col, header: headerRow[col] });
    }
  }
  return { idx, auditCols, unknownCols };
}

function parseProjectSheet(ws) {
  if (!ws) return { rows: [], headerDiagnostic: null };
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (raw.length < 2) return { rows: [], headerDiagnostic: null };

  // Field headers sit on row 1 (row 0 is the merged group banner).
  // A few sheets skip the banner — in that case row 0 IS the field header.
  let headerRowIdx = 1;
  let { idx } = buildHeaderIndex(raw[1] || []);
  if (idx.sf_unit == null && idx.sub_project == null) {
    const alt = buildHeaderIndex(raw[0] || []);
    if (alt.idx.sf_unit != null || alt.idx.sub_project != null) {
      headerRowIdx = 0;
      idx = alt.idx;
    }
  }
  const { idx: finalIdx, auditCols, unknownCols } = buildHeaderIndex(raw[headerRowIdx] || []);

  const rows = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const sfUnit  = finalIdx.sf_unit  != null ? r[finalIdx.sf_unit]  : null;
    const dldUnit = finalIdx.dld_unit != null ? r[finalIdx.dld_unit] : null;
    if (!sfUnit && !dldUnit) continue;

    rows.push({
      sub_project:     finalIdx.sub_project     != null ? r[finalIdx.sub_project]                    : null,
      sf_unit:         sfUnit,
      sf_booking_name: finalIdx.sf_booking_name != null ? r[finalIdx.sf_booking_name]                : null,
      sf_applicant:    finalIdx.sf_applicant    != null ? r[finalIdx.sf_applicant]                   : null,
      sf_price:        finalIdx.sf_price        != null ? toNum(r[finalIdx.sf_price])                : null,
      dld_unit:        dldUnit == null ? null : String(dldUnit),
      size:            finalIdx.size            != null ? toNum(r[finalIdx.size])                    : null,
      rooms:           finalIdx.rooms           != null ? r[finalIdx.rooms]                          : null,
      details:         finalIdx.details         != null && r[finalIdx.details] != null ? String(r[finalIdx.details]) : null,
      name_match:      finalIdx.name_match      != null ? asAuditFlag(r[finalIdx.name_match])        : null,
      price_match:     finalIdx.price_match     != null ? asAuditFlag(r[finalIdx.price_match])       : null,
      count_customers: finalIdx.count_customers != null ? toInt(r[finalIdx.count_customers])         : null,
      procedure_type:  finalIdx.procedure_type  != null ? r[finalIdx.procedure_type]                 : null
    });
  }

  return {
    rows,
    headerDiagnostic: {
      headerRow: raw[headerRowIdx],
      mapped: finalIdx,
      droppedAudit: auditCols,
      droppedUnknown: unknownCols
    }
  };
}

module.exports = {
  sha256OfFile, normName, normNameStripSobha, normUnit, stripProjectPrefix,
  toNum, toInt, asAuditFlag, inferProjectId, hnorm, buildHeaderIndex,
  parseProjectSheet, HEADER_MAP, AUDIT_HEADER_PATTERNS
};
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 67` (56 + 11 new).

- [ ] **Step 5: Commit**

```bash
git add src/import-audit.js test/import-audit.test.js
git commit -m "feat: import-audit core helpers (parsing + flag coercion)

Adds asAuditFlag (TRUE/FALSE/YES/NO/Y/N → 1/0/null), normName /
normNameStripSobha (sheet-name normalization), buildHeaderIndex
(regex-based header → field mapping), parseProjectSheet (handles
banner-row-0 and headers-on-row-1 layouts), inferProjectId
(three-pass fuzzy match against dld_project.project_name).

Tracks unknown / audit-only headers separately for the diagnostic
log. Reads TRUE/FALSE audit columns as name_match/price_match —
the p-charter version silenced these in 2026-04, we re-enable
them so audit-delta categorization is meaningful."
```

---

## Task 3: `import-audit.js` — `importAuditWorkbook` (writes to DB)

**Files:**
- Modify: `src/import-audit.js` (append the function)
- Modify: `test/import-audit.test.js` (append end-to-end test)

- [ ] **Step 1: Append failing test for `importAuditWorkbook`**

Append to `test/import-audit.test.js`:

```js
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');
const { importAuditWorkbook } = require('../src/import-audit');

function makeAuditFixture(tmpPath) {
  const wb = XLSX.utils.book_new();
  // Project sheet "Test Project 99"
  const aoa = [
    ['Salesforce', null, null, null, null, 'Oqood Data', null, null, 'Checked by Registrations Team', null],
    ['Sub Project', 'Unit', 'Booking Name', 'Primary Applicant Name', 'Purchase Price', 'DLD Unit', 'Roons', 'All Details', 'Name in SF Compared to DLD System', 'Purchase Price in SF Compared to DLD System'],
    ['Test Sub', 'A-1', 'B-1', 'JOHN DOE', 1000000, '1', '1 B/R', 'JOHN DOE (50.0 F.T.) ...', 'TRUE', 'TRUE'],
    ['Test Sub', 'A-2', 'B-2', 'JANE DOE', 2000000, '2', '2 B/R', 'JANE DOE (80.0 F.T.) ...', 'FALSE', 'TRUE']
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'Test Project 99');
  // The "Report" sheet should be skipped
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ignored']]), 'Report');
  XLSX.writeFile(wb, tmpPath);
}

test('importAuditWorkbook writes snapshot/project/row tables and skips the Report sheet', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'Test Project')").run();

  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const res = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04', note: 'unit-test' });
    assert.equal(res.status, 'ok');
    assert.equal(res.projects, 1, 'expected 1 project (Report sheet skipped)');
    assert.equal(res.matchedProjects, 1);
    assert.equal(res.inserted, 2);

    const snap = db.prepare('SELECT * FROM manual_audit_snapshot WHERE manual_audit_snapshot_id = ?').get(res.manualAuditSnapshotId);
    assert.equal(snap.as_of_month, '2026-04');
    assert.equal(snap.total_rows, 2);

    const rows = db.prepare('SELECT * FROM manual_audit_row ORDER BY manual_audit_row_id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sf_applicant, 'JOHN DOE');
    assert.equal(rows[0].name_match, 1);
    assert.equal(rows[0].price_match, 1);
    assert.equal(rows[1].name_match, 0, 'expected FALSE → 0');
    assert.equal(rows[1].price_match, 1);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('importAuditWorkbook returns duplicate when same file re-imported', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const r1 = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    assert.equal(r1.status, 'ok');
    const r2 = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    assert.equal(r2.status, 'duplicate');
    assert.equal(r2.manualAuditSnapshotId, r1.manualAuditSnapshotId);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('importAuditWorkbook computes name_false_count / price_false_count / both_true_count', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  const tmp = path.join(os.tmpdir(), 'dlp-audit-test-' + Date.now() + '.xlsx');
  makeAuditFixture(tmp);
  try {
    const res = importAuditWorkbook({ db, filePath: tmp, asOfMonth: '2026-04' });
    const proj = db.prepare('SELECT * FROM manual_audit_project WHERE manual_audit_snapshot_id = ?').get(res.manualAuditSnapshotId);
    // Fixture: row 1 = TRUE/TRUE, row 2 = FALSE/TRUE
    assert.equal(proj.row_count, 2);
    assert.equal(proj.name_false_count, 1);
    assert.equal(proj.price_false_count, 0);
    assert.equal(proj.both_true_count, 1);
    assert.equal(proj.blank_count, 0);
  } finally {
    fs.unlinkSync(tmp);
  }
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ fail` increases (importAuditWorkbook not exported yet).

- [ ] **Step 3: Append the function to `src/import-audit.js`**

Add this just before the existing `module.exports`:

```js
function defaultLastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function summarizeAuditFlags(rows) {
  let nameFalse = 0, priceFalse = 0, bothTrue = 0, blank = 0;
  for (const r of rows) {
    const nm = r.name_match, pm = r.price_match;
    if (nm == null && pm == null) blank++;
    if (nm === 0) nameFalse++;
    if (pm === 0) priceFalse++;
    if (nm === 1 && pm === 1) bothTrue++;
  }
  return { name_false_count: nameFalse, price_false_count: priceFalse, both_true_count: bothTrue, blank_count: blank };
}

function importAuditWorkbook({ db, filePath, asOfMonth, note, replace }) {
  if (!fs.existsSync(filePath)) throw new Error('file not found: ' + filePath);
  const sha = sha256OfFile(filePath);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const props = wb.Props || {};
  const workbookModifiedAt = props.ModifiedDate ? new Date(props.ModifiedDate).toISOString() : null;
  const workbookModifiedBy = props.LastAuthor || null;
  const month = asOfMonth || defaultLastMonth();

  const existing = db.prepare('SELECT manual_audit_snapshot_id FROM manual_audit_snapshot WHERE as_of_month = ? AND source_sha256 = ?')
    .get(month, sha);
  if (existing) {
    if (!replace) {
      return { status: 'duplicate', manualAuditSnapshotId: existing.manual_audit_snapshot_id, asOfMonth: month };
    }
    db.prepare('DELETE FROM manual_audit_snapshot WHERE manual_audit_snapshot_id = ?').run(existing.manual_audit_snapshot_id);
  }

  const projectResults = [];
  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Report') continue;
    const ws = wb.Sheets[sheetName];
    const { rows, headerDiagnostic } = parseProjectSheet(ws);
    projectResults.push({
      sheetName, rows, headerDiagnostic,
      counts: { row_count: rows.length, ...summarizeAuditFlags(rows) }
    });
  }

  const totalRows = projectResults.reduce((n, p) => n + p.rows.length, 0);

  const insertSnapshot = db.prepare(`
    INSERT INTO manual_audit_snapshot (source_file, source_sha256, as_of_month, workbook_modified_at, workbook_modified_by, total_rows, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProject = db.prepare(`
    INSERT INTO manual_audit_project (manual_audit_snapshot_id, sheet_name, project_name_inferred, project_id, auditor, row_count, name_false_count, price_false_count, both_true_count, blank_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRow = db.prepare(`
    INSERT INTO manual_audit_row (manual_audit_project_id, sub_project, sf_unit, unit_number_norm, sf_booking_name, sf_applicant, sf_price, dld_unit, size, rooms, details, name_match, price_match, count_customers, procedure_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const summary = { inserted: 0, projects: 0, matchedProjects: 0, unmatchedProjects: 0 };

  const tx = db.transaction(() => {
    const snapRes = insertSnapshot.run(path.basename(filePath), sha, month, workbookModifiedAt, workbookModifiedBy, totalRows, note || null);
    const snapId = snapRes.lastInsertRowid;

    for (const pr of projectResults) {
      const { projectId, inferred, prefix } = inferProjectId(db, pr.sheetName);
      pr.projectId = projectId;
      pr.projectName = inferred;

      const pres = insertProject.run(snapId, pr.sheetName, inferred, projectId, null,
        pr.counts.row_count, pr.counts.name_false_count, pr.counts.price_false_count,
        pr.counts.both_true_count, pr.counts.blank_count);
      const pid = pres.lastInsertRowid;

      summary.projects++;
      if (projectId) summary.matchedProjects++; else summary.unmatchedProjects++;

      for (const r of pr.rows) {
        const unitNorm = stripProjectPrefix(r.sf_unit, prefix);
        insertRow.run(pid, r.sub_project || null, r.sf_unit ? String(r.sf_unit) : null, unitNorm,
          r.sf_booking_name || null, r.sf_applicant || null, r.sf_price, r.dld_unit, r.size, r.rooms || null,
          r.details, r.name_match, r.price_match, r.count_customers, r.procedure_type || null);
        summary.inserted++;
      }
    }

    return snapId;
  });

  const snapshotId = tx();

  return {
    status: 'ok',
    manualAuditSnapshotId: snapshotId,
    asOfMonth: month,
    workbookModifiedAt,
    workbookModifiedBy,
    ...summary,
    projectResults
  };
}
```

Update the existing `module.exports`:

```js
module.exports = {
  sha256OfFile, normName, normNameStripSobha, normUnit, stripProjectPrefix,
  toNum, toInt, asAuditFlag, inferProjectId, hnorm, buildHeaderIndex,
  parseProjectSheet, HEADER_MAP, AUDIT_HEADER_PATTERNS,
  importAuditWorkbook, summarizeAuditFlags
};
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 70` (67 + 3 new), `ℹ fail 0`.

- [ ] **Step 5: Smoke test against the real workbook**

Run:
```
node -e "const Database=require('better-sqlite3');const fs=require('fs');const {importAuditWorkbook}=require('./src/import-audit');const db=new Database(':memory:');db.exec(fs.readFileSync('db/schema.sql','utf8'));const res=importAuditWorkbook({db,filePath:'C:/Users/ali.alghumlasi/Downloads/Projects Verification updated - 2026 - DONE 4 (1).xlsx',asOfMonth:'2026-04'});console.log('status:',res.status);console.log('projects:',res.projects);console.log('matched:',res.matchedProjects);console.log('unmatched:',res.unmatchedProjects);console.log('rows:',res.inserted);"
```
Expected: ~40 projects, most matched (some sheets like "The Crest 1518" may not have a corresponding dld_project in this DB), ~6,000+ rows.

- [ ] **Step 6: Commit**

```bash
git add src/import-audit.js test/import-audit.test.js
git commit -m "feat: importAuditWorkbook writes snapshot/project/row to DB

Reads each project sheet, skips 'Report', writes a manual_audit_snapshot
+ manual_audit_project (one per sheet) + manual_audit_row (one per
booking). De-duplicates on (as_of_month, source_sha256). Computes
per-project flag counts (name_false / price_false / both_true /
blank) for the project row. Single transaction for the whole workbook
so a partial failure leaves no orphan rows."
```

---

## Task 4: `audit-delta.js` core (categorize + buildProjectDelta)

**Files:**
- Create: `src/audit-delta.js`
- Create: `test/audit-delta.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/audit-delta.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { categorize, buildProjectDelta, summarize } = require('../src/audit-delta');

test('categorize returns AGREE_MATCH when manual TRUE/TRUE and tool MATCH', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, { match_status: 'MATCH' }), 'AGREE_MATCH');
});

test('categorize returns AGREE_MISMATCH when manual has any FALSE and tool not MATCH', () => {
  assert.equal(categorize({ name_match: 0, price_match: 1 }, { match_status: 'BUYER_MISMATCH' }), 'AGREE_MISMATCH');
  assert.equal(categorize({ name_match: 1, price_match: 0 }, { match_status: 'PRICE_UP' }), 'AGREE_MISMATCH');
});

test('categorize returns TOOL_SOLVED when manual FALSE but tool MATCH', () => {
  assert.equal(categorize({ name_match: 0, price_match: 1 }, { match_status: 'MATCH' }), 'TOOL_SOLVED');
});

test('categorize returns TOOL_STRICTER when manual TRUE/TRUE but tool not MATCH', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, { match_status: 'BUYER_MISMATCH' }), 'TOOL_STRICTER');
});

test('categorize returns MANUAL_ONLY when only manual side present', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, null), 'MANUAL_ONLY');
});

test('categorize returns DL_ONLY when only tool side present', () => {
  assert.equal(categorize(null, { match_status: 'MATCH' }), 'DL_ONLY');
});

test('categorize returns MANUAL_BLANK when manual flags are both null', () => {
  assert.equal(categorize({ name_match: null, price_match: null }, { match_status: 'MATCH' }), 'MANUAL_BLANK');
});

test('summarize counts categories', () => {
  const rows = [
    { delta_category: 'AGREE_MATCH' },
    { delta_category: 'AGREE_MATCH' },
    { delta_category: 'TOOL_STRICTER' },
    { delta_category: 'DL_ONLY' }
  ];
  const c = summarize(rows);
  assert.equal(c.AGREE_MATCH, 2);
  assert.equal(c.TOOL_STRICTER, 1);
  assert.equal(c.DL_ONLY, 1);
  assert.equal(c.MANUAL_ONLY, 0);
});

test('buildProjectDelta joins tool and manual rows by unit identifier', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'P')").run();
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sub', 'X', 'Proj', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 't.csv')").run();
  db.prepare("INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, 'sf.xlsx')").run();
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Proj', 'Sub', 'X-101', 'X-101', 'JOHN DOE', 1000000)`).run();
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm) VALUES (1, 1, 1, '101', '101')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 1, 'Sale', '2026-01-01', 'JOHN DOE', 1000000)`).run();

  // Manual audit data (auditor said TRUE/TRUE for X-101)
  db.prepare(`INSERT INTO manual_audit_snapshot (manual_audit_snapshot_id, source_file, as_of_month, total_rows) VALUES (1, 'audit.xlsx', '2026-04', 1)`).run();
  db.prepare(`INSERT INTO manual_audit_project (manual_audit_project_id, manual_audit_snapshot_id, sheet_name, project_id, row_count) VALUES (1, 1, 'P', 1, 1)`).run();
  db.prepare(`INSERT INTO manual_audit_row (manual_audit_project_id, sf_unit, unit_number_norm, dld_unit, sf_applicant, sf_price, name_match, price_match) VALUES (1, 'X-101', '101', '101', 'JOHN DOE', 1000000, 1, 1)`).run();

  const d = buildProjectDelta(db, 1, 1);
  assert.equal(d.status, 'ok');
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].delta_category, 'AGREE_MATCH');
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: failures (file doesn't exist).

- [ ] **Step 3: Create `src/audit-delta.js`**

Create `src/audit-delta.js`:

```js
const fs = require('fs');
const path = require('path');
const { compareProject } = require('./compare');

const CATEGORY_LABEL = {
  AGREE_MATCH:    'Agree · match',
  AGREE_MISMATCH: 'Agree · mismatch',
  TOOL_SOLVED:    'Tool solved',
  TOOL_STRICTER:  'Tool flagged',
  MANUAL_ONLY:    'Manual only',
  DL_ONLY:        'Tool only',
  MANUAL_BLANK:   'Auditor blank'
};

const CATEGORY_CLASS = {
  AGREE_MATCH:    'ok',
  AGREE_MISMATCH: 'warn',
  TOOL_SOLVED:    'up',
  TOOL_STRICTER:  'down',
  MANUAL_ONLY:    'sf',
  DL_ONLY:        'dld',
  MANUAL_BLANK:   'flat'
};

function categorize(m, t) {
  if (m && !t) return 'MANUAL_ONLY';
  if (!m && t) return 'DL_ONLY';
  if (!m && !t) return 'MANUAL_BLANK';
  const manBlank = m.name_match == null && m.price_match == null;
  if (manBlank) return 'MANUAL_BLANK';
  const manYes = m.name_match === 1 && m.price_match === 1;
  const manNo  = m.name_match === 0 || m.price_match === 0;
  const toolMatch = t.match_status === 'MATCH';
  if (manYes && toolMatch)  return 'AGREE_MATCH';
  if (manNo  && !toolMatch) return 'AGREE_MISMATCH';
  if (manNo  && toolMatch)  return 'TOOL_SOLVED';
  if (manYes && !toolMatch) return 'TOOL_STRICTER';
  return 'AGREE_MATCH';
}

function up(s) { return s == null ? '' : String(s).toUpperCase().trim(); }

function makeDeltaRow(m, t) {
  return {
    unit_number_norm: (t && t.unit_number_norm) || (m && m.unit_number_norm) || null,
    sf_unit:          (m && m.sf_unit) || (t && t.sf_unit) || (t && t.expected_sf_unit) || null,
    dld_unit:         (t && t.dld_unit_number) || (m && m.dld_unit) || null,
    m_name_match:     m ? m.name_match  : null,
    m_price_match:    m ? m.price_match : null,
    m_sf_applicant:   m ? m.sf_applicant : null,
    m_sf_price:       m ? m.sf_price : null,
    m_details:        m ? m.details : null,
    m_procedure:      m ? m.procedure_type : null,
    m_booking_name:   m ? m.sf_booking_name : null,
    t_match_status:   t ? t.match_status : null,
    t_match_reasons:  t ? t.match_reasons : null,
    t_dld_buyer:      t ? t.dld_purchase_party : null,
    t_sf_applicant:   t ? t.sf_applicant : null,
    t_dld_price:      t ? t.dld_purchase_amount : null,
    t_sf_price:       t ? t.sf_purchase_price : null,
    t_price_diff_pct: t ? t.price_diff_pct : null,
    delta_category:   categorize(m, t)
  };
}

function buildProjectDelta(db, projectId, manualSnapshotId) {
  const toolResult = compareProject(db, projectId);
  if (toolResult.status !== 'ok') return { status: toolResult.status, rows: [] };

  const manualRows = db.prepare(`
    SELECT r.*
    FROM manual_audit_row r
    JOIN manual_audit_project p ON p.manual_audit_project_id = r.manual_audit_project_id
    WHERE p.manual_audit_snapshot_id = ? AND p.project_id = ?
  `).all(manualSnapshotId, projectId);

  const manualIdx = new Map();
  const addKey = (k, m) => { if (k && !manualIdx.has(k)) manualIdx.set(k, m); };
  for (const m of manualRows) {
    addKey(up(m.unit_number_norm), m);
    addKey(up(m.sf_unit), m);
    addKey(up(m.dld_unit), m);
  }

  const rows = [];
  const usedManual = new Set();

  for (const t of toolResult.rows) {
    const candidates = [
      up(t.unit_number_norm),
      up(t.expected_sf_unit),
      up(t.sf_unit),
      up(t.dld_unit_number)
    ].filter(Boolean);
    let m = null;
    for (const k of candidates) {
      const hit = manualIdx.get(k);
      if (hit) { m = hit; break; }
    }
    if (m) usedManual.add(m);
    rows.push(makeDeltaRow(m, t));
  }

  for (const m of manualRows) {
    if (!usedManual.has(m)) rows.push(makeDeltaRow(m, null));
  }

  return { status: 'ok', rows };
}

function summarize(rows) {
  const c = { AGREE_MATCH: 0, AGREE_MISMATCH: 0, TOOL_SOLVED: 0, TOOL_STRICTER: 0, MANUAL_ONLY: 0, DL_ONLY: 0, MANUAL_BLANK: 0 };
  for (const r of rows) c[r.delta_category] = (c[r.delta_category] || 0) + 1;
  return c;
}

module.exports = {
  categorize, buildProjectDelta, summarize, makeDeltaRow,
  CATEGORY_LABEL, CATEGORY_CLASS
};
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 79` (70 + 9 new), `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/audit-delta.js test/audit-delta.test.js
git commit -m "feat: audit-delta core — categorize + buildProjectDelta

categorize maps a (manual_row, tool_row) pair into one of seven buckets:
AGREE_MATCH, AGREE_MISMATCH, TOOL_SOLVED, TOOL_STRICTER, MANUAL_ONLY,
DL_ONLY, MANUAL_BLANK. TOOL_STRICTER is the actionable bucket — rows the
auditor cleared but the tool still flags.

buildProjectDelta runs compareProject(db, projectId), pulls all manual
audit rows for that project from the latest snapshot, and joins them
by unit_number_norm OR sf_unit OR dld_unit (multi-key, first-wins) so
the join works regardless of which side has the canonical unit form."
```

---

## Task 5: `audit-delta.js` writers (HTML + CSV) + `runAuditDelta`

**Files:**
- Modify: `src/audit-delta.js` (append writers + entrypoint)

- [ ] **Step 1: Append CSV + HTML writers + runAuditDelta**

Append to `src/audit-delta.js`, just before the `module.exports`:

```js
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null || v === '') return '';
  return Math.round(+v).toLocaleString();
}

function csvEsc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeAuditDeltaCsv(outPath, projectName, rows) {
  const header = [
    'project','delta_category','sf_unit','dld_unit',
    'manual_name_match','manual_price_match','manual_sf_applicant','manual_sf_price','manual_procedure',
    'tool_match_status','tool_match_reasons','tool_dld_buyer','tool_sf_applicant','tool_dld_price','tool_sf_price','tool_price_diff_pct'
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      projectName, r.delta_category, r.sf_unit, r.dld_unit,
      r.m_name_match, r.m_price_match, r.m_sf_applicant, r.m_sf_price, r.m_procedure,
      r.t_match_status, r.t_match_reasons, r.t_dld_buyer, r.t_sf_applicant, r.t_dld_price, r.t_sf_price, r.t_price_diff_pct
    ].map(csvEsc).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
}

function writeAuditDeltaHtml(outPath, projectName, rows, manualSnapshot) {
  const counts = summarize(rows);
  const total = rows.length;
  const pct = n => total ? ((n * 100) / total).toFixed(1) + '%' : '0%';
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const renderCell = v => v == null ? '' : escHtml(v);
  const renderFlag = v => v == null ? '<span class="flat">—</span>' : (v === 1 ? '<span class="ok">✓</span>' : '<span class="down">✗</span>');

  const bodyHtml = rows.map(r => {
    const search = [r.sf_unit, r.dld_unit, r.m_sf_applicant, r.t_dld_buyer, r.t_sf_applicant, r.t_match_reasons, r.delta_category]
      .filter(Boolean).join(' ').toLowerCase();
    return `<tr class="${CATEGORY_CLASS[r.delta_category] || ''}" data-cat="${escHtml(r.delta_category)}" data-search="${escHtml(search)}">` +
      `<td><span class="badge ${CATEGORY_CLASS[r.delta_category] || ''}">${escHtml(CATEGORY_LABEL[r.delta_category] || r.delta_category)}</span></td>` +
      `<td>${renderCell(r.sf_unit)}</td>` +
      `<td>${renderCell(r.dld_unit)}</td>` +
      `<td class="num">${renderFlag(r.m_name_match)}</td>` +
      `<td class="num">${renderFlag(r.m_price_match)}</td>` +
      `<td>${renderCell(r.m_sf_applicant)}</td>` +
      `<td class="num">${fmtMoney(r.m_sf_price)}</td>` +
      `<td>${renderCell(r.t_match_status)}</td>` +
      `<td>${renderCell(r.t_match_reasons)}</td>` +
      `<td>${renderCell(r.t_dld_buyer)}</td>` +
      `<td>${renderCell(r.t_sf_applicant)}</td>` +
      `<td class="num">${fmtMoney(r.t_dld_price)}</td>` +
      `<td class="num">${fmtMoney(r.t_sf_price)}</td>` +
      `</tr>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(projectName)} — Audit Delta</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:20px 24px;background:#0b0f14;color:#e6e6e6}
  h1{margin:0 0 4px;color:#fff;font-size:22px}
  .meta{color:#888;margin-bottom:14px;font-size:12px}
  .meta b{color:#ccc}
  .controls{display:flex;gap:8px;margin:12px 0 14px;align-items:center;flex-wrap:wrap}
  .search{background:#0f141b;color:#fff;border:1px solid #222;padding:8px 12px;border-radius:6px;min-width:320px;font:inherit;outline:none}
  .chip{padding:6px 12px;border-radius:20px;font-weight:600;cursor:pointer;border:2px solid transparent;font-size:12px;user-select:none}
  .chip:hover{filter:brightness(1.25)}
  .chip.off{opacity:.28;filter:grayscale(.4)}
  .chip.ok{background:#0d3a1d;color:#4ce38e}
  .chip.up{background:#0f3a2f;color:#5cf0aa}
  .chip.down{background:#3a0f1a;color:#ff7fa6}
  .chip.warn{background:#3a2a0d;color:#ffcc55}
  .chip.dld{background:#0d2d3a;color:#5ad4ff}
  .chip.sf{background:#2d0d3a;color:#d88eff}
  .chip.flat{background:#1c1f25;color:#888}
  .count{color:#888;margin-left:auto;font-size:12px}
  .count b{color:#fff}
  .table-wrap{overflow-x:auto;border:1px solid #1b2028;border-radius:8px;background:#0d1218}
  table{width:100%;border-collapse:collapse;font-size:12px;min-width:1400px}
  thead th{background:#11161d;color:#aaa;font-weight:600;text-align:left;padding:8px 10px;border-bottom:2px solid #1f252e;position:sticky;top:0}
  tbody td{padding:6px 10px;border-bottom:1px solid #1a1f27;vertical-align:top;white-space:nowrap}
  tbody td.num{text-align:right;font-variant-numeric:tabular-nums}
  tbody tr.hidden{display:none}
  tbody tr.ok td{background:rgba(76,227,142,.04)}
  tbody tr.up td{background:rgba(92,240,170,.06)}
  tbody tr.down td{background:rgba(255,127,166,.06)}
  tbody tr.warn td{background:rgba(255,204,85,.05)}
  tbody tr.dld td{background:rgba(90,212,255,.05)}
  tbody tr.sf td{background:rgba(216,142,255,.05)}
  tbody tr.flat td{background:rgba(140,140,140,.04)}
  tbody tr:hover td{background:#151b24 !important}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge.ok{background:#0d3a1d;color:#4ce38e}
  .badge.up{background:#0f3a2f;color:#5cf0aa}
  .badge.down{background:#3a0f1a;color:#ff7fa6}
  .badge.warn{background:#3a2a0d;color:#ffcc55}
  .badge.dld{background:#0d2d3a;color:#5ad4ff}
  .badge.sf{background:#2d0d3a;color:#d88eff}
  .badge.flat{background:#1c1f25;color:#aaa}
  .ok{color:#4ce38e}.down{color:#ff6b88}.flat{color:#666}
  footer{margin-top:14px;color:#555;font-size:11px;text-align:right}
</style>
</head>
<body>
<h1>${escHtml(projectName)} — Audit Delta</h1>
<div class="meta">
  <b>As-of ${escHtml(manualSnapshot.as_of_month || '')}</b>
  &nbsp;·&nbsp; Source: <b>${escHtml(manualSnapshot.source_file || '')}</b>
  &nbsp;·&nbsp; ${total.toLocaleString()} unit-level deltas
</div>
<div class="controls">
  <input class="search" id="q" placeholder="Filter: unit, buyer, status, any text…" autocomplete="off">
  <span class="chip ok off"   data-cat="AGREE_MATCH">AGREE · MATCH ${counts.AGREE_MATCH} (${pct(counts.AGREE_MATCH)})</span>
  <span class="chip warn"     data-cat="AGREE_MISMATCH">AGREE · MISMATCH ${counts.AGREE_MISMATCH} (${pct(counts.AGREE_MISMATCH)})</span>
  <span class="chip up"       data-cat="TOOL_SOLVED">TOOL SOLVED ${counts.TOOL_SOLVED} (${pct(counts.TOOL_SOLVED)})</span>
  <span class="chip down"     data-cat="TOOL_STRICTER">TOOL FLAGGED ⚠ ${counts.TOOL_STRICTER} (${pct(counts.TOOL_STRICTER)})</span>
  <span class="chip sf"       data-cat="MANUAL_ONLY">MANUAL ONLY ${counts.MANUAL_ONLY} (${pct(counts.MANUAL_ONLY)})</span>
  <span class="chip dld"      data-cat="DL_ONLY">TOOL ONLY ${counts.DL_ONLY} (${pct(counts.DL_ONLY)})</span>
  <span class="chip flat"     data-cat="MANUAL_BLANK">BLANK ${counts.MANUAL_BLANK} (${pct(counts.MANUAL_BLANK)})</span>
  <span class="count" id="count">— rows</span>
</div>
<div class="table-wrap">
<table>
<thead><tr>
  <th>Category</th><th>SF Unit</th><th>DLD Unit</th>
  <th class="num">Name?</th><th class="num">Price?</th>
  <th>Manual SF Applicant</th><th class="num">Manual SF Price</th>
  <th>Tool Status</th><th>Tool Reasons</th>
  <th>Tool DLD Buyer</th><th>Tool SF Applicant</th>
  <th class="num">Tool DLD Price</th><th class="num">Tool SF Price</th>
</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div>
<footer>generated ${escHtml(generatedAt)} · click chips to toggle · TOOL FLAGGED ⚠ = likely false-positive worth reviewing</footer>
<script>
(function(){
  const tbody = document.querySelector('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  const q = document.getElementById('q');
  const chips = [...document.querySelectorAll('.chip')];
  const countEl = document.getElementById('count');
  const active = new Set(chips.filter(c => !c.classList.contains('off')).map(c => c.dataset.cat));

  function applyFilter(){
    const needle = q.value.trim().toLowerCase();
    let visible = 0;
    for (const tr of rows) {
      const catOn = active.has(tr.dataset.cat);
      const searchOn = !needle || tr.dataset.search.indexOf(needle) !== -1;
      const show = catOn && searchOn;
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    }
    countEl.innerHTML = '<b>' + visible.toLocaleString() + '</b> / ' + rows.length.toLocaleString() + ' rows';
  }
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const c = chip.dataset.cat;
      if (active.has(c)) { active.delete(c); chip.classList.add('off'); }
      else               { active.add(c);    chip.classList.remove('off'); }
      applyFilter();
    });
  });
  q.addEventListener('input', applyFilter);
  applyFilter();
})();
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function runAuditDelta({ db, projectFilter, outDir = path.join(__dirname, '..', 'output') }) {
  const manualSnapshot = db.prepare('SELECT * FROM manual_audit_snapshot ORDER BY manual_audit_snapshot_id DESC LIMIT 1').get();
  if (!manualSnapshot) {
    throw new Error('runAuditDelta: no manual_audit_snapshot found. Run import-audit first.');
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Distinct project_ids that have audit data in this snapshot.
  let projects = db.prepare(`
    SELECT p.project_id, p.project_name
    FROM dld_project p
    WHERE p.project_id IN (
      SELECT DISTINCT project_id FROM manual_audit_project
        WHERE manual_audit_snapshot_id = ? AND project_id IS NOT NULL
    )
    ORDER BY p.project_name
  `).all(manualSnapshot.manual_audit_snapshot_id);
  if (projectFilter) projects = projects.filter(p => p.project_name === projectFilter);

  const summary = { AGREE_MATCH: 0, AGREE_MISMATCH: 0, TOOL_SOLVED: 0, TOOL_STRICTER: 0, MANUAL_ONLY: 0, DL_ONLY: 0, MANUAL_BLANK: 0 };
  const written = [];

  for (const p of projects) {
    const d = buildProjectDelta(db, p.project_id, manualSnapshot.manual_audit_snapshot_id);
    if (d.status !== 'ok') {
      written.push({ project: p.project_name, status: d.status, csv: null, html: null });
      continue;
    }
    const counts = summarize(d.rows);
    for (const k of Object.keys(summary)) summary[k] += counts[k] || 0;

    const base = safeName(p.project_name);
    const csvPath  = path.join(outDir, base + '.audit-delta.csv');
    const htmlPath = path.join(outDir, base + '.audit-delta.html');
    writeAuditDeltaCsv(csvPath, p.project_name, d.rows);
    writeAuditDeltaHtml(htmlPath, p.project_name, d.rows, manualSnapshot);
    written.push({ project: p.project_name, status: 'ok', total: d.rows.length, counts, csv: csvPath, html: htmlPath });
  }

  return { manualSnapshot, projectsRun: projects.length, summary, written };
}
```

Update the existing `module.exports`:

```js
module.exports = {
  categorize, buildProjectDelta, summarize, makeDeltaRow,
  writeAuditDeltaCsv, writeAuditDeltaHtml, runAuditDelta, safeName,
  CATEGORY_LABEL, CATEGORY_CLASS
};
```

- [ ] **Step 2: Run tests — confirm green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 79`, `ℹ fail 0`. (No new tests added in this task — writers exercised by the smoke test in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add src/audit-delta.js
git commit -m "feat: audit-delta writers — CSV + HTML + runAuditDelta entrypoint

writeAuditDeltaCsv: one row per (manual, tool) pair with both sides'
columns + delta_category. writeAuditDeltaHtml: dark-theme styling
matching existing compare HTML; chip filters per category;
AGREE_MATCH chip default off so reviewers see actionable rows first;
TOOL_STRICTER labelled 'TOOL FLAGGED ⚠' as the actionable bucket.

runAuditDelta: queries the latest manual_audit_snapshot, runs
buildProjectDelta + writers per project that has audit data, returns
a summary across all projects."
```

---

## Task 6: `audit-report.js` — add latest-audit-snapshot block

**Files:**
- Modify: `src/audit-report.js`
- Modify: `test/audit-report.test.js`

- [ ] **Step 1: Append failing test**

Append to `test/audit-report.test.js`:

```js
test('runAudit reports the latest audit snapshot when one exists', () => {
  const db = setupDb();
  db.prepare(`INSERT INTO manual_audit_snapshot (manual_audit_snapshot_id, source_file, as_of_month, total_rows) VALUES (1, 'audit.xlsx', '2026-04', 6128)`).run();

  const out = captureStream();
  const result = runAudit({ db, out });
  const text = out.toString();
  assert.ok(text.includes('AUDIT WORKBOOK'), 'expected AUDIT WORKBOOK section');
  assert.ok(text.includes('audit.xlsx'));
  assert.ok(text.includes('2026-04'));
  assert.ok(text.includes('6,128'));
  assert.equal(result.auditSnapshotId, 1);
  assert.equal(result.auditRows, 6128);
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ fail 1`.

- [ ] **Step 3: Modify `src/audit-report.js`**

In `src/audit-report.js`, find the existing `▸ MAPPING COVERAGE` section. Just BEFORE the `▸ PER-PROJECT MAPPING` section, insert a new block:

```js
  const auditSnap = db.prepare('SELECT * FROM manual_audit_snapshot ORDER BY manual_audit_snapshot_id DESC LIMIT 1').get();
  println('▸ AUDIT WORKBOOK');
  if (auditSnap) {
    println('  Imported snapshot:     #' + auditSnap.manual_audit_snapshot_id + ' — ' + auditSnap.source_file);
    println('  As-of month:           ' + auditSnap.as_of_month);
    println('  Audit rows:            ' + (auditSnap.total_rows || 0).toLocaleString());
    if (auditSnap.workbook_modified_by) {
      println('  Workbook modified:     ' + (auditSnap.workbook_modified_at || '-') + ' by ' + auditSnap.workbook_modified_by);
    }
  } else {
    println('  (none yet — run import-audit)');
  }
  println('');
```

In the same file, find the `return { ... }` at the end of `runAudit` and add the two new headline fields:

```js
  return {
    dldProjects:      dldProj,
    dldUnits:         dldUnit,
    sfBookings:       sfRows,
    mappedProjects:   mappedCount,
    unmappedProjects: unmappedCount,
    auditSnapshotId:  auditSnap ? auditSnap.manual_audit_snapshot_id : null,
    auditRows:        auditSnap ? (auditSnap.total_rows || 0) : 0
  };
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 80` (79 + 1), `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/audit-report.js test/audit-report.test.js
git commit -m "feat: audit-report shows latest audit-workbook snapshot info

Adds a 'AUDIT WORKBOOK' section to runAudit: snapshot id, filename,
as-of month, row count, optional workbook-modified-by metadata. The
returned headline object gains auditSnapshotId and auditRows."
```

---

## Task 7: CLI subcommands in `index.js` + menu entries in `src/menu.js`

**Files:**
- Modify: `index.js`
- Modify: `src/menu.js`

- [ ] **Step 1: Read the current `index.js` argv switch**

Run: `grep -n "switch\|case '" index.js | head -20`
Expected: visible cases for `parse`, `import`, `import-sf`, `compare`, `diff`, `projects`, `status`.

- [ ] **Step 2: Add the two new CLI cases**

In `index.js`, find the `switch (cmd)` block. Add two new cases alongside `import-sf` / `compare`:

```js
case 'import-audit': {
  const filePath = process.argv[3];
  if (!filePath) { console.error('usage: import-audit <xlsx-file>'); process.exit(1); }
  const { importAuditWorkbook } = require('./src/import-audit');
  const { openDb } = require('./src/db');
  const db = openDb();
  try {
    const res = importAuditWorkbook({ db, filePath });
    if (res.status === 'duplicate') {
      console.log('  -> already imported (snapshot #' + res.manualAuditSnapshotId + ', as-of ' + res.asOfMonth + ')');
    } else {
      console.log('  -> snapshot #' + res.manualAuditSnapshotId + ' (as-of ' + res.asOfMonth + ')');
      console.log('     projects: ' + res.projects + '  (matched ' + res.matchedProjects + ', unmatched ' + res.unmatchedProjects + ')');
      console.log('     rows imported: ' + res.inserted);
    }
  } finally { db.close(); }
  break;
}
case 'audit-delta': {
  const filter = process.argv[3] || null;
  const { runAuditDelta } = require('./src/audit-delta');
  const { openDb } = require('./src/db');
  const db = openDb();
  try {
    const res = runAuditDelta({ db, projectFilter: filter });
    console.log('  -> ' + res.projectsRun + ' projects with audit data');
    for (const w of res.written) {
      if (w.status === 'ok') {
        console.log('     ' + w.project + ': agree ' + w.counts.AGREE_MATCH + ' / ⚠ tool-flagged ' + w.counts.TOOL_STRICTER + ' / total ' + w.total);
      } else {
        console.log('     ' + w.project + ': skipped (' + w.status + ')');
      }
    }
    console.log('     totals — agree:' + res.summary.AGREE_MATCH + '  tool-flagged:' + res.summary.TOOL_STRICTER + '  manual-only:' + res.summary.MANUAL_ONLY + '  tool-only:' + res.summary.DL_ONLY);
  } finally { db.close(); }
  break;
}
```

If `index.js` prints a usage banner, add the two new commands to it:

```
  node index.js import-audit <xlsx>   import the team's audit workbook
  node index.js audit-delta [name]    cross-check tool vs auditor
```

- [ ] **Step 3: Test the CLI subcommands work**

Run: `node index.js audit-delta 2>&1 | head -3`
Expected: error like `runAuditDelta: no manual_audit_snapshot found` (since we haven't imported the workbook in this DB yet), OR — if a previous import exists — actual output. Either result confirms the subcommand wired in.

- [ ] **Step 4: Add menu entries to `src/menu.js`**

In `src/menu.js`, find the existing `[A] Audit Report` line in `showMenu()` and ADD two lines just below it:

```js
  menuLine('A', 'Audit Report',                 'reconciliation summary + per-project mapping');
  menuLine('U', 'Import Audit Workbook',        'pick the team verification xlsx');
  menuLine('D', 'Audit Delta',                  'tool vs auditor cross-check (HTML + CSV per project)');
```

In the `switch (choice)` block, add two cases alongside `'a': await doAuditReport()`:

```js
        case 'a': await doAuditReport();   break;
        case 'u': await doImportAudit();   break;
        case 'd': await doAuditDeltaMenu(); break;
```

In the same file, just below `doAuditReport` (the function added in Task 5 of the prior plan), add these two new functions:

```js
async function doImportAudit() {
  await showHeader(); sectionHeader('IMPORT AUDIT WORKBOOK');
  const { pickAuditFile } = require('./file-picker');
  const picks = await pickAuditFile();
  if (!picks || picks.length === 0) { console.log('  no file selected.'); await pause(); return; }
  const { importAuditWorkbook } = require('./import-audit');
  const { openDb } = require('./db');
  const db = openDb();
  try {
    const res = importAuditWorkbook({ db, filePath: picks[0] });
    if (res.status === 'duplicate') {
      console.log('  already imported (snapshot #' + res.manualAuditSnapshotId + ', as-of ' + res.asOfMonth + ')');
    } else {
      console.log('  snapshot #' + res.manualAuditSnapshotId + '  (as-of ' + res.asOfMonth + ')');
      console.log('  projects: ' + res.projects + '  (matched ' + res.matchedProjects + ', unmatched ' + res.unmatchedProjects + ')');
      console.log('  rows imported: ' + res.inserted);
      const unmatched = (res.projectResults || []).filter(p => !p.projectId);
      if (unmatched.length) {
        console.log('');
        console.log('  unmatched sheets (no DLD project found):');
        for (const u of unmatched) console.log('    - ' + u.sheetName + '  (' + u.rows.length + ' rows)');
      }
    }
  } finally { db.close(); }
  await pause();
}

async function doAuditDeltaMenu() {
  await showHeader(); sectionHeader('AUDIT DELTA');
  const { runAuditDelta } = require('./audit-delta');
  const { openDb } = require('./db');
  const db = openDb();
  try {
    const res = runAuditDelta({ db });
    console.log('  ' + res.projectsRun + ' projects with audit data');
    console.log('  ' + '-'.repeat(73));
    for (const w of res.written) {
      if (w.status === 'ok') {
        console.log('  ' + w.project.padEnd(45).slice(0, 45) +
          '  agree:' + String(w.counts.AGREE_MATCH).padStart(5) +
          '  ⚠:' + String(w.counts.TOOL_STRICTER).padStart(4) +
          '  total:' + String(w.total).padStart(5));
      } else {
        console.log('  ' + w.project + '  (' + w.status + ')');
      }
    }
    console.log('  ' + '-'.repeat(73));
    console.log('  totals — agree:' + res.summary.AGREE_MATCH +
      '  tool-flagged:' + res.summary.TOOL_STRICTER +
      '  manual-only:' + res.summary.MANUAL_ONLY +
      '  tool-only:' + res.summary.DL_ONLY);
    console.log('');
    console.log('  HTML files written to output/<project>.audit-delta.html');
  } catch (e) {
    console.log('  error: ' + e.message);
  } finally { db.close(); }
  await pause();
}
```

- [ ] **Step 5: Verify menu loads**

Run: `node -e "require('./src/menu.js'); console.log('menu loads OK')"`
Expected: `menu loads OK`.

- [ ] **Step 6: Run all tests**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 80`, `ℹ fail 0`. The CLI/menu wiring isn't covered by tests but the modules they call are.

- [ ] **Step 7: Commit**

```bash
git add index.js src/menu.js
git commit -m "feat: CLI + menu wiring for import-audit and audit-delta

CLI: 'node index.js import-audit <xlsx>' and 'node index.js audit-delta
[project]'. Menu: [U] Import Audit Workbook, [D] Audit Delta. Menu
diagnostic shows per-project agree / tool-flagged / total counts and
flags any unmatched sheets after import."
```

---

## Task 8: end-to-end smoke test against the real workbook

**Files:** none (runtime verification only)

- [ ] **Step 1: Import the team's actual workbook**

Run:
```
node index.js import-audit "C:/Users/ali.alghumlasi/Downloads/Projects Verification updated - 2026 - DONE 4 (1).xlsx"
```

Expected: `snapshot #1  (as-of 2026-XX)`, `projects: 40`, `matched: 35-37, unmatched: 0-3`, `rows imported: 6,000+`.

- [ ] **Step 2: Run audit-delta against all projects**

Run:
```
node index.js audit-delta 2>&1 | head -50
```

Expected: per-project summary lines with agree / tool-flagged / total counts, then totals line. The TOOL_STRICTER (`⚠:`) numbers are the actionable counts.

- [ ] **Step 3: Inspect one project's HTML**

Run: `ls output/*.audit-delta.html | head -5`
Expected: ~35 audit-delta HTML files.

Open `output/Sobha_Hartland_Waves.audit-delta.html` (or whichever has the highest TOOL_STRICTER count) in a browser. Verify:
- Chip filters at top correctly toggle row visibility
- The `AGREE_MATCH` chip is off by default
- Clicking `TOOL FLAGGED ⚠` shows ONLY the rows where the auditor said TRUE/TRUE but the tool flagged BUYER_MISMATCH
- Each row shows manual-side fields on the left (✓ / ✗ icons for the flags), tool-side fields on the right
- The search box filters by buyer name, unit number, etc.

- [ ] **Step 4: Verify audit-report shows the snapshot**

Run: `node index.js status 2>&1 ; node -e "const {openDb}=require('./src/db');const {runAudit}=require('./src/audit-report');const db=openDb();runAudit({db});db.close();"`

Expected: among other sections, an `AUDIT WORKBOOK` block listing the imported file and row count.

- [ ] **Step 5: No commit needed (runtime verification only)**

If anything in steps 1–4 fails or produces unexpected output, fix the underlying code and commit that. Otherwise the branch is ready.

---

## Final Verification

- [ ] **Step 1: Full test suite green**

Run: `npm test 2>&1 | grep "ℹ pass\|ℹ fail" | head -2`
Expected: `ℹ pass 80`, `ℹ fail 0`.

- [ ] **Step 2: Branch has 8 new commits on top**

Run: `git log --oneline feat/dl-processor-improvements ^master | head -25`
Expected: 8 new commits since the audit-workbook spec commit. The audit-delta + import-audit modules + tests + menu wiring + audit-report tweak all visible.

- [ ] **Step 3: Hand off to finishing-a-development-branch**

Invoke `superpowers:finishing-a-development-branch` to merge / push / discard per Ali's choice.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| `import-audit.js` (parse + write tables) | Tasks 2, 3 |
| Read TRUE/FALSE columns into `name_match`/`price_match` | Task 2 (`asAuditFlag`, `HEADER_MAP` entries) |
| `audit-delta.js` (categorize + buildProjectDelta) | Task 4 |
| audit-delta HTML + CSV writers | Task 5 |
| `runAuditDelta` entrypoint | Task 5 |
| `audit-report.js` shows latest snapshot | Task 6 |
| Menu entries `[U]` and `[D]` | Task 7 |
| CLI subcommands `import-audit`, `audit-delta` | Task 7 |
| `pickAuditFile` in file-picker | Task 1 |
| Tests for parse + flag coercion + projectId inference | Tasks 2, 3 |
| Tests for categorization + buildProjectDelta | Task 4 |
| Tests for audit-report addition | Task 6 |
| End-to-end smoke test | Task 8 |
| Schema unchanged | Pre-flight Step 3 verification |

All spec items covered.

**2. Placeholder scan:** No "TBD", "TODO", "implement later" anywhere. All code blocks are complete. The smoke test (Task 8) is a runtime check, not a placeholder — its expected outputs are concrete.

**3. Type consistency:**
- `categorize(m, t)` — same signature in source + tests ✓
- `buildProjectDelta(db, projectId, manualSnapshotId)` — same signature in source + tests ✓
- `importAuditWorkbook({ db, filePath, asOfMonth, note, replace })` — same return shape in tests + CLI + menu ✓
- `runAuditDelta({ db, projectFilter, outDir })` — same return shape in CLI + menu ✓
- `delta_category` values: `AGREE_MATCH`/`AGREE_MISMATCH`/`TOOL_SOLVED`/`TOOL_STRICTER`/`MANUAL_ONLY`/`DL_ONLY`/`MANUAL_BLANK` — consistent across categorize, summarize, HTML, CSV, tests ✓
- `name_match` / `price_match` are `1 | 0 | null` everywhere ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-audit-workbook-integration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks are mostly independent and well-specified — good fit.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
