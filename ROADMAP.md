# DL-Processor — Improvement Roadmap

**Approved by Ali 2026-05-12. Last updated 2026-05-19 (v2.3 ship).** Strategic improvements organized into three horizons. Each version ships independently; no version blocks the one after.

## Cadence

1. **Done** — v1.2 (patch-based updates), v2.0 (de-iframe + BP grouping + DLD drift) on 2026-05-12, v2.1 (audit hardening) on 2026-05-13, v2.2 (native project dashboard) on 2026-05-15, and v2.3 (workflow automation) on 2026-05-19. v1.3 and v1.4 were folded into v2.0.
2. **Now (v2.3 production phase)** — Use v2.3 with the registration team for 2-4 weeks. Capture friction on the rules editor, anomaly badges, bulk operations, the trending tile, and the pre-apply dry-run modal.
3. **Next milestone** — v2.4 (reporting & exports: Excel monthly audit, print-friendly A4 layouts, scheduled weekly email).
4. **Planning process (from 2026-05-19)** — Every new spec uses the template at `docs/superpowers/spec-template.md`, runs a pre-spec exploration agent committed to `docs/superpowers/explorations/`, and passes the `docs/superpowers/spec-checklist.md` gate before graduating to plan-writing. Planning gaps are logged in `docs/superpowers/planning-mistakes-log.md`. Forward-only; existing specs (v0.4 → v2.3) are not retrofitted. v2.3 was the first implementation plan to run end-to-end through the new process.
5. **Mid-2026** — Evaluate v2.x vs v3.0 against actual team adoption signals.

---

## Near horizon (v1.2 → v2.1, recent + next ~4 weeks)

### v1.2 — Patch-based updates ✅ SHIPPED 2026-05-12

**Status:** spec'd, in progress.

**What ships:**
- App accepts patch zips (`dlp-patch-vA-to-vB.zip`) via a native **Apply update** sidebar action — no iframe, no HTML page, just a renderer-DOM modal matching the v1.1 unit-history-panel pattern
- Build script `scripts/build-patch.js` produces patch zips from `npm run dist` output (~5-15 MB instead of full 78 MB installer)
- File swap happens at next launch via a bundled `patch-apply.cmd` helper (waits for app quit, swaps `app.asar`, relaunches)
- Manifest carries `from_version_min`, `to_version`, `asar_sha256`, `app_id` for safe verification
- Automatic rollback on swap failure; manual **Revert last patch** action in case the new version misbehaves
- First patch-capable version is v1.2.0 itself; v1.1.0 users do one last full reinstall

**Why:** v1.1 ships as a 78 MB installer per release. For a team running monthly cycles with multiple users, that's expensive to redistribute and high-friction to install. Patch updates cut the per-release size by ~5-15× and let team members update through the app instead of running an installer.

**Estimate:** ~1 week (10 tasks). Test target 322 → ~340.

**Spec:** `docs/superpowers/specs/2026-05-12-v1.2-patch-update-design.md`

---

### v2.0 — Milestone: de-iframe + BP grouping + DLD drift ✅ SHIPPED 2026-05-12 *(bundled, was v1.2.5 + v1.3 + v1.4)*

**Status:** shipped. First patch-distributed release (v1.2.0 → v2.0.0 zip patch).

**Why bundled:** Three feature areas with shared architecture. De-iframe is the foundation; BP grouping needs native renderer DOM to work cleanly; DLD drift is an isolated backend refactor that completes v1.1's deferral. Shipping together as one milestone cut release overhead and proved the v1.2 patch system end-to-end.

#### What v2.0 delivered

- **Feature A — De-iframe refactor.** Every in-app page (Review Pending, History, Status, Projects, Apply pending) now renders as a native renderer-DOM pane. The tab-host gained a `render` mode alongside the existing `url` mode (still used for the output Dashboard). Same pattern as v1.1's unit-history-panel / patch-modal.
- **Feature B — Business Process grouping.** Review Pending's Needs review tab shows BP cards grouped by `(source_snapshot_id, project_id, unit_number_norm)`, with BP-type labels (`src/bp-classifier.js`), SF state badges (`src/sf-state.js`), full SF context strip, 8-dimension filter bar, and umbrella `approve_bp` / `reject_bp` / `acknowledge_bp` audit_log entries. Migrations 006 (adds `current_step_assigned_name` + `comments` to `sf_booking`) + 007 (widens `audit_log.action` CHECK).
- **Feature C — DLD drift detection.** Picker functions extracted into `src/snapshot-extract.js`. The `'dld'` branch of `compare-drift.js` is now real — writes `DLD_DRIFT` rows to `pending_change` and `auto_apply` rows to `audit_log` for any unit whose operational fields changed between two consecutive `dld_snapshot`s.

