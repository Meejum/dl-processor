# DL-Processor — Improvement Roadmap

**Approved by Ali 2026-05-12.** Strategic improvements organized into three horizons. Each version ships independently; no version blocks the one after.

## Cadence

1. **Done** — v1.2 (patch-based updates) and v2.0 (de-iframe + BP grouping + DLD drift) shipped on 2026-05-12. v1.3 and v1.4 were folded into v2.0.
2. **Now (v2.0 production phase)** — Use v2.0 with the registration team for 2-4 weeks. Capture friction. The notes below shape v2.1 priorities.
3. **Next milestone** — v2.1 (audit + compliance hardening).
4. **Mid-2026** — Evaluate v2.x vs v3.0 against actual team adoption signals.

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

### v2.1 — Audit & compliance hardening *(formerly v1.4 / v1.5)*

**Status:** spec'd 2026-05-13. Ready to execute.

**What ships (all 5 items per brainstorming session):**
- **One-click Revert** on global History page rows — Cmd-Z model: restores `master_data` to the audit row's `old_value`, writes new audit_log entry `action='revert'`. Only `approve` / `override` / `approve_bp` / prior `revert` entries are revertable.
- **"Approved by" user attribution** — new `audit_log.user` column. Source: Settings field if set, else OS user (`os.userInfo().username`). Forward-only.
- **Cryptographic chain on audit_log** — new `prev_hash` + `row_hash` columns. Migration 008 backfills hashes for existing rows in `(ts, audit_id)` order; v2.1 onward chains forward at every `writeAuditLog`. SHA-256. Tamper-evident.
- **Tier-2 approval gates** — Settings thresholds (default: price >10% delta OR >50K AED absolute; area >5% delta). When approval crosses threshold, required-justification modal fires before commit; text stored in `audit_log.user_note`, `tier2=1` flag set. No password block (single-user reality).
- **Excel audit export** — "Export Excel" button on the History page next to the existing CSV export. Honors current filters. xlsx output with v2.1 columns added (user, tier2, justification, row_hash).

**Why:** Compliance teams will eventually audit the auditor. Cryptographic chain + per-row user attribution makes the audit_log defensible. Revert is needed because approvals will sometimes be wrong and there's no escape hatch in v1.1/v2.0.

**Estimate:** ~1 week.

**Spec:** `docs/superpowers/specs/2026-05-13-v2.1-audit-hardening-design.md`

**Dependencies:** None.

---

### v2.2 — Native project dashboard *(new 2026-05-13, was implicitly part of v2.0 de-iframe)*

**Status:** not yet designed.

**What ships:**
- Replace the `output/compare/*.html` and `output/dashboard.html` files (generated by `cmdCompare`, opened via `url`-mode iframe today) with NATIVE renderer-DOM panes
- Backend query API returns per-project unit data as JSON (instead of writing HTML)
- Native renderer module (similar to bp-card.js) builds the project dashboard from JSON
- Interactive elements: click unit → open per-unit history side panel; click procedure number → jump to filtered History/Review Pending; live filtering + sorting on the unit table; native filter chips
- CLI path stays — `compare` from terminal still writes HTML files for offline viewing

**Why:** v2.0's de-iframe refactor handled all srcdoc iframes but left the url-mode iframes pointing at file:// URLs. Ali wants those native too — full in-app experience, no static HTML opened in browser.

**Estimate:** ~1.5 weeks. Needs its own brainstorming session before execution.

**Dependencies:** v2.1 (use the audit_log query patterns; not strict).

---

## Mid horizon (v2.3 → v2.5, 2-3 months out)

### v2.3 — Workflow automation *(formerly v2.2)*

**Status:** not yet designed.

**What ships:**
- **Bulk operations** — filter the queue, then "approve all 23 buyer corrections in project ONE" in one click
- **Custom rules engine** — declarative: `if change_type='BUYER_MISMATCH' AND alias_exists THEN auto_approve`. Rules stored in a new `automation_rule` table, applied during compare.
- **Smart anomaly flags** — anything with price delta >X% or area delta >Y% gets a 🚨 badge that requires manager sign-off (different from Tier-2 gate in v2.1 — anomaly flag is a visible badge, gate is a workflow block)
- **Cross-month trending** — dashboard tile: "Project X has 23 pending changes this month vs avg 8 over last 6 months" — alerts when a project shows unusual activity
- **Pre-compare report** — preview what compare would produce BEFORE writing it, so users can review the queue size before committing to a multi-hour review

**Why:** v1.1 cut review time by ~30% over the legacy CSV workflow. v2.0 cut another ~40% on top of that by removing per-row friction (BP cards). v2.2 takes the next bite by removing the most common bulk actions and surfacing what's actually anomalous.

**Estimate:** ~3 weeks.

**Dependencies:** v2.0 (BP grouping makes bulk-action UI tractable). ✅ met.

---

### v2.4 — Reporting & exports *(formerly v2.1, then v2.3)*

**What ships:**
- Excel-format monthly audit reports (one click, all the columns compliance wants)
- Print-friendly per-project summary views (one-page A4 layouts)
- Scheduled weekly summary email (via Outlook integration on Windows)
- "Take me to this unit" deep link in emails

**Estimate:** ~1 week.

**Dependencies:** v2.1 (compliance schema additions).

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

**Dependencies:** v2.1 (audit hardening) — multi-user without strong audit is unsafe.

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
