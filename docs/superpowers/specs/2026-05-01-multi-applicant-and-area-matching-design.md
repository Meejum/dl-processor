# Multi-applicant name matching + SQM area cross-check

**Status:** approved design — ready for implementation plan
**Author:** Ali Alghumlasi (DL-Processor maintainer)
**Date:** 2026-05-01

## Problem

Two gaps in DL-Processor's DLD ⇄ Salesforce reconciliation surfaced in monthly use:

1. **Co-applicant blind spot.** The standard compare path in `src/compare.js` (`classifyMatch`) checks the DLD buyer name only against `sf_booking.applicant_name` (the primary applicant). When the DLD-registered buyer is actually a co-owner — recorded in SF as `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, or in the `applicant_details` field — the row is mis-classified as `BUYER_MISMATCH`. The villa/plot fuzzy matcher (v0.9.8 / v0.9.9) already walks all five fields, but the regular unit-prefix path does not.

2. **No area cross-check.** DLD records a net area per unit (`dld_unit.net_area`), and the registration team maintains saleable / built-up areas separately. There is no automated comparison, so wrong-unit matches and stale recorded sizes go undetected. Salesforce's DLD-ALL export does not include an area column, so the data must come from a manual workflow controlled by the registration team.

## Goals

- Recognise DLD buyer matches against any SF applicant slot (primary + 3 additional + `applicant_details`).
- Add an area-mismatch signal driven by staff-maintained per-unit area data, surfaced as both a soft flag (small drift) and a hard status (large drift).
- Keep the work additive: no changes to existing match counts on rows where the new data is absent.

## Non-goals

- Adding a Saleable Area column to the SF DLD-ALL export. The data source is staff-maintained templates.
- Backfilling area data for existing units. Coverage grows over time as the registration team fills templates.
- Refactoring `classifyMatch` into a generalised signals layer. Considered and rejected to preserve the v0.9.11 "upgrade A1–A7 to MATCH" tuning.

## Design

### 1. Schema (`db/schema.sql` + `src/db.js` self-heal)

```sql
CREATE TABLE manual_area (
  manual_area_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm  TEXT NOT NULL,
  area_sqm          REAL NOT NULL,
  source_note       TEXT,
  entered_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);
CREATE INDEX idx_manual_area_proj_unit ON manual_area(project_id, unit_number_norm);

ALTER TABLE project_mapping ADD COLUMN area_threshold_pct REAL;
```

`manual_area` is durable across SF re-imports — same shape as `manual_override`. NULL row for a unit means "no area to compare; signal skipped silently". `project_mapping.area_threshold_pct` is a per-project override; NULL means "use the global default".

The schema migration runs in `src/db.js` next to the existing self-heal `ALTER TABLE` block (the same pattern that added `applicant_details` and `nationality` in v0.9.9). Existing DBs auto-migrate on next launch; no re-import required.

### 2. Template generate / apply (`src/area-template.js`, new)

Two CLI subcommands plus a menu entry for the registration team's data-entry loop.

**Generate:** `node index.js area-template [project_name|all]`
Emits `output/area-template-<project>.csv` (or `area-template-all.csv`), one row per DLD unit in the latest snapshot:

```
project, unit_number, dld_unit_id, dld_buyer, dld_unit_type,
sf_unit, sf_applicant, dld_net_area, area_sqm, source_note
```

`area_sqm` and `source_note` are blank for staff to fill. Existing rows from `manual_area` are pre-populated so re-runs are idempotent and do not lose prior input.

**Apply:** `node index.js apply-areas <csv>`
Reads the CSV and upserts each row whose `area_sqm` is a positive number into `manual_area`, keyed on `(project_id, unit_number_norm)`. Blank or non-numeric `area_sqm` rows are skipped silently. Each apply writes one entry to `logs/audit.jsonl` with the source path, row count applied, and rows skipped.

**Menu:** new top-level `[Y] Area template` opens a submenu — `[1] Generate template` (prompts for project or all) and `[2] Apply filled template` (file picker over `output/`).

### 3. Multi-applicant matching (A10) (`src/compare.js`)

Replace the single `namesOverlap(dldBuyer, sfRow.applicant_name)` call in `classifyMatch` with a walk over all five SF applicant fields, in priority order:

```js
const SF_APPLICANT_FIELDS = [
  'applicant_name',
  'applicant_2_name',
  'applicant_3_name',
  'applicant_4_name',
  'applicant_details'
];

