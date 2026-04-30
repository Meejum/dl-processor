# DL-Processor Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the four remaining correctness/UX issues identified in the 2026-04-30 audit: duplicated bank-pattern definitions, false-positive BUYER_MISMATCH on Arabic transliteration variants, silent data corruption from hardcoded SF column indices, and thin DLD↔SF project mapping.

**Architecture:** Surgical changes within existing files. No new architecture, no new dependencies. Centralize already-extracted bank patterns; rewrite one buyer-name comparison function with TDD; replace hardcoded Salesforce column indices with header-driven lookup; add a fuzzy-token fallback to project name mapping. Tests use Node 18+'s built-in `node:test` runner — no test-framework dependency added.

**Tech Stack:** Node.js 18+, better-sqlite3, xlsx, plain JS (no TS), CommonJS modules, `node:test` for unit tests.

**Pre-flight:**
- Repo: `C:\projects\DL-Processor` (confirmed git repo)
- Already-completed work (Phase 1 from audit) is verified in `src/compare.js` lines 38, 165-181, 280-292, 361, 373-382, 514, 543 — do NOT redo it.
- Plan covers 4 phases (A–D); each phase ends with a commit.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `src/common.js` | exists | Shared bank patterns + parsing helpers (already has `BANK_PATTERNS`/`BANK_PREFIX_RE`/`BANK_SQL_CONDITIONS`) |
| `src/compare.js` | modify | Replace local `BANK_PREFIX_RE` literal with import; rewrite `namesOverlap` |
| `src/overrides.js` | modify | Replace duplicated SQL `LIKE` conditions with `BANK_SQL_CONDITIONS` import |
| `src/salesforce.js` | modify | Header-driven column lookup with fail-fast validation |
| `src/project-mapping.js` | modify | Add fuzzy token-overlap fallback after substring miss |
| `config/project-mapping.json` | modify | Add new project entries (requires user input — see Phase D) |
| `test/names-overlap.test.js` | create | Unit tests for `namesOverlap` |
| `test/project-mapping.test.js` | create | Unit tests for fuzzy fallback |
| `test/salesforce-headers.test.js` | create | Unit tests for header-to-column resolution |
| `package.json` | modify | Add `"test": "node --test test/"` script |

---

## Phase A — Wire Shared Bank Patterns Through compare.js & overrides.js

**Why:** `src/common.js:71-118` already exposes `BANK_PATTERNS`, `BANK_PREFIX_RE`, `BANK_SQL_CONDITIONS`. But `src/compare.js:60` defines its own duplicate `BANK_PREFIX_RE` regex literal, and `src/overrides.js:30-58` hand-codes the same SQL conditions twice. Future bank additions to `common.js` won't propagate.

### Task A1: Replace local BANK_PREFIX_RE in compare.js with the shared import

**Files:**
- Modify: `src/compare.js:1-4` (imports), `src/compare.js:60` (delete local regex)

- [ ] **Step 1: Read the current import block**

Run: `node -e "console.log(require('fs').readFileSync('src/compare.js','utf8').split('\n').slice(0,5).join('\n'))"`
Expected output: lines 1-5 of compare.js including the `require('./project-mapping')` and `require('./overrides')` imports.

- [ ] **Step 2: Add `BANK_PREFIX_RE` to the existing common-module import (or create one)**

`src/compare.js` currently does NOT import from `./common`. Add this require near the top of the file, after the existing requires (line 4 area):

```js
const { BANK_PREFIX_RE } = require('./common');
```

The require block becomes:

```js
const fs = require('fs');
const path = require('path');
const { expectedSfUnit, applyUnitTransforms } = require('./project-mapping');
const { getOverridesMapForProject } = require('./overrides');
const { BANK_PREFIX_RE } = require('./common');
```

- [ ] **Step 3: Delete the duplicate `BANK_PREFIX_RE` literal**

Delete this entire line (currently `src/compare.js:60`):

```js
const BANK_PREFIX_RE = /^(BANK|COMMERCIAL|EMIRATES|DUBAI|ABU DHABI|AJMAN|SHARJAH|AL\s|HSBC|MASHREQ|UNION NATIONAL|FIRST ABU DHABI|FAB|RAK BANK|NATIONAL BANK OF|ENBD|SAMBA|SABB|RIYAD|ARAB |EMIRATES NBD|EMIRATES ISLAMIC)/i;
```

The constants block on lines 53-60 should now end at line 59 with `]);` (the close of `PURCHASE_TX_TYPES`).

- [ ] **Step 4: Smoke test — compare.js still loads**

Run: `node -e "require('./src/compare.js'); console.log('compare loads OK')"`
Expected output: `compare loads OK`
If you get a `BANK_PREFIX_RE is not defined` error, the require statement was not added correctly — re-check Step 2.

### Task A2: Replace hand-coded SQL LIKE block in overrides.js with BANK_SQL_CONDITIONS

**Files:**
- Modify: `src/overrides.js:1` (add require), `src/overrides.js:29-58` (collapse the OR/NOT-LIKE blocks)

- [ ] **Step 1: Add the import at the top of `src/overrides.js`**

Insert as the first non-blank line of the file:

```js
const { BANK_SQL_CONDITIONS } = require('./common');
```

- [ ] **Step 2: Build a paired NOT-LIKE fragment in `src/overrides.js`**

Add this constant immediately below the import:

```js
// NOT-LIKE variant of BANK_SQL_CONDITIONS — used to confirm a unit has NO non-bank tx.
// We mirror the same patterns so additions to BANK_PATTERNS propagate to both clauses.
const { BANK_PATTERNS } = require('./common');
const BANK_SQL_NOT_CONDITIONS = BANK_PATTERNS
  .map(p => p === 'BANK'
    ? `t2.party_name NOT LIKE '%BANK%'`
    : `t2.party_name NOT LIKE '${p.trimEnd()}%'`)
  .join('\n          AND ');
```

