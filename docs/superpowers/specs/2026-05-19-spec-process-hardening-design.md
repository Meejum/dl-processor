# Spec Process Hardening — Design

**Date:** 2026-05-19
**Status:** spec drafted, awaiting user review
**Target failure modes:** A — mid-implementation discovery that the spec assumed infrastructure that doesn't exist. B — branch-conflict surprises discovered at merge time, not plan time.

## Why

DL-Processor has shipped 14+ specs in three weeks. Two failure modes recur:

- **A. Spec-assumes-infra-that-doesn't-exist.** `feat/multi-applicant-and-area-matching` deferred three items (popover infra, column picker, legend section) because the spec assumed components that compare.html didn't have. The deferrals weren't caught at spec time, weren't caught at task-by-task review, surfaced mid-implementation.
- **B. Branch-conflict-not-anticipated.** `feat/multi-buyer-matching` and `feat/multi-applicant-and-area-matching` both heavily modified `classifyMatch`'s init object, every return, the nameState ladder, the result-row push, and `STATUS_PRIORITY`. The 30–50 line manual three-way merge was discovered at merge time, not at spec time.

Both failures share a root cause: **specs are locked before the code surface is explored.** The fix is to enforce a structured exploration pass before spec-writing, capture its findings in the spec, and accumulate the lessons across releases.

## What ships

Five artifacts and one process change.

### 1. Spec template

`docs/superpowers/spec-template.md` — copy-paste skeleton with four required sections, in addition to whatever feature-specific design the spec needs:

#### 1.1 Infrastructure Audit
A table. Every infra item the spec depends on appears as one row. Status is `✓` (with `file:line` citation) or `✗` (with explicit "sub-task in scope" or "descope" decision). No "TBD." No "check this later."

#### 1.2 Hot Files & Branch Coordination
- Predicted file footprint (subject to revision; revisit at every plan checkpoint)
- Hot functions touched
- Names of in-flight branches that also touch any of these files (pulled from exploration report)
- Merge order decision for any overlap

#### 1.3 Realism Check — 3 failure scenarios
Three concrete ways this could go sideways at implementation or merge. Each scenario has a one-sentence mitigation. At least one scenario must be grounded in an entry from the planning-mistakes log.

#### 1.4 Prior-art reference
- Path to the exploration report (committed alongside the spec)
- Top 3 prior specs or notes that touched related code
- Planning-mistakes log entries that matched grep hits

Existing specs are not back-filled. The rule applies forward from the next spec.

### 2. Pre-spec exploration agent

**Always runs** before any new DL-Processor spec is written. Dispatched at brainstorming time via the `Explore` subagent.

**Input:** one paragraph from the brainstorming author describing the intended feature in plain prose.

**Output:** a markdown report saved to `docs/superpowers/explorations/YYYY-MM-DD-<topic>-exploration.md`, **committed to git** alongside the spec. Report contains:

1. **Infra inventory** — for every concept the author named, grep results showing `file:line` where it exists today or "not found — would need to be built."
2. **Hot-file analysis** — for every file the spec is likely to modify, last 5 commits and most-edited functions (volatility proxy).
3. **In-flight branch overlap** — `git branch -a` cross-referenced against the predicted footprint, with overlap flags.
4. **Prior-art hits** — top 3 hits from `docs/superpowers/specs/` and `notes/` matching keywords from the author's paragraph.
5. **Planning-mistakes log hits** — top hits from `docs/superpowers/planning-mistakes-log.md` matching the touched files and keywords.

The author writes the spec **using the report as primary input.** The Infrastructure Audit and Branch Coordination sections are largely transcribed from the report. The author still owns the descope/sub-task decisions in the audit.

### 3. Reviewer checklist

`docs/superpowers/spec-checklist.md` — must-pass gate before the spec graduates to implementation planning. Used by the spec author at self-review AND by `superpowers:code-reviewer` if dispatched.