**Test count:** 338 → **390**.

**Plan:** `docs/superpowers/plans/2026-05-13-v2.0-milestone-plan.md` — 20 tasks across 5 phases.
**Spec:** `docs/superpowers/specs/2026-05-13-v2.0-milestone-design.md`

> Previously planned v1.3 (BP grouping standalone) and v1.4 (DLD drift standalone) have been folded into v2.0 above. The next milestone is v2.1.

---

### v2.1 — Audit & compliance hardening ✅ SHIPPED 2026-05-13 *(formerly v1.4 / v1.5)*

**Status:** shipped as a patch on top of v2.0.0.

#### What v2.1 delivered

- **One-click Revert** on global History page rows — Cmd-Z model. Restores `master_data` to the audit row's `old_value` and appends a new `audit_log` entry with `action='revert'`. Button gated on `REVERTABLE_ACTIONS` (`approve` / `override` / `approve_bp` / `revert`) AND `table_name='master_data'`. Non-revertable actions (`auto_apply`, `reject`, `learn_alias`, `acknowledge_bp`) get no button.
- **User attribution** — new `audit_log.user` column. Populated from the Settings field "Your name (audit attribution)" if set, else `os.userInfo().username`. Forward-only — pre-v2.1 rows stay NULL.
- **Cryptographic chain on `audit_log`** — new `prev_hash` + `row_hash` columns. SHA-256 of `(prev_hash || canonicalize(row_content))`. Migration 008 backfills existing rows in `(ts, audit_id)` order; from v2.1 onward every `writeAuditLog` chains forward. Tamper-evident.
- **Tier-2 approval gates** — Settings thresholds (defaults: price > 10% delta OR > 50K AED absolute; area > 5% delta). Required-justification modal (min 10 chars) fires before commit; text stored in `audit_log.user_note`, row flagged `tier2=1`. BP-card `Approve all` shows ONE combined modal with all tier-2 rows + shared justification. Backend re-validates thresholds (defense in depth). Strict greater-than — boundary cases (exactly 10% / 50K) do NOT trip.
- **Excel audit export** — `[Export Excel]` button on History page next to `[Export CSV]`. Honours current filters. 12 columns (Timestamp / User / Project / Unit / Field / Old value / New value / Action / Source / Tier-2 / Justification / Row hash). Uses existing `xlsx` dep.

#### Schema

Migration 008 (`2026-05-13-008-audit-hardening`) — one idempotent pass:
- Adds 4 nullable columns to `audit_log`: `user`, `tier2`, `prev_hash`, `row_hash`
- Widens `audit_log.action` CHECK to include `'revert'`
- Backfills hashes for existing rows from genesis (`'0' x 64`)

#### Settings additions

- "Your name (audit attribution)" — text, falls back to OS username
- "Tier-2 price threshold (%)" — number, default 10
- "Tier-2 price threshold (AED)" — number, default 50000
- "Tier-2 area threshold (%)" — number, default 5

#### Bonus polish

The right-side log column now starts hidden by default; the 📋 toggle in the top bar still shows it on demand.

**Test count:** 390 → **422**.

**Spec:** `docs/superpowers/specs/2026-05-13-v2.1-audit-hardening-design.md`

> Next up: v2.2 (native project dashboard).

---

### v2.2 — Native project dashboard ✅ SHIPPED 2026-05-15

**Status:** shipped as a patch on top of v2.1.0.

#### What v2.2 delivered

