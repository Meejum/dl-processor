# DL-Processor — Port Working Features from p-charter Branch

**Status:** Approved by Ali (2026-04-30)
**Author:** Ali Alghumlasi (Sobha Realty Registration Team)
**Sources:** `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor` (working baseline)
**Target:** `C:\projects\DL-Processor` (current development tree)

---

## Problem

A compare run on 35 DLD projects against the latest Salesforce export (29,344 rows) produced these failures:

- **Six Sobha Hartland projects** routed to a single wrong SF sub-project (all show `SF-only: 105`, `MATCH: 0`) because the fuzzy matcher's tokens collide on generic words (`villas`, `greens`).
- **Five Riverside Crescent projects + Sobha Estates** were skipped as `no-mapping` because their SF unit numbers don't fit the `^([A-Z]+)-` prefix regex.
- **Eight projects** (Elwood, SKYSCAPE, Skyvue, Element at Sobha One, Sobha Reserve, Sobha SkyParks, Sobha Creek Vistas, etc.) compared with both sides populated but produced **zero matches** — DLD and SF use different unit-number schemes that no current code path bridges.
- **Sobha Hartland Waves Opulence** produced a buyer-mismatch storm (`MATCH:8 / BUYER:327`) — symptom of wrong unit-prefix mapping.

A working version exists at `Desktop\p-charter\dl-processor`. It contains explicit override entries for all 25+ affected projects plus the code paths that those overrides depend on. The current `C:\projects\DL-Processor` codebase had those code paths removed at some point (a regression). The schema, however, was kept up-to-date — `db/schema.sql` already has every column the port needs.

This spec describes what to port back, in what order, and what is intentionally left behind.

---

## Goal

After implementation, a compare run on the same 35 DLD projects + the same Salesforce snapshot produces:

- Zero `no-mapping` skips for projects in the override list (Riverside Crescent 310/320/330/340/360, Sobha Estates is correctly skipped because there is no SF counterpart).
- Non-zero `MATCH` count for every project that previously showed `0` (all the listed regression cases).
- The "SF-only: 105" pattern across six Sobha Hartland projects disappears — each routes to its own correct SF sub-project.
- A new menu option produces a textual reconciliation summary (counts of DLD projects, units, SF rows, mapping status).

The four prior improvements on this branch (sort + chip default, namesOverlap rewrite, header-driven SF parsing, fuzzy fallback) and the two bug fixes (NOT-NULL skip, file picker UX) are preserved unchanged.

---

## Non-Goals

The following are out of scope and stay deferred. Each can be ported in a future cycle if Ali asks.

- `audit-delta.js` — cross-checking tool output against a manually-audited Excel "ground truth" (~460 lines + new menu wiring + paired with `import-audit.js`). Heavy dependency chain. Defer until manual-audit data is in regular use.
- `import-audit.js` — companion to `audit-delta.js`. Defer.
- `audit-log.js` — JSONL action log to `logs/audit.jsonl`. Low value standalone.
- `dump-db.js` — DB → CSV dump. Workflow tool, not blocking.
- `review-template.js` — pre-filled review CSV with priority tiers. Workflow tool.
- Phase 2 auto-inference improvements (better `inferSubProjectPrefixes`, smarter fuzzy matcher). Tracked separately; this spec focuses on regression recovery.

---

## Architecture

No structural change. Changes are localized to existing files plus one new file. Schema is already extended in the current tree, so no migration is needed.

### Files modified

| File | Current LOC | After port | Change |
|------|-------------|------------|--------|
| `config/project-mapping.json` | ~13 | ~250 | Replace single Hartland Waves entry with 25+ explicit overrides |
| `src/project-mapping.js` | ~138 | ~155 | Add `match_scope` field, `buildingTransforms` support, empty-prefix preservation |
| `src/compare.js` | ~660 | ~810 | Add `match_scope='project'` SF query path, plot-project detection, plot fuzzy buyer+price match |
| `src/salesforce.js` | ~190 | ~200 | Replace exact-string `HEADER_LABELS` with regex-based field resolution; import the four extra applicant fields plus nationality/docusign |
| `src/menu.js` | ~620 | ~640 | Add an "Audit Report" menu option |

### Files created

