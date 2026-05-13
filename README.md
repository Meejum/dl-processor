# DL-Processor

**DLD Project Inquiry ⇄ Salesforce Reconciler** — Sobha Realty · Registration / DLD team.

Each month Registrations exports a DLD "Project Inquiry" report per project and needs to find where Salesforce is out-of-date: resales the DLD caught but SF didn't, price amendments, unbooked units, mortgages logged as buyers, etc. DL-Processor imports the DLD files, imports Salesforce, matches them at the unit level and produces per-project HTML dashboards and audit-task CSVs.

Companion docs:

| File | When to read |
|---|---|
| **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** | Something broke — installation, launch, data, UI, build, tests |
| **[BUILDING.md](BUILDING.md)** | You're developing on this codebase — environment setup, schema migrations, release process |

Lives inside the P-Charter repo as a git subtree: `Desktop\p-charter\dl-processor\`.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Install & launch](#install--launch)
3. [Quick start — the monthly flow](#quick-start--the-monthly-flow)
4. [The menu in detail](#the-menu-in-detail)
5. [Reviewing changes (v1.1)](#reviewing-changes-v11)
6. [Reviewing changes (v2.0)](#reviewing-changes-v20)
7. [Viewing change history](#viewing-change-history)
7. [Restoring from backup](#restoring-from-backup)
8. [Audit hardening (v2.1)](#audit-hardening-v21)
8. [Receiving patches (v1.2+)](#receiving-patches-v12)
9. [CLI subcommands](#cli-subcommands)
9. [Data model & file layout](#data-model--file-layout)
10. [How projects are mapped](#how-projects-are-mapped)
11. [Multi-applicant name matching](#multi-applicant-name-matching)
12. [Area cross-check (SQM)](#area-cross-check-sqm)
13. [HTML reports — what the filters do](#html-reports--what-the-filters-do)
14. [Audit-flag reference (A-codes)](#audit-flag-reference-a-codes)
15. [Project ↔ SF SUB ↔ PREFIX reference](#project--sf-sub--prefix-reference)
16. [Troubleshooting](#troubleshooting)
17. [Changelog](#changelog)

---

## What it does

There are **only two data sources** — DLD GOV (Dubai Land Department) and Salesforce. Compare answers one question per unit: *is this in DLD? is this in SF? do they agree?* Optionally a third reference — staff-maintained SQM area per unit — adds an area cross-check signal.

```
  ┌─────────────────────────────────┐        ┌─────────────────────────────────┐
  │  DLD GOV                        │        │  Salesforce                     │
  │  ProjectInquiryReport.xps/.csv  │        │  DLD -ALL-<timestamp>.xlsx      │
  │  per-project .xps / .csv        │        │  (the "DLD -ALL" SF report)     │
  └───────────────┬─────────────────┘        └───────────────┬─────────────────┘
                  │                                          │
                  ▼                                          ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                     SQLite DB:  data/dld-sync.sqlite                     │
  │   dld_project / dld_snapshot / dld_unit / dld_transaction                │
  │   sf_snapshot / sf_booking                                               │
  │   project_mapping / manual_override / manual_area                        │
  └─────────────────────────────────┬────────────────────────────────────────┘
                                    │
                                    ▼
                   ┌─────────────────────────────────┐
                   │ compare  — unit-level DLD ↔ SF  │
                   │ diff     — DLD month-over-month │
                   │ audit    — reconciliation       │
                   └────────────────┬────────────────┘
                                    ▼
             output/compare/<project>.compare.html
             output/csv/<project>.compare.csv
             output/csv/<project>.audit-tasks.csv
             output/csv/<project>.diff.csv
             output/diff/<project>.diff.html
             output/dashboard.html   ← cross-project summary
```

### Naming gotcha

The SF export is called `DLD -ALL-<timestamp>.xlsx` because the **Salesforce report is named "DLD -ALL"** (it tracks DLD-related fields — buyer, DLD amount, pre-reg status). Don't confuse it with actual DLD GOV files.

| File looks like                                      | Source     | Goes into  |
|------------------------------------------------------|------------|------------|
| `DLD -ALL-2026-04-22-15-11-56.xlsx`                  | Salesforce | `sf-input/` |
| `ProjectInquiryReport.xps` / `.csv`                  | DLD GOV    | `input/`   |
| `Sobha Central II.csv`, `Sobha Solis.csv`, `SKYSCAPE.csv` | DLD GOV    | `input/`   |

### Salesforce export — required columns (v2.0)

The SF importer extracts headers by name (case-insensitive, colon-tolerant). v2.0 adds **three new headers** to the SF context strip on Review Pending BP cards:

- `Current Step Name`
- `Current Step: Assigned Name`
- `Comments`

If your existing "DLD -ALL" SF report lacks these columns, BP cards will still render but show `null` / `—` placeholders in the SF context strip. Re-export with these columns added to the report definition for full v2.0 functionality.

Each compare row is categorized as one of:

| Status         | Meaning                                                          |
|----------------|------------------------------------------------------------------|
| `MATCH`        | DLD and SF agree on unit, buyer, and price (within tolerance)    |
| `PRICE_UP`     | DLD price is higher than SF — resale at higher price, not reflected |
| `PRICE_DOWN`   | DLD price is lower than SF — price amendment not posted          |
| `BUYER_MISMATCH` | DLD last buyer name differs from SF applicant (after multi-applicant + transliteration check) |
| `AREA_MISMATCH` | DLD `net_area` vs staff-recorded SQM differ by ≥ project threshold (default 5%) |
| `DLD_ONLY`     | DLD has the unit, SF has no booking                              |
| `SF_ONLY`      | SF booked, DLD has no record                                     |

---

## Install & launch

**Requirements:** Windows (tested on Sobha workstations — no admin needed), Node.js ≥ 18.

### First run

```bat
cd C:\Users\<you>\Desktop\p-charter\dl-processor
npm install
dl-processor.bat
```

The `.bat` launcher auto-discovers Node, auto-installs dependencies on first run, sets UTF-8 (`chcp 65001`), and opens the menu.

### From P-Charter

Launch `p-charter.bat` → menu option `[D] DLD Audit` — runs inline (same window since v9.3.x).

### Desktop app (v1.1)

For staff users, the Windows desktop build is the recommended surface — see `BUILDING.md` for how to produce the installer. The sidebar is always full-width (icon + text — the v1.0 collapse button has been removed); a single project selector in the top bar filters every page and includes Salesforce-only projects in addition to DLD-imported ones. Schema migrations run automatically at every app launch; on a v1.0→v1.1 upgrade the renderer briefly shows an *"Upgrading database…"* splash if the migration takes more than ~2 seconds.

### Non-interactive

```bat
node index.js <subcommand> [args]
```

See [CLI subcommands](#cli-subcommands).

---

## Quick start — the monthly flow

1. **Drop DLD files** into `dl-processor\input\` — any mix of `.xps` or `.csv` per-project files, or the combined `ProjectInquiryReport`.
2. **Drop the SF xlsx** into `dl-processor\sf-input\` — the `DLD -ALL-<timestamp>.xlsx` export.
3. Launch `dl-processor.bat`. From the menu pick:
   - `[6] FULL PIPELINE` — processes everything in `input/` and `sf-input/`, or
   - `[7] QUICK AUDIT` — pick specific files, run the full pipeline on just those.
4. **(Optional)** Top up area data when you have new SQM measurements:
   - `[Y] Area template` → `[1] Generate template` → fills `output/Changes Template/area-template-<project>.csv`.
   - Open in Excel, fill the `area_sqm` column for the units you have data on, save into `input/Changes Template Input/`.
   - `[Y] Area template` → `[2] Apply filled template` → upserts into `master_data.area_sqm`.
   - Re-run `[3] Compare` to see new A11 / AREA_MISMATCH signals.
5. **Review DLD-proposed changes (inline, v1.1).** In the desktop app, click `5. Review pending` in the sidebar. The Review Pending page opens with two tabs:
   - **Needs review** — per-row `✓ Approve` / `✗ Reject`; the `New (edit)` cell lets you override the proposed value before approving. BUYER_MISMATCH rows expose `🔗 Teach alias` so the same false-positive doesn't recur next month.
   - **Drift log** — read-only list of values silently overwritten at compare time when a fresh DLD or SF snapshot disagrees with the previous one.

   Every action writes the change directly to `master_data` and appends to `audit_log` — no more CSV roundtrip. See [Reviewing changes (v1.1)](#reviewing-changes-v11) below.
6. When done:
   - `[O]` opens `output/dashboard.html` (cross-project summary).
   - `[R]` reveals the `output/` folder in Explorer.
   - Per-project `.compare.html` reports are in `output/compare/`.

Re-running `compare` after any change is cheap — it rebuilds from what's already in SQLite.

---

## The menu in detail

```
[1]  Parse & Import DLD       pick .xps or .csv file
[2]  Import Salesforce        pick .xlsx file
[3]  Compare (DLD vs SF)      writes compare.csv / .html / audit-tasks
[4]  Month-over-Month Diff    writes diff.csv / .html
[5]  Master Data (staff edits) unit-level buyer overrides
[6]  FULL PIPELINE (folders)  process everything in input/ & sf-input/
[7]  QUICK AUDIT              pick DLD + SF files, run everything

