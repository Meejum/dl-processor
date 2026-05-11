# DL-Processor Desktop (Electron) — Design

**Date:** 2026-05-11
**Status:** Pending Ali's review. To be built on a new branch off `master` (after `feat/m-approval-extensions` lands).
**Topic:** Distribute DL-Processor as a native desktop app for Windows / macOS / Linux, with no Node.js prerequisite — "like a password manager".

---

## Scope

Wrap the existing DL-Processor codebase in an Electron shell so colleagues can install and run the tool without setting up Node.js, npm, or a code editor. v1.0 ships:

- A native window with a sidebar of buttons (mirroring the current CLI menu), a log panel, and a tab host that renders the existing HTML reports inline.
- Platform-specific installers built by `electron-builder`: Windows NSIS `.exe` + portable zip, macOS `.dmg`, Linux `.AppImage` + `.deb`.
- First-run wizard that asks where to store data (default `~/Documents/DL-Processor/`) and offers to copy from a detected legacy install at `C:\projects\DL-Processor\`.
- In-app "Check for updates" button that fetches a manifest from a static HTTPS host and applies updates user-initiated.
- All 246 existing tests continue to pass — the Node-side business logic does not change.

## Goals

1. **Zero prerequisites for colleagues.** Double-click the installer; the app runs. No Node, no npm, no terminal commands.
2. **Preserve the existing UX.** Anything that works in the CLI menu today (`[V]` review pending, `[B]` apply pending, import flows, compare, diff, dashboard, archive, area template) works in the desktop app via a sidebar button.
3. **Keep the HTML reports as the primary visual surface.** Approve-pending, dashboard, compare-result HTML render inside tabs in the app — same files the CLI writes today.
4. **One-click updates.** Colleagues click a button and get the next version. No emailing zip files.
5. **Single codebase, no logic duplication.** The Node-side modules (`src/*.js`, `index.js` command handlers) are reused as-is by the Electron main process. The renderer is purely UI.

## Non-Goals

- Authentication / RBAC / multi-user concurrency. This is a single-user desktop app.
- Cloud sync. The SQLite DB stays on each user's machine.
- Mobile clients (iOS/Android).
- Telemetry, crash reporting, analytics.
- Code signing for v1.0 (deferred — see §Code Signing).
- Auto-update on launch (user-initiated only for v1.0; auto-check is a v1.1 follow-up).
- Replacing the CLI. `node index.js` keeps working for power users and CI / scripted workflows.

---

## Architecture

### Two-process model

Electron splits the runtime into a Node-side **main process** and a Chromium-side **renderer process**. The two communicate via the `ipcMain` / `ipcRenderer` channel.

**Main process** — `electron/main.js` (new):
- Boots the app, opens the main `BrowserWindow`, manages window lifecycle.
- Imports the existing Node modules (`src/compare.js`, `src/pending-change.js`, `src/approve-html.js`, `src/sf-lookup.js`, `src/auto-approve.js`, etc.) unchanged.
- Exposes each high-level command (`review-pending`, `apply-pending`, `import-dld`, `import-sf`, `compare`, `diff`, `status`, `archive`, etc.) as an IPC handler.
- Hosts the `better-sqlite3` database connection (one per data folder).
- Hosts the `BrowserView` instances for rendered HTML tabs.
- Reads/writes the user-data location (data folder path, last-opened tabs, window size).

**Renderer process** — `electron/renderer/` (new):
- Vanilla HTML + JS (no framework). Mirrors the styling of the existing `src/html-styles.js` Sobha branding.
- Three regions: left sidebar (buttons), bottom log panel (streamed stdout), center tab host (`BrowserView` overlay).
- Top bar: data-folder path display + project selector.
- Sends IPC requests via a small `electron/preload.js` script that exposes a typed API (`window.dlp.runCommand('review-pending', args)`) to the renderer's window context.

### IPC contract

```
Renderer → Main:
  dlp:command:run        { command: 'review-pending', args: [...] } → spawn
  dlp:tab:open           { url: 'file:///<data>/output/approve-pending.html' }
  dlp:tab:close          { tabId }
  dlp:settings:get       → { dataFolder, lastDb, ... }
  dlp:settings:set       { dataFolder, ... }
  dlp:update:check       → { current, available, downloadUrl } | null
  dlp:update:download    { url } → progress events
  dlp:fs:browse          → opens native file dialog, returns selection

Main → Renderer (events):
  dlp:log:line           { text, level }    streamed console output
  dlp:command:done       { command, exitCode, stats }
  dlp:update:progress    { percent, bytesPerSecond, total }
```

### Folder layout

```
DL-Processor/
├── src/                     # existing — unchanged
├── index.js                 # existing CLI — unchanged
├── electron/
│   ├── main.js              # Electron main entry point
│   ├── preload.js           # bridges window.dlp API to ipcRenderer
│   ├── command-bridge.js    # wraps existing cmd* functions for IPC consumption
│   ├── data-folder.js       # data-folder selection + migration logic
│   ├── update-checker.js    # fetches latest.yml, compares versions
│   ├── renderer/
│   │   ├── index.html
│   │   ├── styles.css       # reuses src/html-styles.js's SOBHA_STYLE_CSS
│   │   ├── app.js           # sidebar + log + tab-host wiring
│   │   ├── sidebar.js
│   │   ├── log-panel.js
│   │   └── tab-host.js
│   └── assets/
│       ├── icon.ico         # Windows
│       ├── icon.icns        # macOS
│       └── icon.png         # Linux
├── electron-builder.yml     # build config for all 3 OSes
├── package.json             # adds electron + electron-builder deps; new "dist" / "start:electron" scripts
└── docs/superpowers/specs/2026-05-11-dl-processor-desktop-electron-design.md
```

The existing `src/` and `index.js` are untouched. The CLI continues to work for power users; the Electron app is a new front end over the same engine.

---

## UI

### Window layout

```
┌──────────────────────────────────────────────────────────────────┐
│ DL-Processor · Data folder: C:\Users\Ali\Documents\DL-Processor  │  ← top bar
│  ┌─ project: ─────────────┐                                      │
│  │ [Sobha Hartland Waves▾] │  [↻ Refresh] [⚙ Settings]            │
│  └───────────────────────┘                                      │
├──────────┬───────────────────────────────────────────────────────┤
│ SIDEBAR  │ TAB HOST                                              │
│          │  ┌─[Dashboard ×]─[Approve pending ×]─[Compare ×]─┐    │
│ [Run all]│  │                                                │   │
│ [Import  │  │  <BrowserView renders                          │   │
│   DLD]   │  │   the existing approve-pending.html            │   │
│ [Import  │  │   inline — same file, same content,            │   │
│   SF ]   │  │   no rewrite>                                  │   │
│ [Compare]│  │                                                │   │
│ [Diff]   │  └────────────────────────────────────────────────┘   │
│ [Review  │                                                       │
│   pend]  ├───────────────────────────────────────────────────────┤
│ [Apply   │ LOG PANEL                                             │
│   pend]  │   [10:42:13]  importing dld snapshot...               │
│ [Open    │   [10:42:14]    parsed 1740 transactions              │
│  dashbd] │   [10:42:14]    queued 1740 pending changes           │
│ [Status] │   [10:42:15]  wrote output/csv/pending-changes.csv    │
│ [Archive]│   [10:42:15]  wrote output/approve-pending.html       │
│ [Area    │   [10:42:15]  opened in browser                       │
│  templ]  │                                                       │
└──────────┴───────────────────────────────────────────────────────┘
```

### Sidebar buttons (1:1 mapping to current menu)

| Sidebar button | Current menu key | Maps to |
|---|---|---|
| Run full pipeline | (default) | `cmdAll()` |
| Import DLD | `1` | `cmdImport(files)` |
| Import SF | `2` | `cmdImportSf(file)` |
| Compare | `3` | `cmdCompare(filter)` |
| Diff (month-over-month) | `4` | `cmdDiff(args)` |
| Review pending | `V` | `cmdReviewPending(filter)` |
| Apply pending | `B` | `cmdApplyPending(csvPath)` — opens file picker |
| Open dashboard | `O` | open `output/dashboard.html` in a tab |
| Status | `S` | `cmdStatus()` |
| Reveal data folder | `R` | shell.showItemInFolder(dataFolder) |
| Archive | `Z` | `cmdArchive()` |
| Projects list | `P` | `cmdProjects()` |
| Area template | `Y` (submenu) | submenu modal with Generate / Apply / Reveal |

The Sobha branding from `src/html-styles.js` (cream `#F6F1E9` background, bronze `#85633B` accent, Dubai/Inter typography) is reused for the renderer's internal styling — sidebar, log panel, tab strip, modals. The native OS window decorations (title bar, minimize/maximize/close buttons) remain platform-default.

### Tab host

When a command produces an HTML file (review-pending → `output/approve-pending.html`; dashboard → `output/dashboard.html`; compare → `output/compare/<project>.html`), the renderer opens it as a tab using Electron's `BrowserView` API. Multiple tabs open simultaneously; click a tab to switch; × on a tab closes it. Tabs persist across window resize but not across app restart (deferred to v1.1).

Tabs render the HTML as-is — no rewrite of the existing generators. The HTML's inline JS (e.g., the approve-pending UI's `Export decisions` button) still works because `BrowserView` is a full Chromium instance.

### Log panel

A pre-formatted scrollable text area at the bottom (~30% of window height; resizable via a drag handle). Each `console.log` call from the main process is piped via IPC `dlp:log:line` and appended. Color-coded by level:
- Info: ink-2 (`#5A4A37`)
- Warn: warn (`#8A5A08`)
- Error: down (`#A12C1B`)
- Success markers (✓): up (`#1E6B34`)

Right-click menu: Copy, Clear, Save log to file.

### Top bar

- Data-folder path (clickable — opens it in the OS file explorer).
- Project selector dropdown (populated from `SELECT project_name FROM dld_project`). Changes the implicit `filter` arg for commands that accept one.
- Settings cog → opens a modal: data folder, check for updates, about/version.

---

## Data Persistence

### First-run wizard

On first launch (no `~/.config/dl-processor/config.json` present), a modal appears:

```
Welcome to DL-Processor
───────────────────────

Where should DL-Processor store its data?

  [_] ~/Documents/DL-Processor/    (recommended)
  [_] Choose a different folder...

If you already have DL-Processor data on this machine,
we'll detect it and offer to copy it over.

                                     [Continue]
```

On click, the chosen folder is created with subdirectories:
```
DL-Processor/
├── db/                  # SQLite db (currently dl-processor.db)
├── input/               # DLD XPS / CSV imports
│   └── Changes Template Input/
├── output/              # generated reports + CSVs
│   ├── csv/
│   ├── compare/
│   ├── diff/
│   ├── parse/
│   └── archive/
├── sf-input/            # Salesforce xlsx exports
└── config/
    └── auto-approve.json
```

### Legacy migration

After the folder is chosen, the wizard scans common legacy paths:
- `C:\projects\DL-Processor\db\`
- `~/dl-processor/db/`
- `<install dir>/db/` (the .exe's parent)

If a legacy `dl-processor.db` is found, the wizard prompts:

```
We found an existing DL-Processor database at:
  C:\projects\DL-Processor\db\dl-processor.db

Copy it to the new location?
  [_] Yes — copy db/ input/ output/ sf-input/ config/ to ~/Documents/DL-Processor/
  [_] No  — start fresh

                                     [Continue]
```

"Yes" performs a recursive copy (not move — the legacy files remain in place as a backup). "No" starts with empty subfolders.

### Settings later

Settings modal has a "Change data folder" button. Clicking opens a folder picker; on selection, the app prompts:
- "Move data?" (rename current to new path)
- "Copy data?" (duplicate, leave old in place)
- "Switch only?" (point at the new folder; old data orphaned)

Each option then restarts the app to re-bind the DB connection.

### Config schema

`~/.config/dl-processor/config.json` (Electron's `app.getPath('userData')`):

```json
{
  "dataFolder": "C:\\Users\\Ali\\Documents\\DL-Processor",
  "windowBounds": { "x": 100, "y": 100, "width": 1400, "height": 900 },
  "lastUpdateCheck": "2026-05-11T08:30:00Z",
  "updateChannel": "stable",
  "version": "1.0.0"
}
```

This is platform config (location, window state, version), NOT user data — the database, imports, outputs, and tolerance config all live under `dataFolder`.

---

## Distribution

### Build pipeline

`electron-builder.yml` configured for three targets:

```yaml
appId: ae.sobha.dl-processor
productName: DL-Processor
directories:
  output: dist-electron
files:
  - 'src/**'
  - 'index.js'
  - 'electron/**'
  - 'db/schema.sql'
  - 'package.json'
  - '!**/*.test.js'
  - '!docs/**'
