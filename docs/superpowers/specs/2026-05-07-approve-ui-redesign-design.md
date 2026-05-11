# Approve-Pending UI Redesign — Design

**Date:** 2026-05-07
**Status:** Pending user approval. To be implemented on top of `feat/m-approval-extensions` (the parent branch shipping items m basic UI on 2026-05-07).
**Parent spec:** `docs/superpowers/specs/2026-05-06-approval-extensions-design.md` (item m basic).
**Item ID:** m-redesign (extension of item m).

---

## Scope

Redesign of `output/approve-pending.html` (currently a single flat sortable table) into a project-aware, SF-aware, override-capable approval UI based on Ali's hands-on feedback after running `review-pending` against real data (1740 pending across 3 projects, mostly Sobha Creek Vistas Heights).

Five additive changes:

1. **4 sections** — Buyer, Price, Area, Other (status + procedure_number) — instead of one mixed table.
2. **Project grouping inside each section** — plain group headers like `Sobha Creek Vistas Heights — 591 pending`, then the rows.
3. **Salesforce unit number column** — joined via `project_mapping → sf_booking` (the existing pattern in `src/compare.js:457`). When no SF match exists, falls back to DLD `unit_number_norm` with a `[DLD only]` badge.
4. **Editable proposed-value cell** — the right half of the "Old → Proposed" cell is an `<input>` pre-filled with DLD's proposed value. Edit in place; Approve applies whatever is currently in the field. Untouched = DLD value; edited = override.
5. **Auto-open HTML at end of `review-pending`** — when pending rows exist, after writing both files, spawn the OS file-open command so the HTML opens in the default browser. Detached, non-blocking.

## Goals

1. Make 1700+ pending changes scannable instead of one giant flat list.
2. Show enough cross-reference data (SF unit, current buyer) that Ali can verify a row without leaving the page.
3. Allow staff overrides at approval time (e.g., correct a buyer name typo, edit a price to a known-correct value) without a separate workflow.
4. Open the HTML automatically — the CSV is the legacy fallback, not the primary surface anymore.

## Non-Goals

- Real authentication / RBAC.
- Per-row keyboard shortcuts beyond what HTML provides natively.
- Embedded HTTP server / live save.
- Schema changes.
- Auto-approve threshold changes (already shipped in item m basic, unchanged here).
- Reverse SF→DLD propagation (overrides flow only into `master_data`).

---

## Component Overview

**New files**

