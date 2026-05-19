# DL-Processor — The Story So Far

*A chronological history, from the first commit to where we are today, and where we're going next.*

**Snapshot taken:** 2026-05-19
**Current version:** **v2.3.0** (release in progress on `feat/v2.3-workflow-automation` at `4cf3d39`) · 522 tests green · last shipped tag `v2.2.0` on `master` at `fd167b5`
**Repo:** github.com/Meejum/dl-processor (private)
**Maintainer:** Ali Alghumlasi — Sobha Realty · Registration / DLD team

---

## Prologue — the problem

Each month the Registration team exports a "Project Inquiry" report from DLD (Dubai Land Department) for every Sobha project, and then has to find where Salesforce is out of date. Resales the DLD caught but SF didn't. Price amendments. Unbooked units. Mortgages logged as buyers. The legacy workflow was a maze of Excel files, manual eyeballing, and one-off scripts. DL-Processor exists to turn that into a one-button reconciliation: parse DLD, parse SF, match at the unit level, surface every mismatch, route it through an audit-logged approval queue, and produce a clean dashboard.

What follows is the story of how it got built — one commit at a time, condensed.

---

## Chapter 0 — Prehistory inside P-Charter (Q1 → April 2026)

Before DL-Processor was a standalone repo at `C:\projects\DL-Processor`, it lived a whole life inside another tool. P-Charter — Sobha's Project Charter brochure generator (`Desktop\p-charter\`) — was the team's existing daily-driver Node.js app. DL-Processor began as a sibling experiment, then got absorbed into P-Charter as a git subtree, then grew through fifteen point releases there before being lifted out into its own repo.

That history matters because today's `C:\projects\DL-Processor` v0.4.1 → v2.2.0 line is **only the second half** of the story. The work below all happened inside `Desktop\p-charter\dl-processor\` and ships there as commits on the P-Charter master branch.

### The subtree merge

- `5c4dec7` — *Squashed `dl-processor/` content from commit ae63ec5*. The standalone v0.4.1 tool gets squashed-merged.
- `5ad2b58` — *Merge commit '5c4dec74…' as 'dl-processor'*. The subtree is officially under `dl-processor/` inside P-Charter.
- `9e18410` — **P-Charter v9.2.0**: DL-Processor merged into the repo as a subtree.
- `280803c` — P-Charter menu gets a `[D] DLD Audit` entry that launches DL-Processor.
- `48ab8e2` — **P-Charter v9.1.0**: DLD Audit entry + optional update gate (predates the subtree — the entry initially launched a separate process).
- `5e12dbe` — *v9.3.0 (LOCAL — pending test): editable HTML overrides + folder-list input picker*.
- `561acaa` — **P-Charter v9.3.0**: *multi-project DL-Processor + master dashboard + compare UX overhaul*. This is the foundation that the v0.5+ versions built on.

P-Charter integration also gained polish along the way: `c8dddb5` made `[D] DLD Audit` run **inline in the same window** (no popup); `a663da3` fixed a better-sqlite3 / Node-version mismatch with self-heal logic; `fdc9252` bumped `package-lock.json` after the better-sqlite3 rebuild for Node v24.

### The P-Charter-era version line

These all shipped as `dl-processor v0.x.y` commits on the P-Charter master branch:

| Version | Commit | Headline |
|---|---|---|
| v0.6.0 | `89e12a2` | Sobha-branded HTML dashboards with **Tabulator grid** |
| v0.7.0 | `de867b4` | Import the **manual audit workbook** into SQLite with as-of-month flag |
| v0.8.0 | `ccf5fac` | **Manual-audit vs tool delta** report + output reorg |
| v0.9.0 | `da995b5` | **Salesforce API pull** (jsforce) + menu entries |
| v0.9.1 | `db1866b` | `import-audit` narrowed to only SF + DLD data |
| v0.9.2 | `acea0f6` | Fix SF reader (new **33-col format**) + add `audit` command |
| v0.9.3 | `f416dba` | HTML compare dashboards rebuilt + full README |
| v0.9.4 | `e8094b3` | Correct data flow + **PROJECT / SF-SUB / PFX** reference |
| v0.9.5 | `28c3351` | **Remove all Salesforce-login code** (deprecate API path) |
| v0.9.6 | `20f932c` | 10 new project mappings (Riverside Crescent, etc.) |
| v0.9.7 | `b745e58` | **Bank-as-buyer fix** + name normalization + `audit_flags` column |
| v0.9.8 | `99669fa` | **Villa/plot compare** + transliteration + 5 new mappings |
| v0.9.9 | `a00f497` | Extended SF report support (co-owner / nationality fields) |
| v0.9.10 | `758ac1b` | **Review-template form** for bulk edits |
| v0.9.11 | `06b18d6` | Treat A1–A7 flags as MATCH (not BUYER_MISMATCH) |
| v0.9.12 | `cdbb471` | "?" **help popovers** on A5–A9 flags |
| v0.9.13 | `bafe553` | DB dump to CSV (`[X] Export DB to CSV`) |

Two related ideas were explored and then **walked back**: a direct Salesforce API pull via jsforce (v0.9.0) and SF-login menu entries (`f337db4`, `70ead47`). Both were removed in v0.9.5 once the CSV/XLSX export path proved less fragile. The lesson — *direct API integration is the right long-term destination but the export-import loop is more robust today* — survives as the framing for v3.0 in the modern roadmap.

### Why the lift-out happened

