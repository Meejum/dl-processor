# Multi-Buyer Matching & Display — Design

**Date:** 2026-05-04
**Author:** Ali Alghumlasi (with Claude)
**Status:** Approved for spec; implementation deferred until two pending branches merge.
**Branch (spec only):** `feat/multi-buyer-matching` (off `master`).

---

## Problem

DLD reports often record multiple buyers per unit (joint owners, co-buyers, name variants). Today's compare logic reduces a DLD unit to ONE name (`dld_purchase_party`) and checks it against the SF booking's primary applicant. Result:

- Daily runs flag dozens of false `BUYER_MISMATCH` cases per project. Across the 30-project pipeline, ~50 false BUYER cases on Sobha Hartland Waves alone, similar counts elsewhere.
- A real common case: DLD lists 3 buyers (Alice, Bob, Carol). SF lists Bob as the primary applicant. Today this is BUYER_MISMATCH. With every-name-vs-every-applicant matching, it's a clean MATCH.
- Reports show only one buyer per unit, hiding the fact that multi-buyer units exist at all.

The DB already stores every buyer (`dld_transaction` has one row per party_name with share + amount + date), and the schema supports up to 5 SF applicant slots (`applicant_name`, `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, `applicant_details`). The fix is in how we *consume* that data — matching logic and display.

This spec also locks in **F.T. → SQM display relabel**: DLD source writes `(34.68 F.T.)` but the registration team reads it as square meters; we relabel for display while preserving the raw `share_unit` value in the DB for audit.

## Goals

1. Match a unit as MATCH if **any** DLD party_name overlaps with **any** populated SF applicant slot. Reduce false BUYER_MISMATCH cases driven by primary-vs-co-buyer alignment differences between the two sources.
2. Surface every DLD buyer and every SF applicant in all HTML reports (`.compare.html`, `.diff.html`, `.audit.html`) via two new columns: `DLD #` and `SF #`. Each is a click-to-expand `<details>` element listing names with details.
3. Build the SF side with forward-compatibility for when ops starts filling co-applicant slots — no code change needed at that point.

## Non-Goals

- No DB schema changes. No new tables, no new columns. The data is already there.
- No CLI flags. This is a default-on display + match upgrade.
- No menu UI changes.
- No name-variant deduplication in display (`ABDUL RAB` and `ABDUL RAB ABDUL AZIZ` show as 2 rows). Matching uses `namesOverlap()` which already tolerates variants.
- No SF ingestion changes. The forward-compat code waits for ops to start populating co-applicants.
- No cross-project summary HTML — separate spec, deferred.
- No A10 changes. The existing area-matching-branch flag stays as-is. A12 is additive.

---

## Sequencing

This spec lands on `feat/multi-buyer-matching` (off `master`). **Implementation deferred** until both pending branches merge to master:

1. `feat/multi-applicant-and-area-matching` (A10 + area + manual_area, 13 commits, awaiting per-commit review).
2. `feat/dld-diff-polish` (CLI + HTML polish, 9 commits, MERGE-AS-IS approved 2026-05-04).

When ready to implement, rebase `feat/multi-buyer-matching` on the new master and proceed via `superpowers:writing-plans` then `superpowers:subagent-driven-development`.

---

## Decisions Locked

| # | Decision | Rationale |
|---|---|---|
| 1 | Scope = capture verify + match extension + display, in that mental order. | Captured 2026-05-04. The parser was confirmed already correct (every share marker emits its own `dld_transaction` row), so the actual work is matching + display. |
| 2 | Match rule = ANY-MATCH. Any DLD buyer × any SF applicant overlap → MATCH. | Most permissive option (`A` from brainstorm). Matches Ali's terms: "if one of them match count it as match." |
| 3 | New flag `A12` emitted when match was found via the broader rule (i.e. NOT via the clean primary-vs-primary pair). Coexists with A10. | Audit trail. Lets the team distinguish "clean match" from "match found in a non-primary slot or DLD co-buyer." |
| 4 | SF side iterates all 5 applicant slots unconditionally. | Today only `applicant_name` is populated. When ops starts filling co-applicants, the dropdown and matching auto-pick them up with zero code change. Code comment makes this intent explicit. |
| 5 | Apply to `compare.html`, `diff.html`, AND `audit.html` (and any other HTML output that lists units). | Single shared renderer helper used everywhere. |
| 6 | New columns: `DLD #` (count + dropdown) and `SF #` (count + dropdown). | Inserted right after the existing buyer column (or end of table if none). |
| 7 | Native HTML `<details>` element for the dropdown. | No JS dependency. Accessible by default. Sortable/filterable via existing report-level controls. |
| 8 | DLD count rule = buyers only; dropdown shows everything labeled (`[bank]`, `[seller — name not captured]`). | Honest count, full transparency. Option `B` from brainstorm. |
| 9 | F.T. → SQM relabel applies to display only. Raw `share_unit` value stays in DB. | DLD source writes `F.T.` but the team reads it as square meters. Relabel preserves audit trail. |
| 10 | No name-variant dedup in this iteration. | Hard problem, deferred. `namesOverlap()` already tolerates variants for matching. |

---

## Architecture (Approach 1)

Three layers:

1. **Data collection** — pure helpers in `src/compare.js` that gather buyers/applicants per unit:
   - `collectDldBuyers(transactions)` returns `[{ name, areaSqm, amountAed, txType, txSubtype, date, kind }]` where `kind ∈ {buyer, bank, seller}`. **Order:** first entry is the "primary" buyer — the party_name from the latest "Sell"-type transaction (matching today's `dld_purchase_party` definition), with banks and sellers de-prioritized to the end. This ordering is what `dldBuyers[0]` refers to in the matching pseudocode.
   - `collectSfApplicants(booking)` returns `[{ name, role, kind: 'applicant' }]` where `role ∈ {primary, applicant_2, applicant_3, applicant_4, applicant_details}`. Empty slots produce no entry. **Order:** primary first, then applicant_2..4 in numeric order, then applicant_details last (matching the SF schema's natural slot order).

2. **Matching** — `compareProject` uses the new collectors:
   ```
   dldBuyers    = collectDldBuyers(txs).filter(b => b.kind === 'buyer')
   sfApplicants = collectSfApplicants(booking)
   clean        = dldBuyers[0] && sfApplicants[0] && namesOverlap(dldBuyers[0].name, sfApplicants[0].name)
   anyMatch     = dldBuyers.some(d => sfApplicants.some(s => namesOverlap(d.name, s.name)))
   if (clean)         → MATCH
   else if (anyMatch) → MATCH + A12
   else               → BUYER_MISMATCH
   ```

3. **Rendering** — new file `src/buyer-cells.js` exporting two pure functions:
   - `renderDldBuyersCell(buyers)` → `<td>` HTML string.
   - `renderSfApplicantsCell(applicants)` → `<td>` HTML string.
   Used by `compare.js`, `diff.js`, `audit-report.js` consistently.

### Files Touched

| File | Change |
|---|---|
| `src/buyer-cells.js` | **New.** Two pure renderer functions. ~80 LOC. |
| `src/compare.js` | Add `collectDldBuyers` and `collectSfApplicants` helpers; switch matching to ANY-MATCH; emit `A12` flag; insert `DLD #` and `SF #` columns into compare HTML. |
| `src/diff.js` | Insert `DLD #` and `SF #` columns into diff HTML for unit-level rows. |
| `src/audit-report.js` | Insert `DLD #` and `SF #` columns into audit HTML. |
| `test/buyer-cells.test.js` | **New.** Renderer tests. ~150 LOC. |
| `test/compare.test.js` | **New.** Tests for ANY-MATCH semantics and A12 flag (no `compare.test.js` exists today; this file is created). |

No DB schema changes. No new CLI flags. No menu changes.

---

## Data Flow

### DLD side

```
dld_transaction rows for unit (latest snapshot, all party_name records)
        │
        ▼
collectDldBuyers(transactions)
        │
        ▼
[
  { name: "AHMAD MUJTABA MURTAZA", areaSqm: 34.68, amountAed: 1612613,
    txType: "Sell", txSubtype: "Pre registration", date: "2026-02-04",
    kind: "buyer" },
  { name: "EMIRATES NBD MORTGAGES", ..., kind: "bank" },          // BANK_PREFIX_RE flagged
  { name: null,                    ..., kind: "seller" },          // empty-name (anonymized seller)
]
```

- `kind` derived from: `null/empty name → seller`; matches `BANK_PREFIX_RE` → `bank`; otherwise `buyer`.
- `areaSqm` is `dld_transaction.ft_share` regardless of `share_unit` literal value (per F.T.→SQM relabel rule).
- `txType` and `txSubtype` come from splitting `dld_transaction.tx_type` on " - " (e.g. `"Sell - Pre registration"` → `Sell` + `Pre registration`).

### SF side

```
sf_booking row for unit
        │
        ▼
collectSfApplicants(booking)
        │
        ▼
[
  { name: "JOHN SMITH", role: "primary",     kind: "applicant" },
  { name: "JANE SMITH", role: "applicant_2", kind: "applicant" },  // only if applicant_2_name populated
  // applicant_3, applicant_4, applicant_details emitted only when populated
]
```

Forward-compat rule: iterate all 5 slots unconditionally. Today most bookings produce one entry; the dropdown and matching auto-extend the day ops starts filling co-applicants.

---

## HTML Rendering

Two new columns inserted after the existing buyer column (or at end of table if none).

### Column 1 — `DLD #`

```html
<td data-sort-val="3">
  <details>
    <summary>3</summary>
    <ul class="buyer-list">
      <li>AHMAD MUJTABA MURTAZA · 34.68 SQM · 1,612,613 AED · Sell · Pre registration · 04/02/2024</li>
      <li>AHMAD MUSADIQ MURTAZA · 34.68 SQM · 1,612,613 AED · Sell · Pre registration · 04/02/2024</li>
      <li>AHMAD MUSADIQ MURTAZA · 69.36 SQM · 1,612,613 AED · Sell · Pre registration · 04/02/2024</li>
      <li class="bank">[bank] EMIRATES NBD MORTGAGES · 50.00 SQM · …</li>
      <li class="seller">[seller — name not captured] · 78.56 SQM · …</li>
    </ul>
  </details>
</td>
```

- `<summary>` shows the **buyer count** (banks + sellers excluded).
- `<ul>` lists everything, with `[bank]` and `[seller — name not captured]` labels on the non-buyer rows.
- Empty unit (no DLD transactions): `<td>0</td>` — no `<details>`.

### Column 2 — `SF #`

```html
<td data-sort-val="1">
  <details>
    <summary>1</summary>
    <ul class="applicant-list">
      <li>JOHN SMITH (primary)</li>
      <!-- applicant_2..4 + applicant_details auto-render when populated -->
    </ul>
  </details>
</td>
```

- Empty (no booking matched): `<td>—</td>`.
- Role labels: `(primary)`, `(applicant_2)`, `(applicant_3)`, `(applicant_4)`, `(details)`.

### CSS

~15 lines added to each HTML template's `<style>` block (or, ideally, factored to a shared snippet):

```css
.buyer-list, .applicant-list { margin: 4px 0 0; padding-left: 18px; font-size: 11px; }
.buyer-list li, .applicant-list li { list-style: none; margin: 2px 0; }
.buyer-list li.bank, .buyer-list li.seller { color: #666; font-style: italic; }
details summary { cursor: pointer; user-select: none; }
details[open] summary { font-weight: 600; }
```

Sorting: `data-sort-val="<count>"` on the `<td>` so the existing numeric-sort detection works on the count value, not on the rendered `<summary>` text. Search: the names inside `<li>` are part of the row's existing `data-search` attribute, so the existing search box finds units by buyer name automatically.

---

## Edge Cases

| Pattern | Behavior |
|---|---|
| Empty-name share marker (anonymized seller) | Excluded from `DLD #` count and from match logic. Shown in dropdown labeled `[seller — name not captured]`. |
| Bank/lender row (matches `BANK_PREFIX_RE`) | Excluded from `DLD #` count and from match logic. Shown in dropdown labeled `[bank]`. |
| Joint owners with double-share entries (same person, different shares) | All rows shown. Counted as N entries. Match logic uses union of names — duplicates don't help or hurt. |
| Name variants (`ABDUL RAB` vs `ABDUL RAB ABDUL AZIZ`) | Shown as-is. Counted as 2. `namesOverlap()` already tolerates variants in matching, so no false BUYER_MISMATCH. Display dedup deferred. |
| Empty SF row (no booking found) | `SF #` cell shows `—`. No dropdown. |
| DLD has 0 buyers (parser found markers but all are banks/sellers) | `DLD #` shows `0`. Match logic returns BUYER_MISMATCH. |

---

## Testing

### `test/buyer-cells.test.js` (new)

1. `renderDldBuyersCell([])` → `<td>0</td>` (no `<details>`).
2. `renderDldBuyersCell` with 3 buyers → `<summary>3</summary>`, 3 `<li>` items containing name + SQM + AED + tx_type + date.
3. `renderDldBuyersCell` with 2 buyers + 1 bank + 1 seller → `<summary>2</summary>`, 4 `<li>` items (bank labeled `[bank]`, seller labeled `[seller — name not captured]`).
4. SQM relabel: input `share_unit: 'F.T.'` displays as `SQM`; `share_unit: 'SQ.M.'` also displays as `SQM`.
5. `renderSfApplicantsCell` with only `applicant_name` populated → `<summary>1</summary>`, 1 `<li>` labeled `(primary)`.
6. `renderSfApplicantsCell` with 3 populated slots → `<summary>3</summary>`, 3 `<li>` items with correct role labels.
7. `renderSfApplicantsCell` with null booking → `<td>—</td>`.

### `test/compare.test.js` (new)

8. DLD = `[Alice, Bob]`, SF `applicant_name = "Alice"` → MATCH, no flag.
9. DLD = `[Alice, Bob]`, SF `applicant_name = "Bob"` → MATCH + A12 (DLD primary was Alice; Bob is co-buyer matching SF primary).
10. DLD = `[Alice, Bob]`, SF `applicant_name = "Carol"` → BUYER_MISMATCH.
11. DLD = `[Alice]`, SF `applicant_name = "Alice"` → MATCH, no A12 (single-buyer single-applicant clean primary).
12. Bank entries ignored — DLD = `[EMIRATES NBD MORTGAGES, Alice]`, SF `applicant_name = "Alice"` → MATCH (clean primary; bank dropped).
13. Empty-name entries ignored similarly.

All run via existing `npm test`.

---

## Estimated Footprint

- `src/buyer-cells.js`: ~80 LOC (new file).
- `src/compare.js`: ~80 LOC modified (new collectors + match-rule extension + column injection).
- `src/diff.js`: ~30 LOC modified (column injection on unit rows).
- `src/audit-report.js`: ~30 LOC modified (column injection).
- `test/buyer-cells.test.js`: ~150 LOC new.
- `test/compare.test.js`: ~80 LOC added.
- Total: roughly 6 commits, single PR after pending branches merge.

---

## Open Questions

None remaining at brainstorm close (2026-05-04). All scope, behavior, and UX decisions confirmed.

When implementation resumes (after pending branches merge), the next step is `superpowers:writing-plans` against this spec.