asarUnpack:
  - 'node_modules/better-sqlite3/**'
win:
  target: [{ target: nsis, arch: [x64] }, { target: zip, arch: [x64] }]
  icon: electron/assets/icon.ico
mac:
  target: [{ target: dmg, arch: [x64, arm64] }]
  icon: electron/assets/icon.icns
  category: public.app-category.business
linux:
  target: [{ target: AppImage, arch: [x64] }, { target: deb, arch: [x64] }]
  icon: electron/assets/icon.png
  category: Office
publish: null  # we hand-upload to the static host
```

`npm run dist` produces:
- `dist-electron/DL-Processor Setup 1.0.0.exe` (Windows installer, ~75 MB)
- `dist-electron/DL-Processor-1.0.0-win.zip` (portable Windows zip)
- `dist-electron/DL-Processor-1.0.0.dmg` (macOS — universal binary x64 + arm64)
- `dist-electron/DL-Processor-1.0.0.AppImage` (Linux)
- `dist-electron/dl-processor_1.0.0_amd64.deb` (Debian/Ubuntu)
- `dist-electron/latest.yml` (update manifest)
- `dist-electron/latest-mac.yml`
- `dist-electron/latest-linux.yml`

Mac builds run on Ali's Windows machine via `electron-builder`'s cross-compile (no notarization since unsigned). If Mac/Linux issues arise, those targets can be skipped for v1.0 (Windows-only release is acceptable).

### Native module handling

`better-sqlite3` is a native module that must be rebuilt for Electron's Node version. `electron-builder` auto-rebuilds in the `pack` phase. The rebuilt binary is unpacked from the asar archive (via `asarUnpack`) so it can be `require()`'d at runtime.

### Static host

Build artifacts upload to a Cloudflare Pages site:
- `https://dl-processor.pages.dev/latest.yml` — manifest
- `https://dl-processor.pages.dev/DL-Processor%20Setup%201.0.0.exe` — installer
- `https://dl-processor.pages.dev/changelog.md` — release notes

