# Spec Process Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the spec-process hardening artifacts defined in `docs/superpowers/specs/2026-05-19-spec-process-hardening-design.md` so the next DL-Processor spec (v2.3 plan) can use the new process end-to-end.

**Architecture:** Pure docs feature. Four new files under `docs/superpowers/`, plus a cross-reference update in `STATUS.md` and `ROADMAP.md`. No source-code changes. Each task creates or modifies one file and commits independently. Forward-only — no back-fill of the 14+ existing specs.

**Tech Stack:** Markdown only. Git for commits. No tests (docs-only feature; verification is by reading the files).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `docs/superpowers/explorations/.gitkeep` | create | Reserve the directory in git |
| `docs/superpowers/spec-template.md` | create | Copy-paste skeleton with 4 required sections |
| `docs/superpowers/spec-checklist.md` | create | Reviewer gate before plan |
| `docs/superpowers/planning-mistakes-log.md` | create | Append-only log seeded with 4 entries |
| `STATUS.md` | modify | Appendix D — add pointers to the 4 new files |
| `ROADMAP.md` | modify | Cadence section — note new process applies from v2.3 forward |

Six tasks, six commits. Tasks 1–4 are independent (any order). Tasks 5–6 depend on 1–4 being on disk so they can be referenced.

---

### Task 1: Create `docs/superpowers/explorations/.gitkeep`

**Files:**
- Create: `docs/superpowers/explorations/.gitkeep`

- [ ] **Step 1: Confirm the parent directory does not already exist**

Run: `ls docs/superpowers/explorations/ 2>&1`
Expected: error like "No such file or directory" — confirms we're not stepping on existing content.

- [ ] **Step 2: Create the directory and empty .gitkeep file**

Run from repo root:

```bash
mkdir -p docs/superpowers/explorations
touch docs/superpowers/explorations/.gitkeep
```

- [ ] **Step 3: Verify**

Run: `ls -la docs/superpowers/explorations/`
Expected: `.gitkeep` file present, 0 bytes.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/explorations/.gitkeep
git commit -m "docs(process): reserve explorations/ for pre-spec reports

Per spec at docs/superpowers/specs/2026-05-19-spec-process-hardening-design.md.
The pre-spec exploration agent writes a markdown report per spec into
this folder. Reports are committed alongside the spec they informed."
```

---

### Task 2: Create `docs/superpowers/spec-template.md`

**Files:**
- Create: `docs/superpowers/spec-template.md`

- [ ] **Step 1: Write the file with the exact content below**

```markdown
# <Feature Name> — Design

**Date:** YYYY-MM-DD
**Status:** spec drafted | spec approved | superseded
**Target failure modes:** (e.g., "A. infra-assumed-but-missing" — drawn from planning-mistakes-log.md if applicable)

## Why

One to three paragraphs. What problem does this solve. Cite the user or workflow pain.

## What ships

The feature in plain prose. Subsections per major component. Scale each section to its complexity.

---

## REQUIRED SECTIONS (do not remove)

### Infrastructure Audit

Every piece of infra this spec depends on. No "TBD." No "check later." Every row is `✓` with a file:line citation, or `✗` with an explicit sub-task or descope decision.

| Need | Exists? | Where | If missing |
|---|---|---|---|
| Example: popover component on compare.html | ✗ | — | Sub-task: add popover infra OR descope to `<details>` |
| Example: `master_data.area_sqm` column | ✓ | `db/schema.sql:142` | — |

### Hot Files & Branch Coordination

- **Predicted file footprint:** list of files this spec will touch (best guess; revisit at plan-time and at every checkpoint)
- **Hot functions touched:** specific function names — `classifyMatch`, `compareProject`, `writeAuditLog`, etc.
- **In-flight branches:** names of any branches in `git branch -a` that also modify any predicted file. Pulled from exploration report.
- **Merge order:** for every overlap, an explicit decision: this-first, that-first, or rebase-strategy. "None — clean apply" is acceptable when nothing overlaps.

### Realism Check — 3 failure scenarios

Three concrete ways this could go sideways at implementation or merge time. Each has a one-sentence mitigation. At least one scenario must cite an entry from `docs/superpowers/planning-mistakes-log.md`.

1. **Scenario one.** *Mitigation:* one sentence. *Cited entry:* `planning-mistakes-log.md` § YYYY-MM-DD if applicable.
2. **Scenario two.** *Mitigation:* one sentence.
3. **Scenario three.** *Mitigation:* one sentence.

### Prior-art reference

- **Exploration report:** `docs/superpowers/explorations/YYYY-MM-DD-<topic>-exploration.md` (committed alongside this spec)
- **Prior specs that touched related code:** up to 3, with paths.
- **Planning-mistakes log hits:** keywords grepped against `docs/superpowers/planning-mistakes-log.md` and any matching entries cited.

