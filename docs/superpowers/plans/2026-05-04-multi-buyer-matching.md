# Multi-Buyer Matching & Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-DLD-buyer × single-SF-applicant match with ANY-MATCH (every DLD party_name × every populated SF applicant slot), surface every buyer in compare/diff/audit HTML reports via two clickable count columns, and lock in the F.T. → SQM display relabel.

**Architecture:** Two new pure helpers `collectDldBuyers` / `collectSfApplicants` in `src/compare.js`; new file `src/buyer-cells.js` with two pure HTML renderers; matching extension in `classifyMatch` introduces a fresh `flags` array on result rows and emits `A12` for matches found via non-clean primary alignment; three HTML writers (`compare.js`, `diff.js`, `audit-report.js`) consume the renderers and add two new columns (`DLD #`, `SF #`).

**Tech Stack:** Node.js (no transpiler), `better-sqlite3`, `node:test` + `node:assert/strict`. Tests build `:memory:` databases via `migrateSchema()` from `src/db.js`. Run via `npm test`.

**Spec:** `docs/superpowers/specs/2026-05-04-multi-buyer-matching-design.md` (commit `4b5cc7a`).

**Branch:** `feat/multi-buyer-matching` (off `master` at `e24834c`). Master does NOT yet have A10 (the unmerged area-matching branch's flag). This plan ships A12 cleanly. When A10 lands later via `feat/multi-applicant-and-area-matching`, both flags coexist as independent chips — no rebase conflict expected on the flag system itself, only on column-injection points in compare.js HTML.

---

## File Map

- **Create:** `src/buyer-cells.js` — two pure HTML renderers (`renderDldBuyersCell`, `renderSfApplicantsCell`). No DB access, no side effects.
- **Modify:** `src/compare.js` — add `collectDldBuyers` / `collectSfApplicants` helpers; switch `classifyMatch` to ANY-MATCH; introduce `flags` field; emit `A12`; add `dld_buyers` / `sf_applicants` to result rows; add two new columns to compare HTML.
- **Modify:** `src/diff.js` — load latest SF snapshot once; for each unit row, look up buyers/applicants and render the two new columns.
- **Modify:** `src/audit-report.js` — add the two columns to audit HTML.
- **Create:** `test/buyer-cells.test.js` — renderer tests.
- **Create:** `test/compare-multi-buyer.test.js` — match logic + collector tests.

No DB schema changes. No CLI flag changes. No menu changes.

---

## Pre-flight

- [ ] **Step 0.1: Verify branch and clean tree**

Run from `C:\projects\DL-Processor`:
```
git branch --show-current
git status --short
```
Expected: `feat/multi-buyer-matching` and no uncommitted changes (only the spec at `4b5cc7a` is on this branch).

- [ ] **Step 0.2: Capture baseline test count**

Run: `npm test`
Record the pass count from the summary line. Each task adds tests; the baseline must keep passing throughout.

---

## Task 1: `collectDldBuyers` helper

Add a pure helper to `src/compare.js` that turns a unit's transactions into a structured array. This is the data shape the matching logic and the HTML renderer both consume.

**Files:**
- Modify: `src/compare.js`
- Create: `test/compare-multi-buyer.test.js`

- [ ] **Step 1.1: Create `test/compare-multi-buyer.test.js` with the first test (failing)**

Create the file:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectDldBuyers, collectSfApplicants } = require('../src/compare');

function tx(partyName, opts = {}) {
  return {
    party_name: partyName,
    ft_share:   opts.ftShare   != null ? opts.ftShare   : 50,
    share_unit: opts.shareUnit || 'F.T.',
    tx_type:    opts.txType    || 'Sell - Pre registration',
    tx_date:    opts.txDate    || '04/02/2024',
    tx_date_iso: opts.txDateIso || '2024-02-04',
    amount_aed: opts.amountAed != null ? opts.amountAed : 1612613,
  };
}