Cloudflare Pages free tier covers this (100 GB / month bandwidth). If Sobha prefers SharePoint or a network share, the static-host URL is the only string that changes in `update-checker.js`.

The host directory is just a git repo (`dl-processor-releases` or similar) connected to Pages. Ali pushes new releases by adding files and committing.

---

## Updates

### v1.0 flow (user-initiated)

Settings → "Check for updates" button:

```
[Settings · Updates]

Current version: 1.0.0
Last checked: 2026-05-11 14:30

   [Check for updates]
```

Click:

1. App fetches `https://dl-processor.pages.dev/latest.yml`.
2. Compares the manifest's `version` with `app.getVersion()`.
3. If newer, prompts:
   ```
   Update available: 1.0.1
   
   Release notes:
     - Fix: pending-changes CSV no longer crashes when Excel has it open
     - Tweak: section headers darker
   
   [Download and Install] [Skip this version]
   ```
4. On click, downloads the platform-appropriate installer (progress bar in the modal), then prompts:
   ```
   Update ready. Restart now?
   [Restart now] [Later]
   ```
5. On restart, the new installer runs; once done, the new version launches.

Powered by `electron-updater`'s `checkForUpdates()` + manual `quitAndInstall()` calls (we don't enable auto-check / auto-download).

### v1.1 follow-up

