# Master-Data Approval Workflow Extensions — Design

**Date:** 2026-05-06
**Status:** Approved by Ali; ready for implementation plan.
**Branch:** `feat/m-approval-extensions` (off master `1dc3c56`)
**Item ID:** m (from the deferred follow-ups; brainstormed 2026-05-06).

---

## Scope

Two of the three identified extensions to the master-data approval system that shipped on 2026-05-05 (per `feat/master-data-approval`):

1. **Auto-approve threshold** — trivial DLD-proposed diffs (small percent changes to numeric fields) auto-apply at ingestion, never enter the review queue.
2. **HTML approval UI** — a generated `output/approve-pending.html` page with click-to-approve, sticky bulk-action toolbar, and CSV export, alongside the existing CSV round-trip.

The third, **multi-user auth**, is deferred. A one-line env-var fallback in `apply-pending` (`decided_by = process.env.DLP_USER || 'ali'`) covers the realistic near-term case (a colleague runs the tool on a different machine, sets `DLP_USER` in their shell, and their decisions are tagged with their name). Real auth with login/RBAC waits until a second user actually exists.

## Goals

1. Cut review-queue noise: auto-approve numeric drift within tolerance with a full audit trail.
2. Replace CSV round-trip's only true downside (manual editing of a CSV) with a click-to-approve HTML page that exports the same CSV the existing pipeline consumes.
3. Land both as additive features — existing CSV review/apply commands keep working unchanged.
4. Preserve the spec's "zero silent updates" rule: every auto-approve writes a `pending_change` audit row.
5. Preserve the staff-override stickiness rule: auto-approve never overwrites a `source='staff'` master value.

## Non-Goals

- Real multi-user authentication / RBAC / per-project ACLs.
- Embedded HTTP server for live approval clicks.
- Schema changes to `pending_change` or `master_data`.
- Auto-approve of identity fields (`buyer_name`, `procedure_number`, `status`) — these always require human review.
- Replacing the existing CSV flow. Both flows coexist; HTML is additive.

---

## Component Overview

**New files**
- `config/auto-approve.json` — `{ "price_tolerance_pct": 0.5, "area_tolerance_pct": 0.5 }`. Optional. Missing file → defaults baked into `loadAutoApproveConfig`.
- `src/auto-approve.js` — pure helpers. Exports: `shouldAutoApprove(field, oldValue, newValue, currentMasterSource, config) → boolean` and `loadAutoApproveConfig() → { price_tolerance_pct, area_tolerance_pct }`. No DB access.
- `src/approve-html.js` — generates `output/approve-pending.html`. One export: `generateApproveHtml(pendingRows, projects, outputPath)`. Mirrors `src/dashboard.js` shape: Sobha-branded, `brandBar()`, sortable flat table, sticky toolbar.
- `test/auto-approve.test.js`
- `test/pending-change-auto-approve.test.js` (or extend existing `test/pending-change.test.js`)
- `test/approve-html.test.js`
- `test/decisions-roundtrip.test.js`

**Modified files**
- `src/pending-change.js` — `queueMasterDiffs` calls `shouldAutoApprove` per (unit, field) candidate before queuing as `pending`. If true: write a `pending_change` row with `decision='approved' decided_by='auto' decided_at=now` AND call `upsertMasterField` to apply to master_data. Both inside the existing `db.transaction(...)` wrapper. Auto-approve config is loaded once per `queueMasterDiffs` call and passed in; not re-read per row.
- `index.js` — `cmdReviewPending` invokes `generateApproveHtml(pending, projects, outputPath)` after writing the CSV. `cmdApplyPending` reads `process.env.DLP_USER || 'ali'` for `decided_by` (when not the `'auto'` sentinel).
- `db/schema.sql` — no schema change. Existing `decided_by` field carries the `'auto'` sentinel; existing `decision` enum already includes `'approved'`.

**Unchanged**
- `apply-pending` consumes the same CSV shape whether human-edited (existing flow) or HTML-exported (new flow).
- All `master_data` writes still go through `upsertMasterField` only.
- Sticky-reject (`proposalAlreadyRejected`) and re-propose-on-shift logic in `queueMasterDiffs`.

---

## Auto-approve Mechanics

### Where it fires

Inside `queueMasterDiffs(db, projectId, snapshotId)`, in the per-(unit, field) loop where today we'd write a `pending_change` row with `decision='pending'`. Before queuing, the loop calls `shouldAutoApprove(...)`. If `true`, take the auto path; else fall through to the existing pending path.

### Eligibility logic