- [ ] **Step 3: Replace the OR-block in the WHERE clause**

In `src/overrides.js`, the current `listBankOnlyUnits` function has a hand-coded `AND ( ... LIKE OR LIKE OR ...)` block at lines 29-41 and a parallel `AND NOT EXISTS ( ... NOT LIKE AND NOT LIKE ...)` block at lines 42-58. Replace the SQL string in the prepared statement with this version (full function body shown for clarity):

```js
function listBankOnlyUnits(db, projectId) {
  return db.prepare(`
    WITH latest AS (
      SELECT snapshot_id FROM dld_snapshot WHERE project_id = ?
      ORDER BY imported_at DESC LIMIT 1
    ),
    last_tx AS (
      SELECT t.*,
             ROW_NUMBER() OVER (PARTITION BY t.unit_id ORDER BY t.tx_date_iso DESC, t.tx_id DESC) AS rn
      FROM dld_transaction t
      WHERE t.snapshot_id = (SELECT snapshot_id FROM latest)
    )
    SELECT u.unit_id, u.unit_number, u.unit_number_norm, u.unit_type, u.dld_unit_id,
           b.name AS building_name,
           lt.tx_type   AS last_tx_type,
           lt.tx_date   AS last_tx_date,
           lt.amount_aed AS last_amount,
           lt.party_name AS last_party,
           mo.actual_buyer AS override_buyer,
           mo.notes        AS override_notes,
           mo.updated_at   AS override_updated
    FROM dld_unit u
    JOIN latest ls ON ls.snapshot_id = u.snapshot_id
    LEFT JOIN dld_building b ON b.building_id = u.building_id
    LEFT JOIN last_tx lt ON lt.unit_id = u.unit_id AND lt.rn = 1
    LEFT JOIN manual_override mo ON mo.project_id = u.project_id AND mo.unit_number_norm = u.unit_number_norm
    WHERE u.project_id = ?
      AND lt.party_name IS NOT NULL
      AND (
        ${BANK_SQL_CONDITIONS}
      )
      AND NOT EXISTS (
        SELECT 1 FROM dld_transaction t2
        WHERE t2.unit_id = u.unit_id
          AND t2.party_name IS NOT NULL
          AND t2.party_name <> ''
          AND ${BANK_SQL_NOT_CONDITIONS}
      )
    ORDER BY u.unit_number
  `).all(projectId, projectId);
}
```

Note: the SQL is a single backtick template-literal string, so `${BANK_SQL_CONDITIONS}` is interpolated at module-load time, not at query time — there is no SQL-injection risk because the patterns are literal constants.

- [ ] **Step 4: Smoke test — overrides.js still loads and SQL is well-formed**

Run: `node -e "const o = require('./src/overrides.js'); const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec(require('fs').readFileSync('db/schema.sql','utf8')); o.listBankOnlyUnits(db, 1); console.log('overrides SQL prepared OK')"`
Expected output: `overrides SQL prepared OK` (an empty result set is fine — the test is that the prepared statement parses without SQLite errors).
If you get `near "...": syntax error`, you have a stray `OR` or `AND` — re-check the interpolation.

### Task A3: Commit Phase A

- [ ] **Step 1: Stage and commit**

```bash
git add src/compare.js src/overrides.js
git status
git commit -m "refactor: route compare.js and overrides.js through shared BANK_PATTERNS

Removes duplicated bank-prefix regex from compare.js and duplicated SQL
LIKE/NOT LIKE block from overrides.js. Both now derive from the single
BANK_PATTERNS array in common.js, so future additions propagate."
```

Expected: a single commit with two files modified, no new files.

---

## Phase B — Rewrite namesOverlap (TDD)

**Why:** `src/compare.js:84-93` fails on Arabic transliteration variants (`MOHAMMED` vs `MOHAMMAD`), name-order swaps (`SARAH JANE THOMPSON` vs `THOMPSON SARAH JANE`), and incorrectly **matches** on shared 3-char particles like `BIN`/`AL`/`ABU` — so `AHMED BIN SULTAN` and `HAMAD BIN RASHID` currently return `match` even though they are different people. Each false positive becomes a manual override task; each false negative hides a real reconciliation issue.

### Task B1: Add the test runner script and create the test directory

**Files:**
- Modify: `package.json:9-12` (add `"test"` script)
- Create: `test/` directory

- [ ] **Step 1: Verify Node version supports built-in test runner**

Run: `node --version`
Expected: v18.0.0 or higher. (`package.json:20` already requires `>=18`.)
If lower, stop and tell the user to upgrade Node.

- [ ] **Step 2: Add the test script to `package.json`**

In `package.json`, the `scripts` object currently contains:

```json
"scripts": {
  "start": "node index.js",
  "parse": "node index.js"
},
```

Change it to:

```json
"scripts": {
  "start": "node index.js",
  "parse": "node index.js",
  "test": "node --test test/"
},
```

- [ ] **Step 3: Create the test directory**

Run: `mkdir -p test && ls test`
Expected: empty directory (no error).

- [ ] **Step 4: Verify test runner discovers an empty directory cleanly**

Run: `npm test 2>&1 | head -20`
Expected: passes with `0 tests` (or similar) — the runner does not error on an empty directory.

### Task B2: Write the failing tests for the new namesOverlap behavior

**Files:**
- Create: `test/names-overlap.test.js`

- [ ] **Step 1: Write the test file with all required cases**

Create `test/names-overlap.test.js` with this exact content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { namesOverlap } = require('../src/compare');