test('collectDldBuyers returns one entry per transaction with split tx_type', () => {
  const rows = collectDldBuyers([
    tx('AHMAD MUJTABA MURTAZA', { ftShare: 34.68 }),
    tx('AHMAD MUSADIQ MURTAZA', { ftShare: 34.68 }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'AHMAD MUJTABA MURTAZA');
  assert.equal(rows[0].areaSqm, 34.68);
  assert.equal(rows[0].amountAed, 1612613);
  assert.equal(rows[0].txType, 'Sell');
  assert.equal(rows[0].txSubtype, 'Pre registration');
  assert.equal(rows[0].date, '04/02/2024');
  assert.equal(rows[0].kind, 'buyer');
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: FAIL — `collectDldBuyers is not a function`.

- [ ] **Step 1.3: Implement `collectDldBuyers` in `src/compare.js`**

Locate the existing `BANK_PREFIX_RE` import near line 5 and add the helper anywhere above `classifyMatch`. Insert this block (recommended location: just below the `namesOverlap` function):

```javascript
function splitTxType(raw) {
  if (!raw) return { txType: '', txSubtype: '' };
  const idx = raw.indexOf(' - ');
  if (idx === -1) return { txType: raw.trim(), txSubtype: '' };
  return { txType: raw.slice(0, idx).trim(), txSubtype: raw.slice(idx + 3).trim() };
}

function classifyDldKind(name) {
  if (!name || !String(name).trim()) return 'seller';
  if (BANK_PREFIX_RE.test(name)) return 'bank';
  return 'buyer';
}

function collectDldBuyers(transactions) {
  if (!Array.isArray(transactions)) return [];
  const out = transactions.map(t => {
    const { txType, txSubtype } = splitTxType(t.tx_type);
    return {
      name:      t.party_name || null,
      areaSqm:   t.ft_share != null ? Number(t.ft_share) : null,
      amountAed: t.amount_aed != null ? Number(t.amount_aed) : null,
      txType,
      txSubtype,
      date:      t.tx_date || null,
      kind:      classifyDldKind(t.party_name)
    };
  });
  // Order: buyers first (primary = latest Sell), then banks, then sellers.
  // For now, the order within a kind is the input order; classifyMatch picks the latest Sell-type buyer as primary later.
  const order = { buyer: 0, bank: 1, seller: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind]);
  return out;
}
```

Update the `module.exports` line at the bottom of `src/compare.js`. Find the existing exports and add `collectDldBuyers` and `collectSfApplicants` (the second is added in Task 2). For now just add `collectDldBuyers`:
```javascript
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap, collectDldBuyers };
```

- [ ] **Step 1.4: Run the test and verify it passes**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: PASS.

- [ ] **Step 1.5: Add tests for kind classification and ordering**

Append to `test/compare-multi-buyer.test.js`:
```javascript
test('collectDldBuyers labels banks via BANK_PREFIX_RE and empty-names as sellers', () => {
  const rows = collectDldBuyers([
    tx('EMIRATES NBD MORTGAGES'),
    tx('AHMAD'),
    tx(null, { ftShare: 78.56 }),
  ]);
  const byName = Object.fromEntries(rows.map(r => [r.name || '(null)', r.kind]));
  assert.equal(byName['EMIRATES NBD MORTGAGES'], 'bank');
  assert.equal(byName['AHMAD'], 'buyer');
  assert.equal(byName['(null)'], 'seller');
});

test('collectDldBuyers orders buyer entries before banks before sellers', () => {
  const rows = collectDldBuyers([
    tx(null),                           // seller
    tx('EMIRATES NBD MORTGAGES'),       // bank
    tx('AHMAD'),                        // buyer
  ]);
  assert.deepEqual(rows.map(r => r.kind), ['buyer', 'bank', 'seller']);
});

test('collectDldBuyers handles empty input', () => {
  assert.deepEqual(collectDldBuyers([]), []);
  assert.deepEqual(collectDldBuyers(null), []);
  assert.deepEqual(collectDldBuyers(undefined), []);
});

test('collectDldBuyers splits "Sell - Pre registration" into txType and txSubtype', () => {
  const [r] = collectDldBuyers([tx('A', { txType: 'Sell - Pre registration' })]);
  assert.equal(r.txType, 'Sell');
  assert.equal(r.txSubtype, 'Pre registration');
});

test('collectDldBuyers handles tx_type with no " - " separator', () => {
  const [r] = collectDldBuyers([tx('A', { txType: 'Owner (no transaction)' })]);
  assert.equal(r.txType, 'Owner (no transaction)');
  assert.equal(r.txSubtype, '');
});
```

- [ ] **Step 1.6: Run the new tests and verify they pass**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: 6 tests pass (1 from Step 1.1 + 5 new).

- [ ] **Step 1.7: Run full suite to confirm no regression**

Run: `npm test`
Expected: all green, count = baseline + 6.

- [ ] **Step 1.8: Commit**

```
git add src/compare.js test/compare-multi-buyer.test.js
git commit -m "feat(compare): collectDldBuyers helper with kind classification"
```

---

## Task 2: `collectSfApplicants` helper

Pure helper in `src/compare.js` that turns one SF booking row into a structured array of applicants. Iterates all 5 slots unconditionally for forward-compat.

**Files:**
- Modify: `src/compare.js`
- Modify: `test/compare-multi-buyer.test.js`

- [ ] **Step 2.1: Add failing tests**

Append to `test/compare-multi-buyer.test.js`:
```javascript
test('collectSfApplicants emits only populated slots, in canonical order', () => {
  const rows = collectSfApplicants({
    applicant_name:    'JOHN SMITH',
    applicant_2_name:  'JANE SMITH',
    applicant_3_name:  null,
    applicant_4_name:  'KIDS SMITH',
    applicant_details: 'GRANDMA SMITH'
  });
  assert.deepEqual(rows.map(r => r.role),
    ['primary', 'applicant_2', 'applicant_4', 'applicant_details']);
  assert.equal(rows[0].name, 'JOHN SMITH');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.kind === 'applicant'));
});

test('collectSfApplicants returns one entry when only applicant_name populated (today\'s reality)', () => {
  const rows = collectSfApplicants({ applicant_name: 'JOHN SMITH' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'JOHN SMITH');
  assert.equal(rows[0].role, 'primary');
});

test('collectSfApplicants handles null booking', () => {
  assert.deepEqual(collectSfApplicants(null), []);
  assert.deepEqual(collectSfApplicants(undefined), []);
});

test('collectSfApplicants treats empty strings as missing slots', () => {
  const rows = collectSfApplicants({
    applicant_name:    'JOHN',
    applicant_2_name:  '',
    applicant_3_name:  '   ',
    applicant_4_name:  null,
  });
  assert.deepEqual(rows.map(r => r.name), ['JOHN']);
});
```

- [ ] **Step 2.2: Run and verify failure**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: 4 new tests FAIL — `collectSfApplicants is not a function`.

- [ ] **Step 2.3: Implement `collectSfApplicants`**

In `src/compare.js`, add this helper right after `collectDldBuyers`:
```javascript
// Iterate all 5 slots for forward-compatibility — applicant_2..4 and applicant_details
// are usually empty today but ops may start populating them. The matching logic
// and HTML dropdown auto-extend the day they're filled. Do NOT collapse this to
// just applicant_name without revisiting the spec at
// docs/superpowers/specs/2026-05-04-multi-buyer-matching-design.md.
function collectSfApplicants(booking) {
  if (!booking) return [];
  const slots = [
    { role: 'primary',           field: 'applicant_name'    },
    { role: 'applicant_2',       field: 'applicant_2_name'  },
    { role: 'applicant_3',       field: 'applicant_3_name'  },
    { role: 'applicant_4',       field: 'applicant_4_name'  },
    { role: 'applicant_details', field: 'applicant_details' },
  ];
  const out = [];
  for (const { role, field } of slots) {
    const raw = booking[field];
    const name = raw != null ? String(raw).trim() : '';
    if (!name) continue;
    out.push({ name, role, kind: 'applicant' });
  }
  return out;
}
```

Update the `module.exports`:
```javascript
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap, collectDldBuyers, collectSfApplicants };
```

- [ ] **Step 2.4: Run the new tests and verify they pass**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: all tests in this file pass (Task 1's 6 + Task 2's 4 = 10).

- [ ] **Step 2.5: Run full suite**

Run: `npm test`
Expected: baseline + 10.

- [ ] **Step 2.6: Commit**

```
git add src/compare.js test/compare-multi-buyer.test.js
git commit -m "feat(compare): collectSfApplicants helper with forward-compat 5-slot iteration"
```

---

## Task 3: ANY-MATCH rule + `flags` array + `A12` emission

Modify `classifyMatch` to use the broader matching rule and emit a new `A12` flag. Introduce a `flags` array on the result row so future flags (A10 from the area branch, A11, etc.) coexist cleanly.

**Files:**
- Modify: `src/compare.js`
- Modify: `test/compare-multi-buyer.test.js`

- [ ] **Step 3.1: Add failing tests for ANY-MATCH**

Append to `test/compare-multi-buyer.test.js`:
```javascript
const { compareProject } = require('../src/compare');
// We cannot easily build a full project comparison fixture in pure unit tests
// because compareProject reads from sqlite. Instead, exercise classifyMatch via
// a thin re-export. We add it to module.exports next to the other helpers.
const { classifyMatchPublic } = require('../src/compare');

function classify({ dldParties, sfApplicants }) {
  const dldTxs = dldParties.map((name, i) => ({
    party_name: name,
    ft_share:   50,
    share_unit: 'F.T.',
    tx_type:    'Sell - Pre registration',
    tx_date:    '04/02/2024',
    tx_date_iso:'2024-02-04',
    amount_aed: 1000000 + i,
  }));
  const sfRow = {};
  if (sfApplicants[0]) sfRow.applicant_name    = sfApplicants[0];
  if (sfApplicants[1]) sfRow.applicant_2_name  = sfApplicants[1];
  if (sfApplicants[2]) sfRow.applicant_3_name  = sfApplicants[2];
  if (sfApplicants[3]) sfRow.applicant_4_name  = sfApplicants[3];
  if (sfApplicants[4]) sfRow.applicant_details = sfApplicants[4];
  // dldUnit only used for status fallthrough; not relevant to buyer match.
  return classifyMatchPublic({ unit_number: 'P-1' }, dldTxs, sfRow, null);
}

test('classifyMatch: clean primary-vs-primary match → MATCH, no flag', () => {
  const r = classify({ dldParties: ['ALICE'], sfApplicants: ['ALICE'] });
  assert.equal(r.status, 'MATCH');
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: DLD co-buyer matches SF primary → MATCH + A12', () => {
  const r = classify({ dldParties: ['ALICE', 'BOB'], sfApplicants: ['BOB'] });
  assert.equal(r.status, 'MATCH');
  assert.ok((r.flags || []).includes('A12'), 'expected A12 flag, got: ' + JSON.stringify(r.flags));
});

test('classifyMatch: no overlap anywhere → BUYER_MISMATCH', () => {
  const r = classify({ dldParties: ['ALICE', 'BOB'], sfApplicants: ['CAROL'] });
  assert.equal(r.status, 'BUYER_MISMATCH');
});

test('classifyMatch: bank entries do not satisfy the match', () => {
  const r = classify({
    dldParties: ['EMIRATES NBD MORTGAGES', 'ALICE'],
    sfApplicants: ['ALICE']
  });
  assert.equal(r.status, 'MATCH');
  // Bank is filtered, so primary becomes ALICE; clean match → no A12.
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: empty-name DLD entries do not satisfy the match', () => {
  const r = classify({
    dldParties: [null, 'ALICE'],
    sfApplicants: ['ALICE']
  });
  assert.equal(r.status, 'MATCH');
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: DLD primary matches SF co-applicant → MATCH + A12', () => {
  const r = classify({
    dldParties: ['ALICE'],
    sfApplicants: ['BOB', 'ALICE']  // ALICE is in applicant_2_name
  });
  assert.equal(r.status, 'MATCH');
  assert.ok((r.flags || []).includes('A12'));
});
```

- [ ] **Step 3.2: Run and verify failure**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: 6 new tests FAIL — `classifyMatchPublic is not a function`, plus existing logic doesn't emit `A12` or check non-primary buyers.

- [ ] **Step 3.3: Modify `classifyMatch` in `src/compare.js`**

Locate `classifyMatch` (around line 200). The current `nameState` block at lines 220-222 is:
```javascript
  let nameState;
  if (!dldBuyer || !haveSfName) nameState = 'unknown';
  else nameState = namesOverlap(dldBuyer, sfRow.applicant_name) ? 'match' : 'mismatch';
```

Replace that block with:
```javascript
  // Multi-buyer ANY-MATCH: collect every DLD buyer and every populated SF applicant,
  // then check if any pairing matches. Emit A12 when the match was found via a
  // non-clean (i.e. not primary-vs-primary) pairing — see spec
  // docs/superpowers/specs/2026-05-04-multi-buyer-matching-design.md.
  const dldBuyersAll  = collectDldBuyers(dldTxs).filter(b => b.kind === 'buyer');
  const sfApplicants  = collectSfApplicants(sfRow);
  const dldNamesForMatch = dldBuyersAll.map(b => b.name).filter(Boolean);
  // Override-only path: when DLD has no natural buyer but an override is configured.
  if (dldBuyersAll.length === 0 && overrideBuyer) dldNamesForMatch.push(overrideBuyer);
  const flags = [];

  let nameState;
  if (dldNamesForMatch.length === 0 || sfApplicants.length === 0) {
    nameState = 'unknown';
  } else {
    const cleanPair = namesOverlap(dldNamesForMatch[0], sfApplicants[0].name);
    const anyPair   = dldNamesForMatch.some(d => sfApplicants.some(s => namesOverlap(d, s.name)));
    if (cleanPair) {
      nameState = 'match';
    } else if (anyPair) {
      nameState = 'match';
      flags.push('A12');
    } else {
      nameState = 'mismatch';
    }
  }
```

Then update every `return` statement in `classifyMatch` to include `flags`. The function has four return statements; modify each:

1. `DLD_ONLY` early return (around line 201) — add `flags: []`:
```javascript
  if (!sfRow) return {
    status: 'DLD_ONLY',
    reasons: ['no SF'],
    priceDelta: { diff: null, pct: null, direction: null },
    nameState: 'none',
    usedOverride: false,
    flags: []
  };
```

2. `BUYER_MISMATCH` return (around line 231) — change to:
```javascript
    return { status: 'BUYER_MISMATCH', reasons, priceDelta: delta, nameState, usedOverride, flags };
```

3. `PRICE_UP` / `PRICE_DOWN` return (around line 238) — change to:
```javascript
    return { status, reasons, priceDelta: delta, nameState, usedOverride, flags };
```

4. `MATCH` returns (lines 241-242) — change to:
```javascript
  if (usedOverride) return { status: 'MATCH', reasons: ['override'], priceDelta: delta, nameState, usedOverride, flags };
  return { status: 'MATCH', reasons: [], priceDelta: delta, nameState, usedOverride, flags };
```

- [ ] **Step 3.4: Add `classifyMatchPublic` to module.exports**

For testability, expose `classifyMatch` under a public name. At the bottom of `src/compare.js`, update the exports:
```javascript
module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap, collectDldBuyers, collectSfApplicants, classifyMatchPublic: classifyMatch };
```

- [ ] **Step 3.5: Run the new tests and verify they pass**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: all 16 tests in this file pass.

- [ ] **Step 3.6: Run the full suite**

Run: `npm test`
Expected: baseline + 16. Some pre-existing tests may have referenced the old `classifyMatch` return shape — if any fail because they don't expect the new `flags` field on the returned object, fix the assertion to `.partialDeepStrictEqual` or simply check the fields under test. Do NOT remove `flags` from the production code.

If a pre-existing test fails for a different reason, stop and report BLOCKED with the failing test name and message.

- [ ] **Step 3.7: Commit**

```
git add src/compare.js test/compare-multi-buyer.test.js
git commit -m "feat(compare): ANY-MATCH rule with A12 flag for non-primary alignments"
```

---

## Task 4: Result-row enrichment — `dld_buyers`, `sf_applicants`, `match_flags`

The compare HTML and audit HTML both consume `result.rows`. To render the new columns, each row needs the buyer/applicant arrays alongside the existing scalar fields. Also expose `flags` on each row so the HTML can render flag chips later (and so the CSV captures the audit trail).

**Files:**
- Modify: `src/compare.js`

- [ ] **Step 4.1: Add failing test**

Append to `test/compare-multi-buyer.test.js`:
```javascript
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

test('compareProject result rows expose dld_buyers, sf_applicants, match_flags', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix) VALUES (?, ?, ?)').run('Eps', 'Eps Sub', 'P').lastInsertRowid;
  const snap = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, imported_at, total_units, total_tx) VALUES (?, 'csv', 'fake.csv', '2026-01-01', '2026-01-01 10:00:00', 1, 1)`).run(pid).lastInsertRowid;
  const uid  = db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area, unit_type) VALUES (?, ?, '1', '1', 100, 'Apt')`).run(snap, pid).lastInsertRowid;
  db.prepare(`INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed) VALUES (?, ?, ?, 'ALICE', 50, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1000000)`).run(uid, snap, pid);
  db.prepare(`INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed) VALUES (?, ?, ?, 'BOB',   50, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1000000)`).run(uid, snap, pid);

  const sfSnap = db.prepare(`INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 1)`).run().lastInsertRowid;
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, 'Eps Sub', 'P-1', 'P-1', 'BOB', 1000000)`).run(sfSnap);

  const result = compareProject(db, pid);
  assert.equal(result.status || 'ok', 'ok'); // some paths return undefined status
  const row = result.rows.find(r => r.dld_unit_number === '1');
  assert.ok(row, 'expected unit 1 in result rows');
  assert.equal(row.match_status, 'MATCH', 'BOB matches in DLD co-buyer position');
  assert.deepEqual(row.match_flags || [], ['A12']);
  assert.ok(Array.isArray(row.dld_buyers), 'dld_buyers should be an array');
  assert.equal(row.dld_buyers.length, 2);
  assert.deepEqual(row.dld_buyers.map(b => b.name).sort(), ['ALICE', 'BOB']);
  assert.ok(Array.isArray(row.sf_applicants), 'sf_applicants should be an array');
  assert.equal(row.sf_applicants.length, 1);
  assert.equal(row.sf_applicants[0].name, 'BOB');
});
```

- [ ] **Step 4.2: Run and verify failure**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: the new test fails — `dld_buyers` / `sf_applicants` / `match_flags` are not on the row yet.

- [ ] **Step 4.3: Add the new fields to result rows in `compareProject`**

In `src/compare.js`, locate the `rows.push({...})` block around line 384 (the main per-unit row construction). Add three new fields right after `match_reasons`:
```javascript
      match_status:             cls.status,
      match_reasons:            (cls.reasons || []).join('; '),
      match_flags:              cls.flags || [],
      dld_buyers:               collectDldBuyers(dldTxs),
      sf_applicants:            collectSfApplicants(sfRow)
    });
