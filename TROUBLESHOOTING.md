# DL-Processor — Troubleshooting & Debug Solutions

Everything we know goes wrong, why, and how to fix it. Sections are grouped by **where** the problem shows up (install, app launch, data flow, build) — find your symptom, follow the steps.

Companions: [README.md](README.md) for normal usage, [BUILDING.md](BUILDING.md) for development environment setup.

---

## Table of contents

- [Installation problems](#installation-problems)
- [App-launch problems](#app-launch-problems)
- [Data-flow problems](#data-flow-problems)
- [UI problems](#ui-problems)
- [Patch update problems (v1.2+)](#patch-update-problems-v12)
- [v2.0 BP grouping problems](#v20-bp-grouping-problems)
- [v2.1 audit hardening problems](#v21-audit-hardening-problems)
- [Build problems (developers)](#build-problems-developers)
- [Test problems (developers)](#test-problems-developers)
- [Diagnostic procedures](#diagnostic-procedures)
- [Where logs live](#where-logs-live)
- [Recovery procedures](#recovery-procedures)

---

## Installation problems

### "Windows protected your PC" / SmartScreen blocks the installer

**Cause:** The `.exe` is unsigned (no Authenticode certificate). Windows defaults to blocking unsigned installers from unknown publishers.

**Fix:**
1. On the SmartScreen dialog, click **More info**.
2. A new **Run anyway** button appears — click it.
3. Installation proceeds normally.

Each install needs the same dance until we buy a code-signing certificate (~AED 1,000/year). The certificate would eliminate the warning entirely.

---

### Installer asks "Remove data files?" during uninstall

**Default answer: NO.** Saying *No* preserves `Desktop\DL-Processor\` with all imported DLD/SF data, the SQLite DB, decisions history, and audit log. You can reinstall the same or a newer version and pick up exactly where you left off.

Say *Yes* only when you genuinely want a fresh start. There's no recovery beyond an Export DB zip backup you made earlier.

---

### After upgrading from an older version, the app shows errors on every action

**Symptom:** Errors pane fills with things like `SqliteError: no such column: change_type` for every command.

**Cause:** A v1.1.0 build older than commit `2d692bb` ran `schema.sql` before migrations. Older DBs failed schema.sql's index creation on a column migrations hadn't added yet.

**Fix:** Reinstall the current `DL-Processor Setup 1.1.0.exe` (commit `2d692bb` or later). The new `openDb()` runs migrations first; upgrades work in place. No data loss.

---

### Installer says "another version is already installed"

**Cause:** Windows tracks installs by app ID. Two NSIS installers with the same `appId: ae.sobha.dl-processor` collide.

**Fix:** Uninstall via Settings → Apps → DL-Processor → Uninstall (say *No* to remove-data unless you mean it). Then run the new installer.

---

## App-launch problems

### App launches to a blank window

**Likely causes (in order of frequency):**

1. **Renderer JS crashed before page rendered.** Press `Ctrl+Shift+I` to open DevTools → Console. Look for the first red error — that's usually the cause.
2. **Schema migration is hanging.** Should never take >2 seconds. If it does, the SQLite DB at `Desktop\DL-Processor\data\dld-sync.sqlite` may be locked by another process. Close any external SQLite viewers and relaunch.
3. **Wizard hidden.** v1.0 had a first-run wizard that v1.1 always skips. If somehow shown but invisible, delete `%APPDATA%\dl-processor\config.json` and relaunch — the app will recreate it with sensible defaults.

To force-open DevTools every launch: set environment variable `DLP_DEVTOOLS=1` before starting.

---

### Top-bar project dropdown is empty (only shows "All projects")

**Cause A — fresh install, no data:** Expected. The dropdown lists projects seen in either DLD imports OR Salesforce imports. Import something via `📥 Import DLD` or `📥 Import Salesforce` first.

**Cause B — DB upgrade failed:** Open DevTools (`Ctrl+Shift+I`). If you see `SqliteError: no such column: change_type` in the Errors pane, you're on an old broken build. See [the upgrade section above](#after-upgrading-from-an-older-version-the-app-shows-errors-on-every-action).

**Cause C — IPC handler error:** The renderer's `[top-bar] refreshProjects failed` line in the Errors pane will show the exact error. Common ones:
- `projects spawn failed: ENOENT` — `process.execPath` couldn't be resolved. Means a broken install — reinstall.
- `projects JSON parse failed` — something else (banner, stderr) leaked into stdout. File a bug with the exact `stdout=...` from the message.

---

### App crashes immediately on launch with `ERR_DLOPEN_FAILED`

**Symptom in logs:** `The module ... better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version of Node.js requires NODE_MODULE_VERSION Y`.

**Cause:** A native module ABI mismatch. The on-disk `better-sqlite3` binary was built for one runtime; you're running another.

**For end users:** Reinstall from the official `.exe`. The packaged build ships the matching binary.

**For developers running from source:**

```bash
# Match better-sqlite3 to Electron 28 (the runtime when start:electron / dist runs)
npm_config_runtime=electron \
npm_config_target=28.3.3 \
npm_config_disturl=https://electronjs.org/headers \
npm install better-sqlite3 --build-from-source=false
```

Or use the same script that `npm test` uses: `scripts/run-tests.js` calls Electron in Node mode (ELECTRON_RUN_AS_NODE=1) so the bundled Node 18 runtime (NODE_MODULE_VERSION 119) matches the on-disk binary. **Don't run `node --test` directly** — it'll use system Node and fail.

---

## Data-flow problems

### Compare produces `DLD_ONLY` for every unit

You imported DLD but not Salesforce. Click `🏢 Projects` → confirm projects exist. Click `📈 Status` → check `sf_booking` row count. If 0, import a Salesforce export via `📥 Import Salesforce`.

---

### Compare produces `SF_ONLY` for every unit

Inverse of the above — Salesforce imported, DLD didn't. Import DLD via `📥 Import DLD`.

---

### Import succeeds but the row count looks wrong

Open the data folder (top-bar shows the path; click to open). Look at the source file you imported:
- DLD `.xps` files contain ONE project per file. Multi-project imports must select multiple files.
- DLD `.csv` files are also single-project unless explicitly multi-project (rare).
- Salesforce `.xlsx` exports include ALL projects matching the export filter.

If you expected N projects and got M < N: re-export Salesforce with a wider filter, OR pick more `.xps` files in the multi-select picker.

---

### `BUYER_MISMATCH` queue is enormous

Every transliteration/whitespace/case difference between DLD and SF used to flag. v1.1 auto-normalizes (Mr./Mrs./Dr./Eng./Sheikh stripped, Al- prefix collapsed, common Arabic-Latin variants like Mohammad/Mohamed unified) so most should already match.

For genuine differences:
- Review one row that should match
- Click **🔗 Teach alias**
- Pick **Project only** (limit alias to this project) or **All projects** (global rule)
- Any sibling rows with the same name pair auto-approve in the same transaction

Each taught alias persists in `buyer_alias` forever; next month's compare will absorb it before flagging.

---

### `AREA` stat card shows 0 for every project

`manual_area` is empty — no staff-maintained SQM data yet. Fill area templates via the **📐 Area template** sidebar action: it produces CSVs in `output/Changes Template/` that you edit and re-import. Until then, area cross-check signals don't fire.

---

### `apply-areas` reports `applied 0; skipped N`

The `area_sqm` column in your CSV is blank, non-numeric, or non-positive. Re-export with `area-template` if the file got out of shape; existing `manual_area` rows are pre-populated on every generate so re-runs don't lose data.

---

### `Bad uncompressed size: …` stderr spam when importing SF xlsx

Harmless. The `xlsx` library emits this for files where Excel's stored zip lengths disagree with the actual compressed stream. The data extracts correctly anyway. Suppressed in `src/salesforce.js`.

---

### Drift log is empty after a re-import

Drift detection requires **at least two consecutive snapshots** for the same project to compare. If you imported once, ran compare, then imported again with changes — drift should populate after the second compare run.

v1.1 implemented **SF drift only**. **v2.0 adds DLD drift detection** — compares consecutive `dld_snapshot`s for the same `(project_id, unit_number_norm)` and writes `DLD_DRIFT` rows whenever operational fields changed silently between imports. See [DLD drift detection (v2.0)](#dld-drift-detection-v20) below for what to expect.

---

### DLD drift detection (v2.0)

**Drift log tab shows new entries after a re-import — is that expected?**

Yes. v2.0 added DLD drift detection. Any unit whose operational fields (buyer, price, area, status, procedure) changed in DLD between two consecutive compare runs writes a `DLD_DRIFT` entry to `pending_change` and an `auto_apply` row to `audit_log` (`source='compare'`). These are **informational only** — they don't require approval. Use the per-unit history side panel to see the trail.

The extractor (`src/snapshot-extract.js`) computes the operational field values per snapshot using the same `pickLatestPurchase` / `pickLatestMarketPrice` / `findLatestNonBankParty` logic that compare uses for MISMATCH detection — so what shows in Drift log is exactly what compare would have considered "current" for each snapshot.

---

### Review Pending → Approve doesn't actually change `master_data`

If the approve flow throws, the row stays in the queue and the Errors pane shows the SQLite error. Common cause: a row references a `project_id` that no longer exists in `dld_project` (e.g., you wiped DLD but kept pending rows). Either:
- Re-import the DLD project that owns those pending rows, OR
- Manually delete orphaned rows: `DELETE FROM pending_change WHERE project_id NOT IN (SELECT project_id FROM dld_project);`

---

## UI problems

### HTML report filters feel "sticky"

Header column filters + top search + stat-card click-filters all compose with AND. Hit the **Reset** button at the top of the table to clear all filters at once.

---

### Sidebar menu lost the collapse button after v1.1

Intentional. v1.1 removed the collapse-to-icons mode because the icon-only view hid the labels users wanted to read. Sidebar is now always full-width.

---

### `📜 History` sidebar entry shows "no entries"

Either:
- The DB was just upgraded and `audit_log` is still empty (audit_log gets populated by approve/reject/override/auto-apply events going forward; pre-v1.1 history isn't retroactively reconstructed)
- Filters are too narrow — try **Range: All time**, clear other filters, click **Apply**

---

### Import DB modal won't accept my old zip

Modal shows "No `meta.json` — Created: unknown". This is expected for zips built before v1.1 (which started embedding `meta.json`). You can still click **Confirm import**; the modal just can't pre-validate counts. After import the database opens normally.

---

### Per-unit history side panel doesn't open when I click a unit

Sometimes the click handler fails if `window.__openUnitHistoryPanel` hasn't loaded yet (race condition on first page render). Refresh the tab — the panel script always loads on `index.html` startup.

---

## Patch update problems (v1.2+)

### "This file is not a valid zip archive"

The file the user picked isn't a real zip. Common causes: someone renamed a `.exe` to `.zip`, the download was corrupted mid-transfer, or the file is actually an `.xlsx` / `.7z` / other format with a `.zip` extension.

**Fix:** Get a fresh copy from your admin. Verify the file size matches what was originally shared.

---

### "Patch zip is missing manifest.json"

The zip doesn't have a `manifest.json` at the top level. It was either built with the wrong tool (not `node scripts/build-patch.js`) or the zip was repackaged after the build.

**Fix:** Rebuild the patch via `node scripts/build-patch.js` from the original `dist-electron/win-unpacked/` output.

---

### "This patch is for a different application"

The manifest's `app_id` is not `ae.sobha.dl-processor`. Someone built a patch for a different app or modified the manifest.

**Fix:** Discard the file. Get a legitimate patch from your admin.

---

### "Your installed version is older than this patch supports"

`manifest.from_version_min` is greater than your installed version. The patch was built assuming a newer base.

**Fix:** Either:
- Install the latest full `.exe` installer first, then apply the patch.
- Or ask your admin to rebuild the patch with `--from <your-version>`.

---

### "Patch archive failed integrity check"

The `app.asar` SHA-256 in the zip doesn't match the manifest's stated hash. The zip was tampered with or corrupted during transfer.

**Fix:** Get a fresh copy. Compare the SHA-256 shown in the modal against what your admin posted alongside the zip.

---

### Apply succeeds but the app doesn't restart

The helper script `patch-apply.cmd` ran but `start "" "%APP_EXE%"` failed (path wrong, exe locked by anti-virus, etc.). The new `app.asar` is in place, just no relaunch happened.

**Fix:** Manually open the Start menu and launch DL-Processor. You'll see the new version. If launch fails too — `app.asar` may be corrupted; use the next section.

---

### Apply succeeds but the app won't launch after restart

The patched `app.asar` is broken (rare — but possible if the patch was built incorrectly).

**Fix:**
1. Open `%LOCALAPPDATA%\Programs\DL-Processor\resources\` in Explorer.
2. You should see `app.asar` (new, broken) and `app.asar.bak` (old, working).
3. Delete `app.asar`.
4. Rename `app.asar.bak` → `app.asar`.
5. Launch DL-Processor — should boot on the previous version.
6. Report the bad patch to your admin.

Alternatively, if the app DOES boot but misbehaves: open it and Settings → **Revert last patch** does the rename for you.

---

### "no .bak available — nothing to revert"

You clicked Revert but no `app.asar.bak` exists. Either this is a fresh install (no patches applied yet) or someone manually deleted the backup.

**Fix:** Nothing to revert. If the current app version is broken, reinstall from the latest full `.exe`.

---

### Helper script blocks during apply ("timed out waiting for PID to exit")

After 10 seconds the helper gave up waiting for the main app to quit. Likely cause: the app froze on quit (e.g., a long-running compare).

**Fix:** Force-quit DL-Processor via Task Manager. The helper script will then proceed with the swap.

If `app.asar.pending` still exists in `resources\`: you can manually swap it. Rename `app.asar` → `app.asar.bak` (if not already), then rename `app.asar.pending` → `app.asar`. Restart the app.

---

### How to verify a patch came from your admin

The modal shows the SHA-256 of the patch's `app.asar`. Your admin can post the same SHA-256 alongside the download link (e.g., in the email or shared-drive description). Compare them character-by-character before clicking Apply & Restart.

If they don't match: the patch was tampered with in transit. Don't apply it. Tell your admin.

---

## v2.0 BP grouping problems

### BP card shows "NO_SF_ROW"

No matching `sf_booking` row exists for the card's `(project, unit)`. Most likely your Salesforce import didn't include this unit, OR the `unit_number_norm` formatting differs between the DLD and SF sides (e.g., `W-101` vs `101`).

**Fix:**
1. Check `master_data` provenance for the unit — click the unit cell to open the per-unit history side panel.
2. If the unit really should be in SF, re-export the SF report with a wider filter that includes the missing unit, then re-import.
3. If the mismatch is normalization-side, check the project's `unitTransforms` / `buildingTransforms` in `config/project-mapping.json`.

---

### BP card label is "Multi-field update" when it should be "Resale"

The Resale classifier requires the field set to be **buyer + price + procedure** (with `status` optional). If your DLD import also changed `area_sqm`, that bumps the label to `Multi-field update` because the classifier no longer recognizes the pattern.

This is **by design** — a "true" resale doesn't typically change the unit's area. If area moved too, something else is going on (re-measurement, common-area reallocation) and the reviewer should look at it as a multi-field change.

If you genuinely want a different cutoff, see [BUILDING.md → BP classifier — how to extend](BUILDING.md#bp-classifier--how-to-extend).

---

### SF context strip shows "—" for Current Step / Assigned / Comments

Your SF `.xlsx` export doesn't include those columns. v2.0 reads three new headers that were added on `sf_booking`:

- `Current Step Name`
- `Current Step: Assigned Name`
- `Comments`

**Fix:** Open the "DLD -ALL" report definition in Salesforce, add the three columns, save, re-export, re-import. The cards will populate on the next render — no further action needed.

---

### State badge stays "IN_PROGRESS" even after the BP is complete in SF

`sf_booking.status` is read from the **most recent** SF import. If SF marked the BP completed AFTER your last SF re-import, DL-Processor won't know yet.

**Fix:** Re-export the latest SF report and re-import via `📥 Import Salesforce`. The badge updates on the next page open.

---

### `Approve all` is disabled even on a card that looks READY

Check the SF context strip carefully. If `dld_process_status` shows something like `Submitted to DLD`, the card is actually in `DLD_ISSUE` state — not `READY` — because the classifier prioritizes `DLD_ISSUE` over `READY` when both apply. The state badge color (orange) will confirm.

**Fix:** Resolve the DLD-side issue first (typically requires action in SF, not DL-Processor). Once `dld_process_status` clears, re-import SF and the card flips back to `READY`.

---

### Filter bar doesn't show my BP

The default filters on first open are **SF state ≠ REJECTED** and **Date range = Last 30 days**. Older pending changes need the date range expanded.

**Fix:** Open the date-range filter and pick `Last 90 days` / `All time`. Also check whether your unit is in a project hidden by the Project filter.

---

### `Open in SF →` copies the record ID instead of opening Salesforce

Known v2.0 limitation. The Sobha Salesforce instance URL pattern wasn't configured in v2.0. The button copies `booking_record_id` to your clipboard — paste it into your SF instance URL bar manually for now.

**Planned v2.1:** configurable SF base URL in Settings, so the button becomes a real deep link.

---

## v2.1 audit hardening problems

### Revert button doesn't appear on a row I just approved

The row's `action` must be in `approve` / `override` / `approve_bp` / `revert` AND its `table_name` must be `master_data`. The button is intentionally hidden for:

- **`auto_apply`** — drift logging. `master_data` wasn't actually changed by this row (the new value replaced an older value at compare time, but no user action queued it), so there's nothing to "revert".
- **`reject`** — no `master_data` change; reject just closed a `pending_change` row.
- **`learn_alias`** — different table (`buyer_alias`), not `master_data`.
- **`acknowledge_bp`** — no `master_data` change; only marks a REJECTED BP card as seen.

If you genuinely need to roll back an `auto_apply`, find the equivalent prior `approve` / `override` in History for the same `(project, unit, field)` and revert that one — or edit `master_data` manually plus add a corresponding `audit_log` row with `action='override'`.

---

### Revert button shows but click does nothing / says "Revert failed"

Most likely the unit no longer exists in `master_data`. Possible causes:

- A fresh DLD import path purged the row (rare — `master_data` rows generally survive imports).
- The `project_id` was wiped and re-seeded with a different ID.

Open DevTools (`Ctrl+Shift+I`) → Console for the exact error. Common ones:
- `SqliteError: no such (project_id, unit_number_norm)` — the row's target unit is gone. Re-import the project, then retry.
- `Action 'revert' is not allowed` — see [the migration 008 entry below](#action-revert-is-not-allowed-error-during-revert).

---

### My name doesn't show in the audit log

Open `⚙ Settings` → **"Your name (audit attribution)"** → type your name or email → Save. New audit entries from that point onward are stamped in `audit_log.user`.

**Existing entries from before you set the name stay NULL** — attribution is forward-only. There's no backfill (and shouldn't be — you can't retroactively claim an approval you didn't make).

If the field is set but the column is still NULL on new entries:
- Open DevTools → check the renderer console for `[settings] save failed`.
- Verify `%APPDATA%\dl-processor\config.json` contains `audit_user` after Save.
- Restart the app — settings are read on launch.

---

### Tier-2 modal doesn't fire for a big change

Check Settings thresholds. Defaults: price > 10% OR > 50K AED; area > 5%. The comparison is **strict greater-than** — if the change is exactly 10% or exactly 50K AED, the modal does NOT fire.

This is deliberate (round-number price amendments are common and shouldn't always be tier-2), but if you want to catch boundary cases lower the threshold slightly (e.g., `9.99` instead of `10`).

Other reasons the modal might not fire:
- The field isn't tier-2-eligible. Only `purchase_price_aed` and `area_sqm` are magnitude-gated. `buyer_name`, `status`, `procedure_number` never trip tier-2.
- `oldValue` or `newValue` isn't a finite number — the helper returns `false` on non-numeric inputs.

---

### Tier-2 modal fires for changes I expect to be normal

Either lower the threshold (no — that fires more) OR **raise** it. Open `⚙ Settings` and bump:

- **Tier-2 price threshold (%)** — try `25` if `10` is too sensitive for your market.
- **Tier-2 price threshold (AED)** — try `100000` if `50000` is too low.
- **Tier-2 area threshold (%)** — try `10` if `5` flags routine re-measurement noise.

The thresholds apply per-dimension with OR semantics on price (pct OR abs), so loosening one without the other still leaves the gate active on the other.

---

### Excel export downloads but is empty

Filters are excluding everything. Open `📜 History` → click **Reset** (or manually clear every filter) → try **Export Excel** again.

Common over-filter combinations:
- `Action = revert` on a DB that has no revert entries yet.
- `Date range = Today` when you want this month.
- `Project = <X>` plus `Unit = <Y>` where the combo doesn't exist.

The export honours the **currently filtered set**, not "everything" — by design, so you can scope a compliance request precisely.

---

### "Action 'revert' is not allowed" error during revert

Migration 008 didn't run. The `audit_log.action` CHECK constraint still has the v2.0 set (`approve`, `override`, `reject`, `auto_apply`, `learn_alias`, `approve_bp`, `reject_bp`, `acknowledge_bp`) — `revert` isn't accepted yet.

**Force the migration:**

1. Close the app.
2. Reinstall the current `DL-Processor Setup` `.exe` (or re-apply the v2.0 → v2.1 patch). On launch, the migration framework retries any un-applied migrations.

If reinstall doesn't help, inspect the CHECK directly:

```sql
SELECT sql FROM sqlite_master WHERE name = 'audit_log';
```

The `action` CHECK should include `'revert'`. If it doesn't, migration 008 is missing from `schema_migration`. See the next entry to force a rerun.

---

### Old audit rows have no `row_hash`

Backfill failed (rare — the migration is one transaction, so a partial state is unusual). Force a rerun:

```sql
DELETE FROM schema_migration WHERE id = '2026-05-13-008-audit-hardening';
```

Close + reopen the app. Migration 008 is idempotent — it'll re-add any missing columns (no-op if they already exist) and backfill any rows still missing `row_hash` in `(ts, audit_id)` order from genesis (`'0' x 64`).

To verify the chain is now complete:

```sql
SELECT COUNT(*) FROM audit_log WHERE row_hash IS NULL;
-- Expected: 0
```

---

## v2.2 native dashboard problems

### Dashboard tab opens but shows no cards

The `dlp:compare:summary` IPC call returned an empty array. Common causes:

- `data/dl-processor.db` doesn't exist yet — open the app, run `Import DLD` and `Import SF` at least once.
- The database has projects but no `dld_snapshot` rows — projects need at least one snapshot before they show on the Dashboard (`status: 'no-dld-snapshot'`).
- Devtools check: open the renderer devtools console and run `await window.dlp.compare.summary()`. An empty array confirms the backend has no data; a thrown error points at the underlying IPC failure (DB locked, schema mismatch, etc.).

### Project Compare opens blank for a Salesforce-only project

Expected. Projects with `project_id = null` (no DLD mapping yet) have no DLD snapshot to compare against. The tab shows a "not available" inline message and falls back to opening the static `output/compare/<slug>.compare.html` if it exists. Add the project to `config/project-mapping.json` and re-run `compare` to bring it into the native tab.

### Buyer / applicant popup gets clipped behind the tab strip

Known z-index gotcha — the popup uses `position: fixed` with a high z-index, but a sufficiently deep custom DPI / zoom setting can still clip it. Workaround: scroll the row up so the popup opens below the chip instead of above. File an issue with your screen resolution + Windows scaling % so we can reproduce.

### Procedure or PENDING chip click does nothing

Both chips dispatch custom events (`dlp:open-history` / `dlp:open-review-pending`) that the main app listens for in `electron/renderer/app.js`. If clicks are dead:

- Confirm you're on v2.2+ (check `Help → About` or `package.json`).
- Open devtools and watch the Console — a thrown error during event dispatch means the receiving page failed to render (usually a DB / IPC issue, not a UI bug).
- Try opening the target page directly from the sidebar (`📜 History` or `5. Review pending`). If that works, the event listener is fine — the chip handler is the bug.

### Native Project Compare and static HTML show different counts

The native page reads live data; the static HTML is frozen at `compare` time. Re-run `compare` (or click `🔄 Refresh` on the native tab) so both surfaces reflect the same `dld_snapshot` / `sf_snapshot`. v2.1 audit hardening fields (user, tier-2, hash chain) only appear in the live data, never in the frozen HTML.

---

## Build problems (developers)

### `npm run dist` fails with "icon must be at least 256x256"

The source PNG/SVG that `scripts/make-icon.js` reads is smaller than 256×256. `electron-builder` rejects under-sized icons.

**Fix:**
1. Make sure `electron/assets/icon.svg` is the source (not just `icon-source.png`). SVG renders sharp at any size.
2. Run `node scripts/make-icon.js` — uses `@resvg/resvg-js` to rasterize the SVG at 16/24/32/48/64/128/**256** and pack into a multi-resolution ICO.
3. Re-run `npm run dist`.

If `icon-source.png` is your only asset and you need a higher-resolution version, use a vector graphics tool (Illustrator, Affinity, Inkscape) to redraw it as SVG, then `node scripts/make-icon.js`.

---

### `npm run dist` fails with `gyp ERR! ... node-gyp` / Python errors

Some native dependency tried to build from source because no prebuilt was available, and your machine doesn't have Python + a C++ toolchain installed.

**Fix:** Force the install to use prebuilts only and to target Electron's ABI:

```bash
npm_config_runtime=electron \
npm_config_target=28.3.3 \
npm_config_disturl=https://electronjs.org/headers \
npm install --build-from-source=false
```

Repeat for any specific package that complains. For `better-sqlite3` specifically — that's the most common offender — its v11.10.0 ships prebuilts for Electron 28; the env vars above pick them.

---

### `npm run dist` fails with `winCodeSign` extraction error

`electron-builder` downloads `winCodeSign` (used even for unsigned builds for resource embedding) and extracts it. On some Windows configs the extraction fails on Mac-OS-only files in the archive (they're symlinks 7za can't make without admin).

**Fix:**
```bash
cd %LOCALAPPDATA%\electron-builder\Cache\winCodeSign
# Find the .7z file matching the version electron-builder wants
7za x -y -x!darwin <the-archive>.7z
```

This pre-extracts everything *except* the macOS files. `electron-builder` then reuses the already-extracted folder.

---

### `npm run dist` succeeds but `.exe` won't launch — "spawn ENOENT"

Likely cause: the spawned subprocess (for projects-list, audit, etc.) is using `cwd` that's inside `app.asar` (a virtual filesystem the OS can't `chdir` into).

**Fix:** Confirm `electron/main.js` sets:
```js
const cwd = state.dataFolder || path.dirname(process.execPath);
```
(not `path.join(__dirname, '..')` — `__dirname` inside the packaged build is virtual.)

---

### Build embeds the wrong icon

1. Delete `dist-electron/` entirely: `rmdir /s /q dist-electron`
2. Verify `electron/assets/icon.ico` matches what you want (it should — `node scripts/make-icon.js` is reproducible)
3. Re-run `npm run dist`

Some Windows builds cache icon resources at the system level. If the new icon still doesn't show after install:
- Right-click the Desktop shortcut → Properties → Change Icon → re-pick `icon.ico`
- Or: `ie4uinit.exe -show` in PowerShell (Admin) clears the system icon cache

---

## Test problems (developers)

### `npm test` fails with `ERR_DLOPEN_FAILED` / Node module version mismatch

You're running tests against bare Node, which can't load the Electron-target `better-sqlite3` binary.

**Fix:** Use the test runner script that's already wired in `package.json`:
```bash
npm test
```
which invokes `node scripts/run-tests.js`. That script spawns Electron in Node mode (`ELECTRON_RUN_AS_NODE=1`) so the bundled Node 18 runtime matches the binary.

**Don't bypass:** `node --test test/**/*.test.js` will fail with the ABI error.

---

### One specific test fails with `no such table: <table_name>`

Your fixture forgot to apply the schema before running migrations. The standard pattern:

```js
const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
runMigrations(db);
```

Don't hand-create tables — `schema.sql` is the source of truth for fresh DBs.

---

### Tests pass locally but `npm run dist` then fails at packaging

This usually means a native dep got reinstalled for Node and the packager can't find the Electron-target build. After running `npm test` extensively, re-pin to Electron prebuilts before packaging:

```bash
npm_config_runtime=electron \
npm_config_target=28.3.3 \
npm_config_disturl=https://electronjs.org/headers \
npm install better-sqlite3 --build-from-source=false
```

---

### `--test-name-pattern` filter doesn't work

The runner script supports forwarding args. Use the `--` separator:
```bash
npm test -- --test-name-pattern='resolveBuyerComparison'
```

---

## Diagnostic procedures

### Get the full error from the desktop app

1. Press `Ctrl+Shift+I` to open DevTools.
2. **Console** tab — all renderer-side errors, IPC rejection messages.
3. **Errors** pane in-app (right sidebar) — captures the same errors, copyable via the **Copy** button. Survives DevTools close.

### Inspect the SQLite DB

The DB lives at `Desktop\DL-Processor\data\dld-sync.sqlite`. Open it with:
- **DB Browser for SQLite** — free, GUI
- **SQLiteStudio** — free, GUI
- **VS Code SQLite extension** — inline
- Command line: `node -e "const Database=require('better-sqlite3');const db=new Database('Desktop/DL-Processor/data/dld-sync.sqlite');console.log(db.prepare('SELECT * FROM schema_migration').all());"` (run via the test script: `node scripts/run-tests.js -e "…"` so the ABI matches)

### Check which schema migrations have applied

```sql
SELECT id, applied_at FROM schema_migration ORDER BY id;
```

Expected after v1.1 install (in order):
- `2026-05-12-001-audit-log`
- `2026-05-12-002-buyer-alias`
- `2026-05-12-003-pending-change-v2`
- `2026-05-12-004-buyer-alias-seed`
- `2026-05-12-005-audit-log-source-widen`

If any are missing, the migration framework didn't run — likely an upgrade-bug build. Reinstall the current `.exe`.

### Verify the icon is embedded in the `.exe`

Right-click `DL-Processor Setup 1.1.0.exe` → Properties → look at the file icon. If it's a generic doc icon, the `.exe` doesn't have an embedded icon — `electron-builder` left it as default. Rebuild from a fresh `dist-electron/`.

After install, right-click the Desktop shortcut → Change Icon — the DL monogram should appear in the list.

---

## Where logs live

| Source | Location | Use |
|---|---|---|
| Renderer (DevTools console) | `Ctrl+Shift+I` while app is running | Live errors, network, IPC |
| Renderer (in-app Errors pane) | Right panel, click **Copy** | Same errors, persistent, easy to share |
| Main process | `%APPDATA%\dl-processor\logs\` | Spawn errors, IPC handler exceptions |
| electron-builder | `dist-electron\builder-debug.yml` | Build-time issues |
| `npm test` output | Terminal | Test failures, stack traces |
| SQLite WAL/SHM | `Desktop\DL-Processor\data\dld-sync.sqlite-*` | If present and DB is locked, close all consumers and delete these (DB will recreate them) |

---

## Recovery procedures

### "I lost data — can I get it back?"

1. **`.bak` safety copies** — Every Import DB writes `Desktop\DL-Processor\data\dld-sync.sqlite.bak.{ISO timestamp}` of the pre-import DB. Rename one back to `dld-sync.sqlite` and relaunch.
2. **Export DB zips** — If you ran **💾 Export DB** at any point, the zip in `Desktop\` (or wherever you saved it) contains a full snapshot. Use **📤 Import DB** to restore.
3. **No backups, no `.bak`** — Sorry, no recovery path. Going forward: run **💾 Export DB** on the first day of every month.

### "I made a wrong approval — how do I revert?"

`audit_log` records every change to live data. Find the change:
```sql
SELECT * FROM audit_log
WHERE project_id = ? AND unit_number_norm = ?
  AND field = ?
ORDER BY ts DESC;
```

Then manually `UPDATE master_data SET <field> = <old_value> …` and add a corresponding `audit_log` row with `action='override'`, `user_note='manual revert of audit_id=N'` so the trail stays consistent.

Future v1.2 plan: add a one-click **Revert** button on global History rows.

### "My DB is locked — I can't open it"

Close every process that might be holding it:
1. Quit DL-Processor.
2. Close any external SQLite viewer.
3. Look in Task Manager for stale `Electron` / `node.exe` / `DL-Processor.exe` processes — end them.
4. Delete `dld-sync.sqlite-wal` and `dld-sync.sqlite-shm` in the data folder (the DB recreates them on next open).
5. Relaunch.

### "The installer left config pointing at the wrong folder"

`%APPDATA%\dl-processor\config.json` stores the data-folder path. Delete it and relaunch — the app re-runs its folder-pick logic and defaults to `Desktop\DL-Processor`.

---

## Still stuck?

1. Make a **💾 Export DB** zip BEFORE doing anything destructive.
2. Capture:
   - DL-Processor version (top bar)
   - Windows version (`winver`)
   - Exact error message from the Errors pane (Copy button)
   - Last 10 lines of `%APPDATA%\dl-processor\logs\` (if logs exist)
3. Email Ali (registration team owner) with the above. He can replay against his copy or escalate.
