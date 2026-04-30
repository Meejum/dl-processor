# Audit Workbook Integration — Design

**Status:** Approved by Ali (2026-04-30)
**Author:** Ali Alghumlasi (Sobha Realty Registration Team)
**Reference workbook:** `C:\Users\ali.alghumlasi\Downloads\Projects Verification updated - 2026 - DONE 4 (1).xlsx`
**Reference baseline (port from):** `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor`

---

## Problem

The Registration team manually audits each month's reconciliation in a per-project Excel workbook. Each sheet has rows for every booking, with the SF columns on the left, the DLD columns in the middle, and the team's verification (Name match TRUE/FALSE, Price match TRUE/FALSE) on the right. Currently DL-Processor has no way to:

- **Use the workbook as ground truth** to validate the tool's compare output
- **Categorize disagreements** between the tool and the human audit (where the tool is stricter, where the auditors are stricter, where they agree)
- **Quantify coverage** — how many bookings did the auditors verify, and how many of those does the tool agree with?

A pair of files exists in the p-charter baseline (`src/import-audit.js`, `src/audit-delta.js`) that does this work. They were intentionally not ported in the previous spec (deferred as nice-to-have). This spec ports them with one important tweak: the audit TRUE/FALSE columns will be **read**, not ignored as the p-charter version does (per a comment dated 2026-04-23, they were silenced; we re-enable them so the categorization is meaningful).

---

## Goal

After implementation:

- A new menu option `[U] Import Audit Workbook` accepts the audited xlsx, parses 40+ project sheets, and inserts ~6,000 audit rows into `manual_audit_snapshot/project/row` tables.
- A new menu option `[D] Audit Delta` runs the tool's compare against the latest audit snapshot, categorizes every row into one of seven buckets, writes per-project HTML reports plus a top-level summary.
- The `TOOL_STRICTER` bucket — rows the auditor said matched but the tool flagged as BUYER_MISMATCH — is the actionable output: it surfaces likely false-positive cases for tuning `namesOverlap` heuristics.
- The 56 existing tests stay green; two new test suites (one per file) cover the new code.
- The audit report (`[A]`) gains a "Latest audit snapshot" line that shows when the workbook was last imported and how many rows it contains.

---

## Non-Goals

- Editing the audit workbook from inside DL-Processor (the workbook stays single-source-of-truth-from-the-team).
- Cross-month trending (only one workbook snapshot at a time matters for this spec).
- Auto-importing the workbook on a schedule — manual menu trigger only.
- The `Report` sheet (auditor-assignments roster) — explicitly skipped per existing p-charter behavior.

---

## Architecture

Two new modules. No structural change to existing code beyond the menu/CLI wiring.

```
audit workbook (.xlsx)
        │
        ▼
src/import-audit.js          ── parses sheets, writes
        │
        ▼
manual_audit_snapshot          ── (already in schema, Task 0)
manual_audit_project
manual_audit_row
        │
src/compare.js  ── compareProject(db, projectId)
        │
        ▼
src/audit-delta.js           ── joins both, categorizes
        │
        ▼
output/<project>.audit-delta.html  + .csv
```

### Files modified / created

| File | Action | Responsibility |
|------|--------|----------------|
| `src/import-audit.js` | create | Parse audit workbook → write `manual_audit_*` tables. Reads TRUE/FALSE columns into `name_match`/`price_match`. |
| `src/audit-delta.js` | create | Run compare for a project, join against audit rows, categorize, render HTML+CSV. |
| `src/menu.js` | modify | Two new menu options `[U] Import Audit Workbook`, `[D] Audit Delta`. |
| `index.js` | modify | Two new CLI subcommands `import-audit <file>` and `audit-delta [project]`. |
| `src/audit-report.js` | modify | Add a "Latest audit snapshot" line showing workbook info + row count. |
| `src/file-picker.js` | modify | Add `pickAuditFile()` that points at `input/` and accepts `.xlsx`. |
| `test/import-audit.test.js` | create | Header detection, TRUE/FALSE flag parsing, projectId inference. |
| `test/audit-delta.test.js` | create | Categorization buckets against synthetic compare + audit fixtures. |

### Files NOT touched

- `src/compare.js` — `compareProject` already produces the rows audit-delta needs.
- `src/project-mapping.js`, `src/salesforce.js` — unrelated.
- `db/schema.sql` — `manual_audit_*` tables already added by Task 0.