---

## Non-goals

What this deliberately does NOT cover.

## Success criteria

How will we know it worked. Prefer measurable outcomes.

## Open questions

List unresolved items. "None" is acceptable when there are none.
```

Write this content to `docs/superpowers/spec-template.md` exactly as shown above (everything between the opening triple-backtick and the closing triple-backtick).

- [ ] **Step 2: Verify**

Run: `wc -l docs/superpowers/spec-template.md`
Expected: ~50 lines.

Run: `grep -c "REQUIRED SECTIONS" docs/superpowers/spec-template.md`
Expected: 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/spec-template.md
git commit -m "docs(process): spec template with 4 required sections

Copy-paste skeleton for every new DL-Processor spec. Four mandatory
sections — Infrastructure Audit, Hot Files & Branch Coordination,
Realism Check, Prior-art reference — that target the two recurring
planning failure modes (infra-assumed-but-missing,
branch-conflict-not-anticipated) documented in the spec at
docs/superpowers/specs/2026-05-19-spec-process-hardening-design.md."
```

---

### Task 3: Create `docs/superpowers/spec-checklist.md`

**Files:**
- Create: `docs/superpowers/spec-checklist.md`

- [ ] **Step 1: Write the file with the exact content below**

```markdown
# Spec Checklist

Must pass before a spec graduates to writing-plans. Used by the spec author at self-review AND by `superpowers:code-reviewer` if dispatched.

## Infrastructure Audit

- [ ] Every required infra item has a row in the audit table.
- [ ] Every `✓` row has a `file:line` citation (not "yes exists" or "file.js:?").
- [ ] Every `✗` row has an explicit decision: "sub-task in scope" OR "descope" (no "TBD," no "check later").
- [ ] Every concept named in the spec body that depends on infra appears in the audit table (no infra mentioned in prose but missing from audit).

## Hot Files & Branch Coordination

- [ ] Predicted file footprint listed.
- [ ] Hot functions named, not just files.
- [ ] List cross-checked against the exploration report's in-flight branch overlap section.
- [ ] For every overlap, an explicit merge-order decision is recorded.

## Realism Check

- [ ] Three concrete failure scenarios documented.
- [ ] Each scenario has a one-sentence mitigation.
- [ ] At least one scenario cites an entry from `docs/superpowers/planning-mistakes-log.md`.

## Prior-art

- [ ] Exploration report exists at `docs/superpowers/explorations/YYYY-MM-DD-<topic>-exploration.md` and is committed.
- [ ] Up to 3 prior specs/notes referenced.
- [ ] Planning-mistakes log greps run; keywords searched are listed; any hits addressed in the spec body.

## Scope

- [ ] Spec covers one cohesive feature, OR bundling justified inline (cite shared architecture).
- [ ] Every feature in the spec has a way to be tested or otherwise verified.
- [ ] Non-goals section explicit.

## Rejection conditions

If any of the above is missing or vague, return the spec to the author with the failing items listed. Do not approve a spec with placeholder content — placeholders are how planning mistakes survive into implementation.
```

- [ ] **Step 2: Verify**

Run: `grep -c "^- \[ \]" docs/superpowers/spec-checklist.md`
Expected: at least 14 (the count of checkbox items).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/spec-checklist.md
git commit -m "docs(process): spec-checklist as review gate

Must-pass checklist between spec self-review and writing-plans.
Used by spec author at self-review and by superpowers:code-reviewer
when dispatched. Rejects specs with placeholder content,
missing citations, or unresolved scope decisions."
```

---

### Task 4: Create `docs/superpowers/planning-mistakes-log.md`

**Files:**
- Create: `docs/superpowers/planning-mistakes-log.md`

- [ ] **Step 1: Write the file with the exact content below**

```markdown
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
```

- [ ] **Step 2: Verify**

Run: `grep -c "^## " docs/superpowers/planning-mistakes-log.md`
Expected: 4 (the four seed entries).

Run: `grep -c "Root cause:" docs/superpowers/planning-mistakes-log.md`
Expected: 4.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/planning-mistakes-log.md
git commit -m "docs(process): planning-mistakes-log seeded with 4 entries

Append-only log of planning gaps. Seeded from STATUS.md Appendix M:
area-branch infra deferrals (2026-05-01, infra-assumption),
multi-buyer × multi-applicant merge conflict (2026-05-05,
hot-file-collision), Phase 4 critical regressions (2026-05-06,
bootstrap-deviation), patch-apply.cmd %ASAR% bug (2026-05-13,
cross-version). Future specs grep this file for prior patterns
matching their touched files and keywords."
```