By April 2026 DL-Processor inside P-Charter had:
- Its own SQLite schema
- A growing surface of CLI subcommands
- A separate user audience (Registration team vs P-Charter's project-management users)
- Independent release cadence

Living as a subtree meant every DL-Processor change went through a `561acaa`-style monolithic commit on P-Charter master. The team decided to lift it out. The work happened in two stages:

1. **Standalone bootstrap** — a fresh repo at `C:\projects\DL-Processor` got the early `80f3225` → `ae63ec5` history (v0.1 through v0.4.1).
2. **Port from P-Charter** (specs `6365460`, `87a8268`, around 2026-04-30) — the *actual proven features* from P-Charter's v0.9.13 subtree (multi-applicant fields, project-mapping inference, regex-based SF header parsing, transliteration, audit-report, audit-workbook integration, audit-delta) were ported across into the standalone repo as the v0.4.1+ commits described in Chapter 2.

After the lift-out, the P-Charter subtree was frozen at v0.9.13. It still exists on disk at `Desktop\p-charter\dl-processor\` and the `[D] DLD Audit` menu entry still works against it, but no new development happens there.

---

## Chapter 1 — Origins (April 2026): a parser becomes a tool

The very first commit, `80f3225` — **"Initial XPS-Processor: parse DLD Project Inquiry reports"**. At that point the tool had one job: take DLD's native `.xps` files and extract project data from them. No DB, no compare, no UI. Just a positional-glyph extractor (`src/extractor.js`) and a project parser (`src/parser.js`).

Within a handful of commits it grew teeth:

- **`5ca94e6` — v0.2.0** added a CSV parser (for DLD's CSV exports), a SQLite store, and the first Salesforce compare logic. The tool now had two data sources and a database. Three core tables took shape: `dld_project`, `dld_snapshot`, `dld_unit`.
- **`71331a1`** — signed price deltas + interactive HTML report. The first compare HTML existed.
- **`efcc3ee`** — `MISMATCH` was split into the three statuses still in use today: `PRICE_UP` / `PRICE_DOWN` / `BUYER_MISMATCH`. Plus the `diff` subcommand for month-over-month DLD comparisons.

**`5c6d996` — v0.3.0** is the rename. *XPS-Processor* became **DL-Processor**, picked up manual overrides (`manual_override` table), and got a "cyberpunk terminal menu" — the no-deps readline UI in `src/menu.js` that still drives `dl-processor.bat` today.

**v0.4.0** (`e4c1659`) and **v0.4.1** (`ae63ec5`) added the interactive file picker and `[7] Quick Audit` menu option. These are the first two tags pushed to GitHub.

---

## Chapter 2 — The port from P-Charter (late April 2026)

DL-Processor had been living as a subtree inside a bigger repo called P-Charter. Around `f14043d` ("DL-Processor improvements plan") the team decided to lift the proven, working pieces of P-Charter's DLD logic into the standalone tool. This was a methodical refactor, not a rewrite:

- `3cb4685` extracted `BANK_PATTERNS`, `BANK_PREFIX_RE`, `BANK_SQL_CONDITIONS` into `common.js` — one source of truth for "is this party name a bank?" Used everywhere `bank-only` detection happens.
- `d480885` rewrote `namesOverlap` to drop Arabic particles and handle transliteration variants ("Mohammad" vs "Mohamed"). The Levenshtein-plus-token-overlap matcher took its modern form here.
- `bd47399` switched Salesforce column lookup from hardcoded indices to header-name resolution — the SF report format could now drift without breaking the import.
- `806824a` added a fuzzy token-overlap fallback to the project-mapping guesser, so unmapped DLD projects could still find their SF counterpart by name similarity.

Then the bigger port work, sequenced over `0344030` → `5fcbc10`: `expectedSfUnit` learned to handle building names and empty prefixes; the schema gained `match_scope` plus extra applicant fields (slots 2–5 for joint applicants); `compareProject` started supporting per-project match scopes (whole-project vs plot-level); a real `audit-report.js` showed up with the `[A]` menu entry; explicit DLD→SF override config was ported from P-Charter to `config/project-mapping.json`.

A small but important diversion: the **audit workbook integration** (`17cf5a0` → `6bc7cf1`). The Registration team had a manual audit Excel workbook. The tool learned to import it (`importAuditWorkbook`), categorize each row, and cross-check tool output against staff judgement (`audit-delta`). This feature is now legacy — superseded by the much richer `pending_change` workflow — but at the time it was the first "ground truth" feedback loop.

---

## Chapter 3 — The three matching layers (early May 2026)

This is where DL-Processor stopped being a glorified diff and started being a *reconciliation engine*. Three separate matching strategies landed across three feature branches, eventually all merged into master:

### A10 — multi-applicant matching

Before A10, the tool compared only DLD's primary buyer against SF's primary applicant. But Sobha sells lots of joint-ownership units. If a DLD primary matched SF *applicant 3* the row got flagged BUYER_MISMATCH — a false positive. Commits `2a85715` → `f9ab83e` extended `compareProject` to match against all 5 SF applicant slots and emit an **A10** audit flag when the match was non-primary.

### A11 — area cross-check

DLD reports `net_area`. The Registration team also maintains a private SQM reference per unit (the project's surveyed area). When these disagree by more than the project threshold (default 5%), that's a real discrepancy. Commits `d96ae89` → `c2cf54b` added:
- A new `manual_area` table (later folded into `master_data`).
- `project_mapping.area_threshold_pct` so per-project tolerances could differ.
- `computeAreaSignal` helper with three outputs: `none` / `flag` / `hard`.
- A new compare status `AREA_MISMATCH` plus an **A11** audit flag.
- An `area-template` workflow: generate per-unit CSV → fill SQM in Excel → apply back.

### A12 — multi-buyer ANY-MATCH

The most subtle of the three. A unit might have multiple DLD buyers over time and multiple SF applicants. Commits `d062950` → `ce9d954` introduced an **ANY-MATCH** rule: if *any* DLD buyer matches *any* SF applicant, the row is not a mismatch — but if the alignment is non-clean (e.g., primary-to-non-primary across multiple parties), it earns an **A12** flag for human review.

By the time these three branches converged (merge `0d00d73` on 2026-05-05), the compare HTML had two new columns — `DLD #` and `SF #` with click-to-expand dropdowns showing every buyer/applicant — and a `match_flags` array that deduped A10/A11/A12 cleanly.

This was also when the output structure was reorganized (`a7be93e`): `output/compare/`, `output/diff/`, `output/csv/`, and a master `output/dashboard.html` rolling everything up.

**Tests at this point: 161.**

---

## Chapter 4 — Phase 3 polish + master_data (mid May 2026)

After the three-branch merge, eight polish fixes shipped in a row (`8217665` → `d2c6e95`):
- Consistent step labels `[1/5]..[5/5]` across `cmdAll`
- Per-project `try/catch` so one project's failure didn't kill the run
- Friendly error when the SF `.xlsx` was open in Excel (file-lock)
- Numeric column sort by `data-sort-val` not text
- CSV serialization: string arrays as pipe-joined, object arrays as JSON
- SF import dedupe by `source_sha256` (matching the DLD pattern)
- **Bulk-load all transactions per snapshot** — the big perf win, ~30k → ~30 round-trips per Monday run.

Then came the master_data + approval queue work (`788b246` → `e096a06`). This was a 32-commit feature branch (`feat/master-data-approval`) that fundamentally changed how staff-curated data flowed through the system:

- New `master_data` table — single source of truth for staff-curated values (buyer overrides, area_sqm, etc.).
- New `pending_change` table — every DLD import queues proposed updates here for staff review.
- One-time migration: existing `manual_override` + `manual_area` were seeded into `master_data`, then frozen as historical tables.
- A CSV-roundtrip approval workflow: `[V] review-pending` writes `pending-changes.csv`; staff edit decisions; `[B] apply-pending` commits them.
- A `PENDING` flag in `match_flags` for any unit with unresolved pending changes.
- A new dashboard `Pending` column with per-project counts.

Plus a cleanup bundle of seven fixes (`91a68d8` → `a32544d`):
- Audit-delta moved to `output/audit-delta/` subfolder
- Dead `raw_json` column dropped from `dld_snapshot`
- Dead `v_unit_compare` view dropped
- `queueMasterDiffs` and `applyDecision` wrapped in transactions
- `audit-report` area-coverage reads `master_data` not `manual_area`
- Dead `overrides.js` exports removed
- N+1 snapshot_date lookup in review-pending replaced with `LEFT JOIN`

Dashboard got the **Sobha brand palette** (`455175e`) — cream/bronze, Dubai/Inter typography, the `brandBar` topbar. Diff HTML got the same treatment (`fc0b6a0`).

Finally `731a813` added `[L] Last drop` — one-click full pipeline on the newest input files.

This merge landed as `e096a06` on 2026-05-07. **190 tests passing.**

---

## Chapter 5 — Approval extensions + approve UI redesign

Branch `feat/m-approval-extensions` (commits `507ac5c` → `348d92f`) added several feature waves:

**Item m — auto-approve.** Trivial numeric drift (small price rounding, tiny area noise) now auto-approves at queue time without bothering staff. `src/auto-approve.js` exposes `shouldAutoApprove` against a config-driven rule set. `audit_log.action='auto_apply'` records every silent approval.

**Item m polish — DLP_USER env var.** When applying decisions from the CLI, the `decided_by` field can be set via `DLP_USER` so headless runs attribute correctly.

**Approve UI redesign.** Rather than ask staff to hand-edit a CSV, the tool now generates a click-to-export HTML page (`approve-pending.html`) with four collapsible sections, project groups, SF unit lookups joined in (via new `src/sf-lookup.js`), and **in-cell override editing** — staff type the corrected value directly in the proposed-value input. The page auto-opens after `review-pending` runs (cross-platform via `src/open-file.js`).

`applyDecision` learned an optional `appliedValue` argument so staff overrides flow through. Tests covered the HTML → CSV → applyDecision roundtrip including legacy CSV compatibility.

Merged as `b45382a` on 2026-05-09. **246 tests passing.**

---

## Chapter 6 — v1.0 The desktop app (2026-05-11)

This is the moment DL-Processor stopped being a developer's CLI and became an actual product. Branch `feat/electron-desktop` (12 plan tasks) packaged the tool as a Windows Electron application:

- `8742bb9` added Electron + electron-builder as devDeps; bumped to **1.0.0**.
- `eacad35` did the big refactor: all `cmd*` functions moved from the CLI top-level into `src/commands/*.js` for library reuse from the renderer.
- `8f5fc83` shipped the minimal main + preload + blank renderer window.
- `3d5f996` wired up the IPC `command-bridge` with **log streaming** — every CLI command's stdout/stderr now streams live to the renderer's log panel.
- `7d5dfe8` + `83acd60` built the **first-run wizard**: folder picker, legacy data migration logic, splash UI.
- `67c70cc` made install zero-config: NSIS hooks auto-create `Desktop\DL-Processor\` with the standard input/output folders.
- `0243637` added multi-select file pickers for DLD and SF imports.

**Tag `v1.0`** (untagged on disk but called out in commit messages). The first `.exe` shipped via OneDrive to the team.

---

## Chapter 7 — v1.1 Inline review + audit log (2026-05-12)

v1.1 was the second-biggest leap. The CSV roundtrip workflow worked, but it was slow and prone to user error. v1.1 made review **inline in the desktop app** and added a real audit trail:

- `13cae1d` — migration framework took shape. The first three numbered migrations landed: `001-audit-log` (append-only audit table), `002-buyer-alias` (learned BUYER_MISMATCH fixes), `003-pending-change-v2` (richer pending schema). Migration 004 seeded `buyer_alias` from the historical record.
- `27a3767` — `normalizeName()`: title strip + transliteration in one function.
- `7a89d14` — `lookupAlias()`: project-scoped beats global. "Teach alias" in the UI persists a mapping forever.
- `fdeb3aa` — projects list now `UNION`s SF-only projects, so Salesforce-only items appear in the top-bar selector.
- `16d9fea` — `AUDIT_FIELDS` constant + `writeAuditLog()` helper. Every field-level change funnels through one writer.
- `31bf35a` + `e76b62c` — **SF drift detection**. When a fresh SF snapshot disagrees with the previous one, the change is auto-applied to `master_data` and logged as `auto_apply` in `audit_log`. (DLD drift was deferred to v1.2, then folded into v2.0.)
- `1b79608` — sidebar redesign: removed the collapse button, added a **History** entry.
- `536ddc3` — **Needs review** tab: per-row `✓ Approve` / `✗ Reject`, `New (edit)` cell for inline overrides, `🔗 Teach alias` button on BUYER_MISMATCH rows.
- `89eefc6` — **Drift log** tab: read-only list of values silently overwritten at compare time.
- `f0aee2a` — per-unit history side panel (the `__openUnitHistoryPanel` that v2.0/v2.2 reuse everywhere).
- `5cc2775` — global **History page** + CSV export.
- `70f69d1` — Import DB modal with metadata + impact summary.
- `2d692bb` — critical fix to the v1.0 → v1.1 upgrade path: run migrations *before* `schema.sql` so the existing DB upgrades cleanly.

**Released as v1.1.0 on 2026-05-12.** Tests jumped from 246 → **322**.

A real app icon (`8e550d2`, `7e4206e`) replaced the placeholder — DL monogram, Sobha brand, regenerated as 256×256 .ico via resvg for electron-builder.

A comprehensive `TROUBLESHOOTING.md` (`e1aa167`) and `ROADMAP.md` (`9aa5deb`) shipped alongside.

---

## Chapter 8 — v1.2 Patch updates (2026-05-12, same day)

The team was going to want updates monthly. Pushing a 78 MB installer every time was expensive and high-friction. v1.2 solved that with a **patch system**:

- `9c369d3` — `scripts/build-patch.js`: package `app.asar` into a `dlp-patch-vA-to-vB.zip` (~5–15 MB, vs the 78 MB full installer).
- `19213ec` — `resources/patch-apply.cmd`: a tiny Windows batch helper that waits for the app to quit, swaps `app.asar`, and relaunches. Bundled into every install.
- `b0d8bc3` — `electron/patch-engine.js`: `probeZip` reads the manifest (verifying `from_version_min`, `to_version`, `asar_sha256`, `app_id`); `stagePatch` writes the new asar alongside the old; `revertLast` restores the `.bak` for one-click rollback.
- `11f8655` — IPC handlers + preload bridge.
- `3e78c88` — native renderer modal for applying patches.
- `02d57d5` — sidebar **⬆ Apply update** entry + Settings → Revert last patch action.

The BP grouping work originally scoped for v1.2 was re-scoped (`347b54e`) — patch updates shipped first; BP grouping moved to v1.3 (and ultimately into v2.0).

**Released as v1.2.0 on 2026-05-12.** Tests 322 → **338**. First version capable of receiving its own future patches.

---

## Chapter 9 — v2.0 The de-iframe milestone (2026-05-12, late)

Originally planned as three separate releases (v1.3 BP grouping, v1.4 DLD drift, v1.5 de-iframe), the team realized they had shared architectural foundations and bundled them into one milestone: **v2.0**.

### Feature A — de-iframe refactor

The desktop app had been serving most pages as iframed HTML files generated by the CLI. This was clunky: every page reload re-rendered the HTML; deep linking was a nightmare; the look-and-feel was inconsistent.

- `8521a1a` — the tab-host added a `render` mode alongside the existing `url` mode.
- `578447e`, `3fb6be8`, `8c619f5` — Review Pending, History page, Status, Projects, and Apply-pending all converted to native renderer-DOM.
- `2846308` — the deprecated `srcdoc` branch was removed.

### Feature B — Business Process grouping

DLD doesn't ship "one change per row" — a Pre-registration kicks off a cascade of related changes across buyer, price, area, dates. Reviewing them one-by-one is wasteful; grouping by BP lets staff approve a whole transaction in one action.

- `d691d9a` — migrations 006 (adds `current_step_assigned_name` + `comments` to `sf_booking`) + 007 (widens `audit_log.action` CHECK to include `approve_bp` / `reject_bp` / `acknowledge_bp`).
- `aec055c` — `src/bp-classifier.js` — pure function that maps a cluster of pending_changes to one of 7 BP type labels.
- `0c2e01b` — `src/sf-state.js` — pure function mapping SF context to one of 5 state badges.
- `a9827b2` — SF importer extracts 3 new BP-context columns.
- `4b71e57` — `src/commands/review-bps.js` exposes list/approve/reject/acknowledge as IPC.
- `f75908c`, `82d7f24`, `87acd46` — bp-card native renderer + Needs review tab + 8-dimension filter bar.

Umbrella `approve_bp` / `reject_bp` / `acknowledge_bp` audit_log entries record group-level actions while individual field changes still chain through `writeAuditLog`.

### Feature C — DLD drift detection

The companion to v1.1's SF drift, finally done.

- `adf9ba8` — picker functions extracted from `compare.js` into `src/snapshot-extract.js` so the drift logic could reuse them.
- `f807bc6` — the `'dld'` branch of `compare-drift.js` (a no-op stub since v1.1) became real. Field changes between consecutive `dld_snapshot`s now write `DLD_DRIFT` rows to `pending_change` or `auto_apply` rows to `audit_log`.

**Released as v2.0.0 on 2026-05-12.** Tests 338 → **390**. First real-world patch distribution (v1.2.0 → v2.0.0 zip).

---

## Chapter 10 — v2.1 Audit & compliance hardening (2026-05-13)

By v2.0 the tool had real users editing real data. Compliance needed bite. v2.1 (branch `feat/v2.1-audit-hardening`) made the audit log tamper-evident, gave it identity, and added thresholds for high-impact changes.

- `a1e4684` — `src/audit-hash.js`: `canonicalize(row)`, `computeRowHash`, `chainAppend`. SHA-256 of `(prev_hash || canonicalize(row))`.
- `6d706c6` — `src/current-user.js`: resolves the actor as Settings → OS username → `'unknown'`.
- `3e84889` — **migration 008**, the audit-hardening one. Idempotent. Adds four columns to `audit_log` (`user`, `tier2`, `prev_hash`, `row_hash`), widens the action CHECK to include `revert`, and **backfills hashes for all existing rows in `(ts, audit_id)` order** from genesis (64 zeros).
- `53c07b9` — `writeAuditLog` now chains forward and auto-fills `user` + `tier2` on every INSERT, all inside one `db.transaction`.
- `3e74599` + `73a2255` — **one-click Revert** backend + IPC + History page button. Cmd-Z model: restore `master_data` to the audit row's `old_value`, append new `audit_log` entry with `action='revert'`. Gated on `REVERTABLE_ACTIONS` (`approve` / `override` / `approve_bp` / `revert`) AND `table_name='master_data'`.
- `e2e2c8a` — `src/tier2.js`: threshold helper + Settings fields. Defaults: price > 10% OR > 50K AED absolute; area > 5%. Strict greater-than — boundary cases do NOT trip.
- `c6c6fca` — **Tier-2 justification modal**: required min-10-char text in the approve flow; BP-card "Approve all" shows ONE combined modal with all Tier-2 rows + shared justification. Backend re-validates thresholds (defense in depth).
- `7b5f65b` — **Excel audit export** from the History page. 12 columns, honours current filters, uses the existing `xlsx` dep.

A small UX polish: the log column on the right side of the app now **starts hidden by default**; the 📋 toggle still shows it.

**Released as v2.1.0 on 2026-05-13.** Tests 390 → **422**. Six release artifacts produced: `DL-Processor Setup 2.1.0.exe` (78 MB), the matching zip, and **`dlp-patch-v2.0.0-to-v2.1.0.zip` (4.89 MB)** — the second real-world patch.

A critical bug surfaced post-release: `2e08bab` — `resources/patch-apply.cmd` line 51 was missing the closing `%` on `%ASAR` variable expansion. One-character fix (`"%ASAR"` → `"%ASAR%"`). Has been in `patch-apply.cmd` since v1.2.0 but only surfaced when applying the v2.0→v2.1 zip patch because prior upgrades went through the full installer. Users on v2.0 either reinstall via the full v2.1+ installer or finish the half-done swap manually.

---

## Chapter 11 — v2.2 Native dashboard + project compare (2026-05-15)

v2.0 de-iframed everything *except* the two highest-traffic pages: the portfolio Dashboard and the per-project Compare. v2.2 closed that gap.

- `d0414bd` — `getProjectsSummary` backend query. Reuses the `compareProject()` + `summarize()` pipeline so the native page and the static HTML stay consistent.
- `e1bcf35` — `getProjectCompare` backend query, same principle.
- `061db89` — IPC bridge: `dlp:compare:summary`, `dlp:compare:project`. Preload exposes `window.dlp.compare.summary()` and `.project(id)`.
- `ca8e57c` — **native buyer/applicant cell popup** — replaces the old `<details>` block on DLD#/SF# cells. Closes on click-outside or Escape.
- `65adcc8` — `electron/renderer/project-compare-page.js` skeleton: all 23 columns rendered natively.
- `4ed8507` — **filter chips** with live counts, free-text search, click-to-sort headers (numeric-aware via `data-sort-val`).
- `ff7b8b6` — interactivity wired: row → side panel; procedure chip → History deep-link; PENDING chip → Review Pending deep-link.
- `7769779` — **Dashboard page**: project cards with source badge, unit totals, status mini-chips, `PENDING N →` chip, import dates, portfolio totals strip, search filter, refresh.
- `e93c14b` — sidebar + top-bar project picker rewired to drive the native pages.
- `680a2be` — chip + badge palette ported from `html-styles.js` to `electron/renderer/styles.css` so the native pages match the static HTML pixel-for-pixel.

The CLI `compare` command still writes both static HTML files unchanged for offline distribution — `output/dashboard.html` and `output/compare/<slug>.compare.html` aren't going anywhere.

No new tables. No new migrations. Just a cleaner, faster, deep-linkable UI.

**Released as v2.2.0 on 2026-05-15** (`cde4116`). Tests 422 → **428**.

---

## Chapter 12 — Present moment (2026-05-19)

`master` sits at `fd167b5`. The most recent two commits are spec work for what's next:

- `779bb12` — **spec for v2.3 workflow automation** drafted.
- `fd167b5` — self-review fixes to that spec.

The team is in the **2-to-4 week production phase** for v2.2. The brief is: use the native Dashboard and Project Compare tabs with real monthly data; capture friction (popup behaviour, sort edge cases, refresh ergonomics, deep-link round-trips); feed observations into v2.3 planning.

### What's on disk right now

```
dist-electron/
├── DL-Processor Setup 2.2.0.exe       (full installer)
├── DL-Processor Setup 2.2.0.zip
├── dlp-patch-v2.1.0-to-v2.2.0.zip     (patch)
└── latest.yml                         (Cloudflare manifest)
```

Tags on GitHub: `v0.4.0`, `v0.4.1`, `v1.1.0`, `v1.2.0`, `v2.0.0`, **`v2.2.0`**.

Pending team-facing actions: upload to `dl-processor.pages.dev` Cloudflare Pages; distribute the v2.1→v2.2 patch zip via OneDrive; collect production-phase feedback.

---

## Chapter 13 — Where the story goes next

### v2.3 — Workflow automation ✅ SHIPPED 2026-05-19

See Chapter 14 below for the full narrative. Headline: 15 commits on `feat/v2.3-workflow-automation` (`7614d73` SAVEPOINT spike → `4cf3d39` IPC wiring), test count 428 → **522** (+94), schema migration 009 (new `automation_rule` table, `pending_change.anomaly` column, widened `audit_log.source` CHECK enum). First release through the spec-process hardening flow.

### v2.4 — Reporting & exports (~1 week, next milestone)

Excel monthly audit reports (all the columns compliance wants), print-friendly per-project A4 layouts, scheduled weekly summary email via Outlook on Windows, "Take me to this unit" deep links in those emails.

### v2.5 — Code signing + cross-platform (~3 days, procurement-blocked)

Buy ~AED 1,000/year Authenticode certificate. All future `.exe` builds signed → SmartScreen warning disappears → IT trusts the binary without manual override. Add macOS and Linux builds via electron-builder (already supports them — just toggle target flags).

### v3.0 — Direct integrations (~3–4 weeks)

Salesforce REST API via OAuth. DLD API if Sobha's data partnership supports it. Webhook outbound to Slack/Teams. **Eliminates the entire "export → save → import" cycle** — the single most error-prone manual step in the monthly workflow.

### v3.1 — Cloud sync + multi-user (~6–8 weeks)

Move from local SQLite to managed Postgres. Multi-user concurrent editing with audit-log conflict detection. Optional web app build (Electron app becomes optional). Useful for handoffs across the team.

### v3.2 — Machine learning assist (~2–3 weeks)

Sentence-transformer buyer-name similarity beyond Levenshtein. Cross-unit duplicate detection (same buyer + similar amounts within a month = potential double-booking). Statistical anomaly prediction. Only worth doing if false-positive volume justifies the maintenance burden.

### Deliberately deferred

Mobile companion app (web build covers it), browser extension (niche), plugin system (premature), Arabic UI localization (team is bilingual).

---

## Appendix Z — Every DL-Processor location on this machine

DL-Processor exists in **five distinct places** on Ali's laptop. Each has a purpose; conflating them is a frequent confusion source.

| Path | Role | Last touched | What's there |
|---|---|---|---|
| **`C:\projects\DL-Processor`** | Active dev repo (the one this doc lives in) | 2026-05-19 | Full git history, v2.2.0 source, tests, specs, plans, build scripts. **All new work happens here.** |
| `C:\Users\ali.alghumlasi\Desktop\DL-Processor` | **Live working install (data only)** | 2026-05-15 | Real production data: `data/dld-sync.sqlite` (~30 MB), `input/`, `sf-input/`, `output/`, `logs/`. Created by the v1.0+ installer NSIS hook. **Do not edit code here** — the installed Electron app reads from this folder. |
| `C:\Users\ali.alghumlasi\Desktop\p-charter\dl-processor` | Legacy P-Charter subtree | last DL commit `bafe553` (v0.9.13) | Frozen prehistory inside P-Charter. Still launchable via P-Charter `[D] DLD Audit`. Has its own `node_modules`, `vendor/`, `dl-processor.bat`. **Don't develop here.** |
| `C:\projects\DL-Processor-Portable` | Portable build artifact (~v0.9.13 era) | older | Self-contained `app/` + `node/` (bundled Node runtime) for zero-install distribution. Predates the Electron app. |
| `C:\Users\ali.alghumlasi\Desktop\dlp-test-20260428125156\DL-Processor-Portable` | Older portable test (2026-04-28) | 2026-04-28 | Throwaway test extraction. Safe to delete. |
| `C:\Users\ali.alghumlasi\Desktop\DL-Processor.lnk` | Desktop shortcut | — | Launcher pointing at the installed Electron app. |

Two other related folders on disk that are **separate projects** (don't conflate):
- `C:\projects\crm-dashboard` — Sobha CRM sales-pipeline dashboard, **not** a DLD/Registration tool.
- `C:\Users\ali.alghumlasi\Desktop\p-charter` — P-Charter project-charter brochure generator (DL-Processor is a frozen subtree inside it).

### Data folder layout (`Desktop\DL-Processor\`)

```
DL-Processor/
├── config/                          (project-mapping overrides if set)
├── data/
│   └── dld-sync.sqlite              ← the live DB, ~30 MB, contains PII
├── db/                              (schema copy, regenerated on launch)
├── input/                           drop DLD .xps / .csv here
│   └── Changes Template Input/      filled area-template CSVs go here
├── sf-input/                        drop SF "DLD -ALL" .xlsx here
├── output/
│   ├── Changes Template/            generated area-template CSVs
│   ├── compare/                     per-project <name>.compare.html
│   ├── csv/                         compare.csv, diff.csv, audit-tasks.csv
│   ├── diff/                        per-project <name>.diff.html
│   ├── parse/                       raw parse output (JSON + CSV)
│   └── dashboard.html               cross-project summary
└── logs/                            audit.jsonl
```

The `Desktop\DL-Processor\` install also has a v1.0+ Electron app shell, but the data lives at the paths above and is read by both the Electron renderer and any CLI runs.

---

## Appendix A — The cast (source files that matter)

```
src/
├── alias-lookup.js          buyer_alias table reader + matcher
├── audit-hash.js            ★ v2.1 — SHA-256 chain canonicalization
├── audit-log.js             JSONL trail + DB writeAuditLog
├── auto-approve.js          rules → audit_log.action='auto_apply'
├── bp-classifier.js         ★ v2.0 — BP type label inference
├── compare.js               ★ unit-level DLD↔SF + A10/A11/A12
├── compare-drift.js         ★ v2.0 — SF + DLD drift detection
├── current-user.js          ★ v2.1 — user identity resolver
├── db.js                    better-sqlite3 wrapper + migration runner
├── extractor.js             XPS positional-glyph extractor
├── import-dld.js            parsed tree → snapshot rows + queueMasterDiffs
├── master-data.js           helpers over master_data
├── menu.js                  terminal menu (zero-dep readline)
├── overrides.js             listBankOnlyUnits + master_data CRUD
├── parser.js                XPS project parser
├── pending-change.js        helpers over pending_change
├── project-mapping.js       DLD↔SF inference + area threshold
├── salesforce.js            SF XLSX header-name reader
├── sf-state.js              ★ v2.0 — SF state badges
├── snapshot-extract.js      ★ v2.0 — picker fns for drift
├── tier2.js                 ★ v2.1 — Tier-2 threshold helpers
├── transliteration-map.js   Arabic ⇄ Latin name variants
└── migrations/              001..008 (numbered, idempotent)

electron/
├── main.js                  app lifecycle + IPC registry
├── preload.js               window.dlp.{compare,history,settings,...}
├── command-bridge.js        renderer ↔ src/commands/* bridge
├── patch-engine.js          ★ v1.2 — manifest verify + apply
└── renderer/                ★ v2.0/v2.2 — native DOM pages
    ├── dashboard-page.js
    ├── project-compare-page.js
    ├── review-pending-page.js
    ├── history-page.js
    ├── unit-history-panel.js
    └── styles.css
```

## Appendix B — Schema (19 tables)

`dld_project` · `dld_snapshot` · `dld_building` · `dld_unit` · `dld_transaction` · `dld_breakdown` · `sf_snapshot` · `sf_booking` · `manual_override` · `project_mapping` · `manual_area` · `manual_audit_snapshot` · `manual_audit_project` · `manual_audit_row` · **`master_data`** · **`pending_change`** · **`audit_log`** · **`buyer_alias`** · **`automation_rule`**

9 migrations applied automatically: `001-audit-log` → `002-buyer-alias` → `003-pending-change-v2` → `004-buyer-alias-seed` → `005-audit-log-source-widen` → `006-sf-booking-step-cols` → `007-audit-log-action-widen` → `008-audit-hardening` → `009-automation` (creates `automation_rule`, adds `pending_change.anomaly`, widens `audit_log.source` CHECK to 7 enum values, seeds 4 built-in rules).

## Appendix C — Test count trajectory

```
v0.9.x → 161
v0.9.16 → 190
v1.0   → 246
v1.1   → 322   (+76, audit log + inline review)
v1.2   → 338   (+16, patch system)
v2.0   → 390   (+52, de-iframe + BP grouping + drift)
v2.1   → 422   (+32, audit hardening)
v2.2   → 428   (+6, native panes)
v2.3   → 522   (+94, rules engine + anomaly + bulk + trending + dry-run)
```

## Appendix D — Pointers

| What | Where |
|---|---|
| Canonical roadmap | `ROADMAP.md` |
| Build / patches | `BUILDING.md` |
| Common issues + recovery | `TROUBLESHOOTING.md` |
| v2.3 spec | `docs/superpowers/specs/2026-05-18-v2.3-workflow-automation-design.md` |
| Spec template (new from 2026-05-19) | `docs/superpowers/spec-template.md` |
| Spec checklist (review gate) | `docs/superpowers/spec-checklist.md` |
| Planning-mistakes log (seeded with 4 entries) | `docs/superpowers/planning-mistakes-log.md` |
| Pre-spec exploration reports | `docs/superpowers/explorations/` |
| Spec-process hardening spec | `docs/superpowers/specs/2026-05-19-spec-process-hardening-design.md` |
| Spec-process hardening plan | `docs/superpowers/plans/2026-05-19-spec-process-hardening.md` |
| Schema | `db/schema.sql` |
| Migrations | `src/migrations/` |
| Test runner | `scripts/run-tests.js` (Electron with `ELECTRON_RUN_AS_NODE=1`) |
| CLI entry | `node index.js` or any subcommand |
| Desktop entry | `electron/main.js` (`package.json` `main`) |
| Resumption | **"resume dl area"** + version |

---

## Appendix M — Memory archive (every DL-Processor memory note, verbatim)

This appendix folds in the full content of every DL-related memory note from `~/.claude/projects/C--projects/memory/`. They overlap with the chapters above but preserve commit hashes, real-DB validation numbers, branch states, sample fixtures, and decisions that didn't fit the narrative.

---

### M.1 — User role

> Ali Alghumlasi, Sobha Realty · Registration / DLD team. Maintains DL-Processor on Windows. Bilingual (English / Arabic). Uses the resume phrase **"resume dl area"** + version to pick up paused DL feature work.

### M.2 — Resume phrase convention

> **"resume dl area"** is Ali's convention for picking up paused DL feature work. Usually followed by a version qualifier: `"resume dl area — start v2.3"`, `"resume dl area — plan v2.3"`, `"resume dl area — start v2.2 brainstorming"`.

### M.3 — `reference_dl_processor.md` (key paths and entry points)

> **Repository root:** `C:\projects\DL-Processor` (standalone git repo; also lives as a subtree inside the P-Charter repo at `Desktop\p-charter\dl-processor\`).
>
> **Specs:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
> **Plans:** `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`
>
> **Tests:** `node --test "test/**/*.test.js"` via `npm test`. Uses `node:test` + `node:assert/strict`. DB tests build `:memory:` better-sqlite3 with `db/schema.sql` then call `migrateSchema()` from `src/db.js`.
>
> **CLI:** `node index.js` (full pipeline) or any subcommand: `parse`, `import`, `import-sf`, `compare`, `diff`, `audit`, `audit-delta`, `area-template`, `apply-areas`, `projects`, `status`. Menu: `node src/menu.js` or `dl-processor.bat`.
>
> **Two specialised agents** are useful here: `dl-processor-engineer` (implementer / code work — proactively dispatched whenever DL-Processor source is touched) and `superpowers:code-reviewer` (review steps).
>
> **Pain-points list (kept by the maintainer):** false BUYER_MISMATCH reduction, monthly-flow ergonomics, project-mapping coverage, HTML dashboard usability.

### M.4 — `reference_dl_processor_all_locations.md` (5 locations + P-Charter prehistory)

> See Appendix Z and Chapter 0 above — this memory file is fully folded in there.

### M.5 — `project_dl_area_branch.md` (`feat/multi-applicant-and-area-matching`)

> In-flight branch in `C:\projects\DL-Processor`: **`feat/multi-applicant-and-area-matching`**, 13 commits ahead of `master` as of 2026-05-01.
>
> **What it adds:**
> - **A10 multi-applicant matching** — DLD buyer now compared against all 5 SF applicant slots (`applicant_name`, `applicant_2_name`, `applicant_3_name`, `applicant_4_name`, `applicant_details`). Co-applicant matches reclassify from BUYER_MISMATCH → MATCH+A10.
> - **A11 / AREA_MISMATCH** — staff-driven SQM cross-check. New durable table `manual_area` (parallel to `manual_override`). Threshold default 5%, per-project configurable. Below threshold → soft `A11` flag; at/above → hard `AREA_MISMATCH` status (only escalates from MATCH; non-MATCH rows keep their status + A11).
> - **`area-template` / `apply-areas` CLI** — staff fill SQM in a CSV; apply upserts into `manual_area`. Menu entry `[Y] Area template`.
>
> **Spec:** `docs/superpowers/specs/2026-05-01-multi-applicant-and-area-matching-design.md`
> **Plan:** `docs/superpowers/plans/2026-05-01-multi-applicant-and-area-matching.md`
>
> **Why:** v0.9.13 had ~1200 BUYER_MISMATCH rows; many were co-applicant false positives. Area data was uncaptured — wrong-unit matches and stale recorded sizes went undetected. The feature is additive: with `manual_area` empty (its initial state) the output is identical to v0.9.13 except for the new AREA stat card showing 0.
>
> **Three deferred items** (spec drift; require HTML overhaul, not bug fixes):
> 1. `FLAG_INFO` `?` popovers for A10/A11 (existing HTML has no popover infra).
> 2. Area columns default-hidden (existing HTML has no column-picker UI).
> 3. Status legend section (existing HTML has no legend section).
>
> **Pre-existing uncommitted state on the branch (not part of this feature, leave alone):** deleted `input/ProjectInquiryReport.xps` + untracked `Sobha_Hartland_Waves.overrides.csv`.

### M.6 — `project_dl_diff_polish_branch.md` (`feat/dld-diff-polish`)

> **Branch:** `feat/dld-diff-polish` in `C:\projects\DL-Processor` — 9 commits ahead of `master` as of 2026-05-04.
>
> **What it does:** Three small refinements to the existing month-over-month DLD diff:
> 1. Hide "missing" rows by default (renamed `REMOVED_*` → `MISSING_*`, soften copy, gate behind `--show-missing`).
> 2. `--since YYYY-MM-DD` flag to override the older snapshot baseline.
> 3. Restructured per-project terminal block (grouped new/changed/hidden lines + `TOTAL across N projects` footer).
>
> **Commits (oldest to newest):** `e0af6bf` (spec), `f334021` (plan), `230c035`, `9e60cea`, `096492a`, `a1d7959` (comment polish), `7edc9a2`, `c00481e`, `5896a8a`.
>
> **Status:** Final whole-branch code review approved MERGE-AS-IS on 2026-05-04.
>
> **Non-blocking follow-ups noted by reviewer:**
> - Add `test/parse-diff-args.test.js` for the CLI flag parser.
> - Fix pre-existing `[1/4]`/`[2/4]` step labels in `cmdAll()` (unrelated bug at base SHA `e24834c`).
> - Tighten spec wording for the HTML hidden-rows meta line (cosmetic doc drift).

### M.7 — `project_dl_multi_buyer_feature.md` (`feat/multi-buyer-matching` design notes)

> **Status:** Implementation COMPLETE on branch `feat/multi-buyer-matching`. **REBASED 2026-05-05 onto `feat/dld-diff-polish`** so the branch carries both feature sets. 24 commits ahead of master, 124 tests pass. Final whole-branch review approved MERGE-WITH-CLEANUP on 2026-05-05.
>
> Safety tag at `backup/multi-buyer-pre-rebase` points to the pre-rebase HEAD.
>
> **Real-DB validation 2026-05-05:** Sobha Hartland Waves before/after — **MATCH 446→457, BUYER_MISMATCH 50→34**. ~16 false BUYER cases recovered, ~11 reclassified MATCH+A12.
>
> **Rebase note for future merge with feat/multi-applicant-and-area-matching:** The two branches both modify `classifyMatch`'s init object, every return statement, the nameState ladder, the result-row push, and `STATUS_PRIORITY`. Plan a manual three-way merge — auto-merge will not produce the right result. Synthesis: keep A12's loop as primary source for `flags`, run `findMatchingApplicant` once after to populate `matchedApplicantField` for A10. `STATUS_PRIORITY` trivially gains `AREA_MISMATCH`. ~30-50 lines of conflict.
>
> **Branch state at pause (9 commits ahead of master):**
> - `4b5cc7a` docs: spec
> - `88550c6` docs: implementation plan
> - `8bcaf68` feat(compare): collectDldBuyers helper with kind classification (Task 1)
> - `83badfa` fix(compare): primary-first ordering, dateIso field, drop unused import (Task 1 review fixes)
> - `3147b5c` feat(compare): collectSfApplicants helper with forward-compat 5-slot iteration (Task 2)
> - `e4fb0be` feat(compare): ANY-MATCH rule with A12 flag for non-primary alignments (Task 3)
> - `0330282` fix(compare): pin override semantics + stable tiebreak in collectDldBuyers (Task 3 review fixes)
> - `73fd0c7` feat(compare): add dld_buyers / sf_applicants / match_flags to result rows (Task 4)
> - `d957e80` feat(buyer-cells): pure HTML renderers for DLD buyers and SF applicants (Task 5)
>
> **Decisions locked 2026-05-04:**
> - **Match rule = ANY-MATCH** (option A from brainstorm). If any of the up-to-N DLD party_names matches any populated SF applicant slot, the unit is MATCH. No primary-priority preference; any overlap counts.
> - **SF reality check.** Today only `sf_booking.applicant_name` is populated; slots 2-4 + details are usually empty. Implementation still iterates all five slots for forward-compatibility.
> - **Apply to all HTML reports.** Multi-buyer column + dropdown lives in `.compare.html`, `.diff.html`, AND `.audit.html`. Single shared renderer helper.
>
> **Sample multi-buyer cell from Ali (2026-05-04, for fixture/test use):**
> ```
> ABIGAIL ALETTA ALMAIDA FRANKLIN JAGANATH ALMAIDA(46.35 F.T.)  Sell - Pre registration - 05/02/2024 - 1234802 AED
> ABIGAIL ALETTA ALMAIDA FRANKLIN JAGANATH ALMAIDA(23.17 F.T.)  Sell - Pre registration - 05/02/2024 - 1234802 AED
> SACHIN MOHAN PUJARI PUJARI MOHAN RAMA(46.35 F.T.)            Sell - Pre registration - 05/02/2024 - 1234802 AED
> SACHIN MOHAN PUJARI PUJARI MOHAN RAMA(23.18 F.T.)            Sell - Pre registration - 05/02/2024 - 1234802 AED
> ```
> All four end up as separate `dld_transaction` rows.
>
> **Source-field provenance (from Ali's terminology):**
> - `pROJECT_NAME_ENDataTextBox` → `dld_project.project_name`
> - `uNIT_ACTUAL_AREADataTextBox` → `dld_unit.net_area`
> - `htmlTextBox1` / `textBox1` → parsed by `parseHtmlTextBox1` into N `dld_transaction` rows per unit.
>
> **Edge cases the design must handle:**
>
> 1. **Empty-name share markers (anonymized seller).** Marker with no name before it (e.g. `(78.56 F.T.) Sell - ...`) usually represents the previous owner whose name DLD stripped. Always paired with a same-share, same-date, same-amount named row that's the new buyer. Today the parser stores an empty `party_name`. Recommend: filter from buyer-match logic (so they don't cause false BUYER_MISMATCH), but display in the per-unit card with the "name not captured" label.
>
> 2. **Joint owners with double-share entries.** A jointly-owned unit often emits four rows: each person at one share + each person at the joint-total share. Do NOT dedupe — they are valid DLD records. For display, group by name and list shares; for matching, use the union of names.
>
> 3. **Name variants for same person (hard).** `ABDUL RAB(75.18)` and `ABDUL RAB ABDUL AZIZ(75.18)` — same date, same amount, same share. Almost certainly one person. Reuse `namesOverlap()` to decide. Group/dedupe in display, treat as single match candidate.
>
> **Relabel F.T. → SQM in display.** DLD source writes `F.T.` but the registration team reads it as square meters. Schema keeps `share_unit` raw (audit trail). Display layer maps `F.T.` → `SQM`. `SQ.M.` inputs pass through unchanged.

### M.8 — `project_dl_merge_complete.md` (three-branch merge to master 2026-05-05)

> **Status as of 2026-05-05:** master is the unified branch. All three feature branches merged. **161 tests green.** Real-DB smoke test on Sobha Hartland Waves: **MATCH 457 / BUYER 34 / AREA 0 / A10:0 / A11:0 / A12:27**.
>
> **Master log (top):**
> - `0d00d73` — Merge feat/multi-buyer-matching (ANY-MATCH + A12 + multi-buyer HTML + folders + dashboard)
> - `07ae65e` — Merge feat/multi-applicant-and-area-matching (A10 + A11/AREA_MISMATCH + manual_area)
> - `5896a8a` — feat(diff-cli): --since, --show-missing (FF from feat/dld-diff-polish)
> - `e24834c` — pre-merge baseline (Sobha-branded HTML)
>
> **The three matching layers now coexist:**
> - **A10** — DLD primary buyer matched a non-primary SF applicant slot. Emitted by `classifyMatch` (cls.flags) and the post-classify A10 push in `compareProject` (deduped via Set at row-push).
> - **A11** — Area cross-check failure (manual_area vs DLD net_area beyond threshold). Emitted by `compareProject` via `auditFlags.push('A11')`. Populates as soon as `manual_area` rows fill via `area-template` / `apply-areas` flow.
> - **A12** — Multi-buyer ANY-MATCH found a non-clean pairing. Emitted by `classifyMatch`.
>
> Result row carries BOTH `audit_flags` (legacy pipe-joined string of A10+A11) AND `match_flags` (canonical deduped array of A10+A11+A12).
>
> **Safety tags preserved:** `backup/multi-buyer-pre-rebase`, `backup/multi-buyer-pre-master-rebase`.
>
> **Cleanup item flagged but not done:** `auditFlags` local in `compareProject` still pushes A10 redundantly with classifyMatch's A10 push; the Set-dedup at row-push hides it from match_flags but it's slightly wasteful work.
>
> **Phase 3 — DONE 2026-05-05.** All 8 polish fixes shipped on master:
> - `8217665` consistent [1/5]..[5/5] step labels
> - `0c1ad70` per-project try/catch isolates failures
> - `af6a313` friendly error when SF .xlsx is locked by Excel
> - `467caa6` numeric columns sort by data-sort-val not text
> - `f928585` CSV serializes string arrays as pipe-joined, object arrays as JSON
> - `0f5dbb1` SF imports deduped by source_sha256
> - `d2c6e95` bulk-load all transactions per snapshot (~30k → 30 round-trips/run)
> - `6f83cf0` README updated for A12, dashboard, output folders, diff --since
>
> Final: 162 tests pass. Real-DB smoke confirms MATCH/BUYER counts unchanged after the bulk-load perf rewrite. Dashboard A12 column live (27 on Sobha Hartland Waves).
>
> **Phase 4 — DONE 2026-05-06.** All 13 tasks of master_data + approval queue spec implemented on `feat/master-data-approval`. Two critical regressions caught and fixed: incomplete-migration bugs in `compare.js` A11 path and `overrides.js` `listBankOnlyUnits`. I1 (per-field bootstrap deviation from plan) documented inline.
>
> **Phase 4.5 — Polish + UX done 2026-05-06.**
> - Real-DB bug: `queueMasterDiffs` crashed on null `unit_number_norm` — fixed (skip those units)
> - `[O]` menu preferred latest-modified HTML — now prefers `output/dashboard.html`
> - Output folders restructured: `output/parse/`, `output/Changes Template/`, `input/Changes Template Input/`
> - Bundle a-g: audit-delta subfolder, raw_json drop, v_unit_compare drop, transaction wrapping, audit-report master_data read, dead exports removal, review-pending N+1 fix
> - Dashboard restyled to Sobha brand (cream/bronze palette, Dubai/Inter typography, brandBar topbar)
>
> **Branch MERGED to master 2026-05-07.** `feat/master-data-approval` (32 commits) merged via `--no-ff` as `e096a06`. **190/190 tests pass.**
>
> **Final commits of feat/master-data-approval:**
> - `4c3c821` docs(pending-change): explain per-field bootstrap deviation from plan
> - `36a1882` fix(overrides): listBankOnlyUnits reads master_data not manual_override
> - `6225730` fix(compare): A11 area cross-check reads master_data not manual_area
> - `e54c287` feat(menu): [5] master data, [V] review pending, [B] apply pending
> - `4a051d6` feat(dashboard): add Pending column
> - `e59b38d` feat(cli): apply-pending
> - `6f18a5c` feat(cli): review-pending
> - `0e4c160` feat(compare): hybrid lookup + PENDING flag (canonicalBuyer parameter)
> - `c87b605` refactor(area-template): apply-areas writes to master_data
> - `8dd3824` refactor(overrides): getOverridesMapForProject reads from master_data
> - `e423c1a` feat(import-dld): queue master_data diffs after every snapshot
> - `3b41197` feat(pending-change): helpers
> - `3f9b0c2` feat(master-data): helpers
> - `b87002d` feat(db): migration of manual_override + manual_area
> - `aa97331` feat(schema): tables
> - `bc64558` docs: plan
> - `788b246` docs: spec
>
> **Non-blocking polish backlog from final review:**
> - I2: wrap `apply-pending` in a transaction
> - I3: wrap `queueMasterDiffs` in a transaction
> - I4: N+1 snapshot_date lookup in review-pending CSV writer
> - I5: audit-report area-coverage still reads `manual_area`
> - I6: dead exports in `overrides.js` (`setOverride/deleteOverride/listOverrides/getOverride`)
> - M1-M6: cosmetic (dedupe canonicalBuyer/overrideBuyer, DRY csvEscape, etc.)
>
> Catalogued in `docs/superpowers/notes/2026-05-05-deferred-follow-ups.md`. DEF-1 audit-delta buyer columns · DEF-2 audit-delta subfolder · DEF-3 archiving · DEF-4 raw_json drop · DEF-5 v_unit_compare drop · DEF-6 master-data approval workflow.

### M.9 — `project_dl_two_branches_paused.md` (v2.1.0 SHIPPED 2026-05-13 — despite the filename)

> **State 2026-05-13 EOD.** v1.0 + v1.1 + v1.2 + v2.0 + v2.1 all shipped on master + pushed to GitHub.
>
> **Master state:**
> - Tip: `3be7ffe` — merge of `feat/v2.1-audit-hardening` (33 files, +1,983 lines).
> - Tags pushed: `v0.4.0`, `v0.4.1`, `v1.1.0`, `v1.2.0`, `v2.0.0`, **`v2.1.0` (at `03f7de8`)**.
> - Suite: **422/422 passing** (v1.0=246 → v1.1=322 → v1.2=338 → v2.0=390 → v2.1=422).
> - All feature branches merged + deleted.
>
> **GitHub:**
> - Repo: https://github.com/Meejum/dl-processor (private)
> - Auth: Windows Credential Manager
> - All commits + 6 tags pushed
>
> **v2.1.0 — five audit-hardening features** distributed as the second real patch (v2.0.0 → v2.1.0, 4.89 MB zip):
>
> 1. **One-click Revert** on global History page rows. Cmd-Z model — restores master_data to the audit row's old_value + writes new audit_log row with `action='revert'`. Button gated on `REVERTABLE_ACTIONS` (`approve` / `override` / `approve_bp` / `revert`) AND `table_name='master_data'`. New file `src/commands/audit-revert.js`.
>
> 2. **User attribution** — new `audit_log.user` column. Source: Settings field "Your name (audit attribution)" → else `os.userInfo().username` → else `'unknown'`. Forward-only — pre-v2.1 rows stay NULL. New file `src/current-user.js`.
>
> 3. **Cryptographic chain on audit_log** — new `prev_hash` + `row_hash` columns. SHA-256 of `(prev_hash || canonicalize(row))`. Migration 008 backfills existing rows in `(ts, audit_id)` order from genesis (64 zeros). `writeAuditLog` chains forward at every INSERT inside one `db.transaction`. Tamper-evident. New file `src/audit-hash.js`.
>
> 4. **Tier-2 approval gates** — Settings thresholds (default: price >10% OR >50K AED absolute; area >5%). Required-justification modal (min 10 chars) fires before commit when threshold crossed. Text → `audit_log.user_note`, `tier2=1` flag. Card-level Approve all shows ONE combined modal with all tier-2 rows + shared justification. Backend re-validates (defense in depth). Strict greater-than — boundary cases do NOT trip. New file `src/tier2.js`.
>
> 5. **Excel audit export** — `[Export Excel]` button on History page next to `[Export CSV]`. Honors current filters. 12 columns (Timestamp / User / Project / Unit / Field / Old value / New value / Action / Source / Tier-2 / Justification / Row hash). Uses existing `xlsx` dep.
>
> **Migration 008 (`2026-05-13-008-audit-hardening`)** — single idempotent pass: adds 4 columns + widens `audit_log.action` CHECK to include `'revert'` + backfills hashes.
>
> **Settings additions** — "Your name", price % threshold, price AED threshold, area % threshold. New IPC `dlp:settings:get` + `dlp:settings:set`.
>
> **Bonus** — log column starts collapsed by default; the 📋 toggle still shows it.
>
> **Critical bug fix shipped with v2.1.0:**
> `resources/patch-apply.cmd` line 51 was missing the closing `%` on `%ASAR` variable expansion, causing v2.0.0→v2.1.0 patch BACKUP step to fail with "system cannot find the file specified". One-char fix (`"%ASAR"` → `"%ASAR%"`) shipped in `2e08bab`. Bug had been in patch-apply.cmd since v1.2.0 — only surfaced when applying v2.0→v2.1 patch because previous patches got installed via full installer.
>
> Existing v2.0.0 installs have the broken cmd. Users who hit the failure can:
> - Reinstall via v2.1.0 full installer (78 MB) — gets fixed cmd
> - Manually finish the half-done swap: rename `app.asar` → `app.asar.bak`, `app.asar.pending` → `app.asar`, delete `.patch-pending`
> - Hand-edit the broken cmd before retrying
>
> **Release artifacts (local at `dist-electron/`):**
> - `DL-Processor Setup 2.1.0.exe` (78 MB, contains FIXED patch-apply.cmd)
> - `DL-Processor Setup 2.1.0.zip` (107 MB)
> - **`dlp-patch-v2.0.0-to-v2.1.0.zip` (4.89 MB)** — second real patch zip
> - `latest.yml` ready for Cloudflare
>
> **Test infrastructure note (DON'T regress):** `npm test` runs through `scripts/run-tests.js` which spawns Electron with `ELECTRON_RUN_AS_NODE=1`. Don't change.
>
> **Sanity audit findings deferred to v2.2** (5 items in `docs/v2.1-sanity-audit.md`):
> 1. `appConfigPath` dead export in current-user.js
> 2. Tier-2 logic duplicated renderer↔src
> 3. `REVERTABLE_ACTIONS` duplicated renderer↔src
> 4. `audit_log.user` nullability tightening (NOT NULL DEFAULT 'unknown')
> 5. Settings modal numeric input validation
>
> **Session arc:** This session went from morning v1.0 smoke → v1.1 design + ship → v1.2 patch system → v2.0 milestone (de-iframe + BP grouping + DLD drift) → v2.1 audit hardening. **~60 tasks closed, 422 tests green, 4 .exe builds + 2 patch zips shipped. All on GitHub.**

### M.10 — `project_dl_v22_shipped_v23_drafted.md` (current state)

> **State as of 2026-05-19.** Branch tip `fd167b5` on master.
>
> **Releases shipped (chronological, all on master):**
> - v0.4.0 / v0.4.1 — initial standalone CLI
> - v0.9.x bundle (2026-05-05) — A10/A11/A12 matching layers, Sobha-branded dashboard, output folders
> - v0.9.16 (2026-05-07) — master_data + pending_change + CSV approval workflow + `[L]` Last drop
> - v1.0 (2026-05-11) — Electron desktop packaging
> - v1.1.0 (2026-05-12) — audit log + inline review + UI cleanup (322 tests)
> - v1.2.0 (2026-05-12) — patch-based in-app updates (~5–15 MB zips, 338 tests)
> - v2.0.0 (2026-05-12) — de-iframe + BP grouping + DLD drift (390 tests)
> - v2.1.0 (2026-05-13) — audit hardening — Revert / user / SHA-256 chain / Tier-2 / Excel export (422 tests)
> - **v2.2.0 (2026-05-15)** — native Dashboard + Project Compare panes (428 tests). Last iframes removed.
>
> Tags on GitHub: v0.4.0, v0.4.1, v1.1.0, v1.2.0, v2.0.0, v2.2.0.
>
> **Next milestone — v2.3 workflow automation.** Spec at `docs/superpowers/specs/2026-05-18-v2.3-workflow-automation-design.md` (self-review fixes in `fd167b5`). Implementation plan NOT yet written.
>
> Five features: bulk operations · custom rules engine (`automation_rule` table) · anomaly badges · cross-month trending · pre-compare report.
>
> **Estimate:** ~3 weeks. Dependencies (v2.0 BP grouping) met.
>
> **Resume phrases:**
> - `"resume dl area — plan v2.3"` → write implementation plan from spec
> - `"resume dl area — start v2.3"` → begin phased execution on `feat/v2.3-workflow-automation`
>
> **Production-phase ask (next 2-4 weeks):** Use v2.2 with the registration team. Capture friction on:
> - Native Dashboard popup behaviour + refresh ergonomics
> - Project Compare column sort edge cases (numeric vs text, blanks)
> - Deep-link round-trips (PENDING chip → Review Pending → back)
> - Any regressions vs old iframe HTML
>
> **Schema state:** 18 tables. 8 numbered migrations (`001-audit-log` → `008-audit-hardening`), idempotent, run automatically. Key tables: `master_data` + `pending_change` + `audit_log` (hash-chained) + `buyer_alias` drive the modern approval workflow.

---

## Appendix N — Real-DB validation numbers (Sobha Hartland Waves benchmark)

The Sobha Hartland Waves project has been the team's regression-test benchmark since v0.9.x. Capturing the numbers makes future regressions obvious.

| Date | Version | MATCH | BUYER_MISMATCH | AREA | A10 | A11 | A12 | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-05-05 | post-merge | 446 | 50 | — | — | — | — | pre-multi-buyer baseline |
| 2026-05-05 | + multi-buyer | 457 | 34 | — | — | — | — | A12 reclassified ~11 rows; ~16 false BUYER cases recovered |
| 2026-05-05 | three-branch merged | 457 | 34 | 0 | 0 | 0 | 27 | manual_area empty so A11 not yet active |

## Appendix O — Pain points the maintainer tracks

From `reference_dl_processor.md` — the explicit list Ali keeps:

1. **False BUYER_MISMATCH reduction** — addressed by A10 (multi-applicant), A12 (multi-buyer ANY-MATCH), transliteration map, `buyer_alias` "Teach alias" persistence, and (next) v2.3 rules engine.
2. **Monthly-flow ergonomics** — addressed by `[L] Last drop`, the desktop app's full pipeline button, inline review, BP grouping.
3. **Project-mapping coverage** — addressed by the v0.9.6 10-mapping bundle, regex SF-header parsing, fuzzy token-overlap fallback in `project-mapping.js`.
4. **HTML dashboard usability** — addressed by Sobha branding, A12 column, output folder restructure, native panes in v2.2.

## Appendix P — Deferred-follow-ups (`docs/superpowers/notes/2026-05-05-deferred-follow-ups.md`)

| ID | What | Status |
|---|---|---|
| DEF-1 | Audit-delta buyer columns | shipped in `8912dc0` |
| DEF-2 | Audit-delta subfolder | shipped (`91a68d8`) |
| DEF-3 | Output archiving | shipped (`[Z] archive output`, `0141db6`) |
| DEF-4 | Drop raw_json column | shipped (`c544a26`) |
| DEF-5 | Drop v_unit_compare view | shipped (`6f199cf`) |
| DEF-6 | Master-data approval workflow | shipped as `feat/master-data-approval` |
| I2 | Wrap apply-pending in transaction | open |
| I3 | Wrap queueMasterDiffs in transaction | shipped (`250af57`) |
| I4 | N+1 snapshot_date lookup in review-pending | shipped (`a32544d`) |
| I5 | audit-report area-coverage reads manual_area | shipped (`f5e9322`) |
| I6 | Dead exports in overrides.js | shipped (`33898a7`) |

Most of the DEF-* items shipped in Phase A bundle (merge `1dc3c56`).

## Appendix Q — Decisions locked early that still hold

1. **No git remote until master_data approval shipped.** Set up `github.com/Meejum/dl-processor` only after v0.9.16 was real — keeps experimental noise out of public history.
2. **`audit_flags` (pipe-joined) and `match_flags` (array) coexist.** Don't deprecate `audit_flags` until no consumer reads it. Both populated on every row.
3. **F.T. → SQM display relabel.** DLD source writes `F.T.` but Registration reads square meters. Schema preserves the raw value; display layer translates.
4. **Iterate all 5 SF applicant slots even though slots 2-4 are usually empty.** Forward-compat for when ops starts filling co-applicants.
5. **Filter empty-name share markers from buyer-match logic, display with "name not captured" label.** DLD strips seller names on resales; the markers still appear.
6. **ANY-MATCH > primary-priority** for multi-buyer × multi-applicant matching. No preference for primary-vs-primary.
7. **Patches start from v1.2.** v1.0 + v1.1 users do one last full reinstall before joining the patch stream.
8. **No --no-verify, no --no-gpg-sign** on git commits in this repo. If hooks fail, fix the underlying issue.
9. **Test runner spawns Electron with `ELECTRON_RUN_AS_NODE=1` via `scripts/run-tests.js`.** Don't change — many transitive deps need the Electron binary's bundled Node.
10. **Sanity-audit pass before every release.** `docs/v2.X-sanity-audit.md` files document deferred non-blockers per release.

---

## Epilogue

In roughly three weeks of focused development, DL-Processor went from a single-purpose `.xps` parser to a packaged Windows desktop app with hash-chained audit logs, Business-Process grouping, drift detection, learned buyer aliases, Tier-2 gates with required justifications, one-click Revert, Excel audit export, native renderer panes, and a patch-based update system that ships changes as ~5 MB zips instead of 78 MB installers.

The Registration team has a tool that does the work an Excel maze used to do, faster, with a real audit trail, and with a roadmap that points at SF/DLD API integration as the next transformative step. The story is mid-chapter, not finished.

**Next page:** v2.3.