[A]  Audit Report             reconciliation summary + per-project mapping
[P]  Projects list            projects in DB with their mapping
[S]  Status                   DB overview (counts per table)
[O]  Open latest HTML report  opens output/dashboard.html if present
[R]  Reveal output folder

[Y]  Area template            generate / apply staff-filled SQM CSVs
[V]  Review pending changes   v1.1 — prints a hint pointing at the desktop app's inline page
[B]  Apply pending decisions  legacy — reads a CSV with change_id+decision, commits approvals

[L]  Last drop                run full pipeline on the newest DLD + SF files
[Z]  Archive output           snapshot output/ to output/archive/<timestamp>/

[Q]  Quit
```

### `[5] Master Data (staff edits)`

DLD transactions sometimes have a bank (mortgage holder) as the last party when the real buyer sold to someone else. The Master Data submenu lets you pick a project, pick a bank-only unit, and enter the real buyer name. Compare reads from `master_data` instead of the bank.

`master_data` is the single source of truth for staff-curated values. It is seeded from `manual_override` + `manual_area` on first run (those legacy tables are then frozen). Every DLD import queues proposed changes into `pending_change` for staff review before they take effect.

### `[V] Review pending changes`

> **v1.1 — primary workflow is the desktop app.** Click `5. Review pending` in the sidebar to open the inline Review Pending page (two tabs, override/approve/reject/teach-alias per row). See [Reviewing changes (v1.1)](#reviewing-changes-v11).

The terminal `[V]` entry / `node index.js review-pending` CLI no longer produces an HTML+CSV roundtrip — it prints a hint pointing at the desktop app. Kept as a no-op shim for one release cycle.

### `[B] Apply pending decisions`

> **Legacy — deprecated for v1.1, will be removed in v1.2.** Reads a CSV with `change_id` + `decision` columns and commits approved rows to `master_data`. Retained for users who still drive reconciliation through `apply-pending.csv` files. The recommended path is the inline Review Pending page; the CSV roundtrip is no longer used by the desktop app.

### `[Y] Area template`

Drives the staff-maintained SQM data flow. Two sub-options:

- **`[1] Generate template`** — emits `output/Changes Template/area-template-<project>.csv` (or `area-template-all.csv`) with one row per DLD unit, pre-populating any existing `master_data.area_sqm` values. Staff fill the `area_sqm` column and (optionally) the `source_note` column.
- **`[2] Apply filled template`** — reads a filled CSV from `input/Changes Template Input/`; upserts every row whose `area_sqm` is a positive number into `master_data`. Blank rows are skipped silently. Unknown project names skip with a warning. Each apply writes one entry to `logs/audit.jsonl`.

### `[Z] Archive output`

Snapshots the current `output/` tree to `output/archive/<YYYY-MM-DD-HH-MM>/`. Use before re-running on a corrected DLD file when you want to keep the previous run's HTML reports and CSVs. The archive folder is preserved across subsequent runs.

### `[L] Last drop`

One-click full pipeline. Scans `input/` for the newest `.xps`/`.csv` and `sf-input/` for the newest `.xlsx`, shows the picked filenames + dates, and runs the full pipeline (parse → import → SF import → compare → diff) after a single confirmation.

### `[A] Audit Report`

Reconciliation report (previously accessible as `[V]` before v0.9.16):

- Rows imported vs rows in the raw xlsx.
- Per-project completeness — missing SF unit / DLD unit / price.
- Projects matched to a DLD row in the DB.
- SF booking cross-check — percentage of audit rows whose booking name exists in the current SF snapshot.
- **Area cross-check coverage** — per-project `master_data.area_sqm` row count vs DLD unit count + total percentage. Lets you see which projects still need staff to fill area templates.

Every run is written to `logs/audit.jsonl`.

---

## Reviewing changes (v1.1)

> Replaces the legacy `review-pending` → CSV → `apply-pending` two-step.

In the desktop app, click **`5. Review pending`** in the sidebar. The page opens with a project filter on top and two tabs:

### `Needs review` tab

Actionable rows — every `pending_change` whose `decision='pending'`. One row per `(unit, field)`.

| Column        | Behavior                                                                                          |
|---------------|---------------------------------------------------------------------------------------------------|
| `☐`           | Multi-select for batch actions                                                                    |
| `Unit + Project` | Clickable — opens the [per-unit history side panel](#viewing-change-history)                   |
| `Field + Type` | E.g. `purchase_price_aed MISMATCH`, `buyer_name BUYER_MISMATCH`                                  |
| `Current`     | Read-only current `master_data` value (with source label `staff` / `dld_approved`)                |
| `New (edit)`  | Editable input prefilled with the proposed value. Type to override before approving.              |
| `Actions`     | `✓ Approve` / `✗ Reject` per row. BUYER_MISMATCH rows additionally show `🔗 Teach alias`.        |

Filter chips above the table: `All` / `MISMATCH` / `BUYER_MISMATCH` / `AREA_MISMATCH` / `PRICE_UP` / `PRICE_DOWN`. Batch actions at the bottom: `[Approve selected (N)]` / `[Reject selected]`.

**Approve** writes the final value (your typed override if you edited the cell, else the proposed value) straight to `master_data`, marks the `pending_change` row `approved`, and appends an `audit_log` row.

**Reject** marks the row `rejected` and leaves `master_data` unchanged. An `audit_log` entry still records the action so the queue is reproducible.

**`🔗 Teach alias`** (BUYER_MISMATCH only) opens a modal: *"Always treat 'AlGhumlasi' = 'Alghumlasi' for project ONE? (or globally)"*. Confirming inserts a `buyer_alias` row and auto-approves every other pending BUYER_MISMATCH with the same normalized name pair on the page — saves the same false-positive from recurring next month.

### `Drift log` tab

Read-only. Lists every `pending_change` whose `decision='auto_applied'` — values silently overwritten at compare time because a fresh DLD or SF snapshot disagreed with the previous one. Columns: `When`, `Unit + Project` (clickable → side panel), `Field`, `Old → New`, `Source` (`DLD import` / `SF import`). Use this to spot price corrections or buyer changes that landed without review.

No CSV roundtrip is involved. The legacy `apply-pending` CLI still works for one release cycle (deprecated in v1.1, removed in v1.2).

---

## Reviewing changes (v2.0)

> Replaces the v1.1 per-field row layout. The Needs review tab now groups pending changes into **Business Process (BP) cards** — one card per business event, with full Salesforce context inline.

Click **`5. Review pending`** in the sidebar. The page opens as a native renderer-DOM pane (no iframe — see [v2.0 changelog](#v200-12-may-2026)) with a **filter bar** on top and two tabs (`Needs review`, `Drift log`).

### Filter bar (8 dimensions)

Above the tabs, narrow the queue along any combination of:

- **Project** — pulled from the same projects-list query used by the top bar
- **Tower** — the per-project tower / sub-village if applicable
- **BP type** — Resale / Buyer correction / Price amendment / Status update / Procedure update / Area correction / Multi-field update
- **SF state** — READY / IN_PROGRESS / DLD_ISSUE / REJECTED / NO_SF_ROW
- **Assigned to** — `sf_booking.current_step_assigned_name`
- **Procedure #** — exact-match on `sf_booking.procedure_number`
- **Date range** — when the pending changes were queued
- **Search** — free-text across unit number, buyer name, BP name

**Default filters on first open:** SF state ≠ `REJECTED`, Date range = `Last 30 days`. Expand the range if your BP doesn't show up.

### BP cards

Each card represents one business event — `pending_change` rows sharing the same `(source_snapshot_id, project_id, unit_number_norm)`. The card header carries:

| Element | Source | What it tells you |
|---|---|---|
| **BP label** | `classifyBp(fieldSet)` in `src/bp-classifier.js` | What kind of change happened. First-match-wins: Resale → Buyer correction → Price amendment → Status update → Procedure update → Area correction → Multi-field update fallback. |
| **SF state badge** | `classifyState(sfRow)` in `src/sf-state.js` | Whether SF is ready for you to approve. READY (green), IN_PROGRESS (yellow), DLD_ISSUE (orange), REJECTED (red), NO_SF_ROW (gray). |
| **SF context strip** | `sf_booking` columns | BP name, status, current_step_name, current_step_assigned_name, pre_reg_status, dld_process_status, dates, comments, procedure_number. |
| **`Open in SF →`** | `booking_record_id` | Copies the booking record ID to clipboard. Paste into your Salesforce instance manually (v2.0 limitation — Sobha SF URL pattern not yet configured; v2.1 will deep-link). |

### Action buttons (gated by SF state)

- **READY** — `Approve all` and `Reject all` both enabled. Approve all writes every field's final value to `master_data` atomically, marks all `pending_change` rows `approved`, and appends an umbrella `approve_bp` row to `audit_log`.
- **IN_PROGRESS / DLD_ISSUE** — banner explains why (BP still mid-process, or DLD has flagged an issue). `Approve all` is disabled; per-row Approve still works from the expanded card.
- **REJECTED** — only `Acknowledge` is shown. Writes an `acknowledge_bp` audit_log entry; doesn't touch `master_data`.
- **NO_SF_ROW** — no matching `sf_booking` exists for this `(project, unit)`. SF context strip shows placeholders. Approve flow still works but you're approving without SF confirmation. See [TROUBLESHOOTING.md → v2.0 BP grouping problems](TROUBLESHOOTING.md#v20-bp-grouping-problems).

**Expand button** reveals per-row Approve / Reject / Override / `🔗 Teach alias` (for BUYER_MISMATCH rows) — the same per-row controls available in v1.1.

### Drift log tab

Same as v1.1, but now also populates from **DLD drift detection** (new in v2.0 — see [Data model](#key-db-tables)). Any `dld_unit` whose operational fields change between two consecutive `dld_snapshot`s writes a `DLD_DRIFT` row at compare time and an `auto_apply` row with `source='compare'` in `audit_log`. Use the per-unit history side panel to see the trail.

---

## Viewing change history

### Global `📜 History` page

New sidebar entry between `Tools` and `Backup`. Shows every change to live data across all projects, newest first.

**Filters** (all combine with AND):

- `Range` — `Today` / `Last 7 days` / `Last 30 days` / `Last 90 days` / `All time` / `Custom…`
- `Project` — populated from the same projects-list query used by the top bar (now includes Salesforce-only projects, see below)
- `Action` — `All` / `approve` / `override` / `reject` / `auto_apply` / `learn_alias`
- `Source` — `All` / `review_pending` / `import_dld` / `import_sf` / `apply_pending`
- `Unit` — free-text exact match on `unit_number`

**Columns** (sortable): `When` (default desc), `Project`, `Unit` (clickable → side panel), `Field`, `Old → New`, `Action + Source`.

**Export CSV** dumps the current filtered set (not just the visible page) to `audit-log-YYYYMMDD-HHmm.csv` via the system save dialog.

### Per-unit history side panel

Click any unit cell — in Review Pending, the History page, the Projects page, or the Status page — to slide in a 400px-wide panel from the right showing that unit's full audit trail:

- **Current state** (live values from `master_data`): `buyer_name`, `purchase_price_aed`, `area_sqm`, `status`, `procedure_number`.
- **History** — every `audit_log` event for that `(project_id, unit_number_norm)`, newest first, grouped by timestamp. Each event shows the field, old → new value, and `action · source` (e.g. `override · review_pending`).
- `[×]` or `Esc` closes the panel; `[View in global History →]` deep-links to the `📜 History` page pre-filtered to that unit.

---

## Restoring from backup

> v1.1 adds an impact-summary modal before any DB swap.

Click **`Import DB`** in the desktop app and pick a `.zip` backup. The app extracts to a temp directory, reads the embedded `meta.json`, opens the contained `dld-sync.sqlite` read-only, and shows a confirmation modal:

```
┌─ Import database backup ────────────────────────────────────┐
│ File: dl-processor-backup-2026-05-11T09-00-24.zip            │
│ Size: 4.2 MB                                                 │
│ Created: 2026-05-11 09:00 (1 day ago)                        │
│ App version: 1.1.0                                           │
│                                                              │
│ This backup contains:                                        │
│   • 1,738 sales units                                        │
│   • 23 pending changes                                       │
│   • 12 projects                                              │
│   • 4,521 audit log entries                                  │
│                                                              │
│ Current database (will be replaced):                         │
│   • 1,742 sales units (+4 to remove)                         │
│   • 31 pending changes (+8 to remove)                        │
│   • 12 projects (unchanged)                                  │
│   • 4,605 audit log entries (+84 to remove)                  │
│                                                              │
│ ⚠ This replaces your current database. Cannot be undone      │
│   unless you exported a backup of the current state first.   │
│                                                              │
│         [Cancel]                  [Confirm import]            │
└──────────────────────────────────────────────────────────────┘
```

`[Cancel]` deletes the temp directory and leaves your DB untouched. `[Confirm import]` first writes a `dld-sync.sqlite.bak.{timestamp}` safety copy of the current DB, then moves the imported file into place and restarts the DB connection.

**Old backups without `meta.json`** (anything exported before v1.1) fall back to *"Created: unknown, contents not verified"* — the modal shows only current-DB counts. The import still works after `[Confirm]`; the safety `.bak.{timestamp}` is still written.

---

## Audit hardening (v2.1)

> v2.1 ships five audit-hardening features as a patch on top of v2.0. Schema migration 008 runs automatically at first launch — adds four columns to `audit_log` (`user`, `tier2`, `prev_hash`, `row_hash`), widens the `action` CHECK to include `'revert'`, and backfills hashes for existing rows in `(ts, audit_id)` order.

### Reverting a change

Open the `📜 History` page → find the row whose change you want to undo → click `[↶ Revert]` at the end of the row → confirm in the dialog.

The revert restores `master_data` to that row's `old_value` and appends a fresh `audit_log` entry with `action='revert'`. This is a **Cmd-Z model — one step at a time.** Clicking Revert on consecutive entries walks back through the history step-by-step; there is no "revert to date X" bulk operation.

The button only appears on rows whose `action` is `approve` / `override` / `approve_bp` / `revert` AND whose `table_name` is `master_data`. Rows for `auto_apply`, `reject`, `learn_alias`, and `acknowledge_bp` get no button — they didn't change `master_data` in the first place, so there's nothing to revert.

### Your audit identity

Open `⚙ Settings` → **"Your name (audit attribution)"** → type your name or email → Save. Every change you approve / override / reject / revert from then on stamps that name into `audit_log.user`.

If you leave the field blank, the app falls back to your Windows login name (`os.userInfo().username`). Either way, the audit trail records *who* approved each change, not just *what* changed.

Existing rows from v1.1 / v2.0 stay `NULL` — attribution is forward-only.

### Tier-2 approval safeguards

Big changes trigger an extra confirmation. Defaults (configurable in Settings):

- **Price** — delta > **10%** OR > **50,000 AED absolute**
- **Area** — delta > **5%**

When you click Approve on a row that crosses one of these thresholds, a **Tier-2 justification modal** pops up. Type a justification (minimum 10 characters) and confirm — only then does the change commit. The justification is stored in `audit_log.user_note` and the row is flagged `tier2=1`.

On a BP card's **Approve all** button, if any single field crosses Tier-2 the app shows **one combined modal** listing every Tier-2 row in the card with a single shared justification — you type the reasoning once and it stamps every affected audit entry.

Thresholds live in Settings:
- **Tier-2 price threshold (%)** — default `10`
- **Tier-2 price threshold (AED)** — default `50000`
- **Tier-2 area threshold (%)** — default `5`

The backend re-validates thresholds when the commit lands (defense in depth — a tampered renderer can't skip the gate).

### Cryptographic audit chain

Every `audit_log` row now carries a SHA-256 hash that includes the previous row's hash — a tamper-evident chain. The hash is computed over `(prev_hash || canonicalize(row_content))` so any in-place edit to a past row breaks the chain at that row and every row after.

Migration 008 backfills hashes for all existing rows in `(ts, audit_id)` order on first launch. From v2.1 onward, every `writeAuditLog` call appends a new row that chains forward.

No "Verify audit log" button yet — the chain is just present. A future version will surface a one-click verification that walks the chain and highlights any break. For now, anyone with SQLite access (auditors, compliance) can re-compute the hashes themselves and confirm integrity.

### Excel audit export

Open the `📜 History` page → adjust filters as needed → click `[Export Excel]` (next to `[Export CSV]`) → choose where to save the `.xlsx`.

The export honours the **currently filtered** set — not just the visible page — and writes 12 columns:

`Timestamp` · `User` · `Project` · `Unit` · `Field` · `Old value` · `New value` · `Action` · `Source` · `Tier-2` · `Justification` · `Row hash`

Open in Excel, share with compliance, archive monthly. Uses the existing `xlsx` dependency — no new install required.

### Settings reference (v2.1 fields)

The `⚙ Settings` page gains four fields for v2.1:

| Field | Type | Default | Stored as |
|---|---|---|---|
| Your name (audit attribution) | Text | empty → OS username | `audit_user` |
| Tier-2 price threshold (%) | Number | `10` | `tier2_price_pct` |
| Tier-2 price threshold (AED) | Number | `50000` | `tier2_price_abs` |
| Tier-2 area threshold (%) | Number | `5` | `tier2_area_pct` |

**Bonus polish (v2.1):** the **log column** on the right side of the app now starts **hidden by default**. The `📋` toggle in the top bar still shows / hides it on demand — it just no longer steals horizontal space on first launch.

---

## Receiving patches (v1.2+)

> From v1.2 onward, updates are distributed as small zip patches (~5-15 MB) instead of full 78 MB installers. Your admin builds the patch and shares it (OneDrive / email / network drive). The **v1.2.0 → v2.0.0** upgrade will be the first real-world patch distributed via this mechanism.

To apply a patch:

1. Save the `dlp-patch-vA-to-vB.zip` somewhere on your machine (Downloads is fine).
2. Open DL-Processor → sidebar → **⬆ Apply update**.
3. Click **Choose patch file…** and pick the zip.
4. App verifies the patch (checks app ID, version compatibility, SHA-256 of the contents) and shows a summary:
   - Current version → target version
   - Build date and SHA-256 (compare against what your admin posted if you want)
   - Release notes
   - Warning that the app will close and restart
5. Click **Apply & Restart**. The app quits, swaps `app.asar`, and relaunches with the new version.
6. Your data in `Desktop\DL-Processor\` is NOT affected — only the app code changes. Any new schema migrations run automatically at first launch.

If the patched version misbehaves, open Settings → **Revert last patch** to restore the previous `app.asar` (the app keeps a `.bak` of the last working version). The app restarts automatically.

See [TROUBLESHOOTING.md → Patch update problems](TROUBLESHOOTING.md#patch-update-problems-v12) for failure modes and recovery.

---

## CLI subcommands

| Subcommand                                        | Does                                                                                  |
|---------------------------------------------------|---------------------------------------------------------------------------------------|
| `node index.js`                                   | Full pipeline: parse DLD files → import SF xlsx → compare → status                    |
| `node index.js parse [file]`                      | Parse one DLD file, emit JSON + CSV in `output/`, no DB write                          |
| `node index.js import [file]`                     | Parse + upsert into SQLite as a new snapshot                                          |
| `node index.js import-sf [file]`                  | Import one SF xlsx (or all in `sf-input/` if no file given)                           |
| `node index.js compare [name]`                    | Run unit-level DLD↔SF diff; emit per-project HTML, CSV, audit-tasks; writes `output/dashboard.html` |
| `node index.js diff [name] [--since YYYY-MM-DD] [--show-missing]` | Month-over-month DLD snapshot diff. `--since` picks the baseline by date; `--show-missing` includes units/tx that disappeared. |
| `node index.js import-overrides <csv>`            | Apply buyer overrides edited in the HTML and exported via the "Overrides" button      |
| `node index.js area-template [project\|all]`      | Emit per-unit area CSV for staff to fill (`output/area-template-<slug>.csv`)          |
| `node index.js apply-areas <csv>`                 | Apply filled-in area CSV to `manual_area` table                                       |
| `node index.js audit`                             | Reconciliation report (counts, cross-checks) — the `[V]` menu option                  |
| `node index.js audit-log [N]`                     | Show last N entries of `logs/audit.jsonl` (default 30)                                |
| `node index.js review-pending`                    | **(v1.1)** Prints a hint to use the desktop app's inline Review Pending page. The legacy HTML+CSV roundtrip has been replaced — no files are written. |
| `node index.js apply-pending [csv]`               | **(Legacy — deprecated v1.1, removed v1.2.)** Reads a `change_id`+`decision` CSV and commits approved rows to `master_data`. Kept for backward compatibility; the desktop app no longer drives reconciliation through CSVs. |
| `node index.js audit-delta`                       | **(Legacy.)** Cross-checks manual audit flags vs tool output. Useless since v0.9.4.    |
| `node index.js import-audit <xlsx>`               | **(Legacy — don't use.)** Imported the Projects Verification workbook. Replaced by the reference table in this README. |
| `node index.js projects`                          | List DLD projects in the DB with their mapping                                        |
| `node index.js status`                            | DB overview — counts per table                                                        |

---

## Data model & file layout

```
dl-processor/
├── dl-processor.bat       # Windows launcher
├── index.js               # CLI dispatcher
├── package.json           # deps: better-sqlite3, xlsx, csv-parse, adm-zip
│
├── config/
│   └── project-mapping.json   # DLD name → SF sub_project / prefix / transforms / area threshold
│
├── data/
│   └── dld-sync.sqlite        # main DB (gitignored, contains PII)
│
├── db/
│   └── schema.sql             # tables + views
│
├── input/                     # drop DLD .xps / .csv here (gitignored)
│   └── Changes Template Input/    # drop filled area-template CSVs here
├── sf-input/                  # drop SF .xlsx here (gitignored)
│
├── output/                    # generated CSV/JSON (gitignored)
│   ├── compare/               # per-project <name>.compare.html reports
│   ├── diff/                  # per-project <name>.diff.html reports
│   ├── csv/                   # per-project .compare.csv, .diff.csv, .audit-tasks.csv
│   │   └── pending-changes.csv    # (legacy v1.0 path) consumed by the apply-pending CLI
│   ├── Changes Template/      # generated area-template-<slug>.csv files (output of [Y] → 1)
│   ├── audit-delta/           # per-project <name>.audit-delta.html (legacy)
│   └── dashboard.html         # cross-project summary (regenerated on every compare run)
│
├── logs/
│   └── audit.jsonl            # every import/pull/compare/edit/apply (gitignored — PII)
│
├── src/
│   ├── common.js              # shared parsers (party text, amounts, normalize unit)
│   ├── extractor.js           # XPS positional-glyph extractor
│   ├── parser.js              # XPS project parser
│   ├── sources/csv.js         # DLD CSV parser
│   ├── db.js                  # better-sqlite3 wrapper, schema load + self-heal migrations
│   ├── import-dld.js          # parsed tree → snapshot rows
│   ├── salesforce.js          # SF xlsx reader (header-name based)
│   ├── project-mapping.js     # auto-infer DLD↔SF mapping; merge config overrides; getAreaThreshold
│   ├── compare.js             # unit-level DLD↔SF diff; multi-applicant matching; area signal
│   ├── diff.js                # month-over-month DLD snapshot diff
│   ├── overrides.js           # bank-only detection + manual_override CRUD
│   ├── area-template.js       # generate / apply staff-filled area CSVs
│   ├── audit-report.js        # `audit` subcommand — counts + cross-checks
│   ├── audit-log.js           # JSONL audit trail
│   ├── menu.js                # terminal menu (zero-dep, pure readline)
│   ├── html-styles.js         # Sobha-branded CSS for compare.html
│   └── writers.js             # per-project JSON/units.csv/transactions.csv
│
└── vendor/                    # vendored web assets (offline-friendly)
```

### Key DB tables

- **`dld_project`** — one row per DLD project we've ever seen.
- **`dld_snapshot`** — one row per DLD file imported; SHA-256 of the source.
- **`dld_unit`** — properties within a snapshot (unit number, type, `net_area`).
- **`dld_transaction`** — per-unit transactions (Sale, Sell-Pre, Mortgage, etc. with party + date + amount).
- **`sf_snapshot`** — one row per SF xlsx imported.
- **`sf_booking`** — one row per SF booking; includes primary applicant + co-applicants 2–4 + `applicant_details`. v2.0 adds `current_step_name`, `current_step_assigned_name`, and `comments` (read by the BP card SF context strip).
- **`project_mapping`** — overrides for DLD ↔ SF translation, including per-project `area_threshold_pct`.
- **`master_data`** — wide table, one row per `(project_id, unit_number_norm)`. Single source of truth for staff-curated values (`buyer_name`, `purchase_price_aed`, `area_sqm`, etc.). Each field has a `_source` provenance column (`staff` / `dld_approved`) and a `_decided_at` timestamp. Seeded from `manual_override` + `manual_area` on first run.
- **`pending_change`** — tall audit trail. One row per `(unit, field)` proposed change. `decision` starts as `pending` and is set to `approved` / `rejected` (review_pending UI) or `auto_applied` (compare-time drift). v1.1 adds `change_type` (`MISMATCH` / `DLD_DRIFT` / `SF_DRIFT`) and `override_value` (the user-typed final value, when an inline override happened). Approved rows are applied to `master_data` from the inline Review Pending page.
- **`audit_log`** — **(v1.1.)** Append-only event log; one row per change to live data. Records `action` (`approve`/`override`/`reject`/`auto_apply`/`learn_alias`), `source` (`review_pending`/`import_dld`/`import_sf`/`apply_pending`/`compare`), `old_value`/`new_value`, and FK `change_id` into `pending_change`. Indexed by `(project_id, unit_number_norm, ts DESC)` for the per-unit side panel and by `(project_id, ts DESC)` for the global History page.
- **`buyer_alias`** — **(v1.1.)** Learnable equivalence pairs for buyer-name normalization. `(variant, canonical)` are stored already-normalized; `project_id NULL` = global alias. Populated by the `🔗 Teach alias` button on the Review Pending page and seeded with a built-in transliteration map (~50 Sobha-context Arabic-Latin pairs).
- **`schema_migration`** — **(v1.1.)** One row per applied migration (`id`, `name`, `applied_at`). Driven by `src/migrations/`; idempotent — only un-applied migrations execute at each `openDb()` call.
- **`manual_override`** — **(legacy, frozen after migration to `master_data`).** Pre-v0.9.16 per-unit buyer overrides. Still readable; no new writes.
- **`manual_area`** — **(legacy, frozen after migration to `master_data`).** Pre-v0.9.16 staff-recorded SQM. Still readable; no new writes.

---

## How projects are mapped

DLD names and SF names rarely match exactly. A `Waves` project sheet in DLD maps to `sub_project='Waves'` / `unit_prefix='W'` in SF, so DLD unit `101` becomes SF unit `W-101`.

Three layers, in priority order:

1. **`config/project-mapping.json`** — hand-written overrides (takes precedence).
2. **Auto-inference** — group SF bookings by `sub_project`, detect the dominant unit prefix, match DLD project name by containment.
3. **No mapping** — project falls out of compare. Visible in `[V]` as "unmatched".

`unitTransforms` and `buildingTransforms` rewrite DLD unit numbers before the SF prefix is prepended. See the existing entries in `config/project-mapping.json` for examples.

---

## Multi-applicant name matching

> Added in v0.9.14.

DLD records the buyer name on the latest non-bank purchase transaction. Salesforce records up to **five** name fields per booking:

1. `applicant_name` — primary applicant
2. `applicant_2_name`, `applicant_3_name`, `applicant_4_name` — additional co-applicants
3. `applicant_details` — usually a cleaned primary name (titles stripped) OR a co-owner name when the booking has multiple applicants

Compare walks all five slots and matches the DLD buyer against each one in priority order. The first slot that overlaps wins.

- **Primary slot match → MATCH** (no flag).
- **Non-primary slot match → MATCH + A10 flag** plus `co-applicant:<field>` in the reason column. The match is informative — no action required, but reviewers can filter by `A10` to audit co-applicant matches if they want.
- **No slot matches → BUYER_MISMATCH** (existing path; A8 normalisation, transliteration, etc. still apply).

Net effect on a typical month: a meaningful chunk of rows that used to land in BUYER_MISMATCH because the DLD buyer was a co-owner now correctly classify as MATCH+A10.

---

## Area cross-check (SQM)

> Added in v0.9.14. Area data migrated to `master_data` in v0.9.16.

DLD records `net_area` per unit. The Sobha-recorded saleable / built-up area lives in the `master_data.area_sqm` field (previously `manual_area`, migrated on first run of v0.9.16+), fed by the `[Y] Area template` workflow. Compare emits an area signal when both sides exist.

**Signal rules** (see `computeAreaSignal` in `src/compare.js`):

- |Δ%| < 0.5% → `none` (rounding noise; no signal).
- 0.5% ≤ |Δ%| < threshold → **A11 flag** (soft). Existing match status unchanged. Common cause: common-area allocation, saleable-vs-net rounding.
- |Δ%| ≥ threshold → **AREA_MISMATCH status** (hard) when the row would otherwise be MATCH. If the row already has a higher-precedence problem (BUYER_MISMATCH, PRICE_*, DLD_ONLY, SF_ONLY), the existing status is kept and `A11` is added — fix the primary issue first; the area gap may resolve once the right SF row is matched.

**Threshold resolution** (highest precedence first):

1. `project_mapping.area_threshold_pct` (DB column — manual / future UI override)
2. `config.overrides[<project>].areaThresholdPct`
3. `config.defaults.areaThresholdPct`
4. Hard-coded fallback `5`

Per-project example:

```json
"Sobha Reserve": {
  "sf_sub_project": "Sobha Reserve",
  "sf_unit_prefix": "SR-V",
  "areaThresholdPct": 8
}
```

Status priority for sort and audit-task ordering: `BUYER_MISMATCH (0), AREA_MISMATCH (1), DLD_ONLY (2), SF_ONLY (3), PRICE_DOWN (4), PRICE_UP (5), MATCH (6)`.

The `[V]` reconciliation report includes an "Area cross-check coverage" section — per project, how many DLD units have a `manual_area` row, plus a total percentage. Use it to see which projects still need staff to fill area templates.

---

## HTML reports — what the filters do

The per-project `<name>.compare.html` and `all-projects.compare.html` master:

1. **Stat cards** — MATCH / PRICE ↑ / PRICE ↓ / BUYER / **AREA** / DLD-only / SF-only, each clickable.
   - Click → only that status shows.
   - Click again → all statuses come back.
   - `Ctrl`/`Shift`+click → toggle multiple.
2. **Top search box** — substring filter across every column.
3. **Per-column header filters** — work alongside the search box (AND together).
4. **"Hide unsold" toggle** — hides developer-held units (DLD type "Owner (no transaction)").
5. **Group by** — group rows by status / tx type / unit type / SF status / project (master).
6. **Columns ▾** — hide / show columns.
7. **Reset** — clears all filters.
8. **Export CSV** — current filtered view.
9. **Overrides (N)** — edit the Actual Buyer / Notes columns inline; export and re-import via `apply-overrides`.

Area columns added in v0.9.14: `Manual SQM`, `Area Δ %`, `Area Δ sqm`. Audit flags chip column shows the active A-codes per row.

Buyer columns added in v0.9.15: `DLD #` (count of DLD buyers on the unit) and `SF #` (count of SF applicants on the booking). These let reviewers spot multi-buyer units at a glance without opening the detail row. The dashboard (`output/dashboard.html`) shows a cross-project summary with MATCH / BUYER MISMATCH / Audit Tasks / A10 / A11 / A12 counts — click a project name to open its compare report directly.