test('returns false when either input is empty/null', () => {
  assert.equal(namesOverlap(null, 'JOHN DOE'), false);
  assert.equal(namesOverlap('JOHN DOE', null), false);
  assert.equal(namesOverlap('', 'JOHN DOE'), false);
  assert.equal(namesOverlap('JOHN DOE', ''), false);
});

test('strips English title prefixes before comparing', () => {
  assert.equal(namesOverlap('MR. JOHN DOE', 'JOHN DOE'), true);
  assert.equal(namesOverlap('Dr SARAH SMITH', 'SARAH SMITH'), true);
});

test('matches identical names', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JOHN DOE'), true);
});

test('matches when one name is a token-subset of the other (extra middle name)', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JOHN MICHAEL DOE'), true);
  assert.equal(namesOverlap('JOHN MICHAEL DOE', 'JOHN DOE'), true);
});

test('matches name-order swaps', () => {
  assert.equal(namesOverlap('SARAH JANE THOMPSON', 'THOMPSON SARAH JANE'), true);
});

test('matches Mohammed/Mohammad transliteration variants', () => {
  assert.equal(namesOverlap('MOHAMMED HASSAN AL FARSI', 'MOHAMMAD HASSAN AL FARSI'), true);
  assert.equal(namesOverlap('MUHAMMAD ALI', 'MOHAMMED ALI'), true);
});

test('matches common Arabic-name transliteration variants', () => {
  assert.equal(namesOverlap('IBRAHIM KHALID', 'EBRAHIM KHALED'), true);
  assert.equal(namesOverlap('YUSUF AHMED', 'YOUSEF AHMAD'), true);
  assert.equal(namesOverlap('FATIMA HUSSEIN', 'FATHIMA HUSSAIN'), true);
});

test('does NOT match when 3-char Arabic particles are the only overlap', () => {
  // Both contain BIN — under old logic this matched; new logic must reject.
  assert.equal(namesOverlap('AHMED BIN SULTAN', 'HAMAD BIN RASHID'), false);
});

test('does NOT match when only AL/EL/ABU/UMM/BINT particles overlap', () => {
  assert.equal(namesOverlap('SAEED AL FARSI', 'KHALID AL ANSARI'), false);
  assert.equal(namesOverlap('AHMED ABU BAKR', 'HAMAD ABU YOUSEF'), false);
});

test('does NOT match completely unrelated names', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JANE SMITH'), false);
});

test('does NOT match when shared token is a stripped title', () => {
  // Both have "MR" but no actual name overlap — should mismatch.
  assert.equal(namesOverlap('MR. ALICE BROWN', 'MR. CHARLIE GREEN'), false);
});

test('handles Arabic-script-only inputs gracefully (no crash, returns false)', () => {
  assert.equal(namesOverlap('احمد', 'محمد'), false);
});
```

- [ ] **Step 2: Verify the namesOverlap function is exported from compare.js**

Currently `src/compare.js:652` exports only:

```js
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks };
```

It does not export `namesOverlap`. The test cannot run until the function is exposed. Modify the module.exports line:

```js
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap };
```

- [ ] **Step 3: Run the tests — they MUST fail**

Run: `npm test 2>&1`
Expected: most tests fail. Specifically expect failures on:
- `matches name-order swaps` (currently passes — irrelevant)
- `matches Mohammed/Mohammad transliteration variants` (will fail — current logic compares raw tokens)
- `matches common Arabic-name transliteration variants` (will fail)
- `does NOT match when 3-char Arabic particles are the only overlap` (will fail — current returns `true` because `BIN` is length 3 and >2)
- `does NOT match when only AL/EL/ABU/UMM/BINT particles overlap` (will fail — same reason for 3-char particles; `ABU` length 3)
- `matches when one name is a token-subset of the other` (currently passes — overlap ≥1 covers it)

If ALL tests pass, the function was already rewritten — stop and verify the audit findings before continuing.

### Task B3: Implement the new namesOverlap

**Files:**
- Modify: `src/compare.js:84-93`

- [ ] **Step 1: Replace the function body**

Delete the existing `namesOverlap` (currently lines 84-93) and replace with the following block. Keep all surrounding code unchanged:

```js
// Stopwords removed before token comparison. Includes English titles and
// Arabic naming particles that frequently appear across unrelated names
// and must not be treated as a matching signal.
const NAME_STOPWORDS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR',
  'BIN', 'BINT', 'IBN', 'AL', 'EL', 'ABU', 'UMM', 'UM'
]);

// Transliteration normalization map: variants → canonical form.
// Applied per-token after stopword removal, before set comparison.
const TRANSLIT_MAP = {
  MOHAMMAD:  'MOHAMMED',
  MUHAMMED:  'MOHAMMED',
  MUHAMMAD:  'MOHAMMED',
  MOHAMAD:   'MOHAMMED',
  MOHAMED:   'MOHAMMED',
  EBRAHIM:   'IBRAHIM',
  KHALED:    'KHALID',
  YUSUF:     'YOUSEF',
  YOUSIF:    'YOUSEF',
  YOUSSEF:   'YOUSEF',
  FATHIMA:   'FATIMA',
  FATHIMAH:  'FATIMA',
  AHMAD:     'AHMED',
  HUSSAIN:   'HUSSEIN',
  HUSAIN:    'HUSSEIN',
  HASAN:     'HASSAN',
  UMAR:      'OMAR'
};

function tokenizeName(s) {
  if (!s) return new Set();
  const upper = String(s).toUpperCase()
    .replace(/^(MR|MRS|MS|MISS|DR)\.?\s+/, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!upper) return new Set();
  const tokens = new Set();
  for (const w of upper.split(' ')) {
    if (w.length <= 2) continue;
    if (NAME_STOPWORDS.has(w)) continue;
    tokens.add(TRANSLIT_MAP[w] || w);
  }
  return tokens;
}