| File | LOC | Responsibility |
|------|-----|----------------|
| `src/audit-report.js` | ~150 | Pure read-only function. Takes a `db` handle, prints a fixed-format text reconciliation summary (snapshot ages, project counts, mapping coverage). |
| `test/match-scope.test.js` | ~60 | Unit tests for `match_scope='project'` query routing. |
| `test/building-transforms.test.js` | ~70 | Unit tests for `expectedSfUnit` with `buildingTransforms`. |
| `test/plot-fuzzy-match.test.js` | ~90 | Unit tests for `findSfByBuyerPrice` (Jaccard threshold, price tolerance, generic-token stripping). |

### Files deleted

After the port has been merged to master and verified through one monthly compare run:

- `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor` (entire directory) — superseded.

This deletion is **not** part of the implementation plan; Ali performs it manually after acceptance.

---

## Detailed Specifications

### 1. `config/project-mapping.json`

Copy the entire `overrides` block from `Desktop\p-charter\dl-processor\config\project-mapping.json`. The file uses three optional fields that the port supports:

- `match_scope`: `"sub_project"` (default) or `"project"`. Controls whether SF rows are filtered by `sub_project=` or `project=`.
- `unitTransforms`: array of `{ match, replace }` regex rewrites applied to the DLD `unit_number_norm`.
- `buildingTransforms`: object keyed by DLD `building.name`. Each value is a `unitTransforms` array applied only when the DLD unit's building name matches the key. Falls back to `unitTransforms` when the building doesn't match.
- `sf_unit_prefix`: string. When non-empty, the resolved unit becomes `<prefix>-<transformed>`. When empty (`""`), the transform output is used as the SF unit verbatim — supports formats like `SO-A1001`. When omitted entirely, behaviour falls back to the inferred prefix from `inferSubProjectPrefixes`.

The `_villa_note` and `_note` keys at the top of `overrides` are documentation-only string keys; the loader ignores keys starting with `_`.

### 2. `src/project-mapping.js`

Replace the current `buildMappingFor` and `expectedSfUnit` with the p-charter versions. Specifically:

- `buildMappingFor` returns include `match_scope` (defaulting to `'sub_project'` when an override doesn't specify it).
- `buildMappingFor` preserves an empty-string `sf_unit_prefix` from override config (does not coerce to `null`). Empty string means "use transforms only, do not prepend anything".
- `expectedSfUnit(dldUnitNumberNorm, mapping, buildingName)` accepts a third `buildingName` argument. If `mapping.buildingTransforms[buildingName]` exists, it is applied first; otherwise `mapping.unitTransforms` is applied. If `mapping.sf_unit_prefix` is empty/falsy, returns the transformed unit verbatim; otherwise prepends `<prefix>-`.
- Existing `guessSubProjectFromDldName` (the fuzzy fallback added in Phase D) stays unchanged. Tests covering it stay green.
- Existing `saveMappingToDb` keeps the NOT-NULL skip from the recent bugfix; additionally writes the `match_scope` column.

### 3. `src/compare.js`

The current `compareProject(db, projectId, cachedConfig)` is replaced with a version that:

1. Reads `match_scope`, `sf_sub_project`, `sf_project`, `sf_unit_prefix` from the `project_mapping` row (falling back to the legacy `dld_project` columns where present).
2. Reads the override config once per project, extracting `unitTransforms` and `buildingTransforms` for use during the row loop.
3. Returns `status: 'no-mapping'` only when **all three** of `sf_unit_prefix`, `unitTransforms`, and `buildingTransforms` are absent. Previously, an empty prefix triggered no-mapping even when transforms would have produced the SF unit.
4. Routes the SF query: `WHERE sf_snapshot_id=? AND project=?` when `match_scope='project'`; `WHERE sf_snapshot_id=? AND sub_project=?` (existing behaviour) otherwise.
5. Detects plot/villa projects by computing `landShare = count(unit_type='Land' OR building_name='Land') / total_dld_units`. A project is treated as plot-based if `landShare ≥ 0.3` OR (`bareMapping` AND `landShare ≥ 0.05`), where `bareMapping = (sf_unit_prefix === '' && !unitTransforms.length && !buildingTransforms)`.
6. For plot projects, builds a token index `sfByBuyer: Map<token, SfBooking[]>` over `applicant_name`, `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, `applicant_details` (any of these may be NULL for a given row; skip nulls).
7. After unit-keyed match fails, calls `findSfByBuyerPrice(buyer, dldPrice)` which returns the best SF booking that:
   - Shares non-generic tokens with the DLD buyer name (Jaccard ≥ 0.5 over tokens stripped of `INVESTMENT(S)`, `HOLDING(S)`, `TRADING`, `PROPERTIES`, `PROPERTY`, `REAL`, `ESTATE`, `DEVELOPMENT`, `DEVELOPERS`, `GENERAL`, `GROUP`, `COMPANY`, `CO`, `INTERNATIONAL`, `GLOBAL`, `BUSINESS`, `SERVICES`, `MANAGEMENT`, `CORPORATION`).
   - Has a price within 5% of the DLD price.
   - Has not already been matched by an earlier DLD row in this run (`matchedSfUnits` set).
   - Score is `bestJaccard * 2 + (1 - min(priceDiff, 1))` — ties broken by best fit.

The four pre-existing audit improvements (status sort, default-MATCH-off chip, days-outstanding column, numeric ORDER BY, config caching) and the namesOverlap rewrite stay unchanged.

### 4. `src/salesforce.js`

Replace the exact-string `HEADER_LABELS` map (added in Phase C) with a regex-based field resolver. The `HEADER_PATTERNS` array contains entries like:

```js
{ field: 'applicantName', patterns: [/^(?:booking:?\s*)?primary\s*applicant\s*name$/i, /^applicant\s*name$/i] }
```

`resolveSfColumns(headerRow)` builds a `cols: { [fieldName]: colIndex }` map by, for each known field, finding the first column whose header (trimmed, case-insensitive) matches any pattern. A field is missing only when no pattern matches; in that case the field is set to `null` and reading any row returns `null` for that field — no fail-fast throw, because some optional fields (the multi-applicant ones) are absent from older SF exports.

`readSfWorkbook` and `importSfSnapshot` populate the four extra columns: `applicant_details`, `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, plus `nationality` and `docusign_complete`. The schema already has these columns.

The `resolveSfColumns` test from Phase C is updated to match the new pattern-based resolver. Specifically:
- The "throws when required header missing" test is rewritten as "returns null when required field has no matching header" (different contract).
- A new test confirms that `Booking: Primary Applicant Name` and `Applicant Name` both resolve to `applicantName`.

### 5. `src/audit-report.js` (new)

Single exported function `runAudit({ db, out = process.stdout })`:

- Queries: count of DLD projects, count of units across the latest snapshot per project, count of SF bookings in the latest SF snapshot, mapping status (mapped via override / mapped via auto / unmapped), age of latest DLD snapshot per project, age of latest SF snapshot.
- Outputs to `out` (default `process.stdout`) a fixed-format text report with section headers and bullet lines (matches the p-charter format).
- Returns headline numbers as a plain object: `{ projectCount, unitCount, sfRowCount, mappedCount, unmappedCount, dldSnapshotAgeDays, sfSnapshotAgeDays }`.
- No I/O side effects beyond the supplied `out` stream.

### 6. `src/menu.js`

Add a single new menu entry, `[A] Audit Report`, that calls `runAudit({ db })` and waits for ENTER. The menu's existing structure (cyberpunk banner, two-column layout) stays unchanged.

---

## Data Flow

For an `compare` run on a project with `match_scope='project'` (e.g. SOBHA ONE):

```
1. cmdCompare opens the DB and calls ensureMappings(db).
2. ensureMappings iterates each dld_project; calls buildMappingFor.
3. buildMappingFor returns { source:'override', sf_project:'Sobha One',
   match_scope:'project', sf_unit_prefix:'', ... }.
4. saveMappingToDb writes match_scope into project_mapping.
5. compareProject reads match_scope='project' from project_mapping.
6. compareProject queries: SELECT * FROM sf_booking WHERE sf_snapshot_id=?
   AND project='Sobha One' — covers Sobha One A/B/C/D/E/Podium together.
7. Per-DLD-unit row, expectedSfUnit looks up
   ov.buildingTransforms[u.building_name] (e.g. "Sobha One - A" →
   {match:^A(\d+)$, replace:SO-A$1}).
8. Lookup SF row by transformed unit string; classify match.
```

For a plot project (e.g. Sobha Reserve with empty prefix and no transforms):

```
1. compareProject computes landShare from dld_units.
2. landShare ≥ 0.3 OR bareMapping triggers isPlotProject = true.
3. Build sfByBuyer index over applicant fields of all SF bookings in
   sub_project='Sobha Reserve'.
4. Per DLD row: try unit-keyed match first. If no match, call
   findSfByBuyerPrice(dld_buyer, dld_price).
5. If a match returns, mark the SF booking as consumed (matchedSfUnits)
   and build the row with `match_reasons` including `'plot match'`
   so reviewers can identify rows that came from the fuzzy path.
```

---

## Schema

`db/schema.sql` is unchanged — it already contains every column referenced by the port:

- `sf_booking.applicant_2_name`, `applicant_3_name`, `applicant_4_name`, `applicant_details`, `nationality`, `docusign_complete`
- `project_mapping.match_scope` (default `'sub_project'`)
- `manual_audit_snapshot`, `manual_audit_project`, `manual_audit_row` tables (used by deferred features only — left in place but unused for now)

A read-only assertion at the start of the implementation will confirm the schema actually has these columns; if any are missing the port stops with a clear error.

---

## Error Handling

- **Bad regex in override config:** `applyUnitTransforms` already swallows `new RegExp` exceptions. No change.
- **Missing SF header:** with the regex resolver, optional fields fall back to `null`. The four primary fields (`bpName`, `unit`, `subProject`, `applicantName`) are still verified — if any is missing, an error is thrown that lists the patterns tried and the headers seen.
- **`match_scope='project'` but no `sf_project`:** falls back to `no-mapping` for that project. Logged to console at compare time.
- **Plot match where every SF candidate already consumed:** `findSfByBuyerPrice` returns `null`; the DLD row goes to `DLD_ONLY` as today.
- **`buildingTransforms[buildingName]` for a building that's not in the override:** falls through to `unitTransforms`. If `unitTransforms` is also empty and `sf_unit_prefix` is empty, the row hits plot-fallback.

---

## Testing

Three new test suites use Node 18+'s built-in `node:test` runner and are wired through the existing `npm test` script.

1. **`test/match-scope.test.js`** — tests `compareProject` against an in-memory DB seeded with two SF sub-projects under the same parent project; verifies that `match_scope='project'` returns rows from both sub-projects and `match_scope='sub_project'` returns rows from one.
2. **`test/building-transforms.test.js`** — tests `expectedSfUnit` with various building names; verifies `buildingTransforms` priority over `unitTransforms`; verifies empty-prefix passthrough.
3. **`test/plot-fuzzy-match.test.js`** — tests `findSfByBuyerPrice` with the generic-token stripping, Jaccard threshold, price tolerance, and "already consumed" exclusion.

The existing 32 tests stay green. No regression tolerated.

A manual end-to-end run on the same 35 DLD projects + April-21 SF snapshot is the final acceptance check. Specifically:

- The six Sobha Hartland family projects no longer all show `SF-only: 105`.
- Riverside Crescent 310/320/330/340/360 each produce non-zero `MATCH`.
- Elwood Estates and Sobha Reserve produce non-zero `MATCH` via plot fuzzy compare.
- The four already-good projects (SOBHA ONE, Orbis, Solis, Waves Grande) keep their match counts within ±5% of the previous run.

---

## Cleanup

Once merged to `master` and one monthly run validates the port, Ali deletes `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor`. This step is manual and explicit — not part of the implementation plan.

The `Sobha_Hartland_Waves.overrides.csv` file at the repo root (currently untracked) is unrelated to this port and stays as-is.

---

## Risks

1. **Regex-based SF header matching may false-match** if Salesforce ships a new column whose header coincidentally matches an existing pattern. Mitigated by patterns being tight (`/^...$/`) and by manual verification on first run after the port lands.
2. **Plot fuzzy compare can produce wrong matches** when two unrelated buyers share a non-generic surname AND have prices within 5%. Mitigated by the Jaccard ≥ 0.5 threshold and the "already consumed" exclusion. False positives surface in the compare HTML / CSV via `match_reasons` containing `'plot match'`, so reviewers can filter to those rows for spot-checking.
3. **Override config ports a copy of project-mapping.json from a possibly-stale source.** The p-charter copy was last edited 2026-04-28; if any DLD project names changed between then and 2026-04-30, an override key may not match. Mitigated by the audit-report giving immediate visibility into unmapped projects after the import.
4. **Removed Phase C's fail-fast on missing SF headers** weakens the silent-data-corruption guard. Mitigated by keeping fail-fast on the four primary fields (`bpName`, `unit`, `subProject`, `applicantName`); only optional fields fall back silently.
