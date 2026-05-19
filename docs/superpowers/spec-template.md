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