function isSubsetOf(small, big) {
  for (const x of small) if (!big.has(x)) return false;
  return small.size > 0;
}

function namesOverlap(a, b) {
  const A = tokenizeName(a);
  const B = tokenizeName(b);
  if (A.size === 0 || B.size === 0) return false;
  return isSubsetOf(A, B) || isSubsetOf(B, A);
}
```

- [ ] **Step 2: Run the tests — they MUST all pass**

Run: `npm test 2>&1`
Expected: all 12 tests pass with `# pass 12 / # fail 0` (or equivalent node:test summary).
If any test fails, do not proceed — read the failure, adjust the implementation, re-run.

- [ ] **Step 3: Quick sanity check that the change doesn't break compare-flow loading**

Run: `node -e "require('./src/compare.js'); console.log('compare loads OK')"`
Expected: `compare loads OK`.

### Task B4: Commit Phase B

- [ ] **Step 1: Stage and commit**

```bash
git add src/compare.js test/names-overlap.test.js package.json
git status
git commit -m "fix: rewrite namesOverlap to drop Arabic particles + handle transliteration

namesOverlap now uses an explicit stopword set (BIN, BINT, AL, EL, ABU,
UMM, plus English titles), a transliteration map for common Arabic-name
variants (Mohammed/Mohammad, Ibrahim/Ebrahim, etc.), and a subset-check
instead of single-token overlap. This eliminates false positives where
unrelated buyers shared Arabic particles, and false negatives on
spelling variants of the same name.

Adds first test suite using node:test (Node 18+ built-in), wired via
'npm test' script."
```

Expected: one commit, three files (compare.js, names-overlap.test.js, package.json).

---

## Phase C — Header-Driven Salesforce Column Parsing

**Why:** `src/salesforce.js:8-33` hardcodes Salesforce column **indices** (e.g., `PURCHASE_PRICE: 9`). If Salesforce adds, removes, or reorders a single column in the monthly export, every downstream field silently picks up the wrong value — purchase prices, applicant names, procedure numbers all shift one column over with no error. This is the highest silent-data-corruption risk in the codebase. The fix: read the actual header row and resolve column positions by name with a fail-fast validation.

### Task C1: Inspect the actual SF header row

**Files:** read-only

- [ ] **Step 1: Locate a real SF export to inspect headers**

Run: `ls sf-input/ 2>/dev/null && ls input/ 2>/dev/null | grep -i 'sf\|salesforce' || true`
Expected: at least one `.xlsx` or `.xls` file. If `sf-input/` is empty, ask the user to drop a recent SF export there before continuing.

- [ ] **Step 2: Read the header row from the file with a one-liner**

Replace `<file>` below with the actual filename you found in Step 1:

```bash
node -e "const X=require('xlsx');const wb=X.readFile('sf-input/<file>');const aoa=X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:null});console.log(JSON.stringify(aoa[9]))"
```

Expected output: a JSON array of header cell strings, where each non-null entry is the header label at that column index.

- [ ] **Step 3: Cross-reference against `SF_COLS`**

Verify that the index → label mapping you observe matches the keys defined in `src/salesforce.js:8-33`:

| SF_COLS key | Hardcoded index | Expected header label (verify in Step 2 output) |
|---|---|---|
| BP_NAME | 1 | (record from your Step 2 output) |
| SUB_PROJECT | 3 | |
| UNIT | 4 | |
| BOOKING_NAME | 5 | |
| PROJECT | 6 | |
| TOWER_NAME | 7 | |
| APPLICANT_NAME | 8 | |
| PURCHASE_PRICE | 9 | |
| DLD_AMOUNT | 10 | |
| BP_CREATED_DATE | 12 | |
| PRE_REG_STATUS | 13 | |
| CURRENT_STEP_NAME | 14 | |
| STATUS | 15 | |
| RM_PROCESS_STATUS | 16 | |
| DLD_PROCESS_STATUS | 17 | |
| TOTAL_DLD_PAID | 23 | |
| DLD_SHORTFALL | 24 | |
| DLD_BALANCE | 25 | |
| BOOKING_RECORD_ID | 28 | |
| END_DATE | 29 | |
| PRE_REG_COMPLETION_DATE | 30 | |
| PROCEDURE_NUMBER | 31 | |
| PAYMENT_REFERENCE_NUMBER | 32 | |
| PAYMENT_DATE | 33 | |

Save the resulting label-for-each-key mapping in a scratch note — you will encode it in Task C3 as the `HEADER_LABELS` constant.

- [ ] **Step 4: STOP and confirm with user if any header is unclear**

If any cell in the header row is empty, ambiguous, or doesn't clearly map to one of the `SF_COLS` keys, stop and ask the user to confirm the header text before encoding it. **Guessing a header label is the same correctness risk this phase is meant to eliminate** — do not skip the confirmation.

### Task C2: Write the failing header-resolution test

**Files:**
- Create: `test/salesforce-headers.test.js`

- [ ] **Step 1: Create the test file**

Create `test/salesforce-headers.test.js` with this content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSfColumns, REQUIRED_HEADERS } = require('../src/salesforce');

test('resolveSfColumns maps every required header to a column index', () => {
  // Build a synthetic header row where each REQUIRED_HEADER is at a known index.
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = label; });
  const cols = resolveSfColumns(headerRow);
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number', `missing column index for header "${label}"`);
  }
});

test('resolveSfColumns throws with a clear list when required headers are missing', () => {
  const partial = [null, 'BP Name', 'something else'];
  assert.throws(
    () => resolveSfColumns(partial),
    /missing required Salesforce header/i
  );
});

