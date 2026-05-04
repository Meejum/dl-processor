# Future Direction — Master Data + Approval Workflow

**Date:** 2026-05-04
**Status:** Captured. Not designed. Not scheduled.

This file preserves the longer-term vision Ali pasted on 2026-05-04 so it
isn't lost. It is **not** an implementation spec. It is a roadmap input. When
ready, this should be re-entered into `superpowers:brainstorming` as its own
project, decomposed into sub-projects, and each sub-project gets its own
spec → plan → implementation cycle.

The small DLD diff polish landed first (see
`docs/superpowers/specs/2026-05-04-dld-diff-polish-design.md`) — that's
strictly a refinement of the existing `src/diff.js`. The work below is a
separate, larger initiative.

---

## Original Vision (verbatim from Ali)

> Build a reliable, auditable system that ingests DLD and SF Excel reports,
> tracks all changes over time, and maintains an approval-based master
> dataset. DLD data is the primary source of truth.

### Core Assumptions

- DLD report is more reliable than SF.
- Primary key: `Unit Number + DLD Number`.
- Data history must never be lost.
- No automatic master data updates without approval.

### Inputs

- DLD Excel file placed in `/input`.
- SF report (Excel/CSV).
- Existing database with historical data.

### DLD Handling

1. Read the DLD Excel file.
2. Extract: buyer names (all, no limits), unit number, DLD number, area name,
   project name, dates, values, any other available fields.
3. Save parsed data into database.
4. If DLD file already exists: compare with previous DLD snapshot and detect
   new records, modified fields, removed records. Store full change history
   with timestamps.

### SF Handling

1. Read SF report.
2. Match records using `Unit Number + DLD Number`.
3. Compare against DLD.
4. Detect missing fields, mismatched values, outdated records.
5. Flag discrepancies for manual approval.
6. Do not overwrite master data automatically.

### Master Data Rules

- Master data updates only occur after explicit approval.
- All pending changes must be traceable.
- Keep latest approved snapshot + full history.

### Database Requirements (Ali's draft)

Tables (minimum):

- `buyers`
- `dld_raw_data`
- `sf_raw_data`
- `master_data`
- `change_log`
- `approval_queue`

All records versioned.

### Outputs

Terminal summary: total buyers processed, new DLD records, updated DLD
records, SF mismatches, pending approvals count.

HTML reports:

1. DLD Report
2. SF Report
3. DLD vs SF Comparison
4. Change History Report

Rules: DLD and SF shown separately; changes clearly highlighted; missing
fields marked; buyer names always visible.

### System Behavior

Re-running with new input must preserve previous data, track deltas only,
update reports automatically. Fully auditable, zero silent updates.

---

## Why This Is Not Yet Designed

The vision crosses at least four independent sub-systems. Designing them as
one mega-spec would produce something too large to implement coherently and
too coupled to revisit safely. Each sub-system below should be brainstormed
on its own when its turn comes.

### Sub-system 1 — Versioned ingestion model

DL-Processor today already preserves history via append-only `dld_snapshot`
and `sf_snapshot` rows. A "versioned" master data table is a different
concept: a single canonical row per `(Unit, DLD#)` whose changes are tracked
field-by-field with provenance. This requires:

- Choosing the canonical record's identity (today: `dld_unit` is per-snapshot,
  not per-unit-forever).
- Migration / promotion path from snapshots into a master row.
- Field-level lineage: which snapshot each value came from, when.

### Sub-system 2 — Approval queue

Today `manual_override` and `manual_area` apply staff-entered point fixes.
"Approval queue" is the inverse: pending changes from DLD that **cannot**
update master data until approved. This requires:

- A `pending_change` table linking the proposed value, the source snapshot,
  the proposer, the reviewer, the approval timestamp.
- A CLI / menu workflow to list, approve, reject. Possibly bulk-approve.
- A clear distinction from `manual_override` (staff-driven correction) vs
  approval queue (system-proposed update awaiting sign-off).

### Sub-system 3 — Buyer-as-first-class entity

Today buyers exist as `dld_transaction.party_name` strings — there is no
buyer entity, no buyer history, no name-normalisation across snapshots. The
vision treats `buyers` as a top-level table, which would unlock per-buyer
reporting and de-duplicated counts but requires:

- Identity resolution (transliteration variants, name + nationality + date
  combos).
- Linking transactions to a buyer entity rather than carrying the name.
- Buyer change-history (renames, mergers).

### Sub-system 4 — Four-way HTML report split

Today the HTML output is one comparison report (`.audit.html` and
`.diff.html`). The vision wants four separate documents: DLD-only, SF-only,
DLD-vs-SF, change-history. Decisions needed:

- Audience for each (who opens which? when?).
- Whether they share styling, navigation, search.
- Whether they are linked or independent.
- Whether they replace or supplement existing audit / compare HTML.

---

## When To Pick This Up

Trigger conditions that would make this worth scheduling:

- Volume of `manual_override` rows grows large enough that staff want a
  proper master-data view rather than per-unit overrides.
- Auditors or compliance ask for buyer-centric reporting that current
  schema cannot answer cheaply.
- A specific incident exposes that "field changed silently" was not caught
  early enough.

Until one of those triggers, the small diff polish + existing audit/compare
output is sufficient.

## Suggested Order If/When Started

1. Sub-system 1 (versioned master record) is the foundation — everything
   else assumes it exists. Brainstorm and ship first.
2. Sub-system 2 (approval queue) layers on top.
3. Sub-system 3 (buyers) is independent of 1 and 2 in terms of data model
   but easier once master records exist; can run in parallel with 2.
4. Sub-system 4 (report split) last — it's a presentation layer over the
   data those three pieces produce.

Each step gets its own `superpowers:brainstorming` session and its own spec
in `docs/superpowers/specs/`. Do not let this note become a substitute for
that process.