function findMatchingApplicant(dldBuyer, sfRow) {
  for (const f of SF_APPLICANT_FIELDS) {
    const v = sfRow[f];
    if (!v) continue;
    if (namesOverlap(dldBuyer, v)) return f;
  }
  return null;
}
```

Behaviour:
- Primary match → `nameState = 'match'`, no flag.
- Non-primary match → `nameState = 'match'`, emit flag **A10**, push `co-applicant:<field>` into `match_reasons`.
- No match → existing path runs (BUYER_MISMATCH, A8 normalisation, etc.).

A10 is purely informative — does not change the resulting status, only labels it.

### 4. Area cross-check (A11 + AREA_MISMATCH) (`src/compare.js`)

```js
function computeAreaSignal(dldArea, manualArea, thresholdPct) {
  if (dldArea == null || manualArea == null) return { kind: 'none' };
  if (dldArea <= 0 || manualArea <= 0)       return { kind: 'none' };
  const diff = dldArea - manualArea;
  const pct  = (diff / manualArea) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.5)          return { kind: 'none', diff, pct };
  if (absPct < thresholdPct) return { kind: 'flag', diff, pct };
  return { kind: 'hard', diff, pct };
}
```

`compareProject` loads `manualAreaMap = Map<unit_number_norm, area_sqm>` for the project once (single query) and resolves `thresholdPct` per project (see section 5).

Each compare row gains three new fields: `manual_area_sqm`, `area_diff_sqm`, `area_diff_pct`.

The signal layers on top of the existing classification:
- `kind === 'flag'` → keep current status, push `A11`, push `area Δ +X.X% (+Y sqm)` into `match_reasons`.
- `kind === 'hard'` and current status is `MATCH` → escalate to **AREA_MISMATCH**.
- `kind === 'hard'` and current status is non-MATCH (BUYER_MISMATCH / PRICE_* / DLD_ONLY / SF_ONLY) → keep the current status, push `A11`. Rationale: a row with both a wrong buyer and a wrong area is a buyer problem first.

`STATUS_PRIORITY` for sort order: `BUYER_MISMATCH=0, AREA_MISMATCH=1, DLD_ONLY=2, SF_ONLY=3, PRICE_DOWN=4, PRICE_UP=5, MATCH=6`. `STATUS_ORDER` for `summarize` gets `AREA_MISMATCH` inserted directly after `BUYER_MISMATCH`.

### 5. Threshold resolution (`src/project-mapping.js`)

`config/project-mapping.json` gets a top-level `defaults` block plus an optional per-project `areaThresholdPct`:

```json
{
  "defaults": {
    "areaThresholdPct": 5
  },
  "overrides": {
    "Sobha Reserve": {
      "sf_sub_project": "Sobha Reserve",
      "sf_unit_prefix": "SR-V",
      "areaThresholdPct": 8
    }
  }
}
```

Resolution at compare time, highest precedence first:
1. `project_mapping.area_threshold_pct` (DB row — out of scope to populate via UI in this work, but the column is honoured)
2. `config.overrides[<project>].areaThresholdPct`
3. `config.defaults.areaThresholdPct`
4. Hard-coded fallback `5`

Resolution happens once per project in `compareProject`, not per row.

### 6. HTML / output changes (`src/compare-html.js`)

**Stat cards:** new `AREA` card slotted between `BUYER` and `DLD-only`, CSS class `area`, click-to-filter and Ctrl/Shift-multi-select work the same as existing chips. Counts AREA_MISMATCH rows. The master dashboard inherits automatically — it builds from the same row schema.

**New columns:**

| Column | Default visible? | Renderer |
|--------|------------------|----------|
| Manual Area (`manual_area_sqm`) | hidden | `n.toFixed(2)`, blank if null |
| Area Δ % (`area_diff_pct`) | visible if any AREA_MISMATCH or A11 in dataset, else hidden | `+X.X%` with `up`/`down` colour |
| Area Δ sqm (`area_diff_sqm`) | hidden | `+X.X` / `-X.X` |

The existing `SQM` column (`dld_net_area`) is unchanged. Visibility toggles via the existing column-picker popover.

**Flags column:** A10 and A11 chips slot into the existing `audit_flags` rendering. Both are above-A4, so both get `?` popovers per v0.9.12. `FLAG_INFO` entries:

```js
A10: {
  title: 'Matched via co-applicant',
  body:  'DLD buyer matches a co-owner / additional applicant on the SF booking, not the primary applicant. No action needed — recorded for audit.',
  action: 'No action.'
},
A11: {
  title: 'Area mismatch flagged',
  body:  'DLD net area differs from the staff-recorded area. Fires either (a) when the gap is below the project threshold (default 5%) — usually common-area or saleable-vs-net rounding, or (b) when the gap is above threshold but the row already has a higher-precedence issue (BUYER_MISMATCH, PRICE_*, DLD_ONLY, SF_ONLY) so the area is recorded as a secondary signal rather than escalating the status.',
  action: 'For (a) spot-check a few; raise with engineering only if the pattern is systematic. For (b) fix the primary issue first; the area gap may resolve itself once the right SF row is matched.'
}
```

**Status legend** gains an `AREA_MISMATCH` entry: "DLD area vs Sobha-recorded area off by ≥ project threshold. Likely wrong unit matched or stale recorded size."

### 7. Audit tasks + verify report (`src/compare.js`, `src/audit-report.js`)

`writeAuditTasks` gets a new branch for AREA_MISMATCH:

```js
case 'AREA_MISMATCH':
  priority = 'medium';
  action = `Verify area for ${r.expected_sf_unit}: DLD ${r.dld_net_area} sqm vs recorded ${r.manual_area_sqm} sqm (${r.area_diff_pct >= 0 ? '+' : ''}${r.area_diff_pct.toFixed(1)}%). Confirm the unit number is correct.`;
  break;