- **Native Dashboard tab.** `output/dashboard.html` iframe replaced by `electron/renderer/dashboard-page.js`. Projects render as cards with source badge, total units, status mini-chips, `PENDING N →` deep-link chip, and import dates. Portfolio totals strip across the top; search filters by name; refresh re-runs the query.
- **Native Project Compare tab.** `output/compare/<slug>.compare.html` iframe replaced by `electron/renderer/project-compare-page.js`. Same 23 columns; adds filter chips with live counts, free-text search, click-to-sort headers, row → per-unit history side panel, DLD#/SF# cell → native popup, procedure chip → History deep-link, PENDING flag chip → Review Pending deep-link, refresh button.
- **Backend query API.** New `src/commands/compare-query.js` (`getProjectsSummary`, `getProjectCompare`) reuses `compareProject()` + `summarize()`. IPC: `dlp:compare:summary`, `dlp:compare:project`. Preload: `window.dlp.compare.summary()` / `.project(id)`.
- **`dlp:open-review-pending` event.** Mirrors `dlp:open-history` from v1.1; `__renderReviewPendingPage` now accepts initial filters from event detail.
- **Static HTML retained.** CLI `compare` still writes both HTML files unchanged for offline distribution. `src/html-styles.js` untouched; renderer rules mirrored in `electron/renderer/styles.css`.

**Test count:** 422 → **428**.

**Spec:** `docs/superpowers/specs/2026-05-14-v2.2-native-project-dashboard-design.md`
**Plan:** `docs/superpowers/plans/2026-05-14-v2.2-native-project-dashboard.md`

> Next up: v2.3 (workflow automation).

---

## Mid horizon (v2.3 → v2.5, 2-3 months out)

### v2.3 — Workflow automation ✅ SHIPPED 2026-05-19

**Status:** shipped as a patch on top of v2.2.0. First release through the spec-process hardening flow ratified in v2.2 cleanup.

#### What v2.3 delivered

- **Custom rules engine.** `src/rule-engine.js` evaluates declarative WHEN/THEN rules (AND/OR predicates depth ≤ 3, 8 operators, 13-field allowlist, two-pass evaluation per spec § 3.2). `src/rule-loader.js` reads rules from the new `automation_rule` table, validates JSON, and silently disables (with audit) any rule whose schema fails. Four built-ins (R-1000 alias auto-approve, R-1001 large-price flag, R-1002 large-area flag, R-1003 cancelled-BP auto-acknowledge) ship enabled by default with `builtin=1`. `src/auto-approve.js` collapses to a thin wrapper that delegates to the engine with R-1000.
- **Anomaly badges.** `pending_change.anomaly` (new nullable JSON column) records `{ severity, reasons[] }` written by every matching `flag_anomaly` rule. Review Pending gains a sortable Flags column (🚨 high / ⚠️ warn), a 9th `Flagged` filter, and a side-panel anomaly section with `rule_id` deep-links. Distinct axis from v2.1 Tier-2 — a row can be auto-approved AND carry an anomaly.
- **Bulk operations.** `src/commands/bulk.js` exposes `bulkApprove` / `bulkReject` with chunked transactions (50 rows/chunk), partial-commit on chunk failure, UUID v4 batch id in `audit_log.user_note`, and shared-justification handling for Tier-2 rows in the selection. Review Pending and BP cards both gain selection UI + bulk toolbars.
- **Cross-month trending tile.** `src/trending.js` `getTrendingProjects` buckets `pending_change` by month, computes the trailing 6-month average excluding current, and filters by `minBaseline` (default 5) + `ratioThreshold` (default 2.0). New native Dashboard tile renders one row per project meeting the threshold; empty state hides the tile.
- **Pre-compare dry-run.** `node . compare --dry-run [--source=dld|sf|both] [--format=text|json]` wraps the compare body in `SAVEPOINT dry … ROLLBACK TO dry` — runs the same code path, persists nothing. Desktop app fires it before the first Apply on a fresh snapshot and shows a totals modal with `[Continue]` / `[Cancel]`.
- **Sidebar entry `🤖 Automation`** opens the rules editor page (list view, inline clause-builder editor, per-rule History deep-link).
- **Settings** add four fields: trending min baseline, trending ratio threshold, rules warn-before-disable, bulk confirmation threshold.

#### Schema

Migration 009 (`2026-05-18-009-automation`) — one idempotent pass:
- Creates `automation_rule` (id, name, enabled, priority, when_json, then_json, builtin, created_at, created_by, applied_count, revert_count) + a priority index
- Adds nullable `pending_change.anomaly` (TEXT, JSON)
- Widens `audit_log.source` CHECK from 5 to 7 values (adds `rule_fired`, `bulk_op`) via the migration 005 rebuild idiom — SQLite CHECK can't use LIKE so rule-id / batch-uuid context lives in `user_note`. Application-layer `validateAuditSource` + `auditSourceFor` (in `src/audit-log.js`) backstop the widened CHECK.
- Seeds 4 built-in rules with `INSERT OR IGNORE` on id