- `src/sf-lookup.js` — pure helper. Exports `lookupSfUnit(db, projectId, unitNumberNorm) → { sf_unit, sf_applicant, sf_price } | null`. Joins via `project_mapping` to find `sf_sub_project` + `sf_unit_prefix` + `match_scope`, then queries the latest `sf_snapshot` for an `sf_booking` row matching the DLD unit. Returns `null` when no match.
- `src/open-file.js` — pure helper. Exports `openFile(absolutePath)`. Spawns the OS file-open command detached: `start "" "<path>"` on `win32`, `xdg-open <path>` on `linux`, `open <path>` on `darwin`. Throws on unknown platform; never blocks.
- `test/sf-lookup.test.js`
- `test/approve-html-redesign.test.js` (extends or replaces parts of the existing `test/approve-html.test.js` coverage to assert the 4-section layout + group headers + override input wiring + SF columns)
- `test/override-roundtrip.test.js` (HTML's edited-proposed-value → CSV `applied_value` → `applyDecision` lands the override in `master_data`; audit `decision_notes` records the override pedigree)
- `test/open-file.test.js` (smoke — spawn is detached, no error path leaks)

**Modified files**

- `src/approve-html.js` — major rewrite of `generateApproveHtml`. Now accepts pending rows enriched with SF lookup data (joined by the caller). Renders 4 sections with project group headers. Each row's "Proposed" cell is an `<input>` pre-filled with DLD's proposed value. Toolbar simplified: drops the "Approve all where field=X" buttons (sections already filter by field) and the "Reject all where field=buyer" button. Keeps `Approve all`, `Approve all where Δ<tolerance` (price/area sections only), `Reset to skip`, `Save draft`, `Load draft`, `Export decisions`. Δ% color band uses configured tolerance unchanged.
- `src/pending-change.js` — `applyDecision` signature gains an optional 5th parameter: `applyDecision(db, changeId, decision, notes, appliedValue)`. When `decision='approve'` and `appliedValue` is non-null AND differs from `pc.proposed_value`, the function uses `appliedValue` for `upsertMasterField` and writes a structured prefix into `decision_notes`: `"override: <appliedValue> (DLD: <proposed_value>) — <user notes>"`. When `appliedValue` is null/empty/equal to proposed, behavior is unchanged. Reject branch ignores `appliedValue`.
- `index.js` — `cmdReviewPending` (a) calls `lookupSfUnit` per pending row to enrich the data passed to `generateApproveHtml`, (b) calls `openFile(htmlPath)` after both writes complete, only when `rows.length > 0`. `cmdApplyPending` reads the new `applied_value` column from the CSV and passes it as the 5th arg to `applyDecision`. CSV header in `cmdReviewPending` gains `applied_value` as the 11th column (placed between `proposed_value` and `decision` so existing Excel users can still scan left-to-right). The legacy CSV remains backward-compatible: rows missing `applied_value` are treated as null (no override).

**Unchanged**

- `master_data` schema, `pending_change` schema, `auto-approve.js`, `dashboard.js`, all compare/diff/audit code paths.
- The existing `output/csv/pending-changes.csv` write path. Only the column set grows by one.

---

## SF Unit Lookup

### Algorithm

```js
function lookupSfUnit(db, projectId, unitNumberNorm) {
  // 1. Find the project's mapping. If no mapping, return null.
  const mapping = db.prepare(
    `SELECT pm.*, p.sf_sub_project AS p_sub, p.sf_unit_prefix AS p_prefix
     FROM project_mapping pm JOIN dld_project p ON p.project_id = pm.project_id
     WHERE pm.project_id = ?`
  ).get(projectId);
  if (!mapping) return null;
  const scope        = mapping.match_scope || 'sub_project';
  const sfSubProject = mapping.sf_sub_project || mapping.p_sub;
  const sfPrefix     = mapping.sf_unit_prefix != null ? mapping.sf_unit_prefix : mapping.p_prefix;
  // 2. Latest sf_snapshot.
  const snap = db.prepare(`SELECT sf_snapshot_id FROM v_latest_sf_snapshot`).get();
  if (!snap) return null;
  // 3. Query by scope.
  let row;
  if (scope === 'project' && (mapping.sf_project || sfSubProject)) {
    row = db.prepare(
      `SELECT unit, applicant_name, purchase_price FROM sf_booking
       WHERE sf_snapshot_id = ? AND project = ? AND unit_norm = ?
       ORDER BY sf_booking_id DESC LIMIT 1`
    ).get(snap.sf_snapshot_id, mapping.sf_project || sfSubProject, unitNumberNorm);
  } else if (sfSubProject) {
    // sub_project scope. Optional unit-prefix transform: if sfPrefix set, prefix the unit_norm before lookup.
    const target = sfPrefix ? sfPrefix + '-' + unitNumberNorm : unitNumberNorm;
    row = db.prepare(
      `SELECT unit, applicant_name, purchase_price FROM sf_booking
       WHERE sf_snapshot_id = ? AND sub_project = ? AND unit_norm = ?
       ORDER BY sf_booking_id DESC LIMIT 1`
    ).get(snap.sf_snapshot_id, sfSubProject, target);
  }
  if (!row) return null;
  return { sf_unit: row.unit, sf_applicant: row.applicant_name, sf_price: row.purchase_price };
}
```

The exact prefix/scope handling mirrors `compare.js`'s logic. The function does not throw on missing data — it returns `null` and the caller renders the `[DLD only]` badge.

### Performance

`cmdReviewPending` calls this once per pending row. With 1740 rows and indexes already on `(sub_project, unit_norm)` and `(unit_norm)`, this is sub-second. No batching needed at this scale; revisit if pending rows ever exceed 10k.

---

## Page Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│ brandBar (Sobha Realty | Registration / DLD | <stamp>)               │
├──────────────────────────────────────────────────────────────────────┤
│ Header card                                                          │
│   "1740 pending master-data changes — review at output/approve-..."  │
│   534 buyer · 533 price · 605 area · 68 other                        │
│   Sobha Creek Vistas Heights: 1711 · Sobha Hartland Waves: 1 · …     │
│   tolerance: price 0.5% · area 0.5%                                  │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar (sticky)                                                     │
│   [Approve all] [Approve where Δ<tol]* [Reset to skip] [Save draft]  │
│   [Load draft]  Approved: 0 · Rejected: 0 · Skipped: 1740            │
│                 [Export decisions]                                   │
│   *only effective on price+area sections                             │
├──────────────────────────────────────────────────────────────────────┤
│ §Buyer — 534 pending                                                 │
│   Sobha Creek Vistas Heights — 529                                   │
│   ┌──────────┬────────┬──────┬─────────────────┬────────┬──────┬───┐ │
│   │ Project  │ SF Unit│ Field│ Old → Proposed* │ Current│ Dec  │ N │ │
│   │          │        │      │                 │ Buyer  │      │   │ │
│   ├──────────┼────────┼──────┼─────────────────┼────────┼──────┼───┤ │
│   │ Creek V… │ 1101   │ buyer│ Smith → Smyth_  │ Smith  │ A R S│ … │ │
│   │ Creek V… │ 1102   │ buyer│ Bob   → Robert_ │ Bob    │ A R S│ … │ │
│   │  …                                                              │ │
│   Sobha Orbis — 4                                                    │
│   ┌──────────┬────────┬─… (same shape)                               │
│                                                                      │
│ §Price — 533 pending  (same shape)                                   │
│ §Area  — 605 pending  (same shape, includes Δ%)                      │
│ §Other —  68 pending  (same shape, status + procedure_number rows)   │
└──────────────────────────────────────────────────────────────────────┘
*The right half of "Old → Proposed" is an editable input.
```

### Column set (identical for all 4 sections)

| # | Column | Notes |
|---|---|---|
| 1 | **Project** | Group header repeats the project; row cell shows project name truncated with full-text title attr. |
| 2 | **SF Unit** | From `sf_booking.unit`. When no SF match: shows `<DLD unit_number_norm>` with `[DLD only]` pill. |
| 3 | **Field** | Display string: `buyer`, `price`, `area`, `status`, `procedure`. |
| 4 | **Old → Proposed** | Two-part cell. Left: read-only old value (color-coded for numeric Δ band). Right: `<input>` pre-filled with `proposed_value`. For numeric fields: `type="number"` `step="any"`. For text fields: `type="text"`. The input has `data-original` attribute storing the unedited proposed value so the JS can detect "edited" state. When edited, row gets a yellow background and an "Override active" pill. **Color band visibility (per Ali, 2026-05-07):** the Δ-colored proposed-side wrapper gets a soft `box-shadow` (e.g. `0 1px 3px rgba(0,0,0,.18), inset 0 -2px 0 rgba(0,0,0,.06)`) so green/amber/red bands stand out against the bronze background. Same treatment on the read-only old-value chip. |
| 5 | **Current Buyer** | For Buyer section: same as the row's old_value (redundant but consistent). For Price/Area/Other: looked up from latest `master_data.buyer_name` for the unit. Helps verify "this is the right unit's price". |
| 6 | **Decision** | 3 segmented buttons: Approve / Reject / Skip. Skip selected by default. Approve text changes to "Approve with override" when input is edited. |
| 7 | **Notes** | Free-text optional input. Becomes part of the CSV's `notes` column. The override pedigree gets prefixed automatically by `applyDecision` — staff don't need to repeat it in notes. |

### Group headers

Inside each section, rows are sorted by `project_name` then `unit_number_norm`. A group header row appears between projects:

```html
<tr class="group-header"><td colspan="7">Sobha Creek Vistas Heights — 529 pending</td></tr>
```

Plain visual separator — no fold/unfold, no per-group bulk-action buttons (deferred to a follow-up if needed).

### Empty states

- **Section with zero pending rows** — section header still renders with `0 pending`, body shows muted "No pending changes in this category." Keeps the page shape predictable.
- **Whole page with zero pending** — same as item m basic: brandBar + "No pending changes." Auto-open is suppressed (`cmdReviewPending` only auto-opens when `rows.length > 0`).

---

## Override-on-Approve Mechanic

### CSV format

Existing 10-column header (item m basic):
```
change_id,project_name,unit,field,old_value,proposed_value,source_snapshot_date,proposed_at,decision,notes
```

New 11-column header:
```
change_id,project_name,unit,field,old_value,proposed_value,applied_value,source_snapshot_date,proposed_at,decision,notes
```

`applied_value` is placed between `proposed_value` and `source_snapshot_date` for left-to-right scan readability (the values you care about cluster together).

### HTML "Export decisions"

For each non-skip row, write `applied_value` = current value of the proposed-input cell. Untouched = same string as `proposed_value`; edited = the override.

Skip rows continue to be omitted from the export (unchanged).

### `applyDecision` signature

```js
function applyDecision(db, changeId, decision, notes, appliedValue)
```

Behavior:
- `decision='reject'`: as before. `appliedValue` is ignored.
- `decision='approve'`:
  - If `appliedValue` is null, undefined, empty string, or equal (after type coercion) to `pc.proposed_value`: behavior unchanged. Apply `pc.proposed_value` to master_data; `decision_notes` = caller's `notes`.
  - If `appliedValue` differs: coerce to the right type (Number for price/area, String otherwise), apply to master_data, prepend the override pedigree to `decision_notes`:
    ```
    override: 1234567 (DLD: 1200000) — staff-corrected per buyer email 2026-05-07
    ```
- The audit `pending_change` row preserves the original `proposed_value` unmodified — the override lives entirely in `decision_notes`. Audits remain replayable: anyone reading the row sees both the DLD-proposed value and the value actually applied.

### `cmdApplyPending`

Reads `applied_value` from each CSV row (defaulting to undefined if column absent — keeps backward compat with old CSVs). Passes as 5th arg to `applyDecision`. No other change.

---

## Auto-Open HTML

`src/open-file.js`:

```js
const { spawn } = require('child_process');

function openFile(absolutePath) {
  const p = process.platform;
  if (p === 'win32') {
    spawn('cmd', ['/c', 'start', '""', absolutePath], { detached: true, stdio: 'ignore', shell: false }).unref();
  } else if (p === 'darwin') {
    spawn('open', [absolutePath], { detached: true, stdio: 'ignore' }).unref();
  } else if (p === 'linux') {
    spawn('xdg-open', [absolutePath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    throw new Error('openFile: unsupported platform: ' + p);
  }
}

module.exports = { openFile };
```

`cmdReviewPending` calls `openFile(htmlPath)` only when `rows.length > 0` and only after both `fs.writeFileSync` calls succeed. Wrapped in `try { ... } catch (e) { console.log('  (could not auto-open: ' + e.message + ')'); }` — failure to open never breaks the command.

---

## Configuration

No new config files. Tolerances continue to come from `config/auto-approve.json` (item m basic).

The `applied_value` CSV column is implicit; no flag to disable. Old CSVs without the column still parse via `cmdApplyPending`'s `csv-parse` defaults (missing column = `undefined` per row).

---

## Schema Impact

**None.**

- Override pedigree lives in `pending_change.decision_notes` (free text).
- SF unit lookup is read-only against existing `sf_booking` and `project_mapping`.

---

## Migration / Backwards Compatibility

- **Old CSV without `applied_value`** — `cmdApplyPending` treats absent column as undefined → behaves like the pre-redesign flow.
- **Old HTML in browser cache** — generates new files each run; users picking the freshly-written `output/approve-pending.html` will see the new layout. No persistence to invalidate.
- **In-flight pending_change rows** — apply normally. Override mechanic only kicks in for rows the user actually edits.
- **Auto-open silently fails** in headless environments (CI, SSH session). The HTML is still written; the user can navigate to it manually.

---

## Testing

| Test file | Approx test count | Coverage |
|---|---|---|
| `test/sf-lookup.test.js` | ~5 | sub_project scope happy path; project scope happy path; sf_unit_prefix transform; no mapping → null; no SF snapshot → null; no booking match → null. |
| `test/approve-html-redesign.test.js` | ~5 | 4 sections rendered with correct counts; group headers between projects; SF unit column populated when match exists; `[DLD only]` badge when no match; proposed-input pre-filled with `data-original` attribute; override pill toggles when input changes (snapshot-style assertion on the rendered HTML). Replaces parts of `approve-html.test.js` that asserted the old single-table shape. |
| `test/override-roundtrip.test.js` | ~3 | HTML-exported CSV with edited `applied_value` → `applyDecision` writes the override to master_data; original `proposed_value` preserved in pending_change; `decision_notes` has the structured `override: …` prefix. Untouched (proposed = applied) takes the legacy path with no prefix. |
| `test/open-file.test.js` | ~1 | `openFile` does not throw on `win32` (smoke — child process is detached so we can't easily assert it actually opened anything; just verify no synchronous error). |
| `test/approve-html.test.js` | (revisited) | The 5 existing tests need updating to the new column layout. Net delta: −1 to −2 (the `class="topbar"` and self-contained assertions stay; the field-breakdown counts and toolbar-button id list change). |

**Test count delta (projected):** 225 → ~237 (+12 net new, −≤2 churned).

---

## Risks

- **Override pedigree in free-text `decision_notes`** — anyone querying `decision_notes` for substrings could collide with user-typed notes that happen to contain "override:". Mitigation: prefix is structured (`override: <value> (DLD: <value>) — <user notes>`); a regex `/^override: /` reliably classifies. If audit reporting ever needs first-class override support, promote to a real schema column. Out of scope today.

- **SF lookup performance** — at 1700 rows, the per-row prepared-statement query is ~10ms × 1700 = ~17s in the worst case on cold IO. In practice with WAL-mode SQLite + warm cache it's <1s. If this proves slow, switch to one bulk SQL select with an `IN(...)` clause and join in memory. Not blocking the design.

- **Auto-open in unusual environments** — WSL, remote desktop, Citrix sessions: `start` may pop on the wrong machine or not at all. Wrapped in try/catch so the command still succeeds. User can override behavior later via env var (`DLP_NO_AUTOOPEN=1`) if it becomes annoying — deferred until reported.

- **CSV column reorder breaks existing Excel filters** — staff who saved filtered views of `pending-changes.csv` may need to reapply filters. Tradeoff accepted: the new column improves the workflow enough.

- **Override input text-vs-number type inconsistency** — JS `parseFloat` is lenient; the test for "applied_value differs from proposed_value" must compare as numbers for price/area, strings for buyer/status/procedure. Keep `applyDecision`'s type-coercion logic in one place.

## Open Questions

None remaining. All five brainstorm questions resolved (override mechanic = A; sections = C; project grouping = A; no-SF-match = B; columns + override-input UX = A).

---

## Out-of-Scope Items Captured Today

- **Per-project bulk actions** (e.g., "Approve all in Sobha Creek Vistas Heights where Δ<tolerance"). Group headers are plain rows for now. Easy to add later — just JS event handlers on the `<tr class="group-header">`.
- **Search / filter input** in the toolbar (e.g., "show only rows where buyer matches 'Smith'"). Useful at 1700-row scale but each section already filters by field, and projects are visually separated. Punt unless Ali asks.
- **`DLP_NO_AUTOOPEN` env var** to disable auto-open. Deferred to first complaint.
- **Promotion of override to a first-class `pending_change.applied_value` schema column.** Free-text storage is enough for v1; revisit if reporting needs it.
