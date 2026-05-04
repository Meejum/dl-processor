# DLD Diff Polish — Design

**Date:** 2026-05-04
**Author:** Ali Alghumlasi (with Claude)
**Status:** Approved for implementation
**Scope:** Small, surgical refinement to the existing month-over-month DLD diff.

---

## Background

`src/diff.js` already implements DLD-vs-DLD change detection between snapshots:
combined unit-level + transaction-level diffs per unit, computed on demand from
the existing `dld_snapshot`/`dld_unit`/`dld_transaction` tables, written to CSV
and HTML alongside the audit and compare outputs. The full pipeline runs it as
step `[4/5]`, the menu exposes it as `[4] Month-over-Month Diff`, and it ships
in v0.9.14.

This spec captures three refinements that came out of brainstorming on
2026-05-04. It does **not** introduce new persistence, schema, or report types.

A separate forward-looking note exists at
`docs/superpowers/notes/2026-05-04-future-master-data-approval.md` for the
larger master-data / approval-workflow direction. That work is intentionally
out of scope here.

---

## Goals

1. Stop auto-flagging "removed" rows. A row missing from the latest DLD upload
   does not necessarily mean DLD deleted it — the upload may simply be filtered
   to a different scope.
2. Allow the older snapshot to be chosen by date, so we can ask
   "what changed since March" rather than only "what changed since the previous
   upload."
3. Make the per-project terminal block easier to scan during the monthly run.

## Non-Goals

- No DB schema changes. No `change_log`, `approval_queue`, `master_data`, or
  `buyers` tables.
- No menu UI changes. New flags are CLI-only.
- No master-data or approval workflow.
- No SF-side change tracking.
- No new HTML report types beyond the existing `.diff.html`.
- No "removed-in-scope" detection (i.e. no scope declaration at import time).
- No noise filter for unimportant DLD fields.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| Q1 | Fill the DLD-vs-DLD change-tracking gap (option B from brainstorm). | Master-data/approval (option C) is a separate, larger initiative — captured in the future-direction note. |
| Q2 | Never auto-flag removals. | DLD reports are often filtered (date or project subset). Auto-flagging produces constant false positives. |
| Q3 | Combined per-unit change record covering both unit attributes and transactions. | Matches how a human reads a DLD report. Already how `diff.js` is structured. |
| Q4 | Default baseline = previous snapshot for the project. `--since YYYY-MM-DD` overrides. | Default keeps the monthly flow simple; flag enables "since March" queries. |
| Q5 | Compute on demand. No new tables. | Snapshots already preserve full history; persistence adds complexity without fidelity gains. |
| Q6 | Real issues to fix: auto-flagged removals (A), no `--since` flag (B), thin terminal summary (C). | Confirmed by user as the actual pain points. |

---

## Architecture

Approach: surgical edits to two files plus one new test file. No new modules.

### Files Touched

- `src/diff.js` — engine changes.
- `index.js` — `cmdDiff` flag parsing and per-project terminal output.
- `test/diff.test.js` — new test file covering the behavior changes.

The full pipeline (`node index.js`) calls the diff engine with default options,
so step `[4/5]` automatically picks up the new defaults (missing rows hidden,
no `--since`).

---

## Engine Semantics — `src/diff.js`

### Renamed Change Types

- `REMOVED_UNIT` → `MISSING_UNIT`
- `REMOVED_TX` → `MISSING_TX`

The detail string changes from "disappeared" to
"not present in latest snapshot (may be out of report scope)".

`CHANGE_CLASS` map is updated to use the new keys (still mapping to the
existing `warn` style class so the HTML coloring stays consistent when these
are surfaced).

### New Option: `includeMissing`

`diffProject(db, projectId, opts)` accepts a new option:

- `includeMissing: false` (default) — internally detects missing units and
  missing transactions, but filters them out of the returned `rows` array.
  `summarizeDiff` only sees what is returned, so counts naturally exclude
  them.
- `includeMissing: true` — missing rows are included in `rows` with the new
  `MISSING_UNIT` / `MISSING_TX` change types.

The returned result also exposes:

```
hiddenMissingCount: { units: <int>, txs: <int> }
```

Always populated (zero when none detected, or zero when `includeMissing` is
true since none are hidden).

### New Helper: `pickBaseline`

```
pickBaseline(db, projectId, { since } = {}) -> { oldSnap, newSnap, status }
```

- No `since` → existing behavior: `latestTwoSnapshots`. `status: 'ok'` when two
  exist, `'not-enough-snapshots'` otherwise.
- With `since` (an ISO date string `YYYY-MM-DD`) → `newSnap` is the latest
  snapshot for the project; `oldSnap` is the most recent snapshot whose
  `imported_at < since`. If no snapshot satisfies that, `status:
  'no-baseline-before-date'`.
- A malformed `since` (fails ISO parse) throws `Error("invalid --since date:
  ...")`. `cmdDiff` catches and surfaces.

`diffProject` accepts `{ since, oldSnapshotId, newSnapshotId, includeMissing }`.
The existing `oldSnapshotId`/`newSnapshotId` path stays unchanged for full
manual control. `since` is only honored when explicit IDs are not provided.

### Unchanged

All existing change types (`NEW_UNIT`, `NEW_TX`, `AMOUNT_CHANGED`,
`UNIT_TYPE_CHANGED`, `AREA_CHANGED`) keep their current semantics, thresholds,
and output format.

---

## CLI — `index.js cmdDiff`

New flags on the `diff` subcommand:

- `--since YYYY-MM-DD` — passes through to `pickBaseline`. Validates ISO format
  and emits a clear error on malformed input or no-baseline cases.
- `--show-missing` — passes `includeMissing: true` to `diffProject`. Off by
  default.

The existing positional `[name]` argument (project filter) keeps working.