---

### Task 5: Update `STATUS.md` Appendix D with pointers

**Files:**
- Modify: `STATUS.md` (Appendix D — Pointers table)

- [ ] **Step 1: Locate the pointer table**

Run: `grep -n "Canonical roadmap" STATUS.md`
Expected: one match in Appendix D, near the bottom of the file (around line 700-ish).

- [ ] **Step 2: Add four rows to the pointer table**

Find the existing row:

```markdown
| v2.3 spec | `docs/superpowers/specs/2026-05-18-v2.3-workflow-automation-design.md` |
```

Add the following rows immediately AFTER it:

```markdown
| Spec template (new from 2026-05-19) | `docs/superpowers/spec-template.md` |
| Spec checklist (review gate) | `docs/superpowers/spec-checklist.md` |
| Planning-mistakes log (seeded with 4 entries) | `docs/superpowers/planning-mistakes-log.md` |
| Pre-spec exploration reports | `docs/superpowers/explorations/` |
| Spec-process hardening spec | `docs/superpowers/specs/2026-05-19-spec-process-hardening-design.md` |
| Spec-process hardening plan | `docs/superpowers/plans/2026-05-19-spec-process-hardening.md` |
```

- [ ] **Step 3: Verify**

Run: `grep -n "spec-template.md\|spec-checklist.md\|planning-mistakes-log.md\|explorations/" STATUS.md`
Expected: at least one match per artifact (the new pointer rows).

- [ ] **Step 4: Commit**

```bash
git add STATUS.md
git commit -m "docs(status): point at new spec-process artifacts

Adds Appendix D pointer rows for the four spec-process hardening
artifacts (template, checklist, mistakes log, explorations folder)
plus the spec and plan that defined them."
```

---

### Task 6: Update `ROADMAP.md` cadence section

**Files:**
- Modify: `ROADMAP.md` (Cadence section near top)

- [ ] **Step 1: Locate the cadence section**

Run: `grep -n "^## Cadence" ROADMAP.md`
Expected: one match around line 5.

- [ ] **Step 2: Add a cadence bullet documenting the new process**

Find the existing cadence list. The last numbered item should be the most-recent project-state line. Add a new numbered item AFTER the existing list. Example — find this block:

```markdown
4. **Mid-2026** — Evaluate v2.x vs v3.0 against actual team adoption signals.
```

Insert a new item BEFORE it (so the mid-2026 bullet stays last):

```markdown
4. **Planning process (from 2026-05-19)** — Every new spec uses the template at `docs/superpowers/spec-template.md`, runs a pre-spec exploration agent committed to `docs/superpowers/explorations/`, and passes the `docs/superpowers/spec-checklist.md` gate before graduating to plan-writing. Planning gaps are logged in `docs/superpowers/planning-mistakes-log.md`. Forward-only; existing specs (v0.4 → v2.3) are not retrofitted. v2.3 implementation plan is the first to use the new process end-to-end.
```

And renumber the previously-last item from `4.` to `5.`.

- [ ] **Step 3: Verify**

Run: `grep -A 2 "Planning process" ROADMAP.md`
Expected: the new bullet and a snippet of the renumbered following item.

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): document spec-process hardening cadence

From 2026-05-19 forward, every new DL-Processor spec uses the
template, runs the exploration agent, passes the checklist, and
contributes to the planning-mistakes log. v2.3 implementation plan
is the first to use the new process end-to-end."
```

---

## Verification

After all six tasks land, run from repo root:

```bash
ls docs/superpowers/spec-template.md docs/superpowers/spec-checklist.md docs/superpowers/planning-mistakes-log.md docs/superpowers/explorations/.gitkeep
```

Expected: all four files listed, no errors.

```bash
grep -l "spec-template.md\|spec-checklist.md\|planning-mistakes-log.md" STATUS.md ROADMAP.md
```

Expected: both files listed (both reference the new artifacts).

```bash
git log --oneline -6
```

Expected: six new commits, one per task, in the order Tasks 1 → 6.

No tests to run — pure docs feature. The success signal is the v2.3 implementation plan being the first to follow the new process.

---

## Out of scope (do NOT do as part of this plan)

- Back-filling existing specs (v0.4 → v2.3) with the new sections.
- Modifying the `superpowers:brainstorming` or `superpowers:writing-plans` skill code.
- Building any CI / pre-commit hook that enforces the checklist.
- Running an exploration agent for this plan itself (meta — exploration agent didn't exist when the brainstorm started, by design noted in the spec's Prior-art section).
- Adding entries to `planning-mistakes-log.md` beyond the four seed entries — that's the responsibility of future post-release audits.