---

## Audit-flag reference (A-codes)

The `audit_flags` column on each row carries zero or more pipe-separated A-codes. Filter by typing the code in the column header.

| Code | Meaning | Action |
|------|---------|--------|
| `A1` | SF has a title prefix DLD doesn't (cosmetic, normalised) | None — informational |
| `A3` | Name tokens order-swapped (cosmetic, normalised) | None |
| `A4` | Company prefix `M/S.` / `Messrs.` (cosmetic, normalised) | None |
| `A5` | Partial name overlap < 50% (possible transliteration) | Spot-check |
| `A6` | Partial name overlap ≥ 50% (likely middle name dropped) | Spot-check |
| `A7` | Villa / plot buyer+price fuzzy match | Confirm the buyer + price line up |
| `A8` | BUYER_MISMATCH that normalises to MATCH (false positive) | Review — likely benign |
| `A9` | Latest DLD tx is a bank — mortgage flow | Add a manual override with the real buyer |
| `A10` | Matched via co-applicant (not the SF primary applicant) | None — recorded for audit |
| `A11` | Area mismatch flagged (soft <threshold, OR hard but row already non-MATCH) | (a) <threshold — spot-check; raise with engineering if systematic. (b) Higher-precedence issue exists — fix that first. |
| `A12` | Multi-buyer ANY-MATCH — DLD unit has multiple buyers, SF booking name matches any one of them | None — informational; review if needed |

