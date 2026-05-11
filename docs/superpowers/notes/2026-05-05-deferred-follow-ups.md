# Deferred Follow-ups — DL-Processor

**Date opened:** 2026-05-05
**Source:** Deep review on 2026-05-05 + multi-buyer matching plan.

Items intentionally deferred. None are bugs blocking current behavior; each is a known gap with a recommended owner-fix when the trigger lands.

---

## DEF-1 — Audit-delta HTML buyer columns (Plan Task 8 from multi-buyer)

**What:** Multi-buyer plan §Task 8 called for adding DLD #/SF # columns to the audit HTML. The plan misnamed the target file (`src/audit-report.js` is terminal output only); the actual audit HTML lives in `src/audit-delta.js writeAuditDeltaHtml`.

**Why deferred:** Audit-delta is a niche tool-vs-auditor cross-check, run once-per-month at most. Daily compare HTML and dashboard already cover the multi-buyer visibility need. Closing as scope-creep at this iteration.

**Trigger to revisit:** Ali starts using audit-delta as a regular Monday-morning artifact OR a real auditor disagreement turns out to need the buyer-list context to resolve.

**How to land:** Same renderer pattern as compare.js — import `renderDldBuyersCell`/`renderSfApplicantsCell`, thread `dld_buyers`/`sf_applicants` through `audit-delta.js makeDeltaRow`, add the two columns to the table. ~50 LOC change.

---

## DEF-2 — Move audit-delta outputs to `output/audit-delta/`

**What:** `src/audit-delta.js:302-303` writes to `output/<base>.audit-delta.{html,csv}`. After the folders refactor, every other output type lives in a subfolder; audit-delta is the odd one out.

**Why deferred:** Cosmetic. No correctness impact.

**How to land:** Add `AUDIT_DELTA_DIR = path.join(OUTPUT_DIR, 'audit-delta')` in `index.js`, pass to `runAuditDelta({ outDir: AUDIT_DELTA_DIR })`. Update `cmdAuditDelta`. ~5 lines.

---

## DEF-3 — Output archiving / timestamping

**What:** Every run overwrites the previous `output/`. No `output/2026-04-01/` snapshots. If Ali re-imports a corrected DLD file, the original results are lost.

**Why deferred:** Not yet a real pain point — the team Excel-archives manually. Becomes important if regulatory audit ever asks "show me what the tool said in March 2026."

**Trigger to revisit:** Audit request, OR a second user starts running the tool concurrently.

**How to land:** Add a `--archive` flag to compare/diff that writes to `output/<YYYY-MM-DD-HH-MM>/...` instead of `output/`. Or add a post-run hook that copies `output/` to `archive/<timestamp>/`. ~30 LOC.

---

## DEF-4 — Drop unused `raw_json` column from `dld_snapshot`

**What:** `db/schema.sql:29` declares `raw_json TEXT` on `dld_snapshot`. Stores a full JSON copy of every parsed unit + transaction for every snapshot. Never queried by any code path. Dead weight; inflates WAL.

**Why deferred:** Migration risk. Need to verify no third-party tool / debug script reads it before dropping.

**Trigger to revisit:** DB file size becomes a problem (currently a few hundred MB).

**How to land:** `ALTER TABLE dld_snapshot DROP COLUMN raw_json;` in a new migration. SQLite supports this since 3.35. Audit `git grep raw_json` first.

---

## DEF-5 — Dropunused `v_unit_compare` view

**What:** `db/schema.sql:231-259` defines a view that joins 4 tables. Never called by any module — all comparison goes through `compareProject` in JS.

**Why deferred:** Trivial cleanup, but if any external tool reads from this view we'd break it silently.

**How to land:** `DROP VIEW IF EXISTS v_unit_compare;` in a migration step.

---

## DEF-6 — README master-data + approval workflow

**What:** Captured in `docs/superpowers/notes/2026-05-04-future-master-data-approval.md` (on `feat/dld-diff-polish` branch, present here post-rebase). Schema additions: `change_log`, `approval_queue`, `master_data` tables. Brainstormed but not designed.

**Trigger to revisit:** A second team member needs write access OR an incorrect auto-mapping silently passes a project (forces an approval gate to prevent recurrence) OR regulatory audit asks for change history.

**How to land:** Full brainstorm → spec → plan → implement cycle. Estimate 3-5 days of work given the schema migration + approval UI.

---

## DEF-n — Dashboard summary expansion

**What:** Expand `output/dashboard.html` header to include richer summary numbers per project:
- Number of `Sell` transactions
- "Not Sold" count = pre-registration owner with no transaction
- Total DLD TX count
- Total buyers per project (deduped names? gross count?)
- Per-project counts by `tx_type`: `Sell`, `Transfer`, `Mortgage`, `Granted`, etc.
- (Trailing item from Ali's message — "and will will co..." — TBD; capture when brainstorming this.)

**Source of ask:** Ali, 2026-05-06, mid-brainstorm of item m. Out of scope for approval-workflow extensions; deserves its own brainstorm.

**Trigger to revisit:** After item m ships. Run `superpowers:brainstorming` for "dashboard analytics expansion" — confirm exact metric list, decide if this lives in dashboard.html header or in a separate `summary.html`, address the "co..." ambiguity.

**How to land:** Likely a new aggregation query module (`src/dashboard-stats.js`) computed per project, rendered as cards above the existing per-project tables. Definitions of "Not Sold" vs "Sold" need explicit SQL because pre-reg owners with no transaction is a subtle case.

---

## DEF-o — SF importer accept .xls and .csv (not just .xlsx)

**What:** Today `src/menu.js:192 validateSfPaths` rejects anything that isn't `.xlsx`. The underlying parser already supports all three formats — `salesforce.js:279 importSfSnapshot` dispatches `.csv` → `readSfCsv`, else → `readSfWorkbook` (which handles both `.xlsx` and `.xls` via SheetJS). Only the validator and the file-picker title/filter at `src/file-picker.js:144-153` block the broader formats.

**Source of ask:** Ali, 2026-05-06, hit while trying to import `report1778073075760.xls`.

**Trigger to revisit:** Next time Ali (or anyone) needs to import a non-xlsx SF export. Truly trivial — should be the next thing fixed after item m merges, or sooner if Ali wants a quick detour. NOT a blocker for item m design work.

**How to land (≈10 min, ~5 LOC + 1 test):**
1. `src/menu.js:192` — change validator to accept `.xlsx`, `.xls`, `.csv`.
2. `src/file-picker.js:146` — title `"Select Salesforce export (xlsx)"` → `"Select Salesforce export (xlsx/xls/csv)"`.
3. `src/file-picker.js:147` — filter list to include xls and csv.
4. `src/file-picker.js:150` — `extensions: ['.xlsx', '.xls', '.csv']`.
5. Unit test `validateSfPaths`: rejects `.docx` / `.txt` / missing-file, accepts all three target extensions.
6. Manual smoke: import a real `.xls` file end-to-end.