```

Also in the SF-only path around line 419 (`for (const b of sfBookings) { if (!matchedSfUnits.has(b.unit_norm))`), add the same three fields to the row push:
```javascript
        match_status:        'SF_ONLY',
        match_reasons:       'no DLD',
        match_flags:         [],
        dld_buyers:          [],
        sf_applicants:       collectSfApplicants(b)
      });
```

- [ ] **Step 4.4: Run and verify pass**

Run: `node --test test/compare-multi-buyer.test.js`
Expected: all 17 tests pass.

- [ ] **Step 4.5: Run full suite**

Run: `npm test`
Expected: baseline + 17. If any pre-existing compare test breaks because it iterates row keys and now sees three new ones, fix to whitelist the original keys it cares about.

- [ ] **Step 4.6: Commit**

```
git add src/compare.js test/compare-multi-buyer.test.js
git commit -m "feat(compare): add dld_buyers / sf_applicants / match_flags to result rows"
```

---

## Task 5: `src/buyer-cells.js` — pure HTML renderers

New file. Two pure functions that turn the data shapes from Tasks 1-2 into `<td>` HTML strings. Also export the shared CSS snippet so each report can include it once.

**Files:**
- Create: `src/buyer-cells.js`
- Create: `test/buyer-cells.test.js`

- [ ] **Step 5.1: Create `test/buyer-cells.test.js` with the first batch of failing tests**

Create the file:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS } = require('../src/buyer-cells');

test('renderDldBuyersCell with empty array returns simple <td>0</td>', () => {
  assert.equal(renderDldBuyersCell([]), '<td data-sort-val="0">0</td>');
});

test('renderDldBuyersCell with three buyers shows count 3 and three <li>', () => {
  const html = renderDldBuyersCell([
    { name: 'AHMAD MUJTABA MURTAZA', areaSqm: 34.68, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
    { name: 'AHMAD MUSADIQ MURTAZA', areaSqm: 34.68, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
    { name: 'AHMAD MUSADIQ MURTAZA', areaSqm: 69.36, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
  ]);
  assert.match(html, /<summary>3<\/summary>/);
  const liCount = (html.match(/<li/g) || []).length;
  assert.equal(liCount, 3);
  assert.match(html, /AHMAD MUJTABA MURTAZA/);
  assert.match(html, /34\.68 SQM/);
  assert.match(html, /1,612,613 AED/);
  assert.match(html, /Sell/);
  assert.match(html, /Pre registration/);
  assert.match(html, /04\/02\/2024/);
});

test('renderDldBuyersCell counts only buyers; bank/seller appear in dropdown labeled', () => {
  const html = renderDldBuyersCell([
    { name: 'AHMAD',                  areaSqm: 50,    amountAed: 1000000, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
    { name: 'EMIRATES NBD MORTGAGES', areaSqm: 50,    amountAed: 1000000, txType: 'Mortgage', txSubtype: '', date: '', kind: 'bank' },
    { name: null,                     areaSqm: 78.56, amountAed: 1000000, txType: 'Sell', txSubtype: '', date: '', kind: 'seller' },
  ]);
  assert.match(html, /<summary>1<\/summary>/, 'count should be 1 (buyer-only)');
  assert.match(html, /\[bank\]/);
  assert.match(html, /\[seller — name not captured\]/);
  const liCount = (html.match(/<li/g) || []).length;
  assert.equal(liCount, 3);
});

test('renderDldBuyersCell relabels F.T. value as SQM regardless of source unit', () => {
  // areaSqm is already the numeric value; the renderer displays it with the SQM label.
  const html = renderDldBuyersCell([
    { name: 'A', areaSqm: 34.68, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' }
  ]);
  assert.match(html, /34\.68 SQM/);
  assert.doesNotMatch(html, /F\.T\./);
});

test('renderDldBuyersCell sets data-sort-val to the buyer count for numeric sort', () => {
  const html = renderDldBuyersCell([
    { name: 'A', areaSqm: 50, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
    { name: 'B', areaSqm: 50, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
  ]);
  assert.match(html, /data-sort-val="2"/);
});

test('renderSfApplicantsCell with one applicant shows count 1 with (primary) role', () => {
  const html = renderSfApplicantsCell([
    { name: 'JOHN SMITH', role: 'primary', kind: 'applicant' }
  ]);
  assert.match(html, /<summary>1<\/summary>/);
  assert.match(html, /JOHN SMITH/);
  assert.match(html, /\(primary\)/);
});

test('renderSfApplicantsCell with three populated slots shows correct role labels', () => {
  const html = renderSfApplicantsCell([
    { name: 'JOHN',  role: 'primary',     kind: 'applicant' },
    { name: 'JANE',  role: 'applicant_2', kind: 'applicant' },
    { name: 'KIDS',  role: 'applicant_3', kind: 'applicant' },
  ]);
  assert.match(html, /<summary>3<\/summary>/);
  assert.match(html, /\(primary\)/);
  assert.match(html, /\(applicant_2\)/);
  assert.match(html, /\(applicant_3\)/);
});

test('renderSfApplicantsCell with empty array returns dash placeholder', () => {
  assert.equal(renderSfApplicantsCell([]), '<td data-sort-val="0">—</td>');
});

test('BUYER_CELLS_CSS exports a non-empty CSS string', () => {
  assert.equal(typeof BUYER_CELLS_CSS, 'string');
  assert.ok(BUYER_CELLS_CSS.length > 0);
  assert.match(BUYER_CELLS_CSS, /\.buyer-list/);
  assert.match(BUYER_CELLS_CSS, /\.applicant-list/);
});
```