test('resolveSfColumns trims whitespace around header cells', () => {
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = '  ' + label + '  '; });
  const cols = resolveSfColumns(headerRow);
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number');
  }
});

test('resolveSfColumns ignores extra columns not in REQUIRED_HEADERS', () => {
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = label; });
  headerRow.push('Some Future Column');  // extra trailing header
  const cols = resolveSfColumns(headerRow);
  // Should not throw, and should still return all required mappings.
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number');
  }
});
```

- [ ] **Step 2: Run — must fail because `resolveSfColumns` doesn't exist yet**

Run: `npm test 2>&1`
Expected: failures in `test/salesforce-headers.test.js` with errors like `resolveSfColumns is not a function` or `Cannot read property 'forEach' of undefined`.

### Task C3: Add the HEADER_LABELS map and resolveSfColumns function

**Files:**
- Modify: `src/salesforce.js:8-33` (replace hardcoded `SF_COLS` with header-driven version)

- [ ] **Step 1: Define HEADER_LABELS using the labels you confirmed in Task C1**

Below the existing `DATA_START_INDEX = 10;` line in `src/salesforce.js`, replace the hardcoded `SF_COLS` block with this structure. **Replace the placeholder strings on the right side with the labels you confirmed in Task C1 Step 3** — do not leave the placeholders; if you do not have confirmed labels, return to Task C1 Step 4.

```js
// Map SF_COLS key → expected header text in the workbook header row.
// Label strings MUST match the actual column headers (case-insensitive, whitespace-trimmed).
// If Salesforce reorders columns these stay correct; if Salesforce renames a header,
// resolveSfColumns will throw on import with a clear list of missing headers.
const HEADER_LABELS = {
  BP_NAME:                 '<<CONFIRMED LABEL FROM C1>>',
  SUB_PROJECT:             '<<CONFIRMED LABEL FROM C1>>',
  UNIT:                    '<<CONFIRMED LABEL FROM C1>>',
  BOOKING_NAME:            '<<CONFIRMED LABEL FROM C1>>',
  PROJECT:                 '<<CONFIRMED LABEL FROM C1>>',
  TOWER_NAME:              '<<CONFIRMED LABEL FROM C1>>',
  APPLICANT_NAME:          '<<CONFIRMED LABEL FROM C1>>',
  PURCHASE_PRICE:          '<<CONFIRMED LABEL FROM C1>>',
  DLD_AMOUNT:              '<<CONFIRMED LABEL FROM C1>>',
  BP_CREATED_DATE:         '<<CONFIRMED LABEL FROM C1>>',
  PRE_REG_STATUS:          '<<CONFIRMED LABEL FROM C1>>',
  CURRENT_STEP_NAME:       '<<CONFIRMED LABEL FROM C1>>',
  STATUS:                  '<<CONFIRMED LABEL FROM C1>>',
  RM_PROCESS_STATUS:       '<<CONFIRMED LABEL FROM C1>>',
  DLD_PROCESS_STATUS:      '<<CONFIRMED LABEL FROM C1>>',
  TOTAL_DLD_PAID:          '<<CONFIRMED LABEL FROM C1>>',
  DLD_SHORTFALL:           '<<CONFIRMED LABEL FROM C1>>',
  DLD_BALANCE:             '<<CONFIRMED LABEL FROM C1>>',
  BOOKING_RECORD_ID:       '<<CONFIRMED LABEL FROM C1>>',
  END_DATE:                '<<CONFIRMED LABEL FROM C1>>',
  PRE_REG_COMPLETION_DATE: '<<CONFIRMED LABEL FROM C1>>',
  PROCEDURE_NUMBER:        '<<CONFIRMED LABEL FROM C1>>',
  PAYMENT_REFERENCE_NUMBER:'<<CONFIRMED LABEL FROM C1>>',
  PAYMENT_DATE:            '<<CONFIRMED LABEL FROM C1>>'
};

const REQUIRED_HEADERS = Object.values(HEADER_LABELS);

