# DL-Processor

**DLD Project Inquiry ⇄ Salesforce Reconciler** — Sobha Realty · Registration / DLD team.

Each month Registrations exports a DLD "Project Inquiry" report per project and needs to find where Salesforce is out-of-date: resales the DLD caught but SF didn't, price amendments, unbooked units, mortgages logged as buyers, etc. DL-Processor imports the DLD files, imports Salesforce, matches them at the unit level and produces per-project HTML dashboards and audit-task CSVs.

Lives inside the P-Charter repo as a git subtree: `Desktop\p-charter\dl-processor\`.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Install & launch](#install--launch)
3. [Quick start — the monthly flow](#quick-start--the-monthly-flow)
4. [The menu in detail](#the-menu-in-detail)
5. [CLI subcommands](#cli-subcommands)
6. [Data model & file layout](#data-model--file-layout)
7. [How projects are mapped](#how-projects-are-mapped)
8. [Multi-applicant name matching](#multi-applicant-name-matching)
9. [Area cross-check (SQM)](#area-cross-check-sqm)
10. [HTML reports — what the filters do](#html-reports--what-the-filters-do)
11. [Audit-flag reference (A-codes)](#audit-flag-reference-a-codes)
12. [Project ↔ SF SUB ↔ PREFIX reference](#project--sf-sub--prefix-reference)
13. [Troubleshooting](#troubleshooting)
14. [Changelog](#changelog)

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
5. **(Optional)** Review DLD-proposed changes:
   - `[V] Review pending changes` → opens `output/csv/pending-changes.csv`.
   - Set `decision` to `approved` or `rejected` for each row, save.
   - `[B] Apply pending decisions` → commits approved changes to `master_data`.
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
[V]  Review pending changes   writes output/csv/pending-changes.csv and opens it
[B]  Apply pending decisions  reads pending-changes.csv, commits approve/reject decisions

[Q]  Quit
```

### `[5] Master Data (staff edits)`

DLD transactions sometimes have a bank (mortgage holder) as the last party when the real buyer sold to someone else. The Master Data submenu lets you pick a project, pick a bank-only unit, and enter the real buyer name. Compare reads from `master_data` instead of the bank.

`master_data` is the single source of truth for staff-curated values. It is seeded from `manual_override` + `manual_area` on first run (those legacy tables are then frozen). Every DLD import queues proposed changes into `pending_change` for staff review before they take effect.

### `[V] Review pending changes`

Writes `output/csv/pending-changes.csv` listing every row in `pending_change` whose `decision = 'pending'`. Opens the CSV in the default application (Excel). Staff set the `decision` column to `approved` or `rejected` and save.

### `[B] Apply pending decisions`

Reads the saved `pending-changes.csv` back, applies each approved row to `master_data`, marks rejected rows as decided, and reports the counts.

### `[Y] Area template`

Drives the staff-maintained SQM data flow. Two sub-options:

- **`[1] Generate template`** — emits `output/Changes Template/area-template-<project>.csv` (or `area-template-all.csv`) with one row per DLD unit, pre-populating any existing `master_data.area_sqm` values. Staff fill the `area_sqm` column and (optionally) the `source_note` column.
- **`[2] Apply filled template`** — reads a filled CSV from `input/Changes Template Input/`; upserts every row whose `area_sqm` is a positive number into `master_data`. Blank rows are skipped silently. Unknown project names skip with a warning. Each apply writes one entry to `logs/audit.jsonl`.

### `[A] Audit Report`

Reconciliation report (previously accessible as `[V]` before v0.9.16):

- Rows imported vs rows in the raw xlsx.
- Per-project completeness — missing SF unit / DLD unit / price.
- Projects matched to a DLD row in the DB.
- SF booking cross-check — percentage of audit rows whose booking name exists in the current SF snapshot.
- **Area cross-check coverage** — per-project `master_data.area_sqm` row count vs DLD unit count + total percentage. Lets you see which projects still need staff to fill area templates.

Every run is written to `logs/audit.jsonl`.

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
| `node index.js review-pending`                    | Write `output/csv/pending-changes.csv` of all pending `pending_change` rows. The `[V]` menu option. |
| `node index.js apply-pending`                     | Read `pending-changes.csv`, apply approved decisions to `master_data`. The `[B]` menu option. |
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
│   │   └── pending-changes.csv    # written by review-pending; edited by staff; read by apply-pending
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
- **`sf_booking`** — one row per SF booking; includes primary applicant + co-applicants 2–4 + `applicant_details`.
- **`project_mapping`** — overrides for DLD ↔ SF translation, including per-project `area_threshold_pct`.
- **`master_data`** — wide table, one row per `(project_id, unit_number_norm)`. Single source of truth for staff-curated values (`buyer_name`, `purchase_price_aed`, `area_sqm`, etc.). Each field has a `_source` provenance column (`staff` / `dld_approved`) and a `_decided_at` timestamp. Seeded from `manual_override` + `manual_area` on first run.
- **`pending_change`** — tall audit trail. One row per `(unit, field)` DLD-proposed change. `decision` starts as `pending`; staff set it to `approved` or `rejected` via the CSV round-trip. Approved rows are applied to `master_data` by `apply-pending`.
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

**"no such column: sf_project" / garbage in `sf_booking`**
→ Fixed in v0.9.2. Re-run `node index.js import-sf <xlsx>` to re-import with the correct parser.

**`better-sqlite3` complains about Node version mismatch**
→ Fixed in v0.7.x with a self-heal step in the bat launcher. If it recurs: `cd dl-processor && npm rebuild better-sqlite3`.

**`Bad uncompressed size: ...` stderr spam when importing SF xlsx**
→ Harmless; suppressed in `salesforce.js`.

**Compare produces `DLD_ONLY` for everything**
→ You probably imported DLD but didn't import SF. Check `[S] Status`. Import `sf-input/`.

**`AREA` stat card shows 0 for every project**
→ `manual_area` is empty. Fill area templates via `[Y]` (this is the expected initial state — area cross-check only triggers when staff data is present).

**`apply-areas` reports `applied 0; skipped N`**
→ The `area_sqm` column in your CSV is blank, non-numeric, or non-positive. Re-export with `area-template` if the file got out of shape; existing `manual_area` rows are pre-populated on every generate so re-runs don't lose data.

**HTML filters feel sticky**
→ Header filters + top search + stat cards compose (AND together). Hit the `Reset` button to clear everything.

---

## Changelog

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