A1–A7 are treated as MATCH-eligible (per v0.9.11) — they upgrade BUYER_MISMATCH rows to MATCH. A8 / A9 still need review. A10 is informational only. A11 fires alongside the row's primary classification — does not change the status by itself. A12 is informational — records that the MATCH was achieved by ANY-MATCH logic across multiple DLD buyers.

---

## Project ↔ SF SUB ↔ PREFIX reference

Ground-truth project table, derived from the current SF snapshot. Use this when adding a DLD project to `config/project-mapping.json` — look up the sub-project and prefix here, don't guess.

| SF Project        | SF Sub-Project             | Prefix(es) in SF Unit    | Towers                                   |
|-------------------|----------------------------|--------------------------|------------------------------------------|
| Sobha Central     | The Eden                   | `SC-TE-`                 | single                                   |
| Sobha Central     | The Horizon                | `SC-TH-`                 | single                                   |
| Sobha Central     | The Mirage                 | `SC-MG-`                 | single                                   |
| Sobha Central     | The Pinnacle               | `SC-PL-`                 | single                                   |
| Sobha Central     | The Serene                 | `SC-TS-`                 | single                                   |
| Sobha Central     | The Tranquil               | `SC-TQ-`                 | single                                   |
| Sobha Central Mall| Sobha Central Mall         | `SC-R-`                  | single                                   |
| Sobha Elwood      | Sobha Elwood               | `SEL-V`                  | Elwood Villas (two sub-villages)         |
| Sobha Hartland    | Creek Vista                | `A-`, `B-`               | Tower A, Tower B                         |
| Sobha Hartland    | Creek Vistas Grande        | `CVG-`, `CVG-Polyclinic` | single                                   |
| Sobha Hartland    | Crest Grande               | `CGA`, `CGB`, `CGC`, `CGR` | Tower A / B / C / Retail               |
| Sobha Hartland    | Greens                     | (no prefix — bare `4001`, `2S01`, `5004`) | Phase I / II / III buildings |
| Sobha Hartland    | One Park Avenue            | `O-`, `O-R`              | single                                   |
| Sobha Hartland    | Sobha Creek Vista Heights  | `CVH-A`, `CVH-B`, `CVHR` | SCVH Tower A / B / Retail                |
| Sobha Hartland    | Sobha Creek vistas Reserve | `RA-`, `RB-`, `RA-R`     | SCVR A / B                               |
| Sobha Hartland    | Sobha Waves Opulence       | `WO-`, `WO-R`            | single                                   |
| Sobha Hartland    | The Crest                  | `A`, `B`, `C`, `D`, `Cr-R` | Towers A / B / C / D / Retail          |
| Sobha Hartland    | Townhouses                 | `T`                      | single                                   |
| Sobha Hartland    | Villas                     | `SV`, `GV`, `T`, `VE`    | Phase I / II / III                       |
| Sobha Hartland    | Waves                      | `W-`, `W-R`              | single                                   |
| Sobha Hartland    | Waves Grande               | `WG-`, `WG-R`            | single                                   |
| Sobha Hartland -II| 310 Riverside Crescent     | (embedded: `310 RSC-`)    | single                                   |
| Sobha Hartland -II| 320 Riverside Crescent     | (embedded: `320 RSC-`)    | single                                   |
| Sobha Hartland -II| 330 Riverside Crescent     | (embedded: `330 RSC-`)    | single                                   |
| Sobha Hartland -II| 340 Riverside Crescent     | (embedded: `340 RSC-`)    | single                                   |
| Sobha Hartland -II| 350 Riverside Crescent     | (embedded: `350 RSC-`)    | single                                   |
| Sobha Hartland -II| 360 Riverside Crescent     | (embedded: `360 RSC-`)    | single                                   |
| Sobha Hartland -II| Skyscape Altius            | `SAL-`                   | single                                   |
| Sobha Hartland -II| Skyscape Aura              | `SAR-`                   | single                                   |
| Sobha Hartland -II| Skyscape Avenue            | `SAV-`                   | single                                   |
| Sobha Hartland -II| Skyvue Altier              | `SSA-`                   | single                                   |
| Sobha Hartland -II| Skyvue Solair              | `SSO-`                   | single                                   |
| Sobha Hartland -II| Skyvue Spectra             | `SSP-`                   | single                                   |
| Sobha Hartland -II| Skyvue Stellar             | `SST-`                   | single                                   |
| Sobha Hartland -II| Sobha Hartland II Villas   | `SE-V`, `SE-M`           | Villas / Mansion                         |
| Sobha One         | Sobha One                  | `SO-A` .. `SO-E`, `SO-V`, `SO-R` | Tower A / B / C / D / E / Podium / Retail |
| Sobha One         | The Element at Sobha One   | `SO-EL-`                 | single                                   |
| Sobha Orbis       | Sobha Orbis                | `SOR-A` .. `SOR-G`, `SOR-R`, `SOR-RA` .. `SOR-RG` | Towers A – G / Plaza / Retail each |
| Sobha Reserve     | Sobha Reserve              | `SR-V`                   | single                                   |
| Sobha SeaHaven    | Sobha SeaHaven             | `SSH-A`, `SSH-B`, `SSH-C`, `SSH-R[ABC]` | Towers A / B / C + per-tower retail |
| Sobha Skyparks    | Sobha Skyparks             | `SO-SK-`                 | single                                   |
| Sobha Solis       | Sobha Solis                | `SOL-A`, `SOL-B`, `SOL-C`, `SOL-D` | Towers A / B / C / D            |
| The S             | The S                      | `S-`                     | single                                   |
| Verde By Sobha    | Verde By Sobha             | `VER-`, `VER-R`          | single                                   |