function resolveSfColumns(headerRow) {
  if (!Array.isArray(headerRow)) {
    throw new Error('resolveSfColumns: header row must be an array');
  }
  const labelToIndex = new Map();
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (cell == null) continue;
    const label = String(cell).trim();
    if (!label) continue;
    if (!labelToIndex.has(label)) labelToIndex.set(label, i);
  }
  const cols = {};
  const missing = [];
  for (const [key, label] of Object.entries(HEADER_LABELS)) {
    const idx = labelToIndex.get(label);
    if (idx == null) {
      missing.push(label);
    } else {
      cols[key] = idx;
      cols[label] = idx;  // also keyed by label so test can introspect by label
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `missing required Salesforce header(s): ${missing.map(s => '"' + s + '"').join(', ')}. ` +
      `Verify the workbook still has these columns at row ${HEADER_ROW_INDEX + 1}.`
    );
  }
  return cols;
}
```

- [ ] **Step 2: Wire `resolveSfColumns` into `readSfWorkbook`**

In `src/salesforce.js`, modify `readSfWorkbook` so that the data-row loop uses dynamically resolved indices instead of the hardcoded `SF_COLS`. The function currently does `r[SF_COLS.BP_NAME]` etc.; after this change, it should use a per-call `cols` map:

```js
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
  const headerRow = aoa[HEADER_ROW_INDEX] || [];
  const cols = resolveSfColumns(headerRow);   // throws if any required header is missing
  const titleRow = aoa[1] || [];
  const timeRow  = aoa[2] || [];
  const generatedAt = cellOrNull(timeRow.find(v => typeof v === 'string' && /As of/i.test(v)));
  const rows = [];
  for (let i = DATA_START_INDEX; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(r[cols.BP_NAME]);
    const unit   = cellOrNull(r[cols.UNIT]);
    if (!bpName && !unit) continue;
    rows.push({
      bpName:               bpName,
      subProject:           cellOrNull(r[cols.SUB_PROJECT]),
      unit:                 unit,
      bookingName:          cellOrNull(r[cols.BOOKING_NAME]),
      project:              cellOrNull(r[cols.PROJECT]),
      towerName:            cellOrNull(r[cols.TOWER_NAME]),
      applicantName:        cellOrNull(r[cols.APPLICANT_NAME]),
      purchasePrice:        asNumberOrNull(r[cols.PURCHASE_PRICE]),
      dldAmount:            asNumberOrNull(r[cols.DLD_AMOUNT]),
      bpCreatedDate:        cellOrNull(r[cols.BP_CREATED_DATE]),
      preRegStatus:         cellOrNull(r[cols.PRE_REG_STATUS]),
      currentStepName:      cellOrNull(r[cols.CURRENT_STEP_NAME]),
      status:               cellOrNull(r[cols.STATUS]),
      rmProcessStatus:      cellOrNull(r[cols.RM_PROCESS_STATUS]),
      dldProcessStatus:     cellOrNull(r[cols.DLD_PROCESS_STATUS]),
      totalDldPaid:         asNumberOrNull(r[cols.TOTAL_DLD_PAID]),
      dldShortfall:         asNumberOrNull(r[cols.DLD_SHORTFALL]),
      dldBalance:           asNumberOrNull(r[cols.DLD_BALANCE]),
      bookingRecordId:      cellOrNull(r[cols.BOOKING_RECORD_ID]),
      endDate:              cellOrNull(r[cols.END_DATE]),
      preRegCompletionDate: cellOrNull(r[cols.PRE_REG_COMPLETION_DATE]),
      procedureNumber:      cellOrNull(r[cols.PROCEDURE_NUMBER]),
      paymentReferenceNumber: cellOrNull(r[cols.PAYMENT_REFERENCE_NUMBER]),
      paymentDate:          cellOrNull(r[cols.PAYMENT_DATE])
    });
  }
  return { generatedAt, rows };
}
```

- [ ] **Step 3: Update module.exports**

The bottom of `src/salesforce.js` currently has:

```js
module.exports = { readSfWorkbook, importSfSnapshot, SF_COLS };
```

Replace with:

```js
module.exports = { readSfWorkbook, importSfSnapshot, resolveSfColumns, REQUIRED_HEADERS, HEADER_LABELS };
```

(Drop the legacy `SF_COLS` export — grep first to confirm it has no external consumers; if it does, keep it for backwards compatibility instead.)

- [ ] **Step 4: Verify SF_COLS has no external consumers**

Run: `grep -rn "SF_COLS" --include='*.js' . | grep -v node_modules | grep -v src/salesforce.js | grep -v test/`
Expected: no matches. If any match exists, leave `SF_COLS` exported (and deprecated) until those consumers are updated.

- [ ] **Step 5: Run tests — they MUST pass**

Run: `npm test 2>&1`
Expected: all `salesforce-headers.test.js` tests pass, plus all earlier tests still pass.

- [ ] **Step 6: Smoke test against a real SF export**

Run: `node -e "const {readSfWorkbook}=require('./src/salesforce.js'); const r=readSfWorkbook('sf-input/<your-file>'); console.log('rows:', r.rows.length, 'first:', JSON.stringify(r.rows[0]))"`
Expected: non-zero row count and a row whose `bpName`, `unit`, `applicantName`, `purchasePrice` look correct (numbers in the right fields, names in the right fields, no obvious column shift).
If a field is wrong (e.g., a number where a name should be), one of the `HEADER_LABELS` strings is wrong — go back to Task C1 and re-verify the header text.

### Task C4: Commit Phase C

- [ ] **Step 1: Stage and commit**

```bash
git add src/salesforce.js test/salesforce-headers.test.js
git status
git commit -m "fix: resolve Salesforce columns by header name, not by hardcoded index

readSfWorkbook now reads the header row at HEADER_ROW_INDEX, builds a
label-to-index map, and looks up each required column by its header
text. If Salesforce reorders columns, parsing stays correct; if a
required header is missing or renamed, import fails fast with a clear
list of which headers are missing.

Closes the highest silent-data-corruption risk in the codebase: a
single column reorder previously shifted every downstream field with
no error."
```

---

## Phase D — Project-Mapping Fuzzy Fallback + New Project Entries

**Why:** `config/project-mapping.json` has only one explicit entry (Hartland Waves). All other projects fall through to `guessSubProjectFromDldName` (`src/project-mapping.js:41-52`), which only finds an SF sub_project that is a literal substring of the DLD project name. Real Sobha projects fail this — e.g., DLD "Sobha Seahaven" vs SF "Sea Haven", or DLD "Sobha One" vs SF "Sobha ONE Tower A". Adding fuzzy token-overlap matching is safe and improves coverage; expanding the explicit override list requires user input.

### Task D1: Add fuzzy token fallback (TDD)

**Files:**
- Modify: `src/project-mapping.js:41-52`
- Create: `test/project-mapping.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/project-mapping.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { guessSubProjectFromDldName } = require('../src/project-mapping');

function makeInferred(entries) {
  const m = new Map();
  for (const [sub, info] of entries) m.set(sub, info);
  return m;
}