```

`medium` priority — area drift rarely blocks DLD payment, but it warns that a wrong-unit-match may have happened upstream.

The `[V]` reconciliation in `audit-report.js` gets an "Area coverage" section: per-project `manual_area` row count vs DLD unit count, an overall coverage percentage, and a count of AREA_MISMATCH (hard) and A11 (soft) rows in the latest compare. Lets registrars see at a glance which projects still need staff to fill area templates.

### Files touched

| File | Change |
|------|--------|
| `db/schema.sql` | +1 table (`manual_area`), +1 column (`project_mapping.area_threshold_pct`) |
| `src/db.js` | self-heal `ALTER TABLE` migration block for the new column |
| `src/compare.js` | A10 multi-applicant walk, area signal, AREA_MISMATCH status, new row fields |
| `src/compare-html.js` | AREA stat card, 3 area columns, A10/A11 in `FLAG_INFO`, status legend |
| `src/project-mapping.js` | resolve `areaThresholdPct` per project |
| `src/menu.js` | `[Y] Area template` submenu |
| `src/audit-report.js` | area coverage section |
| `index.js` | register `area-template` and `apply-areas` subcommands |
| **NEW** `src/area-template.js` | template generate / apply (~100 lines) |
| `config/project-mapping.json` | `defaults.areaThresholdPct: 5`; optional `areaThresholdPct` per project |

## Backwards compatibility

- `manual_area` empty after migration → area signal skipped on every row → output identical to v0.9.13 except the new (NULL-only) area columns and the unused AREA stat card showing zero. Existing match counts unchanged.
- A10 fires only on rows where the DLD buyer matches a co-applicant; previously these were `BUYER_MISMATCH`. Expect a measurable drop in `BUYER_MISMATCH` and a matching rise in `MATCH` once this lands.
- The new `area_threshold_pct` column is NULL for every existing project_mapping row → falls through to the config default of 5%.

## Open questions / out of scope

- Inline editing of `manual_area` from the HTML dashboard (similar to the existing override editor). Possible follow-up; not in this work.
- A UI to populate `project_mapping.area_threshold_pct` from the menu. The column is honoured but stays config-driven for now.
- Bulk area import from architectural drawings or a master Excel — out of scope; the staff template is the input mechanism.