Sections:
- **Infrastructure Audit** — every ✓ has a citation; every ✗ has a sub-task or descope decision; audit matches exploration report.
- **Hot Files & Branch Coordination** — cross-checked against exploration; every overlap has a merge-order decision.
- **Realism Check** — three concrete scenarios with one-sentence mitigations; at least one cites a planning-mistakes log entry.
- **Prior-art** — exploration report committed; top 3 prior specs referenced; mistakes-log grep run and addressed.
- **Scope** — one cohesive feature OR bundling justified inline; every feature has a test path.

### 4. Planning-mistakes log

`docs/superpowers/planning-mistakes-log.md` — append-only, single file. Updated at post-release sanity audit OR at the moment of pain when a planning gap surfaces.

Entry schema:
```markdown
## YYYY-MM-DD — <topic slug>
- **Spec:** path
- **Where caught:** mid-impl | merge | review | post-release
- **What was missed:** one sentence
- **Root cause:** explore-gap | scope-creep | hot-file-collision | infra-assumption | bootstrap-deviation | cross-version
- **Touched files:** ...
- **Pattern keywords:** for future grep
- **Mitigation next time:** one sentence (escalates to spec-checklist if recurring)
```

Seeded on day one with four reconstructed entries:

- **2026-05-01 area-branch deferred 3 items** — infra-assumption. Spec assumed popover infra, column picker, legend section on compare.html; none existed. Pattern keywords: `popover`, `column-picker`, `legend`, `compare-html`.
- **2026-05-05 multi-buyer × multi-applicant merge conflict** — hot-file-collision. 30–50 lines of manual three-way merge in `classifyMatch`. Pattern keywords: `classifyMatch`, `STATUS_PRIORITY`, `nameState`.
- **2026-05-06 Phase 4 critical regressions** — bootstrap-deviation. Two regressions caught at final review (incomplete migration in compare.js A11 path; overrides.js listBankOnlyUnits still reading manual_override). Pattern keywords: `migration`, `master_data`, `manual_override`, `manual_area`.
- **2026-05-13 patch-apply.cmd %ASAR% bug** — cross-version. Bug existed since v1.2.0 but only surfaced at v2.0→v2.1 because earlier upgrades went through the full installer, masking the patch path. Pattern keywords: `patch-apply`, `cmd`, `cross-version`, `installer-masking`.

### 5. Updated planning flow

```
idea
  ↓
brainstorm → exploration agent dispatched (always) → exploration report committed
  ↓
spec author writes spec using exploration as primary input — 4 required sections
  ↓
self-review against spec-checklist.md
  ↓
spec committed
  ↓
user reviews committed spec
  ↓
writing-plans skill → implementation plan
  ↓
implement → ship
  ↓
post-release sanity audit; any planning gap → append to planning-mistakes-log.md
```

## Targeted failure modes mapped to mitigations

| Failure | Source artifact | Mitigation |
|---|---|---|
| A — infra assumed but missing | Spec body silent on infra | Section 1.1 forces an explicit audit; exploration agent populates the citations |
| B — merge surprise | No cross-branch analysis at plan time | Section 1.2 forces overlap analysis; exploration agent enumerates in-flight branches |
| (bonus) bootstrap deviation | Plan diverges from spec mid-impl | Section 1.3 realism check catches the most obvious cases; mistakes-log captures the rest for future specs |
| (bonus) cross-version regression | Bug shipped in vN surfaces in vN+k | Mistakes-log entry cites pattern; future specs touching same path grep the log |

## Non-goals

- **Not retrofitting existing specs.** Forward-only.
- **Not enforcing automation gates** (CI block on missing audit, etc.). Discipline-based, not tooling-enforced. Revisit if discipline slips.
- **Not changing the brainstorming or writing-plans skill code.** This spec lives inside DL-Processor's `docs/superpowers/` and constrains the author, not the skill. The skill flow gains one extra step (run exploration agent before writing the spec) but the skill itself is unchanged.
- **Not adding a separate spec-review subagent.** The existing `superpowers:code-reviewer` agent reads `spec-checklist.md` and runs the check.