```js
function shouldAutoApprove(field, oldValue, newValue, currentMasterSource, config) {
  // Only numeric fields are eligible
  if (field !== 'purchase_price_aed' && field !== 'area_sqm') return false;

  // Staff-set master values are sticky
  if (currentMasterSource !== 'dld_approved') return false;

  // Need a prior value to compute a delta. First-time set is bootstrap, not auto-approve.
  if (oldValue == null || newValue == null) return false;
  if (oldValue === 0) return false;

  const tolPct = field === 'purchase_price_aed'
    ? config.price_tolerance_pct
    : config.area_tolerance_pct;

  const deltaPct = Math.abs((newValue - oldValue) / oldValue) * 100;
  return deltaPct <= tolPct;
}
```

### Auto path (inside the existing transaction)

```js
if (shouldAutoApprove(field, oldVal, newVal, masterSource, cfg)) {
  // Audit row
  db.prepare(`INSERT INTO pending_change
    (project_id, unit_number_norm, field_name, old_value, proposed_value,
     source_snapshot_id, decision, decided_at, decided_by)
    VALUES (?,?,?,?,?,?, 'approved', datetime('now'), 'auto')`)
    .run(projectId, unitNorm, field, String(oldVal), String(newVal), snapshotId);
  // Master update
  upsertMasterField(db, projectId, unitNorm, field, newVal, 'dld_approved');
  continue; // skip the pending-queue write
}
```

### Configuration

`loadAutoApproveConfig()` in `src/auto-approve.js`:

1. If `config/auto-approve.json` exists, read and parse it.
2. Validate both `price_tolerance_pct` and `area_tolerance_pct` keys are non-negative numbers. Throw on invalid values (no silent fallback).
3. If file is missing, return defaults `{ price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 }`.
4. Loaded once per `queueMasterDiffs` call; not re-read per row.

### Eligible fields (recap)

| Field | Auto-approve eligible | Reason |
|---|---|---|
| `buyer_name` | No | Identity field; name change deserves human review. |
| `procedure_number` | No | Identity-ish; usually means a real procedure replacement. |
| `status` | No | Lifecycle state change deserves review. |
| `purchase_price_aed` | Yes | Numeric, threshold-able. |
| `area_sqm` | Yes | Numeric, threshold-able. |

### Edge case interactions

- **Sticky-reject** runs before auto-approve eligibility. A previously-rejected value is silently skipped; auto-approve never sees it.
- **Re-propose-on-shift**: if DLD now proposes a value differing from a prior rejection, the new value re-enters eligibility and may auto-approve if delta from current master is within tolerance.
- **First-time field set** (no master_data row): bootstrap path via existing `seedMasterFromDld` writes with `source='dld_approved'`. No auto-approve fires (no prior value to compare against).
- **Master value source is `'staff'`**: auto-approve skipped; diff queues as `pending`. Human approval required to change staff overrides.

---

## HTML Approval UI

### Generated file

`output/approve-pending.html` — single self-contained file with inline CSS + JS. No external assets. No server. Same shipping pattern as `output/dashboard.html`.

### Page structure (top to bottom)

1. **Sobha brandBar** — cream/bronze, reused from `src/html-styles.js`.
2. **Header card** — run date, total pending count, breakdown by field (e.g., "12 buyer · 8 price · 3 status · 0 procedure · 5 area"), per-project count.
3. **Sticky toolbar** — buttons:
   - `Approve all`
   - `Approve all where Δ<0.5%`
   - `Approve all where field=price`
   - `Reject all where field=buyer_name`
   - `Reset to skip`
   - `Export decisions` (primary CTA, right-aligned)
   - Live counter: `"Approved: N · Rejected: M · Skipped: K"`
4. **Flat table**, sortable by header click. Columns: Project · Unit · Field · Old → Proposed (color-coded delta) · Δ% (numeric, blank for non-numeric) · Proposed at · Source snapshot · **Decision** (3 segmented buttons: Approve / Reject / Skip — Skip selected by default) · Notes (text input, optional).

### JS state model

- One in-page object: `state[change_id] = { decision: 'skip' | 'approved' | 'rejected', notes: '' }`.
- All rows initialize to `'skip'`.
- Bulk-action buttons mutate `state` then re-render row controls.
- No `localStorage` by default. Add a small `Save draft to file` / `Load draft` pair as an affordance for long sessions.

### Visual treatment of the diff cell

- Numeric: `12,345,678 → 12,378,900` with delta colored green if Δ% within auto-approve tolerance (sanity check — should be rare since they auto-approved already, but useful for staff-source units), amber if 0.5%–5%, red if >5%.
- Text: `Smith → Smyth` with red highlight on the change.

### Decision file format (HTML "Export decisions")

CSV identical in shape to the existing `pending.csv` so `apply-pending` consumes either:

```csv
change_id,project_id,unit_number_norm,field_name,old_value,proposed_value,decision,decision_notes
42,1,A-101,purchase_price_aed,12345678,12378900,approved,
43,1,A-101,buyer_name,Smith,Smyth,rejected,probable typo
```

Rows where `decision='skip'` are **omitted from the export** (Skip = "do nothing this run", not "create a skip row"). On the next `review-pending` run those rows reappear because they're still `decision='pending'` in the DB.

---

## CLI Integration

### `review-pending`

Today: writes `output/csv/pending-{date}.csv` for human edit.

After this work: writes BOTH `output/csv/pending-{date}.csv` AND `output/approve-pending.html` side-by-side. User picks whichever input method they prefer; both export to the same decisions-CSV format that `apply-pending` already understands. No new commands or flags.

### `apply-pending`

Unchanged in CSV input shape. The only diff: `decided_by = process.env.DLP_USER || 'ali'` (instead of hardcoded `'ali'`) for human decisions. `'auto'` rows written by auto-approve already have `decided_by='auto'` and are not touched by `apply-pending`.

---

## Configuration

### `config/auto-approve.json`

```json
{
  "price_tolerance_pct": 0.5,
  "area_tolerance_pct": 0.5
}
```

- Missing file → defaults baked in (0.5/0.5).
- Invalid values (negative, non-number, missing keys) → throw; no silent fallback.
- Tunable in production without code change.

### Environment variables

- `DLP_USER` (optional) — colleague-friendly name tag for `decided_by` on human-approved rows. Defaults to `'ali'` when unset.

---

## Schema Impact

**None.**

- `pending_change.decision` enum already includes `'approved'`.
- `decided_by` is free-text; `'auto'` is a sentinel value distinguishing auto-approves from human approvals.
- `master_data` source check already includes `'dld_approved'`; auto-approves use the same source value.

---

## Migration / Backwards Compatibility

- **No data migration needed.** Existing `pending_change` rows are untouched. New auto-approves write fresh rows with `decided_by='auto'`.
- **CSV flow continues to work.** Existing scripts that consume `pending.csv` keep working unchanged.
- **Existing `apply-pending` invocations work.** Adding `process.env.DLP_USER` as a fallback is purely additive.

---

## Testing

| Test file | Approx test count | Coverage |
|---|---|---|
| `test/auto-approve.test.js` | ~10 | `shouldAutoApprove` table-driven (eligible fields, staff-source, tolerance edges, null/zero handling); `loadAutoApproveConfig` (defaults, valid file, invalid file). |
| `test/pending-change-auto-approve.test.js` | ~6 | Eligible diff at ingestion: `pending_change` row + master_data update. Above-threshold: queued as pending. Staff-source: always queued. First-time field: bootstrap path. Sticky-reject still wins. Re-propose-on-shift may auto-approve. |
| `test/approve-html.test.js` | ~5 | Header rendering with project breakdown. One row per pending change, filtered. Sticky toolbar markup present. Sortable column attributes (data-sort-val) on Δ%/dates. Sobha branding via `brandBar()` (snapshot test). |
| `test/decisions-roundtrip.test.js` | ~4 | HTML exported CSV (sample fixture) consumed by `applyPendingFromCsv` without modification. `decided_by` reads `process.env.DLP_USER` when set. Falls back to `'ali'` when env unset. Skip rows in HTML don't appear in exported CSV. |

**Test count delta:** 198 → ~223.

---

## Risks

- **Auto-approve loosens the audit posture if tolerances are set too high.** Mitigation: defaults are conservative (0.5%/0.5%) and the audit trail (`pending_change` row with `decided_by='auto'`) makes every auto-approve recoverable. Dashboard can later show "X auto-approved this run" for spot-checks.
- **Stale HTML drafts.** If Ali generates the HTML, makes some clicks, then runs `review-pending` again (regenerating the file), the unsaved clicks are lost. Mitigation: the optional `Save draft / Load draft` buttons. No browser storage by default to avoid privacy concerns.
- **CSV/HTML divergence.** If both flows are used in the same run, last-write-wins. Mitigation: `apply-pending` is idempotent on the same change_id (same decision = no effect; conflicting decision = override based on file order). Document the rule.

## Open Questions

None remaining.

---

## Out-of-Scope Items Captured Today

Two items came up during this brainstorm and are queued in `docs/superpowers/notes/2026-05-05-deferred-follow-ups.md`:

- **DEF-n** — Dashboard summary expansion (per-project counts by tx_type, total buyers, "Not Sold" definition, etc.). Trailing "and will will co..." item TBD; capture when we brainstorm that next.
- **DEF-o** — SF importer accept `.xls` and `.csv` (not just `.xlsx`). One-line validator fix at `src/menu.js:192` plus file-picker title/filter at `src/file-picker.js:144-153`. Parser already supports all three formats.