Flip `autoUpdater.checkForUpdatesAndNotify()` on in the main process. On app launch, check happens in background; if found, prompt non-modally. No infra change.

---

## Code Signing

**Skipped for v1.0.** README ships with a section explaining the first-install workaround:

```markdown
## First Install on Windows

When you run `DL-Processor Setup 1.0.0.exe`, Windows SmartScreen may show:

> Windows protected your PC
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.

Click **More info**, then **Run anyway**. This only happens on the first install.

## First Install on macOS

When you double-click `DL-Processor-1.0.0.dmg` and then `DL-Processor.app`, macOS may show:

> "DL-Processor" can't be opened because Apple cannot check it for malicious software.

Close the dialog. Open System Settings → Privacy & Security. Scroll to the
bottom; you'll see a "DL-Processor was blocked" message with an **Open Anyway**
button. Click it. From now on the app opens normally.

## First Install on Linux

`.AppImage`: `chmod +x DL-Processor-1.0.0.AppImage` then double-click or run from terminal.
`.deb`: `sudo dpkg -i dl-processor_1.0.0_amd64.deb`.
```

### Revisit triggers

Drop the workaround text and procure signing certs when any of:
- More than 5 colleagues are using it (the manual workaround conversation gets repetitive).
- Sobha IT requests centrally-distributed software meets signing standards.
- External partners (developers, agents) start running the tool.

