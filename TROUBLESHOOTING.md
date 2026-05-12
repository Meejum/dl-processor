# DL-Processor — Troubleshooting & Debug Solutions

Everything we know goes wrong, why, and how to fix it. Sections are grouped by **where** the problem shows up (install, app launch, data flow, build) — find your symptom, follow the steps.

Companions: [README.md](README.md) for normal usage, [BUILDING.md](BUILDING.md) for development environment setup.

---

## Table of contents

- [Installation problems](#installation-problems)
- [App-launch problems](#app-launch-problems)
- [Data-flow problems](#data-flow-problems)
- [UI problems](#ui-problems)
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

v1.1 implements **SF drift only** (compares consecutive `sf_snapshot`s for the same `sub_project`). DLD drift is deferred to v1.2 — needs the compare.js extractor functions refactored into a reusable module.

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