### Usage Examples

```
node index.js diff                              # latest two, missing hidden
node index.js diff "Sobha Hartland Waves"       # one project
node index.js diff --since 2026-03-01           # vs newest snapshot before March
node index.js diff --show-missing               # surface MISSING_* rows
node index.js diff "Waves" --since 2026-03-01 --show-missing
```

`printUsage()` is updated to list both flags. The full pipeline does not parse
these flags — it always calls the engine with defaults.

The menu entry `[4] Month-over-Month Diff` stays as-is. A flag picker can be
added later if needed.

---

## Terminal Output

### Today (per project, single tight line)

```
  -> Sobha Hartland Waves
     2026-04-01/csv  ->  2026-05-01/csv
     NEW_TX:5  AMOUNT_CHANGED:2  REMOVED_TX:1  (8 rows)
     wrote: output/Sobha_Hartland_Waves.diff.csv
     wrote: output/Sobha_Hartland_Waves.diff.html
```

### New (grouped, aligned, missing hidden by default)

```
  -> Sobha Hartland Waves
     baseline  2026-04-01 csv   ->   latest  2026-05-01 csv
     new       :  5  (units 0, tx 5)
     changed   :  3  (amount 2, area 1, type 0)
     hidden    :  1 missing row (use --show-missing to include)
     wrote     :  output/Sobha_Hartland_Waves.diff.csv
     wrote     :  output/Sobha_Hartland_Waves.diff.html
```

Rules:

- "new" = `NEW_UNIT` + `NEW_TX` with sub-breakdown.
- "changed" = `AMOUNT_CHANGED` + `AREA_CHANGED` + `UNIT_TYPE_CHANGED` with
  sub-breakdown.
- "hidden" line shown only when `hiddenMissingCount > 0` and `--show-missing`
  is off. Suppressed when count is zero or when the flag is on.
- When `--show-missing` is on, an additional grouped line appears in place of
  "hidden": `missing   :  N  (units X, tx Y)`.
- "no changes" line preserved when total = 0 and zero hidden.

### Grand-Total Footer

Appended once after the last project block:

```
  TOTAL across N projects:  new 12   changed 7   hidden 4
```

Only shown when N >= 1 project produced output. Hidden total only printed when
non-zero and `--show-missing` is off.

---

## HTML Output

Existing report layout, fonts, colors, search, sortable columns all stay.
Surgical changes only:

- **Chip row.** `MISSING_UNIT` and `MISSING_TX` chips render only when at
  least one such row is in the result set. With `--show-missing` off (the
  default), these chips never appear. The known-changes list in
  `writeDiffHtml` is computed from the actual change types present in
  `result.rows`, not a hardcoded array.
- **Header meta.** When `result.hiddenMissingCount.units +
  hiddenMissingCount.txs > 0`, add a small line under the snapshot pair
  reading: `<N> missing rows hidden (run with --show-missing to include)`.
  Same gray meta style as existing labels. Suppressed when count is 0 or
  `--show-missing` is on.
- **`--since` provenance.** When `cmdDiff` invokes the engine with
  `--since`, the snapshot pair label gains a `(--since 2026-03-01)` suffix
  on the older snapshot card. Self-explanatory if the HTML is archived.
- **Empty state.** Unchanged — still shows "No changes between the two
  snapshots."

No CSS additions. No new sections. No legend block. Reusing existing `chip`,
`meta`, and `snap` styles.

---

## Testing

New file `test/diff.test.js`. Each test seeds an in-memory DB via
`migrateSchema()`, inserts the minimum `dld_project`, `dld_snapshot`,
`dld_unit`, and `dld_transaction` rows needed for the case under test.

### Cases

1. **Missing rows hidden by default.** Old snapshot has unit `P-101` with
   one transaction; new snapshot has neither. `diffProject(...)` returns
   `rows.length === 0`, `hiddenMissingCount.units === 1`,
   `hiddenMissingCount.txs === 1`.
2. **Missing rows included with flag.** Same fixture,
   `includeMissing: true`. Returns two rows (`MISSING_UNIT`, `MISSING_TX`);
   `hiddenMissingCount` is zero.
3. **`pickBaseline` with `since`.** Three snapshots dated 2026-02-01,
   2026-03-01, 2026-04-01. `pickBaseline(db, projectId, { since:
   '2026-03-15' })` returns the 2026-03-01 snapshot as `oldSnap`, latest as
   `newSnap`, `status: 'ok'`.
4. **`pickBaseline` with no baseline before date.** Two snapshots both after
   `since` → `status: 'no-baseline-before-date'`.
5. **`pickBaseline` with malformed date.** `since: 'not-a-date'` → throws
   with message `invalid --since date: ...`.
6. **Existing change types still emitted.** Unit area change + new
   transaction across two snapshots → `AREA_CHANGED` and `NEW_TX` rows
   present, no `MISSING_*` rows, `hiddenMissingCount` zero.
7. **`summarizeDiff` excludes missing when hidden.** Over the result of
   case 1, returns an object with no `MISSING_*` keys.

All 118 existing tests must remain green. Run via `npm test`.

CLI flag parsing is verified by manual run of `node index.js diff --since
2026-03-01` and `node index.js diff --show-missing`. No CLI integration test
required.

---

## Estimated Footprint

- `src/diff.js`: ~60–80 LOC added/modified (rename, `includeMissing` filter,
  `pickBaseline` helper, return shape additions).
- `index.js`: ~30–50 LOC modified in `cmdDiff` (flag parsing, new terminal
  block, grand-total footer).
- `test/diff.test.js`: ~120–180 LOC new.
- One commit, or two if the test file lands separately. Single PR.

---

## Open Questions

None. All scope decisions confirmed during 2026-05-04 brainstorm.