---

## Detailed Specifications

### 1. `src/import-audit.js`

Single exported function `importAuditWorkbook({ db, filePath, asOfMonth, note, replace })`. Reads the .xlsx, iterates every sheet except `Report`, calls `parseProjectSheet` per sheet, then writes a transaction:

1. One row in `manual_audit_snapshot` (filename, sha256, as_of_month, workbook modified date, total rows, optional note).
2. One row in `manual_audit_project` per sheet (sheet_name, project_name_inferred via fuzzy match against `dld_project.project_name`, project_id when matched, row_count, [name_false_count, price_false_count, both_true_count, blank_count] computed from the TRUE/FALSE columns).
3. One row per booking in `manual_audit_row` (sub_project, sf_unit, unit_number_norm, sf_booking_name, sf_applicant, sf_price, dld_unit, size, rooms, details, name_match, price_match, count_customers, procedure_type).

`HEADER_MAP` covers the sheet's data columns. New entries beyond p-charter:

```js
{ field: 'name_match',  patterns: [/name\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^name\s*match/] },
{ field: 'price_match', patterns: [/(?:purchase\s*)?price\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^price\s*match/] }
```

The TRUE/FALSE values are coerced via:

```js
function asAuditFlag(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s === 'TRUE'  || s === 'YES' || s === 'Y') return 1;
    if (s === 'FALSE' || s === 'NO'  || s === 'N') return 0;
  }
  return null;
}
```

`inferProjectId(db, sheetName)` — three-pass fuzzy match against `dld_project.project_name`:
1. Exact match on normalized name (lowercase, alphanumeric only).
2. Substring containment ≥5 chars.
3. Same as (2) but with leading "sobha " stripped from both sides.

Sheet names like `"Sobha Skyparks 684"` (trailing row count) get `normName`'d to `"sobha skyparks"` and matched. The `Report` sheet is skipped before any inference runs.

`sub_project` is taken verbatim from the column for filtering — needed because some sheets (e.g. SOBHA ONE workbook) contain rows from multiple SF sub_projects (Sobha One A/B/C/D/E/Podium). The audit-delta uses sub_project + sf_unit when joining.

Returns:

```js
{
  status: 'ok' | 'duplicate',
  manualAuditSnapshotId: number,
  asOfMonth: 'YYYY-MM',
  workbookModifiedAt: ISO,
  workbookModifiedBy: string,
  inserted: count,
  projects: count,
  matchedProjects: count,
  unmatchedProjects: count,
  projectResults: [...]   // for menu diagnostic display
}
```

If a snapshot for the same `(as_of_month, source_sha256)` already exists and `replace` is false, returns `status: 'duplicate'` without inserting anything.

### 2. `src/audit-delta.js`

Single exported `runAuditDelta({ db, projectFilter, outDir })`:

1. Loads latest `manual_audit_snapshot` (or fails fast with a clear error if none exists yet).
2. For each `dld_project` (or only the filtered one), calls `buildProjectDelta(db, projectId, manualSnapshotId)`.
3. Writes `output/<safe-name>.audit-delta.csv` and `output/<safe-name>.audit-delta.html` per project.
4. Returns a summary object: counts per category across all projects.

`buildProjectDelta(db, projectId, manualSnapshotId)`:

1. `compareProject(db, projectId)` → tool's rows.
2. Pull all `manual_audit_row` for this snapshot+project_id.
3. Build a multi-key index: by `unit_number_norm`, by `sf_unit`, by `dld_unit`. First-wins.
4. For each tool row, lookup manual row by trying `t.unit_number_norm`, `t.expected_sf_unit`, `t.sf_unit`, `t.dld_unit_number` in order.
5. Categorize via `categorize(m, t)`:
   - `MANUAL_ONLY` — auditor row exists, no tool row
   - `DL_ONLY` — tool row exists, no auditor row
   - `MANUAL_BLANK` — both exist, but auditor's `name_match` and `price_match` are both null
   - `AGREE_MATCH` — auditor said match (both TRUE) AND tool said MATCH
   - `AGREE_MISMATCH` — auditor said mismatch (any FALSE) AND tool said non-MATCH
   - `TOOL_SOLVED` — auditor said mismatch BUT tool said MATCH (tool found a way to match where the human couldn't)
   - `TOOL_STRICTER` — auditor said match BUT tool said non-MATCH (likely tool false-positive — actionable for namesOverlap tuning)
6. Append unmatched manual rows as `MANUAL_ONLY`.

HTML rendering:

- Reuses `compare-html.js` styling (Sobha palette + dark theme).
- Top of page: per-category counts with chips, one click filters the table.
- Columns: SF unit, DLD unit, manual SF applicant, manual SF price, manual flags, tool match status, tool reasons, tool buyer, tool prices, delta_category badge.
- Default chip state: `AGREE_MATCH` off; everything else on.

CSV output: one file per project with the same data as the HTML (no styling).

### 3. `src/menu.js` changes

Two new entries, placed under the existing letter shortcuts:

```
[A] Audit Report                  reconciliation summary + per-project mapping
[U] Import Audit Workbook         pick the team's verification xlsx
[D] Audit Delta                   tool vs auditor cross-check
[P] Projects list
[S] Status
...
```

`doImportAudit()` calls `pickAuditFile()`, then `importAuditWorkbook({ db, filePath })`. Prints a per-project diagnostic table (sheet name → matched DLD project / row count / unmatched count). Pause for ENTER.

`doAuditDelta()` runs `runAuditDelta({ db })` against all projects, prints a one-line per-project summary, opens the latest delta HTML if `O` would, otherwise just confirms files written.

### 4. `index.js` changes

Two new subcommands:

- `node index.js import-audit <xlsx-file>` — calls `importAuditWorkbook`. Prints summary.
- `node index.js audit-delta [project-name]` — calls `runAuditDelta`. Optional project filter.

Both wired into the existing argv switch alongside `parse`, `import`, `import-sf`, `compare`, `diff`, etc.

### 5. `src/audit-report.js` change

Add one block to the existing `runAudit` function:

```js
const auditSnap = db.prepare('SELECT * FROM manual_audit_snapshot ORDER BY manual_audit_snapshot_id DESC LIMIT 1').get();
println('▸ AUDIT WORKBOOK');
if (auditSnap) {
  println('  Imported snapshot:     #' + auditSnap.manual_audit_snapshot_id + ' — ' + auditSnap.source_file);
  println('  As-of month:           ' + auditSnap.as_of_month);
  println('  Audit rows:            ' + auditSnap.total_rows.toLocaleString());
  println('  Workbook modified:     ' + (auditSnap.workbook_modified_at || '-') + (auditSnap.workbook_modified_by ? ' by ' + auditSnap.workbook_modified_by : ''));
} else {
  println('  (none yet — run import-audit)');
}
println('');
```

The returned headline object gains `auditSnapshotId` and `auditRows`.

### 6. `src/file-picker.js` change

Add `pickAuditFile()` that mirrors `pickSfFile` but defaults `initialDir` and `searchDir` to `<repo>/input/` (since the workbook lives in Downloads or input/), accepts `.xlsx`, single-file selection.

---

## Data Flow

```
1. Ali drops the audit workbook into input/.
2. Menu → [U] → pickAuditFile → importAuditWorkbook
3. importAuditWorkbook reads 41 sheets (skipping "Report"), parses 6,000+ rows
4. Snapshot row + 40 project rows + 6,000 audit rows inserted in transaction
5. Menu → [D] → runAuditDelta
6. For each DLD project: compareProject + buildProjectDelta + writeHTML + writeCSV
7. Output: output/<project>.audit-delta.html (40 files)
8. Open in browser: chip-filterable table; TOOL_STRICTER bucket is the actionable list
```

---

## Schema

Already in place from Task 0:

```sql
manual_audit_snapshot (manual_audit_snapshot_id, source_file, source_sha256,
                       imported_at, as_of_month, workbook_modified_at,
                       workbook_modified_by, total_rows, note, ...)

manual_audit_project (manual_audit_project_id, manual_audit_snapshot_id,
                      sheet_name, project_name_inferred, project_id, auditor,
                      row_count, name_false_count, price_false_count,
                      both_true_count, blank_count)

manual_audit_row (manual_audit_row_id, manual_audit_project_id, sub_project,
                  sf_unit, unit_number_norm, sf_booking_name, sf_applicant,
                  sf_price, dld_unit, size, rooms, details, name_match,
                  price_match, count_customers, procedure_type)
```

No schema changes needed.

---

## Testing

`test/import-audit.test.js`:

1. `parseProjectSheet` extracts SF + DLD columns when header is on row 1
2. `parseProjectSheet` extracts SF + DLD columns when header is on row 0 (banner-less sheet)
3. `asAuditFlag` accepts boolean true/false, string TRUE/FALSE/Yes/No, returns null for blank
4. `inferProjectId` matches `"Sobha Skyparks 684"` to `"Sobha SkyParks"` via fuzzy substring
5. `importAuditWorkbook` writes the right counts to `manual_audit_*` tables (use a small synthetic 2-sheet xlsx fixture)
6. Re-running `importAuditWorkbook` on the same file returns `status: 'duplicate'`

`test/audit-delta.test.js`:

1. `categorize` returns `AGREE_MATCH` for (m={1,1}, t.match_status=MATCH)
2. `categorize` returns `AGREE_MISMATCH` for (m={0,0|null}, t.match_status=BUYER_MISMATCH)
3. `categorize` returns `TOOL_SOLVED` for (m={0|null,0|null}, t.match_status=MATCH)
4. `categorize` returns `TOOL_STRICTER` for (m={1,1}, t.match_status=BUYER_MISMATCH) — most actionable bucket
5. `categorize` returns `MANUAL_ONLY` when t is null
6. `categorize` returns `DL_ONLY` when m is null
7. `categorize` returns `MANUAL_BLANK` when both name_match and price_match are null
8. `buildProjectDelta` joins manual rows by unit_number_norm AND by sf_unit AND by dld_unit (multi-key)

Manual end-to-end check after the port:

- Import the team's actual workbook
- Open `output/Sobha_Hartland_Waves.audit-delta.html`
- Confirm chip counts add up to total rows
- Filter to `TOOL_STRICTER` bucket → eyeball whether those ARE false positives in the namesOverlap heuristic
- If `TOOL_STRICTER` count is high, that's the next iteration target

---

## Cleanup

After merge to master, the deferred audit-pair files in p-charter (`Desktop/p-charter/dl-processor/src/audit-delta.js` and `import-audit.js`) become superseded. They can be deleted along with the rest of `Desktop/p-charter/dl-processor` per the original port plan's cleanup step.

---

## Risks

1. **TRUE/FALSE column ambiguity.** The workbook uses different conventions in different sheets (xlsx booleans vs string "TRUE" vs string "Yes"). Mitigated by `asAuditFlag` accepting all common forms; anything unrecognized becomes `null` (treated as MANUAL_BLANK).
2. **Sheet name → project_id miss.** Some sheets have idiosyncratic names. Mitigated by three-pass fuzzy matching, with a clear unmatched-projects log on import. Unmatched sheets still get rows in `manual_audit_row` but with `project_id = NULL`; audit-delta silently skips those.
3. **Sub-project filtering.** Workbook rows have `sub_project` per row, but audit-delta currently joins on unit identifiers, not sub_project. For a project that uses `match_scope='project'` (e.g. SOBHA ONE), the same DLD unit number could exist in multiple sub-projects. Unit_norm includes the prefix (`SO-A1001`) so collisions are unlikely in practice — but if they occur, first-wins semantics may pick the wrong sub-project's audit row. Mitigated by adding `sub_project + sf_unit` as a secondary key in the manual index.
4. **Schema NULL on `as_of_month`.** Old import-audit defaults to "last calendar month" when caller doesn't provide it. We keep that behavior — but log the resolved month in the import diagnostic so Ali can confirm it's right.
5. **Workbook is large (~6k rows × 12 columns).** xlsx library handles this fine, but the transaction insert is a single `db.transaction(() => { ... })` block. Confirmed safe; better-sqlite3 handles 10k-row transactions in <1s.

---

## Open Questions (none blocking)

- Should the audit-delta HTML be one-per-project (40 files) or one-big-file (1 file)? Default to per-project to match existing compare HTML convention. A summary roll-up page can come later.
- Should `audit-delta` re-run compare from scratch each time, or pull cached compare results? Re-run from scratch — compare is fast (<5s for all 35 projects) and ensures data consistency.
- Should we also surface the team's auditor name (`auditor` column on manual_audit_project)? Per the import-audit comment, "we no longer track who audited what" — leave the column NULL, ignore for now. Can be added back if the team revives the auditor-attribution practice.