---

## Troubleshooting

For everything we know goes wrong and how to fix it, see **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**. Coverage includes:

- Installation issues (SmartScreen, upgrade-from-v1.0 schema errors, uninstall)
- App-launch issues (blank windows, empty dropdowns, ABI mismatches)
- Data-flow issues (DLD_ONLY / SF_ONLY everywhere, BUYER_MISMATCH noise, drift not appearing)
- UI quirks (sticky filters, missing collapse button, modal won't accept old zips)
- Build problems (icon size, Python errors, winCodeSign extraction, spawn ENOENT)
- Test problems (Node 24 vs Electron 28 ABI, fixture patterns)
- Diagnostic procedures + log locations + recovery procedures

For development environment setup (Node version, electron-builder, schema migrations) see **[BUILDING.md](BUILDING.md)**.

Quick reference — the most common ones:

| Symptom | Fix |
|---|---|
| SmartScreen blocks installer | More info → Run anyway. App is unsigned. |
| Empty project dropdown after install | Import a DLD or SF file first (fresh DB has no projects). |
| `no such column: change_type` on every action | Reinstall current `.exe` (commit `2d692bb` or later fixes the upgrade order). |
| `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch | Reinstall `.exe` (end user) or use `npm test` not `node --test` (developer). |
| `BUYER_MISMATCH` queue is huge | Use `🔗 Teach alias` on rows that should match — persists for future months. |
| HTML report filters feel sticky | Click **Reset** at top of table. Filters compose with AND. |
| Lost data | Look for `dld-sync.sqlite.bak.{ts}` in the data folder. Rename → relaunch. |

---

## Changelog

### v2.1.0 (13 May 2026)

Audit & compliance hardening — five features distributed as a patch on top of v2.0.0.

#### One-click Revert on History rows

Global History page rows whose `action` is `approve` / `override` / `approve_bp` / `revert` (and whose `table_name` is `master_data`) gain a `[↶ Revert]` button. Click → confirm → `master_data` is restored to `old_value` and a fresh `audit_log` row is appended with `action='revert'`. Cmd-Z model — one step at a time. Non-revertable actions (`auto_apply`, `reject`, `learn_alias`, `acknowledge_bp`) get no button.

#### User attribution

New `audit_log.user` column. Populated from the new Settings field **"Your name (audit attribution)"** if set, else falls back to `os.userInfo().username`. Forward-only — pre-v2.1 rows stay NULL.

#### Cryptographic chain on `audit_log`

New `prev_hash` + `row_hash` columns. SHA-256 over `(prev_hash || canonicalize(row_content))`. Migration 008 backfills existing rows in `(ts, audit_id)` order; from v2.1 onward `writeAuditLog` chains forward at every append. Tamper-evident — any in-place edit to a past row breaks the chain at that row and every row after.

#### Tier-2 approval gates

Settings thresholds (defaults: price > 10% delta OR > 50K AED absolute; area > 5% delta). When an approval crosses a threshold a justification modal (min 10 chars) fires before the commit. Justification stored in `audit_log.user_note`; row flagged `tier2=1`. BP-card **Approve all** shows ONE combined modal listing every Tier-2 row in the card with a shared justification. Backend re-validates thresholds at commit (defense in depth).

#### Excel audit export

New `[Export Excel]` button on the History page next to `[Export CSV]`. Honours current filters. 12 columns: Timestamp / User / Project / Unit / Field / Old value / New value / Action / Source / Tier-2 / Justification / Row hash. Uses the existing `xlsx` dependency.

#### Schema migration 008

One idempotent pass:
- Adds 4 nullable columns to `audit_log`: `user`, `tier2`, `prev_hash`, `row_hash`
- Widens `audit_log.action` CHECK to include `'revert'`
- Backfills hashes for existing rows

#### Settings additions

- "Your name (audit attribution)" — text
- "Tier-2 price threshold (%)" — number, default 10
- "Tier-2 price threshold (AED)" — number, default 50000
- "Tier-2 area threshold (%)" — number, default 5

#### Bonus polish

The right-side log column now starts hidden by default. The 📋 toggle in the top bar still works to show it on demand.

Test count: 390 → **422**.

### v2.0.0 (12 May 2026)

Three feature areas shipped as one milestone — first patch-distributed release (v1.2.0 → v2.0.0 zip patch).

#### Feature A — De-iframe refactor

All in-app pages (Review Pending, History, Status, Projects, Apply pending) now render as native renderer-DOM panes instead of iframes-with-srcdoc. Scripts run in the main renderer context. The tab-host supports a `render` mode for native panes alongside the existing `url` mode (still used for the output Dashboard). Same pattern as v1.1's unit-history-panel / patch-modal.

#### Feature B — Business Process grouping

Review Pending's Needs review tab now shows **BP cards** (grouped by `(source_snapshot_id, project_id, unit_number_norm)`) instead of per-field rows. Each card carries a BP-type label (`src/bp-classifier.js`), an SF state badge (`src/sf-state.js`), the full SF context strip, and gated action buttons. An 8-dimension filter bar narrows the queue (Project / Tower / BP type / SF state / Assigned to / Procedure # / Date range / Search). See [Reviewing changes (v2.0)](#reviewing-changes-v20).

Two schema migrations:
- **006** — adds `current_step_assigned_name` and `comments` to `sf_booking` (`current_step_name` was already in v1.0 schema).
- **007** — widens `audit_log.action` CHECK to allow `approve_bp` / `reject_bp` / `acknowledge_bp`.

SF importer extension: extracts `Current Step Name`, `Current Step: Assigned Name`, `Comments` headers from `.xlsx` (case-insensitive, colon-tolerant).

#### Feature C — DLD drift detection

The v1.1-deferred `'dld'` branch of `compare-drift.js` is now real. `pickLatestPurchase` / `pickLatestMarketPrice` / `findLatestNonBankParty` extracted into `src/snapshot-extract.js` plus a new `extractUnitFields(db, snapshotId, projectId, unitNumberNorm)`. Compare-time drift detection writes `DLD_DRIFT` rows to `pending_change` and `auto_apply` rows to `audit_log` (`source='compare'`) for any unit whose operational fields changed between two consecutive `dld_snapshot`s.

Test count: 338 → **390**.

### v0.9.17 (6 May 2026)

Phase A bundle — three small improvements landed on master after the master-data merge.

#### Audit-delta HTML buyer columns

`output/audit-delta/<name>.audit-delta.html` now shows **DLD #** and **SF #** buyer count columns per row, matching the layout used by `compare.html`. Auditors can spot multi-party units in the monthly tool-vs-auditor cross-check without expanding the detail view.

#### `[Z] Archive output` menu entry

New one-click archiving. Copies the current `output/` tree to `output/archive/<YYYY-MM-DD-HH-MM>/`. Run before re-importing a corrected DLD file to keep the previous run's HTML reports and CSVs. Doesn't delete anything.

#### Dashboard test coverage

`test/dashboard.test.js` now exercises `buildProjectStat` and `writeDashboardHtml` end-to-end — synthesized compare results + master-data rows feed the renderer and the test asserts MATCH/BUYER/A10/A11/A12/Pending column counts plus filter+sort attributes.

Test count: 190 → **198**.

### v0.9.16 (4 May 2026)

Three quality-of-life improvements on the `feat/master-data-approval` branch.

#### Master-data + approval queue

A new `master_data` table (wide, one row per unit) is the single source of truth for staff-curated values: `buyer_name`, `purchase_price_aed`, `area_sqm`, `status`, `procedure_number`. Each field carries a `_source` provenance tag (`staff` / `dld_approved`) and a `_decided_at` timestamp.

- **Migration on first run** — existing `manual_override` rows (buyer overrides) and `manual_area` rows (SQM data) are automatically copied into `master_data` via `db.js` self-heal. The legacy tables are then frozen; all new reads and writes go to `master_data`.
- **`pending_change` table** — after every DLD import, differences between the incoming snapshot and `master_data` are queued here as `pending` rows (one per `(unit, field)`). This is the audit trail for DLD-proposed changes.
- **CSV round-trip approval workflow** — `[V] Review pending` writes `output/csv/pending-changes.csv`; staff set each row's `decision` to `approved` or `rejected` and save; `[B] Apply pending` reads the file back, promotes approved rows to `master_data`, and records the decision timestamps.

#### New CLI subcommands

- `node index.js review-pending` — writes `output/csv/pending-changes.csv`. Corresponds to menu `[V]`.
- `node index.js apply-pending` — applies decisions from `pending-changes.csv` to `master_data`. Corresponds to menu `[B]`.

#### Menu changes

- `[5]` renamed from "Manual Overrides" → **"Master Data (staff edits)"** — reflects the wider scope of the new table.
- **`[V] Review pending changes`** — new entry (was `[V] Verify / audit data`, now moved to `[A] Audit Report`).
- **`[B] Apply pending decisions`** — new entry.

#### Dashboard Pending column

`output/dashboard.html` gains a **Pending** column showing the count of unresolved `pending_change` rows per project. Lets staff see at a glance which projects have queued DLD-proposed changes waiting for approval.

#### Sobha-branded diff HTML

`output/diff/<name>.diff.html` now uses the same cream/bronze Sobha palette as `compare.html`, `dashboard.html`, and `audit-delta.html`. The previous dark-theme inline CSS has been replaced with `SOBHA_STYLE_CSS` from `src/html-styles.js`.

#### `[L] Last drop` menu entry

New one-click shortcut: scans `input/` and `sf-input/` for the newest `.xps`/`.csv`/`.xlsx` file, shows the filenames and dates, and runs the full pipeline after confirmation.

### v0.9.15 (4 May 2026)

Three feature branches merged into master, plus 8 polish fixes.

#### A12 — multi-buyer ANY-MATCH

Compare now handles DLD units where multiple buyers appear across different transactions. When the SF booking name matches any one of the DLD buyers (primary or resale), the row classifies as `MATCH + A12` instead of `BUYER_MISMATCH`. A12 is informational — no action required, but reviewers can filter by `A12` to audit any-match resolutions.

#### Dashboard (`output/dashboard.html`)

A cross-project summary HTML file is written after every `compare` run. Columns: Project (link to compare report), MATCH, BUYER MISMATCH, Audit Tasks, A10, A11, A12. Sortable by column header; filterable by project name. Skipped projects show a badge with the skip reason.

#### Output folder structure

All generated files now land in sub-folders:
- `output/compare/<name>.compare.html` — per-project HTML compare report
- `output/diff/<name>.diff.html` — per-project HTML diff report
- `output/csv/<name>.compare.csv`, `<name>.diff.csv`, `<name>.audit-tasks.csv`
- `output/dashboard.html` — cross-project summary

#### `diff` command flags

- `--since YYYY-MM-DD` — pick the diff baseline by date (snapshot imported before the given date) rather than always using the second-latest import.
- `--show-missing` — include units/transactions that disappeared between the two snapshots (hidden by default to reduce noise).

#### HTML buyer columns

`DLD #` and `SF #` columns on the compare HTML report show the count of DLD buyers and SF applicants per row, letting reviewers spot multi-party units without expanding the detail view.

#### Polish fixes (all on master)

- Consistent `[1/5]...[5/5]` step labels in the full-pipeline run.
- Per-project `try/catch` in `compare` and `diff` CLI — a corrupt project or locked file no longer kills the whole 30-project run.
- Friendly error message when SF `.xlsx` is open in Excel (`EBUSY`/`EPERM` → "close Excel and re-run").
- Dashboard sort uses `data-sort-val` on numeric cells — em-dash cells no longer sort as text ahead of numbers.
- CSV serialization: string arrays (`match_flags`) → pipe-joined; object arrays (`dld_buyers`, `sf_applicants`) → JSON-quoted.
- SF import deduplication by SHA-256: re-importing the same file is a no-op (returns the existing snapshot ID).
- Bulk transaction load in `compareProject`: one query per snapshot instead of one query per unit (~30,000 → ~30 queries on a full run).

### v0.9.14 (1 May 2026)

Two additive features ship in one branch — both extend the compare engine without changing existing match counts on rows where the new data is absent.

#### Multi-applicant name matching (A10)

Compare now walks all five SF applicant slots when matching DLD buyers — `applicant_name`, `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, `applicant_details`. Co-applicant matches reclassify from `BUYER_MISMATCH` → `MATCH + A10`. Net effect: a measurable drop in BUYER_MISMATCH and a matching rise in MATCH on the next monthly run, with a new `A10` chip indicating the match was on a non-primary slot.

#### SQM area cross-check (A11 / AREA_MISMATCH)

- New durable table **`manual_area`** parallel to `manual_override`, keyed by `(project_id, unit_number_norm)`. Survives every SF re-import. Populated by staff via the new `[Y] Area template` workflow.
- Compare emits a new signal: below 5% threshold (configurable) → soft `A11` flag; at/above threshold → hard `AREA_MISMATCH` status (only escalates rows that would otherwise be MATCH).
- Per-project threshold via `area_threshold_pct` column on `project_mapping`, or `defaults.areaThresholdPct` / per-project `areaThresholdPct` in `config/project-mapping.json`. Default 5%.
- New stat card **AREA** between BUYER and DLD-only on every dashboard.
- New row fields: `manual_area_sqm`, `area_diff_sqm`, `area_diff_pct`. Three new HTML columns.

#### Template / apply CLI

- `node index.js area-template [project|all]` → emits `output/area-template-<slug>.csv`. One row per DLD unit, including DLD buyer (via `pickLatestPurchase` so mortgage flips don't show banks), expected SF unit (mapping-aware — honours `unitTransforms` / `buildingTransforms`), and any existing `manual_area` value pre-populated.
- `node index.js apply-areas <csv>` → upserts each row whose `area_sqm` is a positive number into `manual_area`. Unit numbers normalised through the same `normalizeUnitNumber` the parser uses, so keys always match `dld_unit.unit_number_norm`. Each apply writes one entry to `logs/audit.jsonl`.
- New menu entry `[Y] Area template` with sub-options to generate / apply.

#### CLI summary + audit report

- `node index.js compare` summary line now includes `AREA:N` between BUYER and DLD-only.
- `node index.js audit` (`[V]`) gains an "Area cross-check coverage" section — per project, how many DLD units have a `manual_area` row populated.

#### Schema migrations

- New `manual_area` table.
- New `project_mapping.area_threshold_pct` column.
- Both auto-migrate on next launch via the existing self-heal pattern in `src/db.js`. Existing DBs inherit zero-area-data state; output is identical to v0.9.13 until templates are filled.

#### Test coverage

29 new tests across 5 new test files (`test/area-signal.test.js`, `test/area-classification.test.js`, `test/area-template.test.js`, `test/area-threshold-resolve.test.js`, `test/compare-multi-applicant.test.js`) plus 2 added to the schema-migration suite. Total 118 tests, all green.

#### Deferred (planned for a future HTML overhaul)

- `?` popovers on A10 / A11 chips — current HTML has no popover infrastructure.
- Default-hidden area columns (`Manual SQM`, `Area Δ sqm`) — current HTML has no column-picker UI.
- Status legend section on the dashboard — current HTML has no legend block.

### v0.9.13 (23 Apr 2026)
- DB dump to CSV. New `node index.js dump-db [--full]` command.

### v0.9.12 (23 Apr 2026)
- Flag help popovers on A5+ flags.

### v0.9.11 (23 Apr 2026)
- Treat flags A1–A7 as MATCH. BUYER_MISMATCH count dropped from ~1,200 to single digits.

### v0.9.10 (23 Apr 2026)
- Review-template workflow (`review-template` / `apply-review`).

### v0.9.9 (23 Apr 2026)
- Extended SF report support — `Booking: Nationality`, `Booking: Applicant Details`. Co-owner name matching on the plot/villa fuzzy matcher.

### v0.9.8 (23 Apr 2026)
- Villa / plot compare via buyer+price fuzzy matcher. Sobha Reserve 0 → 268 matches.
- Arabic-Latin transliteration canonicalisation (20 name groups).

### v0.9.7 (23 Apr 2026)
- Bank-as-buyer fix in `dld_purchase_party`. Title/prefix normalisation expanded. New `audit_flags` column with A-codes.

### v0.9.6 (23 Apr 2026)
- Added 10 project-mapping entries (Riverside Crescent, SCVH, SCVR, Waves Opulence, Element at Sobha One).

### v0.9.5 (23 Apr 2026)
- Removed all Salesforce-login code. SF data enters only via `sf-input/*.xlsx`.

### v0.9.4 (23 Apr 2026)
- Confirmed two-source data flow. Reference table replaces the Projects Verification workbook.

### v0.9.3 (23 Apr 2026)
- Rewrote `compare-html` — stat cards, column picker, cleaner toolbar.

### v0.9.2 (23 Apr 2026)
- Critical fix: `readSfWorkbook` rewritten to detect headers by name. SF cross-match jumped 0% → 84%.

### v0.9.1 (23 Apr 2026)
- `import-audit` rewritten to match columns by header name.

### v0.9.0 (22 Apr 2026)
- JSONL audit log. Direct Salesforce API pull (later removed in v0.9.5).

### v0.8.0 (22 Apr 2026)
- `audit-delta` cross-check (later legacy). Output layout reorg.

### v0.7.0 (22 Apr 2026)
- Manual audit workbook importer.

### v0.6.0 (21 Apr 2026)
- HTML reports migrated to Sobha-branded Tabulator output. Master all-projects dashboard.

### v0.3.0 (21 Apr 2026)
- Folder renamed `XPS-Processor` → `DL-Processor`. Terminal menu. Manual override CRUD. P-Charter integration.

### v0.1 — v0.2
- Initial XPS parser, CSV parser, SQLite schema, per-unit compare.

---

## License

UNLICENSED — internal Sobha Realty / Registration tool.

**Author:** Ali Alghumlasi — Sobha Realty Registration Team.