test('exact-substring match still wins (no regression)', () => {
  const inferred = makeInferred([
    ['Waves', { sub_project: 'Waves', prefix: 'W', total: 100 }],
    ['Waves 2', { sub_project: 'Waves 2', prefix: 'W2', total: 50 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Hartland Waves 2', inferred), 'Waves 2');
});

test('fuzzy match finds SF sub_project when DLD name is shorter', () => {
  // DLD says "Sobha One"; SF has "Sobha ONE Tower A" — substring fails.
  const inferred = makeInferred([
    ['Sobha ONE Tower A', { sub_project: 'Sobha ONE Tower A', prefix: 'SO-A', total: 80 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha One', inferred), 'Sobha ONE Tower A');
});

test('fuzzy match handles spacing/case differences', () => {
  // DLD "Sobha Seahaven" vs SF "Sea Haven" — substring fails on spacing.
  const inferred = makeInferred([
    ['Sea Haven', { sub_project: 'Sea Haven', prefix: 'SH', total: 60 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Seahaven', inferred), 'Sea Haven');
});

test('returns null when no candidate shares meaningful tokens', () => {
  const inferred = makeInferred([
    ['Creek Vistas', { sub_project: 'Creek Vistas', prefix: 'CV', total: 40 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Hartland Waves', inferred), null);
});

test('returns null when input is empty', () => {
  const inferred = makeInferred([
    ['Waves', { sub_project: 'Waves', prefix: 'W', total: 100 }]
  ]);
  assert.equal(guessSubProjectFromDldName('', inferred), null);
  assert.equal(guessSubProjectFromDldName(null, inferred), null);
});

test('prefers the candidate with more shared distinctive tokens', () => {
  const inferred = makeInferred([
    ['Creek Vistas', { sub_project: 'Creek Vistas', prefix: 'CV', total: 40 }],
    ['Creek Vistas Grande', { sub_project: 'Creek Vistas Grande', prefix: 'CVG', total: 30 }]
  ]);
  assert.equal(
    guessSubProjectFromDldName('Creek Vistas Grande Tower A', inferred),
    'Creek Vistas Grande'
  );
});
```

- [ ] **Step 2: Verify `guessSubProjectFromDldName` is exported**

Currently `src/project-mapping.js:131-138` exports `buildMappingFor, inferSubProjectPrefixes, applyUnitTransforms, expectedSfUnit, saveMappingToDb, loadOverrides`. Add `guessSubProjectFromDldName`:

```js
module.exports = {
  buildMappingFor,
  inferSubProjectPrefixes,
  applyUnitTransforms,
  expectedSfUnit,
  saveMappingToDb,
  loadOverrides,
  guessSubProjectFromDldName
};
```

- [ ] **Step 3: Run tests — must fail on the fuzzy cases**

Run: `npm test 2>&1`
Expected: the "fuzzy match" tests fail; "exact-substring", "no candidates", and "empty input" pass.

- [ ] **Step 4: Implement the fuzzy fallback**

Replace `guessSubProjectFromDldName` (currently `src/project-mapping.js:41-52`) with:

```js
// Tokenize a project name into lower-case alphanumeric words ≥3 chars long.
// Drops generic real-estate words that appear in many project names and
// would otherwise produce spurious matches.
const PROJECT_STOPWORDS = new Set([
  'sobha', 'tower', 'towers', 'building', 'phase', 'plot',
  'block', 'residence', 'residences', 'community', 'project'
]);

function projectTokens(name) {
  const out = new Set();
  if (!name) return out;
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return out;
  for (const w of cleaned.split(/\s+/)) {
    if (w.length < 3) continue;
    if (PROJECT_STOPWORDS.has(w)) continue;
    out.add(w);
  }
  return out;
}

function guessSubProjectFromDldName(dldName, inferred) {
  if (!dldName) return null;
  const lc = dldName.toLowerCase();

  // Pass 1: exact substring (preserves existing behaviour).
  let best = null, bestLen = 0;
  for (const [sub] of inferred.entries()) {
    const subLc = sub.toLowerCase();
    if (lc.includes(subLc) && subLc.length > bestLen) {
      best = sub; bestLen = subLc.length;
    }
  }
  if (best) return best;

  // Pass 2: token-overlap fallback.
  const dldTokens = projectTokens(dldName);
  if (dldTokens.size === 0) return null;
  let bestSub = null, bestScore = 0;
  for (const [sub, info] of inferred.entries()) {
    const subTokens = projectTokens(sub);
    if (subTokens.size === 0) continue;
    let shared = 0;
    for (const t of subTokens) if (dldTokens.has(t)) shared++;
    if (shared === 0) continue;
    // Score: count of shared tokens; tie-break on subTokens.size (prefer
    // candidate that uses MORE of its own tokens — matches longer SF names first).
    const score = shared * 1000 + subTokens.size;
    if (score > bestScore) { bestSub = sub; bestScore = score; }
  }
  // Require at least one shared distinctive token AND that the shared tokens
  // are at least half of the SF candidate's tokens (avoids weak matches).
  if (!bestSub) return null;
  const bestTokens = projectTokens(bestSub);
  let sharedCount = 0;
  for (const t of bestTokens) if (dldTokens.has(t)) sharedCount++;
  if (sharedCount * 2 < bestTokens.size) return null;
  return bestSub;
}
```

- [ ] **Step 5: Run tests — must all pass**

Run: `npm test 2>&1`
Expected: all project-mapping tests pass, all earlier tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/project-mapping.js test/project-mapping.test.js
git status
git commit -m "feat: add fuzzy token-overlap fallback to project-mapping guesser

guessSubProjectFromDldName now first attempts substring match (existing
behaviour), then falls back to token-overlap. Tokens are lowercased,
≥3 chars, with generic real-estate words (Sobha, Tower, etc.) dropped
as stopwords. Match is accepted only if shared tokens cover at least
half of the SF candidate's distinctive tokens — avoids weak matches.

Handles cases like DLD 'Sobha Seahaven' vs SF 'Sea Haven', and DLD
'Sobha One' vs SF 'Sobha ONE Tower A' that the substring-only matcher
silently dropped."
```

### Task D2: Expand `config/project-mapping.json` (USER INPUT REQUIRED)

**Files:**
- Modify: `config/project-mapping.json`

- [ ] **Step 1: List active SF sub_projects from the latest snapshot**

Run: `node -e "const Database=require('better-sqlite3');const db=new Database('db/dl.sqlite');const rows=db.prepare(\"SELECT DISTINCT sub_project FROM sf_booking WHERE sf_snapshot_id=(SELECT sf_snapshot_id FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1) ORDER BY sub_project\").all();for(const r of rows)console.log(r.sub_project)"`
Expected: a list of distinct SF sub_project values from the most recent SF snapshot.
If the DB path is different, locate it first with `ls db/`.

- [ ] **Step 2: List DLD project names that have snapshots**

Run: `node -e "const Database=require('better-sqlite3');const db=new Database('db/dl.sqlite');const rows=db.prepare(\"SELECT DISTINCT p.project_name, p.sf_sub_project FROM dld_project p WHERE EXISTS (SELECT 1 FROM dld_snapshot s WHERE s.project_id=p.project_id) ORDER BY p.project_name\").all();for(const r of rows)console.log(r.project_name+' -> '+(r.sf_sub_project||'(unmapped)'))"`
Expected: a list of `DLD name -> SF sub_project (or unmapped)`.

- [ ] **Step 3: STOP and ask the user**

Show the user the two lists from Steps 1–2 and ask:

> "Here are the DLD projects with snapshots and the SF sub_projects in the latest snapshot. For each DLD project currently labelled `(unmapped)` — or that the new fuzzy fallback would mis-route — please tell me the correct `sf_project`, `sf_sub_project`, `sf_unit_prefix`, and any `unitTransforms` I should add to `config/project-mapping.json`. **Do not guess** — if you're unsure about a project, leave it out and we'll let the fuzzy matcher handle it."

Wait for the user's reply before continuing.

- [ ] **Step 4: Add each user-confirmed entry to `config/project-mapping.json`**

For each entry the user confirms, add a new key under `"overrides"` with this shape (replace placeholder values with the user's real input):

```json
"<DLD project_name exact>": {
  "sf_project": "<SF Project>",
  "sf_sub_project": "<SF Sub Project>",
  "sf_unit_prefix": "<UNIT-PREFIX>",
  "unitTransforms": []
}
```

Keep the existing `Sobha Hartland Waves` entry. After editing, validate the JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('config/project-mapping.json','utf8')); console.log('JSON OK')"
```

Expected: `JSON OK`. If you get a parse error, fix the trailing commas/quotes.

- [ ] **Step 5: Smoke test — re-run compare for one of the newly mapped projects**

Run: `node index.js compare 2>&1 | head -40`
(Adjust to the actual compare entry-point — see `index.js` for the menu/CLI; `node index.js` opens the menu on Windows.)
Expected: the previously-unmapped project now produces a `compare.html` instead of being skipped with `no-mapping`.

- [ ] **Step 6: Commit**

```bash
git add config/project-mapping.json
git status
git commit -m "config: add explicit DLD->SF mappings for active Sobha projects

User-confirmed mappings for projects where the auto-inference (substring
or fuzzy token overlap) is ambiguous. Each entry is a hard override of
the inferred mapping and includes any unitTransforms needed."
```

---

## Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test 2>&1`
Expected: every test passes, including names-overlap, salesforce-headers, project-mapping suites.

- [ ] **Step 2: Run a full compare end-to-end**

Run: `node index.js` and exercise a typical compare flow from the menu against your most recent DLD + SF snapshots. Open the generated HTML and verify:
- Rows are sorted with BUYER_MISMATCH at the top
- MATCH chip is off by default
- "Days" column appears and shows numeric values for non-MATCH rows
- BUYER_MISMATCH count is **lower** than the previous run on the same data (because more transliteration variants and name-order swaps now match)

- [ ] **Step 3: Spot-check a known false-positive override**

Pick one entry from `Sobha_Hartland_Waves.overrides.csv` (or any other override file) where the override exists specifically because of a transliteration mismatch. Run compare without that override applied (delete the override temporarily) and confirm the row now reports MATCH instead of BUYER_MISMATCH. Re-add the override.

- [ ] **Step 4: Confirm git log shows four clean commits**

Run: `git log --oneline -8`
Expected: four new commits in order — Phase A, Phase B, Phase C, Phase D (D may be one or two commits depending on whether config edits were combined).

---

## Self-Review

Spec coverage check (run after writing the plan):

| Audit item | Phase | Task |
|---|---|---|
| #1 Smarter buyer matching (Mohammed/Mohammad, BIN/AL stopwords) | B | B2, B3 |
| #2 Header-driven SF column parsing | C | C1, C2, C3 |
| #3 Default sort order + MATCH chip OFF | (already done) | — |
| #4 Bank list drift | A | A1, A2 |
| #5 Project mapping coverage | D | D1 (fuzzy), D2 (entries) |
| Quick win: numeric unit_number sort | (already done in `compare.js:38`) | — |
| Quick win: days-outstanding column | (already done) | — |
| Quick win: cache project-mapping.json read | (already done in `compare.js:165-181`) | — |

No placeholders remain except in Task C3 Step 1 — that's deliberate, because the user must verify the actual SF header strings before encoding them. The placeholder `<<CONFIRMED LABEL FROM C1>>` is bracketed and impossible to commit by accident.

Type/name consistency: `namesOverlap` is the function name in `compare.js`, in the test file, and in the export list. `resolveSfColumns` and `REQUIRED_HEADERS` are the names used in `salesforce.js` and the test file. `guessSubProjectFromDldName` is consistent across `project-mapping.js` and the test file.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-dl-processor-improvements.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with checkpoint review. Best when phases C and D will need user input mid-stream.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