## Infrastructure Audit

| Need | Exists? | Where | If missing |
|---|---|---|---|
| `docs/superpowers/specs/` directory | ✓ | already populated with 14+ specs | — |
| `docs/superpowers/plans/` directory | ✓ | populated alongside specs | — |
| `docs/superpowers/notes/` directory | ✓ | `2026-05-04-future-master-data-approval.md`, `2026-05-05-merge-resolution-plan.md`, `2026-05-05-deferred-follow-ups.md` | — |
| `docs/superpowers/explorations/` directory | ✗ | — | sub-task: create with .gitkeep + first exploration |
| `docs/superpowers/spec-template.md` | ✗ | — | sub-task: write the template |
| `docs/superpowers/spec-checklist.md` | ✗ | — | sub-task: write the checklist |
| `docs/superpowers/planning-mistakes-log.md` | ✗ | — | sub-task: write with 4 seed entries |
| `Explore` subagent | ✓ | available in current Claude Code environment | — |
| `superpowers:code-reviewer` agent | ✓ | available | — |

## Hot Files & Branch Coordination

**Predicted footprint:**
- `docs/superpowers/spec-template.md` (new)
- `docs/superpowers/spec-checklist.md` (new)
- `docs/superpowers/planning-mistakes-log.md` (new)
- `docs/superpowers/explorations/.gitkeep` (new)
- No source-code changes
- `STATUS.md` may reference the new artifacts in Appendix D pointers

**Hot functions touched:** none — pure docs change.

**In-flight branches:** v2.3 workflow-automation spec exists but no `feat/v2.3-*` branch yet. No code overlap because this spec is docs-only.

**Merge order:** ship before v2.3 plan is written, so the v2.3 plan can be the first to benefit from the new process.

## Realism Check — 3 failure scenarios

1. **The audit table becomes ritual.** Author writes `✓ exists` rows without actually running grep, defeating the point.
   *Mitigation:* every `✓` row requires a `file:line` citation. Reviewer rejects spec if a citation is `file.js:?` or absent. (Cites planning-mistakes log entry "2026-05-01 area-branch" — same pattern would have been caught.)

2. **The exploration report drifts from the spec.** Author runs exploration, then writes spec from memory days later; report and spec disagree.
   *Mitigation:* spec-checklist item explicitly cross-checks the audit against the report. If author opens exploration > 48h after running it, re-run before writing spec.

3. **The mistakes log isn't grepped.** Author writes a spec touching `classifyMatch` without ever reading the prior mistakes-log entry about the 30–50 line merge conflict.
   *Mitigation:* spec-checklist requires a "mistakes-log grep run" affirmation referencing the keywords searched. Exploration agent also auto-greps the log and returns hits in its report.

## Prior-art reference

- **Exploration report for this spec:** none — meta-spec, no exploration agent existed when this was brainstormed (chicken-and-egg). First post-merge use will be the v2.3 plan.
- **Prior specs touched by this work:** all 14 existing specs in `docs/superpowers/specs/` (template applies forward).
- **Planning-mistakes log:** doesn't exist yet — created by this spec.

## Success criteria

- v2.3 implementation plan is the first to use the new process end-to-end (exploration report + 4 required sections + checklist passed).
- After v2.3 ships, post-release retrospective adds 0 or more new entries to `planning-mistakes-log.md` — entries are welcome, but the spec-time discoveries should now appear in the audit table, not the mistakes log.
- Within 3 releases, the planning-mistakes log has fewer net-new entries per release than the count at v2.2 (4 reconstructed entries). Trend, not absolute count.

## Open questions

None. User selected Approach 3 (heaviest), confirmed "always run, commit to git" for the exploration agent, and asked the assistant to proceed without further confirmation.