#### Descoped (planned in advance via Realism Check)

The rules-editor inline clause-builder was descoped to a JSON-textarea fallback (still passes through the loader's `validatePredicate` / `validateThen` on save) per spec § 9 Realism Check #3. The visual editor lands in v2.4.

**Test count:** 428 → **522**.

**Spec:** `docs/superpowers/specs/2026-05-18-v2.3-workflow-automation-design.md`
**Plan:** `docs/superpowers/plans/2026-05-19-v2.3-workflow-automation.md`

> Next up: v2.4 (reporting & exports).

---

### v2.4 — Reporting & exports *(formerly v2.1, then v2.3)*

**What ships:**
- Excel-format monthly audit reports (one click, all the columns compliance wants)
- Print-friendly per-project summary views (one-page A4 layouts)
- Scheduled weekly summary email (via Outlook integration on Windows)
- "Take me to this unit" deep link in emails

**Estimate:** ~1 week.

**Dependencies:** v2.1 (compliance schema additions). ✅ met.

---

### v2.5 — Code signing + cross-platform *(formerly v2.2, then v2.4)*

**What ships:**
- Buy code-signing certificate (~AED 1,000/year)
- All future `.exe` builds are Authenticode-signed → SmartScreen warning disappears → IT trusts the binary
- Add macOS and Linux builds via `electron-builder` (already supports them — just toggle the target flags)
- Document the install path for each OS in README

**Estimate:** ~3 days (most of that is procurement / IT coordination for the cert).

**Dependencies:** None.

---

## Far horizon (v3.0, 6+ months out — transformative)

### v3.0 — Direct integrations

**What ships:**
- Salesforce REST API integration — DL-Processor pulls SF data directly via OAuth instead of `.xlsx` re-imports
- DLD API integration if available (Sobha's data partnership with DLD might already support this)
- Webhook outbound: when a BP changes state in DL-Processor, notify Slack/Teams/email
- Eliminates the entire "export → save → import" cycle every month

**Why:** Biggest workflow improvement possible — removes the most error-prone manual step (file movement). Also unlocks near-real-time reconciliation instead of monthly batches.

**Estimate:** ~3-4 weeks. Most of that is OAuth + permission grants from Sobha IT + DLD.

**Dependencies:** v2.2 (workflow automation engine is the consumer of webhook events).

---

### v3.1 — Cloud sync + multi-user

**What ships:**
- Move from local SQLite to managed Postgres (AWS RDS / Azure Database)
- Multi-user concurrent editing with audit-log conflict detection
- Web app version (no install — opens in browser; Electron app becomes optional)
- Useful for handoffs across the registration team

**Estimate:** Major architecture work — ~6-8 weeks.

**Dependencies:** v2.1 (audit hardening) — multi-user without strong audit is unsafe. ✅ met.

---

### v3.2 — Machine learning assist

**What ships (optional, evaluate then decide)**:
- Buyer-name similarity beyond Levenshtein (sentence-transformer embeddings — "Mr. Mohammad Hassan" vs "Mohamed Hassan" similarity score)
- Duplicate detection across units (same buyer + similar amounts within a month = potential double-booking)
- Predict next-month anomalies based on prior patterns (statistical, not deep ML)

**Why:** Reduces remaining false-positive volume that alias-learning + heuristics can't catch. Only valuable if the false-positive volume justifies the maintenance burden.

**Estimate:** ~2-3 weeks.

**Dependencies:** v2.0 (need solid baseline before adding ML on top).

---

## Things deliberately deferred indefinitely

These sound useful but the maintenance burden vs. real workflow gain doesn't justify them unless real demand surfaces:

- **Mobile companion app** — read-only history viewer on phone. Limited use case; web app version (v3.1) covers it.
- **Browser extension** — deep-link from Salesforce UI into DL-Processor. Niche unless someone actually asks for it.
- **Plugin system** — let other devs add features. Premature until DL-Processor is stable and has demand from outside the registration team.
- **Localization (Arabic UI)** — Sobha's registration team is bilingual; English UI is fine. Revisit only if the team grows or expands to non-bilingual staff.

---

## Resumption phrase

To pick up any item: open a new session, say **"resume dl area"**, and reference the version (e.g., "start v2.1" or "design v2.2"). The memory note + this roadmap + the spec/plan files in `docs/superpowers/` carry full context.