- [ ] **Step 5.2: Run and verify all fail**

Run: `node --test test/buyer-cells.test.js`
Expected: FAIL — `Cannot find module '../src/buyer-cells'`.

- [ ] **Step 5.3: Create `src/buyer-cells.js`**

Create the file:
```javascript
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '';
  return Math.round(Number(v)).toLocaleString();
}

function fmtArea(v) {
  if (v == null || isNaN(v)) return '';
  // Display always says SQM regardless of source share_unit ('F.T.' or 'SQ.M.').
  // The raw share_unit value is preserved in dld_transaction.share_unit for audit.
  const n = Number(v);
  return (Math.round(n * 100) / 100).toFixed(2) + ' SQM';
}

function renderDldBuyerLi(b) {
  const cls = b.kind === 'bank' ? ' class="bank"' : (b.kind === 'seller' ? ' class="seller"' : '');
  const label = b.kind === 'bank'   ? '[bank] ' :
                b.kind === 'seller' ? '[seller — name not captured] ' : '';
  const parts = [];
  parts.push(label + escHtml(b.name || ''));
  if (b.areaSqm != null)   parts.push(fmtArea(b.areaSqm));
  if (b.amountAed != null) parts.push(fmtMoney(b.amountAed) + ' AED');
  if (b.txType)            parts.push(escHtml(b.txType));
  if (b.txSubtype)         parts.push(escHtml(b.txSubtype));
  if (b.date)              parts.push(escHtml(b.date));
  return '<li' + cls + '>' + parts.filter(Boolean).join(' · ') + '</li>';
}

function renderDldBuyersCell(buyers) {
  const list = Array.isArray(buyers) ? buyers : [];
  const buyerCount = list.filter(b => b.kind === 'buyer').length;
  if (list.length === 0) return '<td data-sort-val="0">0</td>';
  const items = list.map(renderDldBuyerLi).join('');
  return '<td data-sort-val="' + buyerCount + '">' +
    '<details><summary>' + buyerCount + '</summary>' +
    '<ul class="buyer-list">' + items + '</ul></details></td>';
}

function renderSfApplicantLi(a) {
  return '<li>' + escHtml(a.name) + ' <small>(' + escHtml(a.role) + ')</small></li>';
}

function renderSfApplicantsCell(applicants) {
  const list = Array.isArray(applicants) ? applicants : [];
  if (list.length === 0) return '<td data-sort-val="0">—</td>';
  const items = list.map(renderSfApplicantLi).join('');
  return '<td data-sort-val="' + list.length + '">' +
    '<details><summary>' + list.length + '</summary>' +
    '<ul class="applicant-list">' + items + '</ul></details></td>';
}

const BUYER_CELLS_CSS = `
  .buyer-list, .applicant-list { margin: 4px 0 0; padding-left: 18px; font-size: 11px; }
  .buyer-list li, .applicant-list li { list-style: none; margin: 2px 0; }
  .buyer-list li.bank, .buyer-list li.seller { color: #666; font-style: italic; }
  details > summary { cursor: pointer; user-select: none; }
  details[open] > summary { font-weight: 600; }
`;

module.exports = { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS };
```

- [ ] **Step 5.4: Run and verify all pass**

Run: `node --test test/buyer-cells.test.js`
Expected: 9 tests pass.

- [ ] **Step 5.5: Run full suite**

Run: `npm test`
Expected: baseline + 17 (compare) + 9 (buyer-cells) = baseline + 26.

- [ ] **Step 5.6: Commit**

```
git add src/buyer-cells.js test/buyer-cells.test.js
git commit -m "feat(buyer-cells): pure HTML renderers for DLD buyers and SF applicants"
```

---

## Task 6: Wire renderers into compare HTML

Add the two new columns to `writeCompareHtml` and ensure the existing search/sort still work.

**Files:**
- Modify: `src/compare.js` (the `writeCompareHtml` function and its column definitions)

- [ ] **Step 6.1: Add the import at the top of `src/compare.js`**

Locate the existing requires block at the top of `src/compare.js`. Add:
```javascript
const { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS } = require('./buyer-cells');
```

- [ ] **Step 6.2: Add the two new columns to the column definitions**

In `src/compare.js`, find the column definitions used by `writeCompareHtml`. Around line 541 there is:
```javascript
    { key: 'dld_purchase_party',  label: 'DLD Buyer',        align: 'left' },
    { key: 'sf_applicant',        label: 'SF Applicant',     align: 'left' },
```
Right after these two, add:
```javascript
    { key: 'dld_count',           label: 'DLD #',            align: 'center', html: true },
    { key: 'sf_count',            label: 'SF #',             align: 'center', html: true },
```

Now find the cell-rendering loop in the same function — it currently does something like `row[col.key]` to produce a `<td>` per column. Locate it (look for where `columns.map` is used inside the row-rendering function; somewhere around the body building of the HTML). Modify the cell rendering to special-case `html: true` columns, replacing the default `<td>${escHtml(...)}</td>` path. The change is one branch inside the existing per-cell loop:

If the existing rendering is something like:
```javascript
  const renderCell = (col, r) => {
    // ... existing logic ...
    return `<td ...>${html}</td>`;
  };
```
Add at the top of `renderCell`:
```javascript
  const renderCell = (col, r) => {
    if (col.html && col.key === 'dld_count') return renderDldBuyersCell(r.dld_buyers || []);
    if (col.html && col.key === 'sf_count')  return renderSfApplicantsCell(r.sf_applicants || []);
    // ... existing logic ...
  };
```

If the function uses a different shape (e.g. inline string concatenation instead of a `renderCell` helper), insert the same two-branch lookup at the cell construction point. Read the file in context around the column rendering before editing.

- [ ] **Step 6.3: Inject the shared CSS into the compare HTML template**

In `writeCompareHtml`, locate the `<style>` block in the HTML template literal. At the very end of the inline CSS (just before `</style>`), inject the shared CSS:
```javascript
  ${BUYER_CELLS_CSS}
```

(The `${}` interpolation works because `BUYER_CELLS_CSS` is in scope from the require at the top of the file.)

- [ ] **Step 6.4: Verify compare HTML still generates without error**

Smoke test by running compare on a real project (skip if DB is empty):
```
node index.js compare 2>&1 | tail -10
```
Expected: command finishes, an `output/<project>.compare.html` file exists. Open it in a browser. Verify:
- Two new columns appear after `DLD Buyer` and `SF Applicant`.
- Each cell shows a count number; clicking expands a list.
- Existing columns, search box, sort, and chip filters still work.
- No JS errors in the browser console.

If the DB has no projects, the command will print `no projects in DB` — that's still success for this step.

- [ ] **Step 6.5: Run full test suite**

Run: `npm test`
Expected: still all green at baseline + 26.

- [ ] **Step 6.6: Commit**

```
git add src/compare.js
git commit -m "feat(compare-html): add DLD # and SF # columns with click-to-expand dropdowns"
```

---

## Task 7: Wire renderers into diff HTML

The diff report is purely DLD-vs-DLD month-over-month. Add the two new columns showing the **latest snapshot's** buyers and the cross-referenced SF booking's applicants for each unit row. Tx-level rows (`NEW_TX`, `MISSING_TX`, `AMOUNT_CHANGED`) get the same context for the unit they belong to.

**Files:**
- Modify: `src/diff.js`

- [ ] **Step 7.1: Add the import at the top of `src/diff.js`**

Locate the requires block at the top. Add:
```javascript
const { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS } = require('./buyer-cells');
const { collectDldBuyers, collectSfApplicants } = require('./compare');
```

- [ ] **Step 7.2: Load the latest SF snapshot once per project in `diffProject`**

In `src/diff.js`, locate the function `diffProject` (around line 98). After the snapshot pair is selected (after the `picked.status !== 'ok'` block) and before the row-comparison loop starts, load the SF context:
```javascript
  // Load latest SF booking by unit_norm for the project so we can render the SF #
  // column on each unit row in the diff. Empty when no SF data exists.
  const sfSnap = db.prepare(`SELECT * FROM v_latest_sf_snapshot LIMIT 1`).get();
  const sfBookingsByUnit = new Map();
  if (sfSnap) {
    const mapping = db.prepare(`SELECT * FROM project_mapping WHERE project_id = ?`).get(projectId) || {};
    if (mapping.sf_sub_project) {
      const bookings = db.prepare(
        `SELECT * FROM sf_booking WHERE sf_snapshot_id = ? AND sub_project = ?`
      ).all(sfSnap.sf_snapshot_id, mapping.sf_sub_project);
      for (const b of bookings) if (b.unit_norm) sfBookingsByUnit.set(b.unit_norm, b);
    }
  }
```

- [ ] **Step 7.3: Attach buyers/applicants to each row's unitRow object**

The existing `unitRow(unitNumber, u, n)` helper inside `diffProject` builds the per-row metadata. Replace the helper definition with a version that also attaches `dld_buyers` and `sf_applicants`:
```javascript
  const unitRow = (unitNumber, u, n) => {
    const txs = (n && n.transactions) || (u && u.transactions) || [];
    const sfKey = (n && n.unit_number_norm) || (u && u.unit_number_norm) || unitNumber;
    const sfBooking = sfBookingsByUnit.get(sfKey) || null;
    return {
      unit_number:   unitNumber,
      unit_type:     (n && n.unit_type) || (u && u.unit_type) || null,
      dld_unit_id:   (n && n.dld_unit_id) || (u && u.dld_unit_id) || null,
      building:      (n && n.building_name) || (u && u.building_name) || null,
      dld_buyers:    collectDldBuyers(txs),
      sf_applicants: collectSfApplicants(sfBooking)
    };
  };
```

- [ ] **Step 7.4: Add the two columns to `writeDiffHtml`**

In `writeDiffHtml`, find the `columns` array (around line 213-221). Replace it with:
```javascript
  const columns = [
    { key: 'unit_number',    label: 'Unit',     align: 'left' },
    { key: 'unit_type',      label: 'Type',     align: 'left' },
    { key: 'building',       label: 'Building', align: 'left' },
    { key: 'change_type',    label: 'Change',   align: 'left' },
    { key: 'category',       label: 'Scope',    align: 'left' },
    { key: 'dld_count',      label: 'DLD #',    align: 'center', html: true },
    { key: 'sf_count',       label: 'SF #',     align: 'center', html: true },
    { key: 'old_value',      label: 'Was',      align: 'left' },
    { key: 'new_value',      label: 'Now',      align: 'left' },
    { key: 'detail',         label: 'Detail',   align: 'left' }
  ];
```

Locate `renderCell` further down in the same function. Add the two-branch lookup at the very top:
```javascript
  const renderCell = (col, r) => {
    if (col.html && col.key === 'dld_count') return renderDldBuyersCell(r.dld_buyers || []);
    if (col.html && col.key === 'sf_count')  return renderSfApplicantsCell(r.sf_applicants || []);
    // ... existing logic ...
  };
```

- [ ] **Step 7.5: Inject the shared CSS into the diff HTML template**

In `writeDiffHtml`, find the `<style>` block. Add at the end (just before `</style>`):
```javascript
  ${BUYER_CELLS_CSS}
```

- [ ] **Step 7.6: Smoke test**

Run:
```
node index.js diff 2>&1 | tail -10
```
Open one of the resulting `output/<project>.diff.html` files. Verify:
- New `DLD #` and `SF #` columns appear between `Scope` and `Was`.
- Counts reflect the unit's buyers/applicants in the latest snapshot.
- Existing change_type chip filters and search still work.

If the DB has no diffs to render, the command will skip projects with `not-enough-snapshots` — that's still success.

- [ ] **Step 7.7: Run full test suite**

Run: `npm test`
Expected: still all green at baseline + 26.

- [ ] **Step 7.8: Commit**

```
git add src/diff.js
git commit -m "feat(diff-html): add DLD # and SF # columns to month-over-month diff"
```

---

## Task 8: Wire renderers into audit HTML

The audit report (`src/audit-report.js`) presents per-project audit summaries. Add the same two columns to its row table.

**Files:**
- Modify: `src/audit-report.js`

- [ ] **Step 8.1: Inspect the audit report's row source and column layout**

Run: `grep -nE "columns|<th|<td|renderCell" src/audit-report.js | head -30`

Read the file to understand:
- Where rows come from (likely from `compareProject` results piped through, or its own query).
- Whether the row objects already carry `dld_buyers` / `sf_applicants` (they will if rows came from `compareProject` after Task 4) or whether you need to attach them.
- Where the column array is defined and where cells are rendered.

If rows DO come from `compareProject`, the audit report inherits the new fields automatically and you only need to add the columns. If it builds its own rows, you need to call `collectDldBuyers` / `collectSfApplicants` while constructing them.

- [ ] **Step 8.2: Add the import**

At the top of `src/audit-report.js`, add:
```javascript
const { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS } = require('./buyer-cells');
```

If rows are built locally and lack `dld_buyers` / `sf_applicants`, also add:
```javascript
const { collectDldBuyers, collectSfApplicants } = require('./compare');
```

- [ ] **Step 8.3: Add the two columns and the cell renderer branches**

Locate the column definition array in `src/audit-report.js` and insert the two new columns at a sensible position (after the existing buyer column if any, or at the end of the row block):
```javascript
    { key: 'dld_count', label: 'DLD #', align: 'center', html: true },
    { key: 'sf_count',  label: 'SF #',  align: 'center', html: true },
```

Locate the per-cell rendering (whether a `renderCell` helper or inline). Add the two-branch lookup at the top:
```javascript
    if (col.html && col.key === 'dld_count') return renderDldBuyersCell(r.dld_buyers || []);
    if (col.html && col.key === 'sf_count')  return renderSfApplicantsCell(r.sf_applicants || []);
```

If rows lack the buyer/applicant arrays, populate them at row construction time, e.g.:
```javascript
    row.dld_buyers    = collectDldBuyers(rowDldTxs);
    row.sf_applicants = collectSfApplicants(rowSfBooking);
```
(The exact variable names depend on how this file builds rows; read in context before editing.)

- [ ] **Step 8.4: Inject the shared CSS**

Locate the `<style>` block in the audit HTML template and add at the end:
```javascript
${BUYER_CELLS_CSS}
```

- [ ] **Step 8.5: Smoke test**

Run:
```
node index.js audit 2>&1 | tail -10
```
Or whichever audit subcommand is exposed (`audit-delta`, `audit-report`, etc.). Open the resulting HTML and verify the new columns work.

- [ ] **Step 8.6: Run full test suite**

Run: `npm test`
Expected: still all green at baseline + 26.

- [ ] **Step 8.7: Commit**

```
git add src/audit-report.js
git commit -m "feat(audit-html): add DLD # and SF # columns to audit report"
```

---

## Task 9: Final integration check

- [ ] **Step 9.1: Run the full pipeline end-to-end**

Run: `node index.js`
Expected:
- `[1/4]` through `[5/5]` all complete.
- The compare step writes HTML files containing the new columns.
- The diff step writes HTML files containing the new columns.
- No crashes, no JS errors when opening the rendered HTML.

- [ ] **Step 9.2: Run the full test suite**

Run: `npm test`
Expected: total = baseline + 26. Breakdown: `test/compare-multi-buyer.test.js` contributes 17 tests (6 from Task 1 + 4 from Task 2 + 6 from Task 3 + 1 from Task 4), `test/buyer-cells.test.js` contributes 9 tests from Task 5. All green; no pre-existing tests fail.

- [ ] **Step 9.3: Confirm git log**

Run: `git log --oneline master..HEAD`
Expected (newest first):
```
feat(audit-html): add DLD # and SF # columns to audit report
feat(diff-html): add DLD # and SF # columns to month-over-month diff
feat(compare-html): add DLD # and SF # columns with click-to-expand dropdowns
feat(buyer-cells): pure HTML renderers for DLD buyers and SF applicants
feat(compare): add dld_buyers / sf_applicants / match_flags to result rows
feat(compare): ANY-MATCH rule with A12 flag for non-primary alignments
feat(compare): collectSfApplicants helper with forward-compat 5-slot iteration
feat(compare): collectDldBuyers helper with kind classification
docs: spec for multi-buyer matching & display
```
Nine commits ahead of `master`.

- [ ] **Step 9.4: Sanity-check a real BUYER_MISMATCH that should now match**

If you have prior compare runs showing BUYER_MISMATCH counts, re-run compare on the same DB and confirm the count dropped (because units where DLD has multi-buyers and SF lists a co-buyer as primary now classify as MATCH+A12). Record the before/after numbers in a one-line summary you'll keep for the merge PR description.

---

## Out of Scope Reminders

These are intentionally NOT in this plan (per spec §Non-Goals):

- No DB schema changes.
- No CLI flag changes.
- No menu UI changes.
- No name-variant deduplication in display.
- No SF ingestion changes (only forward-compat code).
- No cross-project summary HTML (separate spec, deferred).
- No A10 changes (the area-matching branch still lands separately).

If any of these come up during implementation, stop and revisit the spec — they belong in a separate feature.

---

## Rebase Note

Master is at `e24834c` and does NOT yet include `feat/multi-applicant-and-area-matching` (which adds A10 + area-matching + `manual_area`). When that branch lands later, this branch will need to rebase. Expected conflicts:

- `src/compare.js` — both branches modify `classifyMatch` and the result row push. The merge resolution: keep both flags (A10 + A12 coexist) and both row-shape additions.
- HTML column lists — both branches add new columns. Merge: include all of them.

No DB schema conflict (no schema changes here). No test conflict (different test files).
