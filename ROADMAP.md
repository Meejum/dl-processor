# DL-Processor — Improvement Roadmap

**Approved by Ali 2026-05-12.** Strategic improvements organized into three horizons. Each version ships independently; no version blocks the one after.

## Cadence

1. **Now (v1.1 production phase)** — Use v1.1 with the registration team for 2-4 weeks. Capture friction. The notes below shape v1.2 priorities.
2. **After production validation** — v1.2 (designed; spec at `docs/superpowers/specs/2026-05-12-v1.2-bp-grouping-design.md`).
3. **Then** — v1.3 (DLD drift detection — completes the v1.1 deferral).
4. **Then** — v1.4 (audit + compliance hardening).
5. **Mid-2026** — Evaluate v2.x vs v3.0 against actual team adoption signals.

---

## Near horizon (v1.2 → v2.0, next ~4 weeks)

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

### v2.0 — Milestone: de-iframe + BP grouping + DLD drift *(bundled 2026-05-12, was v1.2.5 + v1.3 + v1.4)*

**Status:** spec'd + planned. Ready to dispatch tomorrow.

**Why bundled:** Three feature areas with shared architecture. De-iframe is the foundation; BP grouping needs native renderer DOM to work cleanly; DLD drift is an isolated backend refactor that completes v1.1's deferral. Shipping together as one milestone cuts release overhead and proves the v1.2 patch system end-to-end (v1.2.0 → v2.0.0 will be the first patch-distributed release).

**Three feature areas bundled:**
- **Feature A — De-iframe refactor.** Replace iframe-with-srcdoc pages (Review Pending, History) with native renderer-DOM panes. Tab-host becomes a `<div>`-pane controller. CSS moves to scoped selectors in `styles.css`. Same pattern as unit-history-panel / patch-modal which are already native.
- **Feature B — Business Process grouping.** All the v1.3 design captured earlier in 2026-05-12 spec, built natively from day 1 on top of Feature A. BP cards grouped by source_snapshot_id, classified by SF state, filterable by 8 dimensions. Migrations 006 (sf_booking columns) + 007 (audit_log.action CHECK widen).
- **Feature C — DLD drift detection.** Extract compare.js's picker functions into src/snapshot-extract.js. Make the 'dld' branch of compare-drift.js real (no longer a no-op stub).

**Plan:** `docs/superpowers/plans/2026-05-13-v2.0-milestone-plan.md` — 20 tasks across 5 phases. Test target 338 → ~390.

**Spec:** `docs/superpowers/specs/2026-05-13-v2.0-milestone-design.md`

**Estimate:** ~3 weeks subagent-driven execution.

---

### v1.3 — Business Process grouping ✅ FOLDED INTO v2.0 (above)

**What ships:**
- Replace per-field rows on Review Pending with collapsible Business Process cards
- Group `pending_change` rows by `source_snapshot_id` + unit (one card per BP event from the same compare run)
- Label by field-set pattern: Resale, Buyer correction, Price amendment, Status update, Procedure update, Area correction, Multi-field update
- SF state badge per card: READY / IN_PROGRESS / DLD_ISSUE / REJECTED / NO_SF_ROW (driven by `Status` + `dld_process_status`)
- Card-level Approve all / Reject all (gated by state) plus per-row Override/Approve/Reject in expanded view
- Full SF context inline: BP name, current step, assigned to, pre-reg status, DLD process status, dates, comments, procedure number
- Filter bar above cards: Project, Tower, BP type, SF state, Assigned to, Procedure #, Date range, free-text search
- `[Open in SF →]` deep link per card using `booking_record_id`
- Umbrella audit_log entries (`approve_bp` / `reject_bp` / `acknowledge_bp`) for queryable BP-level history
- **First version distributed AS A PATCH** to v1.2 users — proves the patch system works

**Why:** Real-world smoke-test of v1.1 revealed that one business event (resale) produces 3 separate pending rows at the same timestamp. Reviewing them as a fragmented list loses context and forces mental re-grouping. Also v1.1 doesn't surface SF workflow state — reviewers risk approving while a BP is still mid-process or has a DLD issue.

**Estimate:** ~2 weeks subagent-driven execution. 14 tasks across 4 phases. Test target ~340 → ~378.

**Spec:** `docs/superpowers/specs/2026-05-12-v1.3-bp-grouping-design.md`
**Plan:** `docs/superpowers/plans/2026-05-12-v1.3-bp-grouping.md`

---