Estimated cost when needed: Windows EV code signing cert (~$300/yr, instant SmartScreen trust) + Apple Developer Program ($99/yr, notarization). Linux: no signing needed.

---

## Migration

### From the current `C:\projects\DL-Processor\` install

On first launch of the Electron app, after data-folder selection, the wizard detects:
- `C:\projects\DL-Processor\db\dl-processor.db` exists
- `C:\projects\DL-Processor\input/` and `output/` exist

If found, the migration prompt fires (described in §First-run wizard). Files copied:
- `db/dl-processor.db` → `<dataFolder>/db/dl-processor.db`
- `input/**/*` → `<dataFolder>/input/**/*` (preserving the `Changes Template Input/` subfolder)
- `output/**/*` → `<dataFolder>/output/**/*` (including `archive/` snapshots)
- `sf-input/**/*` → `<dataFolder>/sf-input/**/*`
- `config/auto-approve.json` → `<dataFolder>/config/auto-approve.json`

Copy is non-destructive: the legacy `C:\projects\DL-Processor\` folder remains as a backup. User can delete it manually after verifying the new install works.

### Backwards compatibility for the CLI

The Node CLI continues to work against the original `C:\projects\DL-Processor\` paths because `index.js` resolves relative to `__dirname`. So `node index.js review-pending` from the project root still operates on the legacy data. This means power users (Ali) can keep using `git pull` + CLI for development, while colleagues run the installed Electron app against their own data folders. Two paths, one codebase.

---

## Configuration

Three layers of config in the desktop app, in precedence order:

1. **Per-data-folder config** — `<dataFolder>/config/auto-approve.json` (same as today's CLI config). Edited from Settings → "Open data folder" → manual JSON edit, OR from a Settings → "Tolerances" form in v1.1.
2. **Per-user app config** — `~/.config/dl-processor/config.json` (Electron `userData`). Platform-level: data folder path, window state, update channel.
3. **Built-in defaults** — baked into `electron/main.js` (e.g., default data folder = `~/Documents/DL-Processor`).

The `DLP_USER` env var (used by `applyDecision`) is read from `process.env.DLP_USER` in the main process. v1.0: documented in README. v1.1: add a Settings → "Your name" field that writes the env var or a config value the main process consumes.

---

## Schema Impact

**None.** The Electron app is a new front-end over the existing Node modules. SQLite schema, master_data, pending_change, auto-approve logic — all unchanged.

---

## Testing

### Existing tests

All 246 tests in `test/**/*.test.js` continue to pass via `npm test`. They don't touch the renderer or main process — they test the existing `src/` modules. No regression risk.

### New tests

| Test file | Approx test count | Coverage |
|---|---|---|
| `test/electron/data-folder.test.js` | ~5 | First-run wizard logic (purely Node, no Electron runtime needed): default path detection, legacy-path probe, folder creation with subfolders, migration copy correctness, settings-update-on-change. |
| `test/electron/command-bridge.test.js` | ~6 | IPC wrapper: each command bridge correctly invokes the underlying `cmd*` function, returns stats, pipes console.log via the supplied logger function. |
| `test/electron/update-checker.test.js` | ~4 | Manifest fetch + version compare: newer version available, same version (no-op), older version (no-op), network error handling. |

**Test count delta:** 246 → ~261 (+15 net new). All new tests are pure Node — no Electron runtime, no jsdom. They stub `ipcMain` / `ipcRenderer` and `electron.app.getPath`.

### Manual smoke

Per release, Ali runs a brief manual smoke checklist on Windows:
- Install via the NSIS installer.
- First-run wizard appears; pick `~/Documents/DL-Processor/`.
- Migration prompt offers to copy from `C:\projects\DL-Processor\`; confirm Yes.
- Sidebar → Review pending. Approve-pending.html opens as a tab; sections visible; click expands; Export decisions downloads CSV.
- Sidebar → Apply pending. File picker opens; pick the exported CSV; logs show "applied N approvals".
- Settings → Check for updates. Returns "you have the latest version".

If Mac / Linux are in the v1.0 release, a similar checklist runs there (probably via a colleague with access, since Ali is on Windows).

---

## Risks

- **`better-sqlite3` rebuild fragility.** Native modules + Electron's bespoke Node version is the historical source of "works on my machine, broken on the user's machine" bugs. Mitigation: `electron-builder`'s `asarUnpack` extracts the prebuilt binary so the user's install doesn't need to recompile. Smoke tests on each release.
- **Bundle size.** Electron apps are ~50 MB minimum for the framework alone; add the Node modules and the asset bundle and we're at ~80 MB per installer. Acceptable for a desktop install (smaller than Slack at ~400 MB). Mention in README.
- **Cross-compile from Windows for macOS.** `electron-builder` cross-compiles, but macOS Gatekeeper is finicky about unsigned binaries built off-platform. If Mac users hit issues, fall back to "Windows-only v1.0, Mac/Linux in a follow-up release once Sobha owns a Mac CI runner".
- **Update server URL stability.** Cloudflare Pages URLs are stable, but if Sobha demands a custom domain (`dl-processor.sobharealty.com`), DNS + cert management becomes ongoing. Stick with `pages.dev` for v1.0.
- **First-run migration deleting wrong data.** Copy is non-destructive — legacy data stays in place. But if Ali later deletes `C:\projects\DL-Processor\`, he loses the development environment. Mitigation: README explicitly says "Do not delete `C:\projects\DL-Processor\` until you've verified the Electron app works end-to-end."
- **Renderer-vs-main process boundary.** Easy to accidentally do disk I/O from the renderer or DB queries from the renderer, which Electron forbids by default since Electron 12. Mitigation: enforce `contextIsolation: true` and `nodeIntegration: false`; all IO goes through IPC. Document the pattern in `electron/preload.js`.
- **Auto-update for Sobha-side maintenance.** If Ali leaves and no one rebuilds, colleagues' installs go stale silently. Mitigation: include the version-check pings into a Sobha-owned health dashboard (out of scope for v1.0).

## Open Questions

1. **macOS support in v1.0?** Cross-compiling from Windows is doable but unsigned-Mac UX is rougher. Decision needed: ship Mac binaries day-one, or "Windows + Linux only" for v1.0?
2. **Cloudflare Pages vs. Sobha SharePoint** for the update host. Cloudflare is technically easier; SharePoint is corporate-blessed. Probably Ali calls IT and asks before v1.0.

---

## Out-of-Scope Items Captured Today

- **Telemetry / crash reporting.** Useful but adds infrastructure. Revisit if bugs are hard to reproduce from colleague reports.
- **Multi-window support.** Single window for v1.0; if users want side-by-side compare + approve, revisit.
- **Built-in changelog viewer.** README lives in `dist-electron/changelog.md` as plain Markdown; users see release notes in the update prompt. Native changelog tab is v1.1.
- **Drag-and-drop file import.** Drop a DLD .xps file on the window → triggers import. Nice-to-have, not required for v1.0.
- **Notification toasts.** "Import done", "5 auto-approvals applied", etc. as native OS notifications. v1.1.
- **Auto-update on launch.** v1.1.
- **Code signing.** Revisit when team grows past 5 or external partners need it.
- **Sobha IT integration / corporate distribution.** If IT wants centrally pushed installs via SCCM / Intune, that's a v2 conversation.
