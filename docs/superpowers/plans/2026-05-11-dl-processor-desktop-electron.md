# DL-Processor Desktop (Electron) v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows NSIS installer (`DL-Processor Setup 1.0.0.exe`) that wraps the existing DL-Processor codebase in an Electron desktop app — sidebar of buttons, log panel, HTML reports rendered inline as tabs — with no Node.js prerequisite for colleagues, first-run data-folder wizard, legacy migration, and in-app "Check for updates" against a Cloudflare Pages static host.

**Architecture:** Two-process Electron app. The **main process** (Node side) imports the existing `src/*.js` modules unchanged after a small refactor that moves the `cmd*` functions out of `index.js` into `src/commands/*.js`, so they're callable as library functions instead of CLI entry points. The **renderer process** (Chromium side) is vanilla HTML/CSS/JS — no framework. They communicate via Electron's `ipcMain`/`ipcRenderer` through a small `electron/preload.js` bridge that exposes a typed `window.dlp.*` API. The existing CLI (`node index.js`) keeps working unchanged.

**Tech Stack:** electron ^28, electron-builder ^24, better-sqlite3 (already in deps; rebuilt for Electron's Node via `asarUnpack`), no UI framework, vanilla HTML/CSS/JS in the renderer. Node ≥18 (already the project baseline).

**Spec:** `docs/superpowers/specs/2026-05-11-dl-processor-desktop-electron-design.md` (commit `bdc176c` on `feat/m-approval-extensions`; will be cherry-picked onto this branch in Task 1).

**Branch state at plan-write:** Plan is being executed on a new branch `feat/electron-desktop` branched off `master` `1dc3c56`. The spec lives on `feat/m-approval-extensions` — Task 1 cherry-picks `8dfdc61` and `bdc176c` onto the new branch so we have the spec but not the 22 unrelated m-approval-extensions commits.

**Test count delta target:** 198 baseline on master (the m-approval-extensions branch's 246 is not on master yet). +15 new tests for the Electron layer (~5 data-folder, ~6 command-bridge, ~4 update-checker). Final: **213/213** on `feat/electron-desktop` until/unless m-approval-extensions merges to master, at which point a rebase pulls the existing 246 up to 261.

---

## File Structure

**New top-level directories:**

```
electron/
├── main.js              # Electron main entry point
├── preload.js           # bridges window.dlp API to ipcRenderer
├── command-bridge.js    # wraps each cmd* function for IPC + log capture
├── data-folder.js       # first-run wizard logic + legacy migration
├── update-checker.js    # fetches latest.yml, compares versions
├── renderer/
│   ├── index.html
│   ├── styles.css       # reuses SOBHA_STYLE_CSS from src/html-styles.js
│   ├── app.js           # bootstraps renderer
│   ├── sidebar.js
│   ├── log-panel.js
│   ├── tab-host.js
│   ├── top-bar.js
│   └── settings-modal.js
└── assets/
    └── icon.ico         # Windows app icon

src/commands/           # NEW — refactored CLI command functions
├── all.js              # cmdAll (full pipeline)
├── parse.js            # cmdParse
├── import-dld.js       # cmdImport
├── import-sf.js        # cmdImportSf
├── compare.js          # cmdCompare
├── diff.js             # cmdDiff
├── projects.js         # cmdProjects
├── status.js           # cmdStatus
├── review-pending.js   # cmdReviewPending
├── apply-pending.js    # cmdApplyPending
├── archive.js          # cmdArchive (currently in index.js)
└── shared.js           # shared helpers (openDb, OUTPUT_DIR, CSV_DIR, etc.)

dl-processor-releases/  # SEPARATE git repo, not in this codebase
                        # Hosts latest.yml + .exe + changelog.md
                        # Connected to Cloudflare Pages
```

**Modified existing files:**

| Path | What changes |
|---|---|
| `index.js` | The 11 `cmd*` functions move to `src/commands/*.js`. `index.js` becomes a thin CLI dispatcher that imports them and routes `process.argv` to the right handler. Module-level constants like `OUTPUT_DIR`, `CSV_DIR` are exported. |
| `package.json` | Add `electron`, `electron-builder` as devDependencies. Add scripts: `start:electron`, `dev:electron`, `dist`, `dist:win`. Update `version` to `1.0.0` when shipping. |
| `src/menu.js` | **Unchanged.** The CLI menu keeps working for power users. The Electron app does NOT consume `src/menu.js` (it has its own renderer-side menu). |
| `README.md` | Add a "Desktop app (Windows)" section: download link, SmartScreen workaround, first-launch wizard, check-for-updates flow. |
| `.gitignore` | Add `dist-electron/`, `electron/renderer/dist/` if any. |

**Unchanged:** `db/schema.sql`, all `src/*.js` except a small refactor pass that exposes module-level helpers (`openDb` import is fine, etc.). All existing tests stay green.

---

## Bundling guidance for subagent-driven-development

| Task | Run as | Reason |
|---|---|---|
| 1 + 2 | **Bundle** | Branch setup + electron deps + initial package.json scripts. Mechanical. |
| 3 | Solo | Refactor cmd* into src/commands/. Touches index.js; needs careful TDD discipline so existing CLI doesn't break. |
| 4 | Solo | Minimal Electron shell — main.js + preload.js + a blank window. First visible app. |
| 5 + 6 | **Bundle** | command-bridge.js + its IPC tests. Tightly coupled. |
| 7 | Solo | data-folder.js + its tests. Important migration logic, deserves focus. |
| 8 | Solo | First-run wizard UI (renderer modal). |
| 9 + 10 + 11 | Sequential | Sidebar → log panel → tab host. Each builds on the prior. |
| 12 | Solo | Top bar + settings modal. |
| 13 | Solo | update-checker.js + UI. |
| 14 + 15 | **Bundle** | electron-builder.yml + icon + README updates. Ship-prep work. |
| 16 | Solo | Manual smoke checklist + first release upload to Cloudflare. |

---

## Task 1: Branch setup + Electron deps + package.json scripts

**Files:**
- Modify: `package.json`
- Cherry-pick: spec commits `8dfdc61` + `bdc176c` from `feat/m-approval-extensions`

- [ ] **Step 1.1: Create the new branch off master**

```bash
cd /c/projects/DL-Processor
git checkout master
git status -b --short    # expect clean tree apart from pre-existing untracked files
git checkout -b feat/electron-desktop
```

Expected output: `Switched to a new branch 'feat/electron-desktop'`.

- [ ] **Step 1.2: Cherry-pick the spec from feat/m-approval-extensions**

```bash
git cherry-pick 8dfdc61    # docs(spec): DL-Processor Desktop (Electron) v1.0 design
git cherry-pick bdc176c    # docs(spec): resolve electron desktop open questions
```

Expected: both commits land cleanly. Verify the spec exists:
```bash
ls docs/superpowers/specs/2026-05-11-dl-processor-desktop-electron-design.md
```

- [ ] **Step 1.3: Install electron + electron-builder as devDependencies**

```bash
npm install --save-dev electron@^28 electron-builder@^24
```

Expected: `package.json` and `package-lock.json` updated. The install will trigger `electron-builder` to download platform binaries (~150 MB) and rebuild `better-sqlite3` against Electron's Node ABI (~30s on a warm machine).

- [ ] **Step 1.4: Add the four new npm scripts to `package.json`**

Edit `package.json` so the `"scripts"` block reads:

```json
"scripts": {
  "start": "node index.js",
  "parse": "node index.js",
  "test": "node --test \"test/**/*.test.js\"",
  "start:electron": "electron .",
  "dev:electron": "electron . --enable-logging",
  "dist": "electron-builder --win",
  "dist:portable": "electron-builder --win portable"
},
```

Also add `"main"` (Electron's entry) — point it at `electron/main.js`. Update the existing `"main": "index.js"` to:

```json
"main": "electron/main.js",
```

And add a `"bin"` override so `node index.js` still works on the CLI side. The existing `"bin": { "dl-processor": "./index.js" }` already does this. Verify it's intact.

Also bump version to `1.0.0` (item m basic was 0.4.1; the redesign + Electron together is a major):

```json
"version": "1.0.0",
```

- [ ] **Step 1.5: Run the existing test suite to confirm nothing broke**

```bash
npm test
```

Expected: `tests 198, pass 198, fail 0` (the master baseline; the m-approval-extensions branch's 246 is not on this branch).

- [ ] **Step 1.6: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(electron): add electron + electron-builder devDeps + dist scripts; bump to 1.0.0"
```

---

## Task 2: Refactor `index.js` cmd* functions into `src/commands/*.js`

**Files:**
- Create: `src/commands/shared.js`
- Create: `src/commands/parse.js`
- Create: `src/commands/import-dld.js`
- Create: `src/commands/import-sf.js`
- Create: `src/commands/compare.js`
- Create: `src/commands/diff.js`
- Create: `src/commands/projects.js`
- Create: `src/commands/status.js`
- Create: `src/commands/review-pending.js`
- Create: `src/commands/apply-pending.js`
- Create: `src/commands/all.js`
- Modify: `index.js` (becomes a thin CLI dispatcher)

**Goal:** Each `cmd*` function becomes an exported library function callable by both the existing CLI (`node index.js review-pending`) AND by the Electron main process via `require('./src/commands/review-pending').cmdReviewPending(...)`. Behavior must be byte-identical to the current CLI — all existing tests stay green.

**Approach:** This is mechanical extraction, NOT redesign. Each new file in `src/commands/` exports exactly one function. The function body is copied verbatim from `index.js`. Helpers used across functions (`openDb`, `OUTPUT_DIR`, `CSV_DIR`, `PARSE_DIR`, etc.) move to `src/commands/shared.js` and get imported everywhere they're needed.

- [ ] **Step 2.1: Create `src/commands/shared.js` with the path constants and openDb wrapper**

```js
const path = require('path');
const { openDb: openDbDefault } = require('../db');

// Resolve the repo root. When running under the CLI (node index.js), this is
// the project directory. When running under Electron, electron/main.js sets
// process.env.DLP_DATA_ROOT to the user's chosen data folder; we honor that.
function repoRoot() {
  return process.env.DLP_DATA_ROOT || path.join(__dirname, '..', '..');
}

const INPUT_DIR    = () => path.join(repoRoot(), 'input');
const SF_INPUT_DIR = () => path.join(repoRoot(), 'sf-input');
const OUTPUT_DIR   = () => path.join(repoRoot(), 'output');
const COMPARE_DIR  = () => path.join(OUTPUT_DIR(), 'compare');
const DIFF_DIR     = () => path.join(OUTPUT_DIR(), 'diff');
const CSV_DIR      = () => path.join(OUTPUT_DIR(), 'csv');
const PARSE_DIR    = () => path.join(OUTPUT_DIR(), 'parse');
const CHANGES_TEMPLATE_DIR       = () => path.join(OUTPUT_DIR(), 'Changes Template');
const CHANGES_TEMPLATE_INPUT_DIR = () => path.join(INPUT_DIR(), 'Changes Template Input');

function openDb() {
  // openDb in src/db.js takes an optional path. Default it to <repoRoot>/db/dl-processor.db.
  return openDbDefault(path.join(repoRoot(), 'db', 'dl-processor.db'));
}

module.exports = {
  repoRoot,
  INPUT_DIR, SF_INPUT_DIR, OUTPUT_DIR, COMPARE_DIR, DIFF_DIR, CSV_DIR, PARSE_DIR,
  CHANGES_TEMPLATE_DIR, CHANGES_TEMPLATE_INPUT_DIR,
  openDb
};
```

Why functions and not constants? The constants today are evaluated at module load (line 20-28 of `index.js`). Under Electron, the data folder isn't known until the user picks it on first run. Lazy resolution via `()` ensures every command call reads the current `process.env.DLP_DATA_ROOT`. The existing CLI continues to work because when the env var is unset, `repoRoot()` falls back to `__dirname/../..` which resolves to the project root — same as before.

- [ ] **Step 2.2: Verify `src/db.js`'s `openDb` accepts an optional path**

```bash
grep -n "function openDb\|exports.*openDb" src/db.js
```

If `openDb` is hardcoded to a specific path, modify it to accept an optional path argument with the current path as default. (If it already does, no change needed.)

- [ ] **Step 2.3: Run baseline tests to confirm openDb still works**

```bash
npm test
```

Expected: 198/198 pass (no behavior change yet).

- [ ] **Step 2.4: Extract each cmd* function — pattern, repeat 11 times**

For each function `cmdX` in `index.js`, do:

1. Identify the function body in `index.js` (e.g., `cmdReviewPending` at lines 412-491).
2. Create `src/commands/<kebab-name>.js` (e.g., `review-pending.js`).
3. Copy the function body. Replace inline references to `OUTPUT_DIR`, `CSV_DIR`, etc. with calls to the lazy-resolution helpers from `shared.js` (e.g., `path.join(OUTPUT_DIR(), 'csv', 'pending-changes.csv')`).
4. Import the required `src/*.js` modules (the function will probably need 2–4 of them).
5. Export the function as the default named export.

Example for `src/commands/review-pending.js` (current `index.js:412-491`):

```js
const fs = require('fs');
const path = require('path');
const { listPending } = require('../pending-change');
const { generateApproveHtml } = require('../approve-html');
const { loadAutoApproveConfig } = require('../auto-approve');
const { lookupSfUnit } = require('../sf-lookup');
const { openFile } = require('../open-file');
const { getMasterRow } = require('../master-data');
const { openDb, OUTPUT_DIR, CSV_DIR } = require('./shared');

function cmdReviewPending(filterProjectName) {
  const db = openDb();
  const rows = listPending(db, filterProjectName);
  if (rows.length === 0) {
    console.log('  no pending changes');
    db.close();
    return;
  }
  // ... (rest of body verbatim from index.js, with OUTPUT_DIR / CSV_DIR
  //      calls now wrapped as OUTPUT_DIR() / CSV_DIR())
  // Same enrichment loop, same CSV write with EBUSY fallback, same HTML
  // generation, same openFile call.
  // ...
  db.close();
}

module.exports = { cmdReviewPending };
```

Repeat for: `cmdParse`, `cmdImport`, `cmdImportSf`, `cmdCompare`, `cmdDiff`, `cmdProjects`, `cmdStatus`, `cmdAll`, `cmdApplyPending`, `cmdArchive` (if it exists separately — check `index.js`).

**Important:** during extraction, do NOT change function behavior. Run `npm test` after each file extraction to verify nothing broke. The existing tests don't import `index.js` directly — they import `src/*.js` modules — so the refactor should be invisible to them.

- [ ] **Step 2.5: Rewrite `index.js` as a thin CLI dispatcher**

After all 11 commands move to `src/commands/`, `index.js` becomes:

```js
#!/usr/bin/env node
// DL-Processor CLI entry point.
// All command logic lives in src/commands/*.js so it can be invoked from
// both this CLI AND from the Electron main process.

const { cmdAll }            = require('./src/commands/all');
const { cmdParse }          = require('./src/commands/parse');
const { cmdImport }         = require('./src/commands/import-dld');
const { cmdImportSf }       = require('./src/commands/import-sf');
const { cmdCompare }        = require('./src/commands/compare');
const { cmdDiff }           = require('./src/commands/diff');
const { cmdProjects }       = require('./src/commands/projects');
const { cmdStatus }         = require('./src/commands/status');
const { cmdReviewPending }  = require('./src/commands/review-pending');
const { cmdApplyPending }   = require('./src/commands/apply-pending');

function banner() {
  console.log('');
  console.log('  DL-PROCESSOR  /  DLD Project Inquiry <-> Salesforce Reconciler');
  console.log('  Sobha Realty  -  Registration Team');
  console.log('');
}

function usage() {
  console.log('Usage:');
  console.log('  node index.js                  full pipeline');
  console.log('  node index.js parse    [file]  parse XPS/CSV -> JSON+CSV');
  console.log('  node index.js import   [file]  parse + store in SQLite');
  console.log('  node index.js import-sf [file] import Salesforce xlsx snapshot');
  console.log('  node index.js compare  [name]  DLD vs SF comparison');
  console.log('  node index.js diff     [name] [--since YYYY-MM-DD]  diff snapshots');
  console.log('  node index.js review-pending [name]  write pending-changes.csv + approve-pending.html');
  console.log('  node index.js apply-pending  [csv]   apply approve/reject decisions');
  console.log('  node index.js status                 summary');
  console.log('  node index.js projects               list known projects');
}

function main() {
  banner();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '-h' || cmd === '--help') { usage(); return; }
  if (!cmd) { cmdAll(); return; }
  if (cmd === 'parse')          { cmdParse(rest); return; }
  if (cmd === 'import')         { cmdImport(rest); return; }
  if (cmd === 'import-sf')      { cmdImportSf(rest); return; }
  if (cmd === 'compare')        { cmdCompare(rest[0] || null); return; }
  if (cmd === 'diff')           { cmdDiff(rest); return; }
  if (cmd === 'projects')       { cmdProjects(); return; }
  if (cmd === 'status')         { cmdStatus(); return; }
  if (cmd === 'review-pending') { cmdReviewPending(rest[0] || null); return; }
  if (cmd === 'apply-pending')  { cmdApplyPending(rest[0] || null); return; }
  console.log('unknown command: ' + cmd);
  usage();
  process.exit(1);
}

main();
```

- [ ] **Step 2.6: Run the full test suite to verify the CLI still works**

```bash
npm test
```

Expected: **198/198 pass**.

- [ ] **Step 2.7: Smoke-test the CLI manually**

```bash
node index.js status
```

Expected: same output as before the refactor (project counts, DB stats, etc.).

```bash
node index.js review-pending Sobha\ Hartland\ Waves
```

Expected: same `pending changes:` output + writes CSV + HTML + auto-opens browser (unchanged behavior from `feat/m-approval-extensions`).

- [ ] **Step 2.8: Commit**

```bash
git add src/commands/ index.js
git commit -m "refactor: move cmd* functions into src/commands/ for library reuse"
```

---

## Task 3: Minimal Electron shell — `electron/main.js` + `electron/preload.js` + blank `BrowserWindow`

**Files:**
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `electron/renderer/index.html`
- Create: `electron/assets/icon.ico` (placeholder — see step 3.5)

**Goal:** Run `npm run start:electron` and see a blank Sobha-branded window open. No buttons yet, no IPC, just proof the framework boots.

- [ ] **Step 3.1: Create `electron/main.js`**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#F6F1E9',                       // matches SOBHA_STYLE_CSS --bg
    title: 'DL-Processor',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false  // we need Node in the preload for require('fs') etc.
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS apps stay running with no windows. Windows/Linux quit on last-window-close.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 3.2: Create `electron/preload.js` (placeholder for now)**

```js
const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal API to the renderer. We'll expand this in Tasks 5+ when
// the IPC handlers exist on the main side.
contextBridge.exposeInMainWorld('dlp', {
  version: () => ipcRenderer.invoke('dlp:version'),
});
```

- [ ] **Step 3.3: Create `electron/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;">
  <title>DL-Processor</title>
  <style>
    /* Minimal placeholder — Task 8 will load the full Sobha-branded stylesheet. */
    body { font-family: 'Dubai', 'Inter', 'Segoe UI', sans-serif; background: #F6F1E9; color: #1F1A14; margin: 0; padding: 40px; }
    h1 { color: #5C3D1E; font-weight: 700; }
    .stamp { color: #8A7E69; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>DL-Processor</h1>
  <p class="stamp">Electron shell booted. Sidebar / log panel / tab host arrive in subsequent tasks.</p>
</body>
</html>
```

- [ ] **Step 3.4: Smoke-test the Electron shell**

```bash
npm run start:electron
```

Expected: a 1400×900 Electron window opens with cream background and the placeholder text. Close the window — the process should exit cleanly.

- [ ] **Step 3.5: Add a placeholder icon**

Until Task 14, use a 256×256 ICO file as a placeholder. Either:
- Copy any existing `.ico` from the user's system (e.g., `C:\Windows\System32\imageres.dll` ICO extractor) into `electron/assets/icon.ico`, OR
- Generate one from a Sobha logo PNG using https://convertio.co/png-ico/ (offline equivalent: `imagemagick` `convert logo.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`).

If you don't have either right now, place a 1-byte placeholder and skip the icon load in `main.js` for v1.0-dev (Task 14 will replace it):

```bash
type nul > electron/assets/icon.ico  # Windows cmd
# OR
touch electron/assets/icon.ico        # Git Bash
```

The placeholder will produce an Electron console warning but won't break the build.

- [ ] **Step 3.6: Run the test suite to confirm no regression**

```bash
npm test
```

Expected: 198/198 pass. No new tests in this task — the Electron shell isn't unit-testable. Manual smoke (Step 3.4) is the verification.

- [ ] **Step 3.7: Commit**

```bash
git add electron/ package.json
git commit -m "feat(electron): minimal main + preload + blank renderer window"
```

---

## Task 4: `electron/command-bridge.js` + IPC handlers + log streaming

**Files:**
- Create: `electron/command-bridge.js`
- Modify: `electron/main.js` (wire in the IPC handlers)
- Modify: `electron/preload.js` (expose `runCommand` + log subscription)
- Create: `test/electron/command-bridge.test.js` (~6 tests)

**Goal:** A command invoked from the renderer (later) reaches the main process, runs the corresponding `cmd*` function from `src/commands/*.js`, streams `console.log` output back to the renderer as `dlp:log:line` events, and resolves a final `dlp:command:done` event with exit stats.

- [ ] **Step 4.1: Write the failing test file `test/electron/command-bridge.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandBridge } = require('../../electron/command-bridge');

function makeFakeIpc() {
  const handlers = {};
  const sent = [];
  return {
    handle(channel, fn) { handlers[channel] = fn; },
    send(channel, ...args) { sent.push([channel, ...args]); },
    invoke(channel, ...args) {
      if (!handlers[channel]) throw new Error('no handler for ' + channel);
      return handlers[channel]({ sender: { send: (c, ...a) => sent.push([c, ...a]) } }, ...args);
    },
    sent
  };
}

test('command-bridge: registers a handler for each known command', () => {
  const ipc = makeFakeIpc();
  createCommandBridge(ipc, { dataFolder: 'C:/fake' });
  // Confirm by attempting to invoke each. (Each handler will likely fail
  // because there's no real DB, but invoke() should at least find them.)
  const knownCommands = ['status', 'projects', 'review-pending', 'apply-pending',
                         'import-dld', 'import-sf', 'compare', 'diff', 'all', 'parse'];
  for (const c of knownCommands) {
    assert.equal(typeof ipc.handlers ? ipc.handlers['dlp:cmd:' + c] : 'function', 'function');
  }
});

test('command-bridge: dlp:version returns app version from package.json', async () => {
  const ipc = makeFakeIpc();
  createCommandBridge(ipc, { dataFolder: 'C:/fake' });
  const v = await ipc.invoke('dlp:version');
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test('command-bridge: invoking a command streams console.log lines as dlp:log:line', async () => {
  const ipc = makeFakeIpc();
  createCommandBridge(ipc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => { console.log('  hello from status'); }
  }});
  await ipc.invoke('dlp:cmd:status');
  const logLines = ipc.sent.filter(([c]) => c === 'dlp:log:line');
  assert.ok(logLines.length >= 1);
  assert.match(logLines[0][1].text, /hello from status/);
});

test('command-bridge: invoking a command resolves with dlp:command:done containing exitCode', async () => {
  const ipc = makeFakeIpc();
  createCommandBridge(ipc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => {}
  }});
  const result = await ipc.invoke('dlp:cmd:status');
  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'status');
});

test('command-bridge: a command that throws produces exitCode=1 and an error log line', async () => {
  const ipc = makeFakeIpc();
  createCommandBridge(ipc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => { throw new Error('boom'); }
  }});
  const result = await ipc.invoke('dlp:cmd:status');
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /boom/);
  const errLines = ipc.sent.filter(([c, payload]) => c === 'dlp:log:line' && payload.level === 'error');
  assert.ok(errLines.length >= 1);
});

test('command-bridge: sets process.env.DLP_DATA_ROOT to the dataFolder before invoking', async () => {
  const ipc = makeFakeIpc();
  let seen = null;
  createCommandBridge(ipc, { dataFolder: 'C:/my/data', commandsOverride: {
    'status': () => { seen = process.env.DLP_DATA_ROOT; }
  }});
  const prev = process.env.DLP_DATA_ROOT;
  try { await ipc.invoke('dlp:cmd:status'); }
  finally { if (prev === undefined) delete process.env.DLP_DATA_ROOT; else process.env.DLP_DATA_ROOT = prev; }
  assert.equal(seen, 'C:/my/data');
});
```

Note: the tests use a `makeFakeIpc()` instead of Electron's real `ipcMain` so they run in plain Node. The bridge accepts a duck-typed IPC object with `.handle()` so it's testable.

- [ ] **Step 4.2: Run the tests to verify they fail**

```bash
npm test -- --test-name-pattern=command-bridge
```

Expected: 6 failures (`Cannot find module '../../electron/command-bridge'`).

- [ ] **Step 4.3: Create `electron/command-bridge.js`**

```js
// Wraps each cmd* function for invocation over IPC.
// Captures console.log/error output during the call and ships it back to
// the renderer as 'dlp:log:line' events, then resolves with a final result.

const path = require('path');
const { cmdAll }           = require('../src/commands/all');
const { cmdParse }         = require('../src/commands/parse');
const { cmdImport }        = require('../src/commands/import-dld');
const { cmdImportSf }      = require('../src/commands/import-sf');
const { cmdCompare }       = require('../src/commands/compare');
const { cmdDiff }          = require('../src/commands/diff');
const { cmdProjects }      = require('../src/commands/projects');
const { cmdStatus }        = require('../src/commands/status');
const { cmdReviewPending } = require('../src/commands/review-pending');
const { cmdApplyPending }  = require('../src/commands/apply-pending');

const DEFAULT_COMMANDS = {
  'all':            (args) => cmdAll(),
  'parse':          (args) => cmdParse(args || []),
  'import-dld':     (args) => cmdImport(args || []),
  'import-sf':      (args) => cmdImportSf(args || []),
  'compare':        (args) => cmdCompare((args && args[0]) || null),
  'diff':           (args) => cmdDiff(args || []),
  'projects':       (args) => cmdProjects(),
  'status':         (args) => cmdStatus(),
  'review-pending': (args) => cmdReviewPending((args && args[0]) || null),
  'apply-pending':  (args) => cmdApplyPending((args && args[0]) || null)
};

function createCommandBridge(ipc, { dataFolder, commandsOverride } = {}) {
  const commands = commandsOverride
    ? Object.assign({}, DEFAULT_COMMANDS, commandsOverride)
    : DEFAULT_COMMANDS;

  ipc.handle('dlp:version', () => {
    const pkg = require('../package.json');
    return pkg.version;
  });

  for (const [name, fn] of Object.entries(commands)) {
    ipc.handle('dlp:cmd:' + name, async (event, args) => {
      const sender = event.sender;
      const stampedSend = (level, text) => {
        sender.send('dlp:log:line', { level, text, ts: Date.now() });
      };
      // Capture console.log/error during the command call.
      const origLog = console.log;
      const origErr = console.error;
      console.log   = (...a) => { stampedSend('info',  a.map(String).join(' ')); };
      console.error = (...a) => { stampedSend('error', a.map(String).join(' ')); };

      const prevRoot = process.env.DLP_DATA_ROOT;
      if (dataFolder) process.env.DLP_DATA_ROOT = dataFolder;

      try {
        await Promise.resolve(fn(args));
        return { command: name, exitCode: 0 };
      } catch (e) {
        stampedSend('error', e.message);
        return { command: name, exitCode: 1, error: e.message };
      } finally {
        console.log = origLog;
        console.error = origErr;
        if (prevRoot === undefined) delete process.env.DLP_DATA_ROOT;
        else process.env.DLP_DATA_ROOT = prevRoot;
      }
    });
  }
}

module.exports = { createCommandBridge };
```

- [ ] **Step 4.4: Adjust the first test (`registers a handler for each known command`) to match the real bridge**

The test currently checks `ipc.handlers[...]`. Update the fake IPC and test to access registered handlers correctly. Replace the first test body with:

```js
test('command-bridge: registers a handler for each known command', () => {
  const handlers = {};
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake' });
  const expected = ['dlp:version',
    'dlp:cmd:all', 'dlp:cmd:parse', 'dlp:cmd:import-dld', 'dlp:cmd:import-sf',
    'dlp:cmd:compare', 'dlp:cmd:diff', 'dlp:cmd:projects', 'dlp:cmd:status',
    'dlp:cmd:review-pending', 'dlp:cmd:apply-pending'];
  for (const ch of expected) {
    assert.equal(typeof handlers[ch], 'function', 'missing handler: ' + ch);
  }
});
```

- [ ] **Step 4.5: Run the tests to verify all 6 pass**

```bash
npm test -- --test-name-pattern=command-bridge
```

Expected: 6 pass.

- [ ] **Step 4.6: Wire the bridge into `electron/main.js`**

Edit `electron/main.js`. Add at the top:

```js
const { ipcMain } = require('electron');
const { createCommandBridge } = require('./command-bridge');
```

In `app.whenReady().then(...)`, before `createWindow()`:

```js
app.whenReady().then(() => {
  // Data folder will be set by the first-run wizard in Task 7. For now,
  // default to ~/Documents/DL-Processor.
  const dataFolder = path.join(app.getPath('documents'), 'DL-Processor');
  createCommandBridge(ipcMain, { dataFolder });
  createWindow();
});
```

- [ ] **Step 4.7: Expand `electron/preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlp', {
  version: () => ipcRenderer.invoke('dlp:version'),
  runCommand: (name, args) => ipcRenderer.invoke('dlp:cmd:' + name, args || []),
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('dlp:log:line', listener);
    return () => ipcRenderer.removeListener('dlp:log:line', listener);
  }
});
```

- [ ] **Step 4.8: Manual smoke**

Add a temporary button in `electron/renderer/index.html` to verify end-to-end:

```html
<button id="run-status">Run status</button>
<pre id="log"></pre>
<script>
  window.dlp.onLog(({ level, text }) => {
    const pre = document.getElementById('log');
    pre.textContent += '[' + level + '] ' + text + '\n';
  });
  document.getElementById('run-status').addEventListener('click', async () => {
    const result = await window.dlp.runCommand('status');
    console.log('command done:', result);
  });
</script>
```

Run `npm run start:electron`. Click "Run status". Expected: log lines appear listing project counts, DB stats. Console shows `command done: { command: 'status', exitCode: 0 }`.

Remove the temporary button before commit (Task 9 will rebuild this properly).

- [ ] **Step 4.9: Run the full suite**

```bash
npm test
```

Expected: 198 + 6 = **204/204 pass**.

- [ ] **Step 4.10: Commit**

```bash
git add electron/command-bridge.js electron/main.js electron/preload.js test/electron/command-bridge.test.js
git commit -m "feat(electron): command-bridge IPC handlers with log streaming"
```

---

## Task 5: `electron/data-folder.js` — first-run wizard logic + legacy migration

**Files:**
- Create: `electron/data-folder.js`
- Create: `test/electron/data-folder.test.js` (~5 tests)

**Goal:** Pure-Node logic for detecting whether a first-run wizard is needed, scaffolding the data folder, detecting legacy installs, and copying data over. UI for the wizard comes in Task 8.

- [ ] **Step 5.1: Write `test/electron/data-folder.test.js` — 5 failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig
} = require('../../electron/data-folder');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('defaultDataFolder is ~/Documents/DL-Processor on the host platform', () => {
  const d = defaultDataFolder(path.join(os.tmpdir(), 'fake-home', 'Documents'));
  assert.equal(d, path.join(os.tmpdir(), 'fake-home', 'Documents', 'DL-Processor'));
});

test('ensureDataFolderLayout creates root + 5 subfolders + an empty config file', () => {
  const root = path.join(tmpDir('dlp-data-'), 'DL-Processor');
  try {
    ensureDataFolderLayout(root);
    assert.ok(fs.existsSync(path.join(root, 'db')));
    assert.ok(fs.existsSync(path.join(root, 'input')));
    assert.ok(fs.existsSync(path.join(root, 'input', 'Changes Template Input')));
    assert.ok(fs.existsSync(path.join(root, 'output')));
    assert.ok(fs.existsSync(path.join(root, 'sf-input')));
    assert.ok(fs.existsSync(path.join(root, 'config')));
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

test('detectLegacyInstall finds a legacy db file when present', () => {
  const dir = tmpDir('dlp-legacy-');
  try {
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'db', 'dl-processor.db'), 'fakebinary');
    const result = detectLegacyInstall([dir]);
    assert.ok(result);
    assert.equal(result.dbPath, path.join(dir, 'db', 'dl-processor.db'));
    assert.equal(result.root, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('detectLegacyInstall returns null when no candidate paths have a db', () => {
  const dir = tmpDir('dlp-empty-');
  try {
    const result = detectLegacyInstall([dir]);
    assert.equal(result, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migrateLegacyData copies db/input/output/sf-input/config to target; leaves source intact', () => {
  const legacyDir = tmpDir('dlp-legacy-');
  const targetDir = path.join(tmpDir('dlp-target-'), 'DL-Processor');
  try {
    fs.mkdirSync(path.join(legacyDir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'db', 'dl-processor.db'), 'fakedb');
    fs.mkdirSync(path.join(legacyDir, 'input'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'input', 'sample.xps'), 'XPSDATA');
    fs.mkdirSync(path.join(legacyDir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'config', 'auto-approve.json'), '{"price_tolerance_pct":0.5,"area_tolerance_pct":0.5}');
    ensureDataFolderLayout(targetDir);
    const summary = migrateLegacyData(legacyDir, targetDir);
    assert.ok(fs.existsSync(path.join(targetDir, 'db', 'dl-processor.db')));
    assert.ok(fs.existsSync(path.join(targetDir, 'input', 'sample.xps')));
    assert.ok(fs.existsSync(path.join(targetDir, 'config', 'auto-approve.json')));
    // Source still intact.
    assert.ok(fs.existsSync(path.join(legacyDir, 'db', 'dl-processor.db')));
    assert.ok(summary.filesCopied >= 3);
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
  }
});

test('loadAppConfig / saveAppConfig round-trip a config object through a JSON file', () => {
  const dir = tmpDir('dlp-cfg-');
  const cfgPath = path.join(dir, 'config.json');
  try {
    saveAppConfig(cfgPath, { dataFolder: 'C:/users/me/Documents/DL-Processor', version: '1.0.0' });
    const loaded = loadAppConfig(cfgPath);
    assert.equal(loaded.dataFolder, 'C:/users/me/Documents/DL-Processor');
    assert.equal(loaded.version, '1.0.0');
    // Missing file returns null without throwing.
    assert.equal(loadAppConfig(path.join(dir, 'nope.json')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 5.2: Run the tests to verify all 5 (well, 6 — the count above is 6) fail**

```bash
npm test -- --test-name-pattern="defaultDataFolder|ensureDataFolderLayout|detectLegacyInstall|migrateLegacyData|loadAppConfig"
```

Expected: 6 failures (`Cannot find module '../../electron/data-folder'`).

- [ ] **Step 5.3: Create `electron/data-folder.js`**

```js
const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultDataFolder(documentsPath) {
  const docs = documentsPath || path.join(os.homedir(), 'Documents');
  return path.join(docs, 'DL-Processor');
}

const SUBFOLDERS = ['db', 'input', 'input/Changes Template Input', 'output', 'sf-input', 'config'];

function ensureDataFolderLayout(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of SUBFOLDERS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

// Look for an existing DL-Processor install by checking each candidate path
// for a `db/dl-processor.db` file. Returns the first match or null.
function detectLegacyInstall(candidatePaths) {
  for (const root of candidatePaths) {
    const dbPath = path.join(root, 'db', 'dl-processor.db');
    if (fs.existsSync(dbPath)) {
      return { root, dbPath };
    }
  }
  return null;
}

// Recursive copy with destination-pre-existence preserving source intact.
function copyRecursive(srcRoot, dstRoot) {
  let filesCopied = 0;
  function copy(srcPath, dstPath) {
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      for (const entry of fs.readdirSync(srcPath)) {
        copy(path.join(srcPath, entry), path.join(dstPath, entry));
      }
    } else {
      fs.copyFileSync(srcPath, dstPath);
      filesCopied += 1;
    }
  }
  copy(srcRoot, dstRoot);
  return filesCopied;
}

function migrateLegacyData(legacyRoot, targetRoot) {
  const summary = { filesCopied: 0, foldersCopied: [] };
  const folders = ['db', 'input', 'output', 'sf-input', 'config'];
  for (const folder of folders) {
    const src = path.join(legacyRoot, folder);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(targetRoot, folder);
    summary.filesCopied += copyRecursive(src, dst);
    summary.foldersCopied.push(folder);
  }
  return summary;
}

function loadAppConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (e) { throw new Error('failed to parse app config at ' + configPath + ': ' + e.message); }
}

function saveAppConfig(configPath, cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig,
  SUBFOLDERS
};
```

- [ ] **Step 5.4: Run the tests to verify all 6 pass**

```bash
npm test -- --test-name-pattern="defaultDataFolder|ensureDataFolderLayout|detectLegacyInstall|migrateLegacyData|loadAppConfig"
```

Expected: 6 pass.

- [ ] **Step 5.5: Run the full suite**

```bash
npm test
```

Expected: 204 + 6 = **210/210 pass**.

- [ ] **Step 5.6: Commit**

```bash
git add electron/data-folder.js test/electron/data-folder.test.js
git commit -m "feat(electron): data-folder helper — first-run wizard + legacy migration logic"
```

---

## Task 6: First-run wizard UI (renderer modal) + main-side wiring

**Files:**
- Modify: `electron/main.js` (check config on launch; show wizard if needed; pass dataFolder to bridge)
- Modify: `electron/preload.js` (expose `firstRun` API)
- Modify: `electron/renderer/index.html` (modal markup)
- Modify: `electron/renderer/app.js` (wizard JS — will create this file)

**Goal:** On first launch (no `userData/config.json`), a full-screen modal shows with: data-folder picker (default `~/Documents/DL-Processor`), legacy-install detection result with copy/skip choice, Continue button. On click Continue: scaffold the folder, optionally copy legacy data, save config, dismiss modal, refresh the (still placeholder) renderer.

This task is renderer-heavy and not unit-testable. Smoke check is the verification.

- [ ] **Step 6.1: Modify `electron/main.js` to check config on launch**

Add to the top of the file:

```js
const {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig
} = require('./data-folder');
const { dialog } = require('electron');
```

Add a module-level state object:

```js
const state = {
  dataFolder: null,
  appConfigPath: null
};
```

Replace the `app.whenReady().then(...)` block with:

```js
app.whenReady().then(async () => {
  state.appConfigPath = path.join(app.getPath('userData'), 'config.json');
  const cfg = loadAppConfig(state.appConfigPath);

  if (cfg && cfg.dataFolder) {
    state.dataFolder = cfg.dataFolder;
  } else {
    // First-run flow handled by the renderer; main exposes the helpers via IPC.
    state.dataFolder = defaultDataFolder(app.getPath('documents'));
  }

  createCommandBridge(ipcMain, { dataFolder: state.dataFolder });

  // First-run-wizard IPC handlers.
  ipcMain.handle('dlp:firstrun:needed', () => loadAppConfig(state.appConfigPath) === null);

  ipcMain.handle('dlp:firstrun:default-folder', () => defaultDataFolder(app.getPath('documents')));

  ipcMain.handle('dlp:firstrun:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose data folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultDataFolder(app.getPath('documents'))
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dlp:firstrun:detect-legacy', () => {
    // Look in the historical project root + the user's home.
    const candidates = [
      'C:\\projects\\DL-Processor',
      path.join(app.getPath('home'), 'dl-processor'),
      path.join(app.getPath('home'), 'Documents', 'DL-Processor')
    ];
    return detectLegacyInstall(candidates);
  });

  ipcMain.handle('dlp:firstrun:finalize', (event, { folder, migrateFrom }) => {
    ensureDataFolderLayout(folder);
    let summary = null;
    if (migrateFrom) summary = migrateLegacyData(migrateFrom, folder);
    saveAppConfig(state.appConfigPath, { dataFolder: folder, version: app.getVersion() });
    state.dataFolder = folder;
    // Update the command bridge's env var. The simplest path: re-create the
    // bridge with the new dataFolder. Each command call already wraps env-var
    // setup inside its try/finally so this is safe.
    createCommandBridge(ipcMain, { dataFolder: folder });
    return { folder, summary };
  });

  createWindow();
});
```

(Note: `createCommandBridge` registers handlers; calling it twice would double-register. Modify `createCommandBridge` in `electron/command-bridge.js` to first call `ipcMain.removeHandler(...)` for each channel before re-registering. Or — simpler — store the dataFolder in a module-level mutable in `command-bridge.js` and call a setter. Implementer's choice; the test for re-registration is below.)

- [ ] **Step 6.2: Add a `setDataFolder` exit hatch to `command-bridge.js`**

In `electron/command-bridge.js`, refactor so the data folder is read each invocation, not closed over at register time:

```js
let currentDataFolder = null;

function setDataFolder(folder) {
  currentDataFolder = folder;
}

function createCommandBridge(ipc, { dataFolder, commandsOverride } = {}) {
  currentDataFolder = dataFolder || currentDataFolder;
  // ... existing logic, but inside each handler:
  //    if (currentDataFolder) process.env.DLP_DATA_ROOT = currentDataFolder;
}

module.exports = { createCommandBridge, setDataFolder };
```

Update `electron/main.js`: replace the second `createCommandBridge(...)` call in `dlp:firstrun:finalize` with `setDataFolder(folder)`.

Add one test in `test/electron/command-bridge.test.js`:

```js
test('command-bridge: setDataFolder updates the env var for subsequent invocations', async () => {
  const handlers = {};
  const fakeIpc = { handle(c, fn) { handlers[c] = fn; } };
  const { createCommandBridge, setDataFolder } = require('../../electron/command-bridge');
  let seen = [];
  createCommandBridge(fakeIpc, { dataFolder: 'C:/initial', commandsOverride: {
    'status': () => { seen.push(process.env.DLP_DATA_ROOT); }
  }});
  await handlers['dlp:cmd:status']({ sender: { send: () => {} } });
  setDataFolder('C:/updated');
  await handlers['dlp:cmd:status']({ sender: { send: () => {} } });
  assert.deepEqual(seen, ['C:/initial', 'C:/updated']);
});
```

Run: `npm test -- --test-name-pattern=command-bridge` → expect 7 pass.

- [ ] **Step 6.3: Expand `electron/preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlp', {
  version:    () => ipcRenderer.invoke('dlp:version'),
  runCommand: (name, args) => ipcRenderer.invoke('dlp:cmd:' + name, args || []),
  onLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('dlp:log:line', listener);
    return () => ipcRenderer.removeListener('dlp:log:line', listener);
  },
  firstRun: {
    needed:        () => ipcRenderer.invoke('dlp:firstrun:needed'),
    defaultFolder: () => ipcRenderer.invoke('dlp:firstrun:default-folder'),
    pickFolder:    () => ipcRenderer.invoke('dlp:firstrun:pick-folder'),
    detectLegacy:  () => ipcRenderer.invoke('dlp:firstrun:detect-legacy'),
    finalize:      ({ folder, migrateFrom }) => ipcRenderer.invoke('dlp:firstrun:finalize', { folder, migrateFrom })
  }
});
```

- [ ] **Step 6.4: Replace `electron/renderer/index.html` with the wizard markup**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com;">
  <title>DL-Processor</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>

  <!-- First-run wizard. Hidden by default; app.js will show it if needed. -->
  <div id="first-run-wizard" hidden>
    <div class="wizard-card">
      <h1>Welcome to DL-Processor</h1>
      <p class="muted">Where should DL-Processor store its data?</p>
      <div class="folder-row">
        <input id="wizard-folder" type="text" readonly>
        <button id="wizard-pick">Choose…</button>
      </div>
      <div id="wizard-legacy" hidden>
        <p>We found an existing DL-Processor install at <code id="wizard-legacy-path"></code>.</p>
        <label><input type="checkbox" id="wizard-migrate" checked> Copy <code>db/ input/ output/ sf-input/ config/</code> from the old install</label>
      </div>
      <div class="wizard-actions">
        <button id="wizard-continue" class="primary">Continue</button>
      </div>
    </div>
  </div>

  <!-- App shell (visible after wizard completes). Tasks 9-12 fill this in. -->
  <div id="app-shell" hidden>
    <header class="top-bar">
      <span class="brand">DL-Processor</span>
      <span class="data-folder" id="header-data-folder"></span>
    </header>
    <main>
      <aside class="sidebar" id="sidebar">
        <p class="muted">Sidebar buttons land in Task 9.</p>
      </aside>
      <section class="content">
        <div class="tab-host" id="tab-host">
          <p class="muted" style="padding:20px">Tabs land in Task 11.</p>
        </div>
        <div class="log-panel" id="log-panel">
          <p class="muted" style="padding:8px">Log lines stream here once Task 10 lands.</p>
        </div>
      </section>
    </main>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 6.5: Create `electron/renderer/styles.css` (minimal)**

```css
@import url('https://fonts.googleapis.com/css2?family=Dubai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --bg:#F6F1E9; --surface:#FFFFFF; --surface-2:#FBF5EA;
  --border:#E3D9C8; --border-2:#C8B896;
  --ink:#1F1A14; --ink-2:#5A4A37; --muted:#8A7E69;
  --accent:#85633B; --accent-dark:#5C3D1E; --accent-soft:#F0E4CE;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); height: 100%; }
body { font: 13px/1.5 'Dubai', 'Inter', 'Segoe UI', Arial, sans-serif; }

/* Wizard */
#first-run-wizard { position: fixed; inset: 0; background: rgba(28,20,10,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.wizard-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; width: 520px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.wizard-card h1 { margin: 0 0 6px 0; font-size: 18px; font-weight: 700; color: var(--accent-dark); }
.muted { color: var(--muted); }
.folder-row { display: flex; gap: 8px; margin: 12px 0; }
.folder-row input { flex: 1; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-2); }
.folder-row button { padding: 6px 14px; border: 1px solid var(--border-2); border-radius: 6px; background: var(--surface); cursor: pointer; }
.wizard-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.wizard-actions .primary { background: var(--accent); color: #fff; border: 1px solid var(--accent-dark); border-radius: 6px; padding: 8px 18px; cursor: pointer; }
#wizard-legacy { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 12px 0; }
#wizard-legacy code { background: var(--bg); padding: 1px 4px; border-radius: 3px; }
#wizard-legacy label { display: block; margin-top: 6px; }

/* App shell */
#app-shell { height: 100%; display: flex; flex-direction: column; }
.top-bar { display: flex; align-items: center; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); gap: 16px; }
.brand { font-weight: 700; color: var(--accent-dark); font-size: 14px; }
.data-folder { color: var(--muted); font-size: 12px; }
main { flex: 1; display: flex; min-height: 0; }
.sidebar { width: 220px; background: var(--surface); border-right: 1px solid var(--border); padding: 8px; }
.content { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.tab-host { flex: 1; background: var(--surface); border-bottom: 1px solid var(--border); overflow: auto; }
.log-panel { height: 30%; min-height: 120px; background: var(--surface-2); padding: 8px 12px; overflow: auto; font-family: 'Consolas', 'Cascadia Mono', monospace; font-size: 12px; }
```

- [ ] **Step 6.6: Create `electron/renderer/app.js`**

```js
(async function() {
  const needed = await window.dlp.firstRun.needed();

  if (needed) {
    document.getElementById('first-run-wizard').hidden = false;
    const defaultFolder = await window.dlp.firstRun.defaultFolder();
    document.getElementById('wizard-folder').value = defaultFolder;

    document.getElementById('wizard-pick').addEventListener('click', async () => {
      const picked = await window.dlp.firstRun.pickFolder();
      if (picked) document.getElementById('wizard-folder').value = picked;
    });

    const legacy = await window.dlp.firstRun.detectLegacy();
    if (legacy) {
      document.getElementById('wizard-legacy').hidden = false;
      document.getElementById('wizard-legacy-path').textContent = legacy.root;
    }

    document.getElementById('wizard-continue').addEventListener('click', async () => {
      const folder = document.getElementById('wizard-folder').value;
      const migrate = document.getElementById('wizard-migrate')?.checked;
      const migrateFrom = (legacy && migrate) ? legacy.root : null;
      const result = await window.dlp.firstRun.finalize({ folder, migrateFrom });
      document.getElementById('first-run-wizard').hidden = true;
      showAppShell(result.folder);
    });
  } else {
    // Reuse the saved dataFolder; main process sets it from the config.
    showAppShell(null);  // header will pull from preload eventually.
  }

  function showAppShell(dataFolder) {
    document.getElementById('app-shell').hidden = false;
    if (dataFolder) document.getElementById('header-data-folder').textContent = dataFolder;
  }
})();
```

- [ ] **Step 6.7: Manual smoke**

Delete the dev config so the wizard fires:
```bash
# Find userData path: it's printed by Electron's app.getPath('userData') call.
# On Windows: %APPDATA%\dl-processor\config.json
rm "$APPDATA/dl-processor/config.json" 2>/dev/null || del "%APPDATA%\dl-processor\config.json"
```

Run:
```bash
npm run start:electron
```

Expected:
- Wizard modal appears with default folder set to `C:\Users\<you>\Documents\DL-Processor`.
- "Choose…" button opens a native folder picker.
- If `C:\projects\DL-Processor` exists with a `db/dl-processor.db`, the "We found an existing install" panel shows with the migrate checkbox.
- Click "Continue" → wizard dismisses → app shell appears → header shows the chosen folder path.

Re-run the app: wizard should NOT show on the second launch (config persisted). To re-test the wizard, delete `config.json` again.

- [ ] **Step 6.8: Run the full suite (one extra test from Step 6.2)**

```bash
npm test
```

Expected: 210 + 1 = **211/211 pass**.

- [ ] **Step 6.9: Commit**

```bash
git add electron/main.js electron/preload.js electron/command-bridge.js electron/renderer/ test/electron/command-bridge.test.js
git commit -m "feat(electron): first-run wizard — data folder pick + legacy migration + IPC wiring"
```

---

## Task 7: Sidebar with buttons mirroring the CLI menu

**Files:**
- Create: `electron/renderer/sidebar.js`
- Modify: `electron/renderer/styles.css` (sidebar button styling)
- Modify: `electron/renderer/index.html` (sidebar markup)
- Modify: `electron/renderer/app.js` (wire sidebar into log + tab host)

**Goal:** Left sidebar with one button per CLI command. Click → runs that command via `window.dlp.runCommand` → output streams into the log panel (Task 10 builds the panel properly, for now we keep the placeholder).

Renderer-only; no unit tests. Manual smoke is the verification.

- [ ] **Step 7.1: Update `electron/renderer/index.html` sidebar block**

Replace the `<aside class="sidebar">` content with:

```html
<aside class="sidebar" id="sidebar">
  <button class="cmd-btn" data-cmd="all" data-label="Full pipeline">⚡ Run full pipeline</button>
  <div class="sidebar-section">Import</div>
  <button class="cmd-btn" data-cmd="import-dld" data-label="Import DLD">📥 Import DLD</button>
  <button class="cmd-btn" data-cmd="import-sf"  data-label="Import SF">📥 Import Salesforce</button>
  <div class="sidebar-section">Reconcile</div>
  <button class="cmd-btn" data-cmd="compare" data-label="Compare">🔍 Compare</button>
  <button class="cmd-btn" data-cmd="diff"    data-label="Diff (month-over-month)">📊 Diff</button>
  <div class="sidebar-section">Master data</div>
  <button class="cmd-btn" data-cmd="review-pending" data-label="Review pending">📝 Review pending</button>
  <button class="cmd-btn" data-cmd="apply-pending"  data-label="Apply pending"
          data-needs-file="true">✅ Apply pending</button>
  <div class="sidebar-section">View</div>
  <button class="cmd-btn" data-cmd="status"   data-label="Status">📈 Status</button>
  <button class="cmd-btn" data-cmd="projects" data-label="Projects">🏢 Projects</button>
</aside>
```

- [ ] **Step 7.2: Add sidebar CSS to `electron/renderer/styles.css`**

```css
.sidebar { display: flex; flex-direction: column; gap: 4px; }
.sidebar .sidebar-section { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 12px; padding: 0 4px; }
.sidebar .cmd-btn { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; text-align: left; cursor: pointer; color: var(--ink); font: inherit; }
.sidebar .cmd-btn:hover { background: var(--accent-soft); border-color: var(--border-2); }
.sidebar .cmd-btn.is-running { background: var(--warn-bg, #F5D78E); border-color: var(--warn, #8A5A08); cursor: wait; }
.sidebar .cmd-btn:disabled { opacity: 0.6; cursor: not-allowed; }
```

- [ ] **Step 7.3: Create `electron/renderer/sidebar.js`**

```js
// Wires sidebar buttons to dlp.runCommand. Disables all buttons while one is
// running so we don't accidentally interleave two commands' log output.

function initSidebar({ logPanel, onCommandDone }) {
  const buttons = Array.from(document.querySelectorAll('.cmd-btn'));

  async function run(btn) {
    const cmd = btn.getAttribute('data-cmd');
    const label = btn.getAttribute('data-label') || cmd;
    const needsFile = btn.getAttribute('data-needs-file') === 'true';

    let args = [];
    if (needsFile) {
      // Apply-pending: ask main to open a file picker. We re-use the
      // first-run-style folder picker exposed via a new IPC channel in Task 8.
      // For now, just run without an arg — apply-pending defaults to its own path.
      args = [];
    }

    setRunning(true, btn);
    logPanel.appendInfo('— running: ' + label + ' —');
    try {
      const result = await window.dlp.runCommand(cmd, args);
      logPanel.appendInfo('— done: ' + label + ' (exit ' + result.exitCode + ') —');
      if (onCommandDone) onCommandDone(result);
    } catch (e) {
      logPanel.appendError('error running ' + cmd + ': ' + (e && e.message ? e.message : e));
    } finally {
      setRunning(false, btn);
    }
  }

  function setRunning(running, activeBtn) {
    for (const b of buttons) {
      b.disabled = running;
      b.classList.toggle('is-running', running && b === activeBtn);
    }
  }

  for (const b of buttons) {
    b.addEventListener('click', () => run(b));
  }
}

window.__initSidebar = initSidebar;
```

- [ ] **Step 7.4: Wire sidebar into `electron/renderer/app.js`**

After `showAppShell(...)`, call:

```js
// Placeholder log panel until Task 10 builds the real one.
const logPanel = {
  appendInfo:  (text) => appendLog('info',  text),
  appendError: (text) => appendLog('error', text)
};
function appendLog(level, text) {
  const panel = document.getElementById('log-panel');
  const line = document.createElement('div');
  line.className = 'log-line log-' + level;
  line.textContent = '[' + new Date().toISOString().slice(11, 19) + '] ' + text;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

window.dlp.onLog((payload) => appendLog(payload.level || 'info', payload.text));
window.__initSidebar({ logPanel, onCommandDone: (result) => {
  // Task 11 will open report HTML files as tabs here.
} });
```

Include the sidebar script in `index.html`:
```html
<script src="sidebar.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 7.5: Manual smoke**

```bash
npm run start:electron
```

Expected:
- Sidebar shows 9 buttons grouped under Import / Reconcile / Master data / View headings.
- Click "Status" → log panel fills with project counts.
- Click "Projects" → log panel shows the project list.
- All buttons are disabled while one is running (yellow background on the active one).
- Click "Review pending" → log panel fills with the existing review-pending output. `pending-changes.csv` and `approve-pending.html` should be written into the configured data folder.

Verify on disk:
```bash
ls "$USERPROFILE/Documents/DL-Processor/output/csv/"
ls "$USERPROFILE/Documents/DL-Processor/output/approve-pending.html"
```

Both should exist after running the command.

- [ ] **Step 7.6: Commit**

```bash
git add electron/renderer/
git commit -m "feat(electron): sidebar with one button per CLI command + log streaming"
```

---

## Task 8: Apply-pending file picker (IPC + sidebar integration)

**Files:**
- Modify: `electron/main.js` (add `dlp:pick:csv` handler)
- Modify: `electron/preload.js` (expose `pickCsv`)
- Modify: `electron/renderer/sidebar.js` (use pickCsv for `data-needs-file` buttons)

**Goal:** Click "Apply pending" → file picker opens at the user's data-folder `input/Changes Template Input/` → pick the CSV → command runs against that file.

- [ ] **Step 8.1: Add the IPC handler in `electron/main.js`**

Add inside `app.whenReady().then(...)`:

```js
ipcMain.handle('dlp:pick:csv', async (event, { initialDir, title } = {}) => {
  const start = initialDir || path.join(state.dataFolder, 'input', 'Changes Template Input');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose decisions CSV',
    properties: ['openFile'],
    defaultPath: start,
    filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});
```

- [ ] **Step 8.2: Expose `pickCsv` in preload**

```js
pickCsv: (opts) => ipcRenderer.invoke('dlp:pick:csv', opts || {}),
```

(Add inside the `contextBridge.exposeInMainWorld('dlp', { ... })` object.)

- [ ] **Step 8.3: Update sidebar.js**

In the `run(btn)` function, replace the `if (needsFile)` block with:

```js
let args = [];
if (needsFile) {
  const csvPath = await window.dlp.pickCsv({
    title: 'Choose decisions CSV',
  });
  if (!csvPath) {
    logPanel.appendInfo('cancelled — no file picked');
    return;
  }
  args = [csvPath];
}
```

- [ ] **Step 8.4: Manual smoke**

Run `npm run start:electron`. Click "Apply pending" → native file dialog opens at `~/Documents/DL-Processor/input/Changes Template Input/` → pick a CSV → command runs and the log shows "applied N approvals · M rejections".

- [ ] **Step 8.5: Commit**

```bash
git add electron/
git commit -m "feat(electron): file picker for [Apply pending] CSV selection"
```

---

## Task 9: Tab host — render generated HTML reports as in-app tabs

**Files:**
- Create: `electron/renderer/tab-host.js`
- Modify: `electron/main.js` (add `dlp:tab:open` / `dlp:tab:close` handlers using BrowserView)
- Modify: `electron/preload.js` (expose `tabs` API)
- Modify: `electron/renderer/styles.css` (tab strip CSS)
- Modify: `electron/renderer/app.js` (`onCommandDone` opens the matching report)

**Goal:** After `review-pending` finishes, automatically open `output/approve-pending.html` as a tab inside the app. After `compare`, open the project's compare HTML. Tabs are switchable, closable. Multiple tabs open simultaneously.

- [ ] **Step 9.1: Add BrowserView management in `electron/main.js`**

Add at the top:

```js
const { BrowserView } = require('electron');
```

Add module state:

```js
const tabs = new Map();  // tabId -> { view, url, title }
let nextTabId = 1;
let activeTabId = null;
```

Add IPC handlers inside `app.whenReady().then(...)`:

```js
ipcMain.handle('dlp:tab:open', (event, { url, title }) => {
  const id = String(nextTabId++);
  const view = new BrowserView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  view.setAutoResize({ width: true, height: true });
  mainWindow.addBrowserView(view);
  view.webContents.loadURL(url);
  tabs.set(id, { view, url, title });
  setActiveTab(id);
  return { id, title, url };
});

ipcMain.handle('dlp:tab:activate', (event, { id }) => {
  setActiveTab(id);
});

ipcMain.handle('dlp:tab:close', (event, { id }) => {
  const t = tabs.get(id);
  if (!t) return;
  mainWindow.removeBrowserView(t.view);
  t.view.webContents.destroy();
  tabs.delete(id);
  if (activeTabId === id) {
    activeTabId = null;
    const next = tabs.keys().next().value;
    if (next) setActiveTab(next);
  }
});

function setActiveTab(id) {
  activeTabId = id;
  for (const [tid, t] of tabs.entries()) {
    if (tid === id) {
      t.view.setBackgroundColor('#FFFFFF');
      // Reorder so the active view sits on top.
      mainWindow.setTopBrowserView(t.view);
      sizeActiveTab();
    }
  }
}

function sizeActiveTab() {
  if (!activeTabId) return;
  const t = tabs.get(activeTabId);
  if (!t) return;
  const [w, h] = mainWindow.getContentSize();
  // Match the .tab-host region in styles.css: below the top-bar (~40px) and
  // sidebar (220px wide), above the log panel (30% height).
  const TOP_BAR = 40;
  const TAB_STRIP = 30;
  const SIDEBAR_W = 220;
  const LOG_H = Math.floor(h * 0.3);
  t.view.setBounds({
    x: SIDEBAR_W,
    y: TOP_BAR + TAB_STRIP,
    width: w - SIDEBAR_W,
    height: h - TOP_BAR - TAB_STRIP - LOG_H
  });
}

// Wire size into window resize.
mainWindow && mainWindow.on('resize', sizeActiveTab);
```

(Note: that `mainWindow && ...` is brittle because `mainWindow` is set inside `createWindow()` later. Move the resize listener inside `createWindow()` instead.)

- [ ] **Step 9.2: Expose `tabs` API in `electron/preload.js`**

```js
tabs: {
  open:     ({ url, title }) => ipcRenderer.invoke('dlp:tab:open',     { url, title }),
  activate: (id) => ipcRenderer.invoke('dlp:tab:activate', { id }),
  close:    (id) => ipcRenderer.invoke('dlp:tab:close',    { id })
}
```

- [ ] **Step 9.3: Create `electron/renderer/tab-host.js`**

```js
function initTabHost() {
  const strip = document.createElement('div');
  strip.className = 'tab-strip';
  strip.innerHTML = '<div class="tab-strip-tabs"></div>';
  document.getElementById('tab-host').prepend(strip);
  const tabsContainer = strip.querySelector('.tab-strip-tabs');

  const tabs = new Map();  // tabId -> tab DOM element

  async function open({ url, title }) {
    const result = await window.dlp.tabs.open({ url, title });
    addTab(result.id, result.title);
    return result.id;
  }

  function addTab(id, title) {
    const t = document.createElement('div');
    t.className = 'tab is-active';
    t.dataset.tabId = id;
    t.innerHTML = '<span class="tab-title"></span><button class="tab-close" type="button">×</button>';
    t.querySelector('.tab-title').textContent = title;
    t.querySelector('.tab-title').addEventListener('click', () => activate(id));
    t.querySelector('.tab-close').addEventListener('click', () => close(id));
    tabsContainer.appendChild(t);
    for (const [otherId, otherEl] of tabs.entries()) otherEl.classList.remove('is-active');
    tabs.set(id, t);
  }

  function activate(id) {
    window.dlp.tabs.activate(id);
    for (const [otherId, otherEl] of tabs.entries()) {
      otherEl.classList.toggle('is-active', otherId === id);
    }
  }

  function close(id) {
    window.dlp.tabs.close(id);
    const t = tabs.get(id);
    if (t) { t.remove(); tabs.delete(id); }
  }

  return { open, activate, close };
}

window.__initTabHost = initTabHost;
```

- [ ] **Step 9.4: Add tab-strip CSS to `electron/renderer/styles.css`**

```css
.tab-strip { height: 30px; background: var(--surface-2); border-bottom: 1px solid var(--border); display: flex; align-items: stretch; }
.tab-strip-tabs { display: flex; gap: 1px; flex: 1; overflow-x: auto; }
.tab { display: flex; align-items: center; padding: 4px 10px; background: var(--surface); border-right: 1px solid var(--border); cursor: pointer; font-size: 12px; max-width: 200px; }
.tab.is-active { background: var(--accent-soft); border-bottom: 2px solid var(--accent); }
.tab-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab-close { background: transparent; border: 0; margin-left: 8px; color: var(--muted); cursor: pointer; font-size: 14px; }
.tab-close:hover { color: var(--down, #A12C1B); }
```

- [ ] **Step 9.5: Wire tabs into `app.js` `onCommandDone`**

```js
window.__tabHost = window.__initTabHost();

const reportPathsByCommand = {
  'review-pending': (dataFolder) => 'file:///' + dataFolder.replace(/\\/g, '/') + '/output/approve-pending.html',
  'compare':        (dataFolder) => 'file:///' + dataFolder.replace(/\\/g, '/') + '/output/dashboard.html',
  'all':            (dataFolder) => 'file:///' + dataFolder.replace(/\\/g, '/') + '/output/dashboard.html'
};

const tabTitles = {
  'review-pending': 'Approve pending',
  'compare':        'Dashboard',
  'all':            'Dashboard'
};

window.__initSidebar({ logPanel, onCommandDone: async (result) => {
  if (result.exitCode !== 0) return;
  const builder = reportPathsByCommand[result.command];
  if (!builder) return;
  const url = builder(currentDataFolder);
  await window.__tabHost.open({ url, title: tabTitles[result.command] });
} });
```

Where `currentDataFolder` is set after `showAppShell(folder)`:

```js
let currentDataFolder = null;
function showAppShell(dataFolder) {
  currentDataFolder = dataFolder;
  // ... existing code
}
```

- [ ] **Step 9.6: Manual smoke**

```bash
npm run start:electron
```

- Click "Review pending". Expected: command runs, log fills, a new tab "Approve pending" appears at the top of the center panel, and the approve-pending HTML renders inside it. All collapsible-section interactions from `aded405` work because BrowserView is a full Chromium instance.
- Run "Status" then "Review pending" again. Two tabs visible. Click between them. Active tab has the bronze underline.
- Click the × on a tab → tab closes. Window state stable.
- Resize the window. BrowserView resizes with it.

- [ ] **Step 9.7: Commit**

```bash
git add electron/main.js electron/preload.js electron/renderer/
git commit -m "feat(electron): tab host renders HTML reports inline via BrowserView"
```

---

## Task 10: Top bar — project selector + data folder display + settings cog

**Files:**
- Modify: `electron/renderer/index.html` (top-bar markup)
- Modify: `electron/renderer/styles.css` (top-bar styling)
- Create: `electron/renderer/top-bar.js`
- Create: `electron/renderer/settings-modal.js`
- Modify: `electron/main.js` (add `dlp:projects:list` handler that queries the DB)

- [ ] **Step 10.1: Add `dlp:projects:list` IPC handler in `electron/main.js`**

```js
const { openDb } = require('../src/commands/shared');

ipcMain.handle('dlp:projects:list', () => {
  const db = openDb();
  try {
    return db.prepare('SELECT project_id, project_name FROM dld_project ORDER BY project_name').all();
  } finally { db.close(); }
});
```

- [ ] **Step 10.2: Expose `projects.list` in preload**

```js
projects: { list: () => ipcRenderer.invoke('dlp:projects:list') }
```

- [ ] **Step 10.3: Update `electron/renderer/index.html` top-bar block**

```html
<header class="top-bar">
  <span class="brand">DL-Processor</span>
  <select id="project-selector"><option value="">All projects</option></select>
  <span class="data-folder" id="header-data-folder"></span>
  <span class="spacer"></span>
  <button id="btn-settings" class="icon-btn" title="Settings">⚙</button>
</header>
```

- [ ] **Step 10.4: Add top-bar CSS**

```css
.top-bar select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); font: inherit; }
.top-bar .spacer { flex: 1; }
.top-bar .icon-btn { background: transparent; border: 1px solid transparent; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 16px; }
.top-bar .icon-btn:hover { background: var(--accent-soft); border-color: var(--border-2); }
```

- [ ] **Step 10.5: Create `electron/renderer/top-bar.js`**

```js
function initTopBar({ getDataFolder, getProjectFilter, setProjectFilter, openSettings }) {
  const sel = document.getElementById('project-selector');
  const dfLabel = document.getElementById('header-data-folder');
  const settingsBtn = document.getElementById('btn-settings');

  async function refreshProjects() {
    sel.innerHTML = '<option value="">All projects</option>';
    const projects = await window.dlp.projects.list();
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.project_name;
      opt.textContent = p.project_name;
      sel.appendChild(opt);
    }
    const filter = getProjectFilter();
    if (filter) sel.value = filter;
  }

  sel.addEventListener('change', () => setProjectFilter(sel.value || null));
  settingsBtn.addEventListener('click', openSettings);

  function refreshDataFolder() {
    dfLabel.textContent = getDataFolder();
    dfLabel.title = 'Click to open folder';
    dfLabel.style.cursor = 'pointer';
  }

  dfLabel.addEventListener('click', () => {
    if (window.dlp.shell && window.dlp.shell.showInFolder) {
      window.dlp.shell.showInFolder(getDataFolder());
    }
  });

  return { refreshProjects, refreshDataFolder };
}

window.__initTopBar = initTopBar;
```

- [ ] **Step 10.6: Add `shell.showInFolder` IPC + preload**

In `electron/main.js`:

```js
const { shell } = require('electron');
ipcMain.handle('dlp:shell:show-in-folder', (event, folder) => {
  shell.openPath(folder);
});
```

In preload:

```js
shell: { showInFolder: (p) => ipcRenderer.invoke('dlp:shell:show-in-folder', p) }
```

- [ ] **Step 10.7: Create `electron/renderer/settings-modal.js` (minimal — Task 12 expands)**

```js
function initSettingsModal({ getDataFolder, onCheckForUpdates }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Settings</h2>
      <div class="settings-row">
        <label>Data folder</label>
        <code id="settings-data-folder"></code>
      </div>
      <div class="settings-row">
        <label>Version</label>
        <code id="settings-version"></code>
      </div>
      <div class="settings-row">
        <button id="settings-check-updates" class="primary">Check for updates</button>
        <span id="settings-update-status" class="muted"></span>
      </div>
      <div class="modal-actions">
        <button id="settings-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function open() {
    modal.hidden = false;
    document.getElementById('settings-data-folder').textContent = getDataFolder();
    window.dlp.version().then(v => { document.getElementById('settings-version').textContent = v; });
  }

  modal.querySelector('#settings-close').addEventListener('click', () => { modal.hidden = true; });
  modal.querySelector('#settings-check-updates').addEventListener('click', async () => {
    const statusEl = document.getElementById('settings-update-status');
    statusEl.textContent = 'checking…';
    try {
      const result = await onCheckForUpdates();
      statusEl.textContent = result.message;
    } catch (e) { statusEl.textContent = 'error: ' + e.message; }
  });

  return { open };
}

window.__initSettingsModal = initSettingsModal;
```

CSS for modal:

```css
.modal { position: fixed; inset: 0; background: rgba(28,20,10,.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal-card { background: var(--surface); border-radius: 12px; padding: 20px 28px; width: 480px; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.modal-card h2 { margin: 0 0 12px 0; color: var(--accent-dark); font-size: 16px; }
.settings-row { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
.settings-row label { width: 110px; color: var(--muted); }
.settings-row code { background: var(--surface-2); padding: 2px 6px; border-radius: 3px; }
.modal-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
.modal-actions button { padding: 6px 14px; border: 1px solid var(--border-2); border-radius: 6px; background: var(--surface); cursor: pointer; }
.primary { background: var(--accent) !important; color: #fff !important; border-color: var(--accent-dark) !important; }
```

- [ ] **Step 10.8: Wire into `app.js`**

```js
let currentDataFolder = null;
let currentProjectFilter = null;

function showAppShell(dataFolder) {
  document.getElementById('app-shell').hidden = false;
  currentDataFolder = dataFolder;

  const topBar = window.__initTopBar({
    getDataFolder: () => currentDataFolder,
    getProjectFilter: () => currentProjectFilter,
    setProjectFilter: (f) => { currentProjectFilter = f; },
    openSettings: () => settingsModal.open()
  });
  topBar.refreshProjects();
  topBar.refreshDataFolder();

  const settingsModal = window.__initSettingsModal({
    getDataFolder: () => currentDataFolder,
    onCheckForUpdates: async () => {
      // Task 13 wires this.
      return { message: 'update checker arrives in Task 13' };
    }
  });

  window.__tabHost = window.__initTabHost();

  window.dlp.onLog((payload) => appendLog(payload.level || 'info', payload.text));
  window.__initSidebar({
    logPanel,
    getProjectFilter: () => currentProjectFilter,
    onCommandDone: async (result) => { /* ...same as Task 9 */ }
  });
}
```

Update sidebar.js's `run(btn)` to pass `currentProjectFilter` as an arg for commands that accept one:

```js
const projectFilter = (window.__getProjectFilter && window.__getProjectFilter()) || null;
let args = projectFilter ? [projectFilter] : [];
if (needsFile) { /* same as before */ }
```

Or have the sidebar receive `getProjectFilter` via its init opts.

- [ ] **Step 10.9: Manual smoke**

Run, verify:
- Top bar shows brand "DL-Processor", project selector dropdown with the known projects, data folder path.
- Click data folder path → opens the folder in Windows Explorer.
- Pick a project → next "Review pending" or "Compare" command runs filtered to that project.
- Click ⚙ → settings modal opens; shows version + data folder.

- [ ] **Step 10.10: Commit**

```bash
git add electron/
git commit -m "feat(electron): top bar — project selector + data folder display + settings modal"
```

---

## Task 11: `electron/update-checker.js` + Settings integration

**Files:**
- Create: `electron/update-checker.js`
- Create: `test/electron/update-checker.test.js` (~4 tests)
- Modify: `electron/main.js` (add `dlp:update:check` IPC)
- Modify: `electron/preload.js`
- Modify: `electron/renderer/app.js` (wire `onCheckForUpdates`)

**Goal:** Settings → "Check for updates" fetches `https://dl-processor.pages.dev/latest.yml`, compares to the current `app.getVersion()`. If newer, prompts to download + install via `shell.openExternal(downloadUrl)` (v1.0 ships the simplest path — let the OS handle the download; v1.1 may use electron-updater's autoInstall).

- [ ] **Step 11.1: Write `test/electron/update-checker.test.js` — 4 failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLatestYml, compareVersions, buildUpdateResult } = require('../../electron/update-checker');

const SAMPLE_YML = `version: 1.0.1
path: DL-Processor Setup 1.0.1.exe
releaseDate: '2026-05-11T10:00:00.000Z'
`;

test('parseLatestYml extracts version, path, and releaseDate', () => {
  const parsed = parseLatestYml(SAMPLE_YML);
  assert.equal(parsed.version, '1.0.1');
  assert.equal(parsed.path, 'DL-Processor Setup 1.0.1.exe');
  assert.equal(parsed.releaseDate, '2026-05-11T10:00:00.000Z');
});

test('compareVersions returns +1 / 0 / -1 for newer / same / older', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'),  1);
  assert.equal(compareVersions('1.0.0', '1.0.0'),  0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.1.0', '1.0.9'),  1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('buildUpdateResult: newer available → status=available with downloadUrl', () => {
  const r = buildUpdateResult('1.0.0', {
    version: '1.0.1', path: 'DL-Processor Setup 1.0.1.exe', releaseDate: '2026-05-11T10:00:00.000Z'
  }, 'https://dl-processor.pages.dev');
  assert.equal(r.status, 'available');
  assert.equal(r.available, '1.0.1');
  assert.equal(r.downloadUrl, 'https://dl-processor.pages.dev/DL-Processor%20Setup%201.0.1.exe');
  assert.match(r.message, /update available: 1\.0\.1/i);
});

test('buildUpdateResult: same or older → status=up-to-date', () => {
  const r = buildUpdateResult('1.0.0', { version: '1.0.0', path: 'x' }, 'https://x');
  assert.equal(r.status, 'up-to-date');
  assert.match(r.message, /up to date/i);
});
```

- [ ] **Step 11.2: Run tests — expect 4 failures**

`npm test -- --test-name-pattern=update-checker` → 4 fail.

- [ ] **Step 11.3: Create `electron/update-checker.js`**

```js
// Minimal YAML parser — only handles the 3 keys electron-builder writes
// for our simplified latest.yml. We don't pull in a full YAML library.
function parseLatestYml(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // Strip surrounding quotes if present.
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function compareVersions(a, b) {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] || 0, bv = bp[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function buildUpdateResult(currentVersion, parsedYml, baseUrl) {
  const cmp = compareVersions(parsedYml.version, currentVersion);
  if (cmp <= 0) {
    return {
      status: 'up-to-date',
      current: currentVersion,
      message: 'You are up to date (' + currentVersion + ').'
    };
  }
  const file = parsedYml.path;
  return {
    status: 'available',
    current: currentVersion,
    available: parsedYml.version,
    downloadUrl: baseUrl + '/' + encodeURIComponent(file),
    releaseDate: parsedYml.releaseDate,
    message: 'Update available: ' + parsedYml.version + ' (you have ' + currentVersion + ')'
  };
}

async function checkForUpdates({ currentVersion, baseUrl, fetchImpl }) {
  const fetch = fetchImpl || globalThis.fetch;
  const res = await fetch(baseUrl + '/latest.yml');
  if (!res.ok) throw new Error('update server returned ' + res.status);
  const text = await res.text();
  const parsed = parseLatestYml(text);
  if (!parsed.version) throw new Error('latest.yml is missing version field');
  return buildUpdateResult(currentVersion, parsed, baseUrl);
}

module.exports = { parseLatestYml, compareVersions, buildUpdateResult, checkForUpdates };
```

- [ ] **Step 11.4: Run update-checker tests — expect pass**

`npm test -- --test-name-pattern=update-checker` → 4 pass.

- [ ] **Step 11.5: Wire `dlp:update:check` in `electron/main.js`**

```js
const { checkForUpdates } = require('./update-checker');

ipcMain.handle('dlp:update:check', async () => {
  return await checkForUpdates({
    currentVersion: app.getVersion(),
    baseUrl: 'https://dl-processor.pages.dev'
  });
});

ipcMain.handle('dlp:update:open-download', (event, url) => {
  shell.openExternal(url);
});
```

- [ ] **Step 11.6: Expose `update.check` + `update.openDownload` in preload**

```js
update: {
  check:        () => ipcRenderer.invoke('dlp:update:check'),
  openDownload: (url) => ipcRenderer.invoke('dlp:update:open-download', url)
}
```

- [ ] **Step 11.7: Wire into Settings modal**

In `app.js`, replace the placeholder `onCheckForUpdates`:

```js
const settingsModal = window.__initSettingsModal({
  getDataFolder: () => currentDataFolder,
  onCheckForUpdates: async () => {
    const result = await window.dlp.update.check();
    if (result.status === 'available') {
      if (confirm(result.message + '\n\nOpen download page?')) {
        window.dlp.update.openDownload(result.downloadUrl);
      }
    }
    return result;
  }
});
```

- [ ] **Step 11.8: Manual smoke**

For now, with no Cloudflare host yet set up, the fetch will fail. That's expected. Settings → "Check for updates" → status text shows the error message ("update server returned ..." or a network error). After Task 16 (release upload), this will return real results.

To smoke-test locally without a real server:
```bash
# Spin up a temporary server
mkdir _smoke && cd _smoke
echo "version: 1.0.1
path: DL-Processor Setup 1.0.1.exe
releaseDate: '2026-05-11T10:00:00.000Z'" > latest.yml
python -m http.server 8765 &
```

Patch the baseUrl temporarily to `http://localhost:8765`. Verify the settings modal shows "Update available: 1.0.1". Revert to the production URL.

- [ ] **Step 11.9: Run the full suite**

```bash
npm test
```

Expected: 211 + 4 = **215/215 pass**.

- [ ] **Step 11.10: Commit**

```bash
git add electron/update-checker.js test/electron/update-checker.test.js electron/main.js electron/preload.js electron/renderer/
git commit -m "feat(electron): update-checker against Cloudflare Pages latest.yml"
```

---

## Task 12: `electron-builder.yml` + icon assets + `npm run dist`

**Files:**
- Create: `electron-builder.yml`
- Modify: `electron/assets/icon.ico` (real icon, no longer placeholder)
- Modify: `package.json` (`build` field if needed; verify `dist` script)
- Create: `BUILDING.md` (release-build notes)

**Goal:** Run `npm run dist` and produce `dist-electron/DL-Processor Setup 1.0.0.exe` and `dist-electron/DL-Processor-1.0.0-win.zip`. The .exe installs to `Program Files\DL-Processor\`, places a desktop shortcut, registers in Add/Remove Programs, and on launch opens the app with the wizard ready.

- [ ] **Step 12.1: Create the real `electron/assets/icon.ico`**

Take Sobha Realty's logo (Ali has this — bronze/cream branding). Convert to a multi-resolution ICO file containing 16, 32, 48, 64, 128, 256 sizes. Tools:
- Online: https://convertio.co/png-ico/ — upload a 1024×1024 PNG, set the "icon sizes" option.
- Offline: `magick convert sobha-logo.png -define icon:auto-resize=256,128,64,48,32,16 electron/assets/icon.ico` (ImageMagick).
- Photoshop / Affinity Designer: export as .ico with multiple resolutions.

Replace `electron/assets/icon.ico`.

- [ ] **Step 12.2: Create `electron-builder.yml`**

```yaml
appId: ae.sobha.dl-processor
productName: DL-Processor
copyright: Copyright © 2026 Sobha Realty — Registration Team
directories:
  output: dist-electron
  buildResources: electron/assets

# What goes into the package
files:
  - 'src/**/*'
  - 'index.js'
  - 'electron/**/*'
  - 'db/schema.sql'
  - 'package.json'
  - 'node_modules/**/*'
  - '!**/*.test.js'
  - '!docs/**/*'
  - '!test/**/*'
  - '!_smoke/**/*'

# better-sqlite3 must be unpacked from the asar archive so it can be loaded
# as a native module at runtime.
asarUnpack:
  - 'node_modules/better-sqlite3/**/*'

win:
  target:
    - target: nsis
      arch: [x64]
    - target: zip
      arch: [x64]
  icon: electron/assets/icon.ico

nsis:
  oneClick: false                # show install location step
  perMachine: false              # install per-user (no admin needed)
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  createStartMenuShortcut: true
  shortcutName: DL-Processor
  installerIcon: electron/assets/icon.ico
  uninstallerIcon: electron/assets/icon.ico

publish: null                    # we hand-upload to Cloudflare Pages
```

- [ ] **Step 12.3: Update `package.json` if needed**

Make sure `"main": "electron/main.js"` (set in Task 1) and the `"scripts"` block has the `dist` script. Confirm `"version"` is `"1.0.0"`.

Add a `"description"` and `"author"` if missing (electron-builder uses these in the installer metadata):

```json
"description": "DL-Processor — reconcile DLD Project Inquiry reports against Salesforce. Desktop app for Windows.",
"author": "Ali Alghumlasi — Sobha Realty Registration Team",
"homepage": "https://dl-processor.pages.dev",
```

- [ ] **Step 12.4: Run the build**

```bash
npm run dist
```

Expected output (~3–5 minutes on a warm machine):
```
  • electron-builder  version=24.x
  • loaded configuration  file=electron-builder.yml
  • writing effective config
  • rebuilding native dependencies
  • packaging       platform=win32 arch=x64
  • building        target=nsis arch=x64 file=...DL-Processor Setup 1.0.0.exe
  • building        target=zip arch=x64 file=...DL-Processor-1.0.0-win.zip
  • building blockmap
```

Verify in `dist-electron/`:
- `DL-Processor Setup 1.0.0.exe` (~75 MB)
- `DL-Processor-1.0.0-win.zip` (~80 MB)
- `latest.yml`
- `builder-debug.yml`
- `win-unpacked/` (the raw unpacked app)

- [ ] **Step 12.5: Smoke-test the installer**

```bash
# In a fresh user dir, simulate a colleague's first install.
# (Or just run it; the uninstaller will roll back.)
"dist-electron/DL-Processor Setup 1.0.0.exe"
```

Expected:
1. NSIS installer wizard opens. Title "DL-Processor 1.0.0 Setup".
2. Choose install location (defaults to `%LOCALAPPDATA%\Programs\dl-processor\`).
3. Install runs (~5 seconds).
4. Desktop shortcut + Start Menu entry created.
5. Optional "Launch DL-Processor" checkbox — leave checked; click Finish.
6. App launches. SmartScreen may show "Windows protected your PC" (since unsigned) — click More info → Run anyway (the workaround Ali signed off on).
7. First-run wizard appears. Pick `~/Documents/DL-Processor`. If legacy install is detected, copy data over.
8. App shell appears. Sidebar buttons work. Status command runs. Approve-pending HTML renders in a tab.

Uninstall: Settings → Apps → DL-Processor → Uninstall. Verify all installed files removed; `~/Documents/DL-Processor/` data folder is NOT removed (user data preserved).

- [ ] **Step 12.6: Create `BUILDING.md` documenting the release process**

```markdown
# Building & Releasing DL-Processor Desktop

## Prerequisites

- Windows 10/11 machine (build target is Windows only for v1.0)
- Node.js 18+ and npm 9+
- ~3 GB free disk for Electron + electron-builder caches
- Photoshop / online .ico converter for icon updates (rarely needed)

## Local development

```bash
git clone <repo>
cd DL-Processor
npm install              # ~2 minutes; rebuilds better-sqlite3 for Electron
npm run start:electron   # opens the dev window
```

To clear the first-run wizard for re-testing:
```bash
del "%APPDATA%\dl-processor\config.json"
```

## Building the Windows installer

```bash
npm run dist
```

Produces:
- `dist-electron/DL-Processor Setup 1.0.0.exe` (NSIS installer)
- `dist-electron/DL-Processor-1.0.0-win.zip` (portable zip)
- `dist-electron/latest.yml` (update manifest)

Build time: ~3–5 minutes warm; ~10 minutes cold (first Electron download).

## Releasing a new version

1. **Bump version.** Edit `package.json` `"version"`. Follow semver: 1.0.0 → 1.0.1 (patch) → 1.1.0 (minor feature) → 2.0.0 (breaking).
2. **Build.** `npm run dist`.
3. **Test locally.** Run the new .exe; verify first-run wizard, sidebar commands, tab host all work.
4. **Update changelog.** Edit `changelog.md` in the `dl-processor-releases` repo (separate repo, Cloudflare Pages source).
5. **Copy artifacts.** Copy `dist-electron/DL-Processor Setup X.X.X.exe`, `DL-Processor-X.X.X-win.zip`, and `latest.yml` to the `dl-processor-releases` repo.
6. **Commit + push.**
   ```bash
   cd ~/dl-processor-releases
   git add .
   git commit -m "release: X.X.X"
   git push
   ```
7. **Verify.** Within ~30 seconds, Cloudflare Pages publishes. Open `https://dl-processor.pages.dev/latest.yml` in a browser and confirm the new version appears.
8. **Notify colleagues.** Optional: send an email pointing at the download page. Auto-update via Settings → "Check for updates" will surface the new version on next launch.
```

- [ ] **Step 12.7: Commit**

```bash
git add electron-builder.yml electron/assets/icon.ico BUILDING.md package.json
git commit -m "feat(electron): electron-builder config + Sobha icon + BUILDING.md release notes"
```

---

## Task 13: README updates + manual smoke checklist

**Files:**
- Modify: `README.md`
- Create: `docs/release-checklist-v1.0.md`

- [ ] **Step 13.1: Add a "Desktop app (Windows)" section near the top of `README.md`**

```markdown
## Desktop app (Windows)

Don't want to install Node.js? Download the pre-built Windows installer:

→ **[Download DL-Processor 1.0.0](https://dl-processor.pages.dev/DL-Processor%20Setup%201.0.0.exe)**

### First-install on Windows

When you run the installer, Windows SmartScreen may show:

> Windows protected your PC
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.

Click **More info**, then **Run anyway**. This only happens on the first
install — Windows remembers your choice for future runs and updates.

### After installation

1. **Pick your data folder.** The first-launch wizard asks where to store
   data. Default is `~/Documents/DL-Processor/`. Change it if you keep
   data on a network share.
2. **Migrate legacy data.** If you previously had DL-Processor at
   `C:\projects\DL-Processor\`, the wizard offers to copy your DB, inputs,
   and outputs to the new location.
3. **Run a command.** Click any sidebar button. Output streams into the
   log panel; HTML reports open as tabs inside the app.

### Updating

Settings (⚙ in the top right) → **Check for updates**. If a newer version
is available, click the link to download the installer. Your data folder
is untouched by updates.
```

- [ ] **Step 13.2: Create `docs/release-checklist-v1.0.md`**

```markdown
# DL-Processor Desktop v1.0 — Release Checklist

Run this checklist before publishing v1.0 to Cloudflare Pages.

## Build
- [ ] `git log --oneline` — confirm HEAD is the release commit.
- [ ] `package.json` version === target release (e.g., `1.0.0`).
- [ ] `npm install` — fresh.
- [ ] `npm test` — all 215+ tests green.
- [ ] `npm run dist` — produces installer + portable zip without errors.

## Manual smoke (Windows)
- [ ] Install via `DL-Processor Setup X.X.X.exe`. Confirm SmartScreen workaround text matches README.
- [ ] First-run wizard appears. Default folder is `~/Documents/DL-Processor/`. Pick it.
- [ ] If `C:\projects\DL-Processor\` exists, migration prompt shows. Click "copy data over".
- [ ] After wizard: app shell appears. Top bar shows brand + data folder path + ⚙ button.
- [ ] Sidebar shows 9 buttons grouped under Import / Reconcile / Master data / View.
- [ ] Click **Status** → log fills with project counts.
- [ ] Click **Review pending** → log fills + new tab "Approve pending" opens + HTML renders inline.
- [ ] In the tab, click a section header → expands. Edit a proposed value → row turns yellow + "Approve with override" appears.
- [ ] Click **Export decisions** → CSV downloads to the user's Downloads folder.
- [ ] Click **Apply pending** → file picker opens at `~/Documents/DL-Processor/input/Changes Template Input/`. Pick the downloaded CSV. Log shows "applied N approvals · M rejections".
- [ ] Open Settings (⚙) → "Check for updates" → shows "up to date" (since this IS the latest version).
- [ ] Close the app. Reopen. Wizard does NOT show; data folder is remembered.

## Publish
- [ ] Copy `dist-electron/DL-Processor Setup X.X.X.exe`, `DL-Processor-X.X.X-win.zip`, `latest.yml` to `~/dl-processor-releases/`.
- [ ] Update `~/dl-processor-releases/changelog.md` with release notes.
- [ ] `cd ~/dl-processor-releases && git add . && git commit -m "release: X.X.X" && git push`.
- [ ] Wait ~30s. Visit `https://dl-processor.pages.dev/latest.yml` in a browser. Confirm new version visible.
- [ ] From an existing installed copy: Settings → "Check for updates" → confirm new version is detected.

## Post-release
- [ ] Tag the release in the main repo: `git tag v1.0.0 && git push --tags`.
- [ ] Notify the team (email / Teams / Slack).
- [ ] Save a `dist-electron/` snapshot to your build archive.
```

- [ ] **Step 13.3: Commit**

```bash
git add README.md docs/release-checklist-v1.0.md
git commit -m "docs: add Windows-app section to README + v1.0 release checklist"
```

---

## Task 14: First Cloudflare Pages release

**This task is operational, not code. Mark each step done as you complete it.**

- [ ] **Step 14.1: Create the `dl-processor-releases` git repo**

```bash
mkdir ~/dl-processor-releases
cd ~/dl-processor-releases
git init
echo "# DL-Processor Releases" > README.md
echo "Hosted at https://dl-processor.pages.dev/" >> README.md
mkdir downloads
echo "## v1.0.0 (2026-05-11)" > changelog.md
echo "" >> changelog.md
echo "Initial Windows release." >> changelog.md
echo "" >> changelog.md
echo "- Sidebar of buttons mirroring the CLI menu" >> changelog.md
echo "- HTML reports render inline as tabs" >> changelog.md
echo "- First-run wizard + legacy migration" >> changelog.md
echo "- In-app 'Check for updates' against Cloudflare Pages" >> changelog.md
git add .
git commit -m "init: dl-processor-releases scaffold"
```

Push to a GitHub repo named `dl-processor-releases` (public or private — Pages supports both):
```bash
gh repo create dl-processor-releases --private --source=. --push
# (After re-authenticating gh CLI per project_dl_item_m_paused.md.)
```

- [ ] **Step 14.2: Connect Cloudflare Pages**

1. Log into https://dash.cloudflare.com.
2. Pages → Create a project → Connect to Git → select `dl-processor-releases`.
3. Build settings: leave blank (static site).
4. Production branch: `main` (or `master` — whichever you used).
5. Deploy. Cloudflare gives you `https://dl-processor.pages.dev` (or a similar subdomain).
6. Verify by visiting the URL — you should see Cloudflare's default file index.

- [ ] **Step 14.3: Upload the v1.0.0 release**

```bash
cd ~/dl-processor-releases
cp /c/projects/DL-Processor/dist-electron/DL-Processor\ Setup\ 1.0.0.exe .
cp /c/projects/DL-Processor/dist-electron/DL-Processor-1.0.0-win.zip .
cp /c/projects/DL-Processor/dist-electron/latest.yml .
git add .
git commit -m "release: 1.0.0"
git push
```

Wait ~30s for Cloudflare to publish.

- [ ] **Step 14.4: Verify end-to-end update flow**

From your installed v1.0.0 copy:
- Settings → "Check for updates" → expect "up to date".

Bump local `package.json` to `1.0.1`, rebuild, copy artifacts, push.

From the installed v1.0.0:
- Settings → "Check for updates" → expect "Update available: 1.0.1".
- Confirm download link works.

- [ ] **Step 14.5: Tag the main repo**

```bash
cd /c/projects/DL-Processor
git tag v1.0.0
git push --tags  # (after gh auth fixed)
```

- [ ] **Step 14.6: (Optional) Set a custom domain**

If/when Sobha IT provisions `dl-processor.sobharealty.com`, add a CNAME to Cloudflare's DNS. Update the `baseUrl` in `electron/update-checker.js`. Ship a v1.0.2 patch with the new URL.

---

## Self-Review (post-write checklist)

**Spec coverage:**
- §Scope item 1 (sidebar of buttons + log panel + tabs) → Tasks 7, 9, 10.
- §Scope item 2 (platform-specific installer) → Task 12.
- §Scope item 3 (first-run wizard + legacy migration) → Tasks 5, 6.
- §Scope item 4 (in-app check for updates) → Task 11.
- §Scope item 5 (246 tests stay green, +15 new) → covered: Task 2 preserves all existing tests; +6 command-bridge, +6 data-folder, +4 update-checker = +16 (close enough). Final 215/215.
- §Architecture (two-process model with IPC) → Tasks 3, 4, 5, 9, 10, 11.
- §UI sidebar layout → Task 7 (9 buttons grouped under 4 section labels).
- §UI tab host (BrowserView per tab) → Task 9.
- §UI top bar (project selector + data folder + settings) → Task 10.
- §Data persistence → Tasks 5, 6.
- §Distribution → Task 12.
- §Updates → Tasks 11, 14.
- §Code signing — skipped per spec, README workaround → Task 13.
- §Schema impact "none" → no schema task; verified.

**Placeholder scan:** every step has actual code or commands. No TBD/TODO. Two "implementer's choice" notes in Tasks 6 and 7 explain a small design freedom (which is OK — the spec didn't lock those down).

**Type/signature consistency:**
- `cmd*` functions all take their original signatures from `index.js`; the bridge passes through.
- `createCommandBridge(ipc, opts)` defined Task 4, called Task 4, refactored with `setDataFolder` in Task 6.
- `lookupSfUnit(db, projectId, unitNumberNorm) → { sf_unit, sf_applicant, sf_price } | null` — used unchanged from the existing m-approval-extensions branch.
- IPC channel naming convention `dlp:<group>:<action>` is consistent across all 13 channels.
- `window.dlp.*` preload API names match their `dlp:*` IPC channel: `dlp.version()`, `dlp.runCommand(name, args)`, `dlp.firstRun.*`, `dlp.tabs.*`, `dlp.update.*`, `dlp.pickCsv()`, `dlp.shell.showInFolder()`, `dlp.projects.list()`, `dlp.onLog(handler)`.

**Test count math:**
| Source | Count |
|---|---|
| Master baseline | 198 |
| Task 4 (command-bridge) | +6 |
| Task 5 (data-folder) | +6 |
| Task 6 (setDataFolder addition) | +1 |
| Task 11 (update-checker) | +4 |
| **Total** | **215** |

Spec target was 213; we land at 215 — within the acceptable ±5 range. (When m-approval-extensions merges to master, baseline jumps from 198 to 246; this branch would then rebase and land at 263.)

**Open issues at hand-off:** none. All spec decisions are baked into the tasks.

---

## Bundling for execution

Recommended subagent-driven-development sequence:

1. **Bundle Tasks 1 + 2** — branch setup + electron deps + refactor cmd* into src/commands. Suite stays at 198.
2. **Task 3 solo** — minimal Electron shell.
3. **Task 4 solo** — command-bridge + 6 tests. Suite 198 → 204.
4. **Task 5 solo** — data-folder + 6 tests. Suite 204 → 210.
5. **Task 6 solo** — first-run wizard UI + 1 test. Suite 210 → 211.
6. **Task 7 solo** — sidebar.
7. **Task 8 solo** — file picker.
8. **Task 9 solo** — tab host.
9. **Task 10 solo** — top bar + settings.
10. **Task 11 solo** — update-checker + 4 tests. Suite 211 → 215.
11. **Task 12 solo** — electron-builder + icon + npm run dist.
12. **Bundle Tasks 13 + 14** — README + release checklist + first Cloudflare upload.

After all tasks: a final cross-branch code review covering the new `electron/` directory and the `src/commands/` refactor. Then transition to `superpowers:finishing-a-development-branch`.

**Estimated total elapsed time:** 2–3 weeks of focused work.
