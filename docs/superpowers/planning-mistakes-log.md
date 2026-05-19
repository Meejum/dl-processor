# Planning Mistakes Log

Append-only. Single file. One entry per planning gap that surfaced as spec drift, branch conflict, merge surprise, post-release bug, or any other "the plan was wrong" moment.

**Add an entry whenever:**
- a deferral item is filed during implementation that the spec did not anticipate
- a merge conflict exceeds 30 lines and the branches were both spec'd
- a regression is caught at final review that earlier reviews missed
- a post-release bug traces to a planning omission

**Format:** Each entry is a level-2 heading, ordered chronologically (newest at bottom).

---

## 2026-05-01 — area-branch infra deferrals

- **Spec:** `docs/superpowers/specs/2026-05-01-multi-applicant-and-area-matching-design.md`
- **Where caught:** mid-impl
- **What was missed:** Spec called for `?` popovers on A10/A11, default-hidden area columns, and a status legend section. None of the HTML infrastructure existed.
- **Root cause:** infra-assumption
- **Touched files:** `src/compare.js`, `src/html-styles.js` (would-be), `output/compare/*.compare.html`
- **Pattern keywords:** popover, column-picker, legend, compare-html, html-styles
- **Mitigation next time:** Infrastructure Audit table forces a citation per assumed component before the spec is locked. Any component not at a `file:line` becomes a sub-task or descope decision.

## 2026-05-05 — multi-buyer × multi-applicant merge conflict

- **Spec:** `docs/superpowers/specs/2026-05-04-multi-buyer-matching-design.md` (interacted with `2026-05-01-multi-applicant-and-area-matching-design.md`)
- **Where caught:** merge
- **What was missed:** Two specs both modified `classifyMatch`'s init object, every return statement, the nameState ladder, the result-row push, and `STATUS_PRIORITY`. 30–50 lines of manual three-way merge.
- **Root cause:** hot-file-collision
- **Touched files:** `src/compare.js`
- **Pattern keywords:** classifyMatch, STATUS_PRIORITY, nameState, compareProject, A10, A12
- **Mitigation next time:** Hot Files & Branch Coordination section names hot functions. Exploration agent enumerates in-flight branches and reports overlap. Specs with hot-function overlap must declare a merge order.

## 2026-05-06 — Phase 4 critical regressions

- **Spec:** `docs/superpowers/specs/2026-05-05-master-data-and-approval-queue-design.md`
- **Where caught:** final review
- **What was missed:** Migration from `manual_override` + `manual_area` to `master_data` was incomplete in two places: `compare.js` A11 area cross-check still read `manual_area`; `overrides.js` `listBankOnlyUnits` still read `manual_override`. Both caught at whole-branch review, fixed in `6225730` and `36a1882`.
- **Root cause:** bootstrap-deviation
- **Touched files:** `src/compare.js`, `src/overrides.js`
- **Pattern keywords:** migration, master_data, manual_override, manual_area, A11, listBankOnlyUnits
- **Mitigation next time:** Migration-touching specs declare the legacy → new mapping per consumer; every legacy-table read site must have an explicit "migrated to master_data" line in the audit. Final-review checklist greps for legacy table names.

## 2026-05-13 — patch-apply.cmd `%ASAR%` bug surfaced 3 versions late

- **Spec:** N/A — bug introduced in `docs/superpowers/specs/2026-05-12-v1.2-patch-update-design.md` implementation, never spec'd as a risk
- **Where caught:** post-release (at first real v2.0→v2.1 patch attempt)
- **What was missed:** `resources/patch-apply.cmd` line 51 was missing the closing `%` on `%ASAR` variable expansion. Bug existed since v1.2.0 but didn't surface because v1.2→v1.3→v1.4 all installed via full installer, masking the patch path for three releases.
- **Root cause:** cross-version
- **Touched files:** `resources/patch-apply.cmd`
- **Pattern keywords:** patch-apply, cmd, batch, variable-expansion, cross-version, installer-masking
- **Mitigation next time:** Cross-version test path for patch updates — every release ships with an integration test that exercises the full patch chain (vN → vN+1) on a clean install. Realism Check section for patch-system specs must include "what happens if N consecutive releases mask this bug" as one of the three scenarios.

---

*(Append new entries below this line in chronological order.)*