### v1.4 — DLD drift detection

**Status:** deferred from v1.1 (scope reduction).

**What ships:**
- `detectDrift(db, projectId, currentSnapshotId, 'dld')` actually does work (today it's a documented no-op stub)
- Extract `compare.js`'s picker functions (`pickLatestPurchase`, `findLatestNonBankParty`, etc.) into a reusable module `src/snapshot-extract.js`
- Both compare's MISMATCH path AND drift detection consume the new extractor
- Adds DLD-side drift logging at parity with SF (Drift log tab populates from both sides)

**Why:** v1.1 ships SF drift only because DLD's snapshot schema stores operational values across `dld_transaction` + `dld_unit` rather than as flat columns, requiring extractor refactor that was too large for the v1.1 scope. v1.3 closes the loop.

**Estimate:** ~3-4 days. Test target +~10.

**Dependencies:** None — independent of v1.2.

---

### v1.5 — Audit & compliance hardening *(formerly v1.4)*

**Status:** not yet designed.

**What ships:**
- **One-click Revert** on global History page rows — undoes an approval, restores prior value, writes audit_log entry with `action='revert'`
- **"Approved by" stamp** — every audit_log entry gets a `user` column populated from local OS user or a Settings preference
- **Cryptographic chain** on audit_log — each row's hash includes previous row's hash, making the log tamper-evident (anyone modifying past rows breaks the chain)
- **Tier-2 approval gates** — price changes >X% threshold OR area changes >Y% threshold require manager re-approval (configurable threshold in Settings)
- **Compliance-grade audit reports** — Excel export with all the columns needed for monthly compliance review (who approved what, when, with what old/new value, with what BP context)

**Why:** Compliance teams will eventually want to audit the auditor. Cryptographic chain plus per-row user attribution makes the audit_log defensible in legal/regulatory contexts. Revert is needed because approvals will sometimes be wrong and there's no escape hatch in v1.1.

**Estimate:** ~1 week.

**Dependencies:** None.

---

## Mid horizon (v2.0, 2-3 months out)

### v2.0 — Workflow automation

**Status:** not yet designed.

**What ships:**
- **Bulk operations** — filter the queue, then "approve all 23 buyer corrections in project ONE" in one click
- **Custom rules engine** — declarative: `if change_type='BUYER_MISMATCH' AND alias_exists THEN auto_approve`. Rules stored in a new `automation_rule` table, applied during compare.
- **Smart anomaly flags** — anything with price delta >X% or area delta >Y% gets a 🚨 badge that requires manager sign-off (different from Tier-2 gate in v1.4 — anomaly flag is a visible badge, gate is a workflow block)
- **Cross-month trending** — dashboard tile: "Project X has 23 pending changes this month vs avg 8 over last 6 months" — alerts when a project shows unusual activity
- **Pre-compare report** — preview what compare would produce BEFORE writing it, so users can review the queue size before committing to a multi-hour review

**Why:** v1.1 cuts review time by ~30% over the legacy CSV workflow (estimated). v2.0 cuts another ~40% on top of that by removing the most common per-row actions and surfacing what's actually anomalous.

**Estimate:** ~3 weeks.

**Dependencies:** v1.2 (BP grouping makes bulk-action UI tractable).

---

### v2.1 — Reporting & exports

**What ships:**
- Excel-format monthly audit reports (one click, all the columns compliance wants)
- Print-friendly per-project summary views (one-page A4 layouts)
- Scheduled weekly summary email (via Outlook integration on Windows)
- "Take me to this unit" deep link in emails

**Estimate:** ~1 week.

**Dependencies:** v1.4 (compliance schema additions).

---

### v2.2 — Code signing + cross-platform

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

**Dependencies:** v2.0 (workflow automation engine is the consumer of webhook events).

---

### v3.1 — Cloud sync + multi-user

**What ships:**
- Move from local SQLite to managed Postgres (AWS RDS / Azure Database)
- Multi-user concurrent editing with audit-log conflict detection
- Web app version (no install — opens in browser; Electron app becomes optional)
- Useful for handoffs across the registration team

**Estimate:** Major architecture work — ~6-8 weeks.

**Dependencies:** v1.4 (audit hardening) — multi-user without strong audit is unsafe.

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

To pick up any item: open a new session, say **"resume dl area"**, and reference the version (e.g., "start v1.2" or "design v1.4"). The memory note + this roadmap + the spec/plan files in `docs/superpowers/` carry full context.
