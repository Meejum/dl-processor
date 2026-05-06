# Post-Merge Cleanup Bundle — Design

**Date:** 2026-05-06
**Status:** Approved for implementation as a bundle.
**Branch:** `feat/master-data-approval` (current — bundle lands on top so it merges with the master-data work).

---

## Scope

Seven small post-merge cleanup items from the deferred-follow-ups list and the master-data final-review backlog. None require new design discussion; each was already analyzed and deferred. Bundle exists because individually they're too small to justify per-task ceremony, but they accumulate as drift if left unaddressed.

| Item | What | Effort | Why now |
|---|---|---|---|
| **a** | Move audit-delta outputs to `output/audit-delta/` | 30 min | Inconsistent with other subfolder layouts (compare/, diff/, csv/, parse/, Changes Template/). |
| **b** | Drop unused `raw_json` column from `dld_snapshot` | 1 hr | Dead weight that inflates the WAL; never queried. Migration via SQLite `ALTER TABLE DROP COLUMN`. |
| **c** | Drop unused `v_unit_compare` view | 30 min | Dead schema. Compare goes through JS, not the view. |
| **d** | Wrap `apply-pending` and `queueMasterDiffs` in transactions | 1 hr | Correctness — a crash mid-loop currently leaves partial state. Tests added. |
| **e** | Update `audit-report.js` area-coverage to read `master_data` | 1 hr | Consistency — same incomplete-migration root cause as the C1/C2 review fixes; this one was missed. |
| **f** | Remove dead exports from `overrides.js` | 30 min | `getOverride`, `setOverride`, `deleteOverride`, `listOverrides` write to `manual_override` and have no callers. Confuses future maintainers. |
| **g** | N+1 lookup fix in `review-pending` CSV writer | 30 min | Per-row `SELECT snapshot_date` becomes a single LEFT JOIN. Perf only. |

Total: ~2-3 hours of focused work, 7 separate commits, ~50-100 LOC of code + ~30 LOC of tests.

## Goals

1. Land all 7 cleanups on `feat/master-data-approval` so they merge with the master-data work in one go.
2. Each fix gets its own commit (bisect-friendly history).
3. No new design decisions — every fix is a closed loop from prior reviews.
4. Maintain green tests after every commit.

## Non-Goals

- No new feature work. Anything from items h-m (audit-delta buyer columns, archiving, buyers entity, four-way HTML, approval workflow extensions) is out of scope and stays on the deferred list.
- No spec-level changes to master_data or pending_change shape.
- No backwards-incompatible CLI changes.

## Approach

Single bundled implementer dispatch (per the bundling-implementation-tasks-for-speed skill — these are mechanical, well-specified, mostly different files, well-suited to bundling). Sonnet for the items with judgment (b: SQLite ALTER TABLE DROP COLUMN compatibility, d: transaction boundary choice). One final whole-branch review at the end covering all 7 commits.

## Commit Plan

Each item below maps to a single commit:

1. `chore(audit-delta): move outputs to output/audit-delta/ subfolder`
2. `chore(schema): drop unused raw_json column from dld_snapshot`
3. `chore(schema): drop unused v_unit_compare view`
4. `fix(pending-change): wrap queueMasterDiffs and applyDecision in transactions`
5. `refactor(audit-report): area-coverage reads master_data not manual_area`
6. `chore(overrides): remove dead getOverride/setOverride/deleteOverride/listOverrides`
7. `perf(cli): review-pending uses LEFT JOIN for snapshot_date instead of N+1 query`

## Testing

- Items **b, c, d, e** affect runtime behavior — each gets at least one targeted test.
- Items **a, f, g** are mechanical — verified by running the full suite + smoke test.
- Final integration check after all 7 commits: full pipeline run, dashboard renders, real-DB import succeeds.

## Risks

- **Item b (DROP COLUMN):** SQLite `ALTER TABLE DROP COLUMN` requires SQLite 3.35+. Check `db.pragma('user_version')` or version detection at migration time. Fallback: leave the column, just mark it deprecated in schema comments.
- **Item d (transactions):** SQLite transactions don't nest cleanly in better-sqlite3. Verify the existing `db.transaction(...)` wrappers don't conflict.

## Open Questions

None remaining. All scope and risk items confirmed.
