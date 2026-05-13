const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const { createCommandBridge, setDataFolder } = require('./command-bridge');
const { checkForUpdates } = require('./update-checker');
const {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig
} = require('./data-folder');

let mainWindow = null;

const state = {
  dataFolder: null,
  appConfigPath: null
};

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
      sandbox: false,         // we need Node in the preload for require('fs') etc.
      webSecurity: false      // allow <iframe src="file:///...output/...html"> from the
                              // renderer. Safe because every file we load is content
                              // we generated ourselves into the user's data folder.
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Auto-open DevTools only in dev mode (`npm run dev:electron` passes
  // --enable-logging). Normal `npm run start:electron` runs without it.
  // Set DLP_DEVTOOLS=1 to force-open from any script.
  if (process.argv.includes('--enable-logging') || process.env.DLP_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  // Pipe renderer console output to the main-process terminal so we can debug
  // even when DevTools isn't engaged, AND also send WARN/ERROR/violations
  // back into the renderer's Errors pane via the log-line channel so the
  // user can copy them without opening DevTools.
  mainWindow.webContents.on('console-message', (event, level, message, line, source) => {
    const names = ['LOG', 'WARN', 'ERROR', 'INFO'];
    const name = names[level] || String(level);
    console.log('[renderer:' + name + '] ' + message);
    // Electron emits dev-only security advisories whenever webSecurity is off
    // or insecure content is allowed; they explicitly state they "will not
    // show up once the app is packaged". Skip them so the in-app Errors
    // pane stays clean.
    if (/Electron Security Warning/i.test(message)) return;
    // Surface WARN and ERROR in-app. The Chromium "violation" messages
    // (CSP, mixed content, deprecation) come through as INFO/WARN; treat
    // anything that contains "Refused to" or "Violation" as an error so
    // the user sees it in the Errors pane.
    const isViolation = /Refused to|Violation|TypeError|ReferenceError/i.test(message);
    if (level >= 2 || isViolation) {
      const channel = mainWindow.webContents;
      try {
        channel.send('dlp:log:line', { level: 'error', text: '[renderer] ' + message, ts: Date.now() });
      } catch { /* webContents may have torn down */ }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  state.appConfigPath = path.join(app.getPath('userData'), 'config.json');
  const cfg = loadAppConfig(state.appConfigPath);

  // Decide the data folder:
  //  - If a previous config picked one AND that folder still exists on disk,
  //    keep it (user might have moved the install or chosen a custom path).
  //  - Otherwise, in the packaged .exe default to Desktop\DL-Processor so the
  //    end user gets a zero-config experience with everything on their desktop.
  //  - In dev (npm run start:electron) fall back to the project root so the
  //    existing C:\projects\DL-Processor data keeps working unchanged.
  function pickFolder() {
    if (cfg && cfg.dataFolder && fs.existsSync(cfg.dataFolder)) {
      return cfg.dataFolder;
    }
    if (app.isPackaged) {
      return defaultDataFolder(app.getPath('desktop'));
    }
    return path.join(__dirname, '..');   // project root in dev
  }
  state.dataFolder = pickFolder();
  process.env.DLP_DATA_ROOT = state.dataFolder;

  // Always ensure the directory layout exists — covers fresh installs, moved
  // installs, and the case where the user deleted a subfolder by hand.
  try { ensureDataFolderLayout(state.dataFolder); }
  catch (e) { console.error('failed to create data folder layout:', e.message); }

  // Persist the choice so next launch is identical without re-deciding.
  if (!cfg || cfg.dataFolder !== state.dataFolder) {
    saveAppConfig(state.appConfigPath, { dataFolder: state.dataFolder, version: app.getVersion() });
  }

  createCommandBridge(ipcMain, { dataFolder: state.dataFolder });

  // First-run-wizard IPC handlers.
  ipcMain.handle('dlp:firstrun:needed', () => loadAppConfig(state.appConfigPath) === null);

  ipcMain.handle('dlp:firstrun:default-folder', () => defaultDataFolder(app.getPath('desktop')));

  ipcMain.handle('dlp:firstrun:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose data folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultDataFolder(app.getPath('desktop'))
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
    process.env.DLP_DATA_ROOT = state.dataFolder;
    setDataFolder(folder);  // updates the command-bridge's env-var target
    return { folder, summary };
  });

  ipcMain.handle('dlp:data-folder', () => state.dataFolder);

  ipcMain.handle('dlp:pick:save', async (event, { title, defaultPath, filters } = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: title || 'Save file',
      defaultPath: defaultPath || undefined,
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle('dlp:pick:open', async (event, { title, filters, initialDir } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Open file',
      properties: ['openFile'],
      defaultPath: initialDir || undefined,
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dlp:pick:open-multi', async (event, { title, filters, initialDir } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Choose files',
      properties: ['openFile', 'multiSelections'],
      defaultPath: initialDir || undefined,
      filters: filters || [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths;
  });

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

  // Spawn `node index.js projects --json` instead of opening the DB in-process —
  // Electron's bundled Node ABI (119) differs from system Node's (137), and the
  // installed better-sqlite3 binary is built for the latter. Spawning a child
  // Node process keeps the native module load in a compatible runtime.
  ipcMain.handle('dlp:projects:list', () => {
    return new Promise((resolve, reject) => {
      const indexJs = path.join(__dirname, '..', 'index.js');
      const env = Object.assign({}, process.env);
      if (state.dataFolder) env.DLP_DATA_ROOT = state.dataFolder;
      const childEnv = Object.assign({}, env, { ELECTRON_RUN_AS_NODE: '1' });
      const cwd = state.dataFolder || path.dirname(process.execPath);
      const child = cp.spawn(process.execPath, [indexJs, 'projects', '--json'], {
        env: childEnv, cwd, windowsHide: true
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c.toString(); });
      child.stderr.on('data', (c) => { err += c.toString(); });
      child.on('error', (e) => reject(new Error('projects spawn failed: ' + e.message)));
      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error('projects exit ' + code + ': ' + err.trim()));
        }
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          reject(new Error('projects JSON parse failed. stdout=' + out.slice(0, 200) + ' stderr=' + err.slice(0, 200)));
        }
      });
    });
  });

  ipcMain.handle('dlp:shell:show-in-folder', (event, folder) => {
    shell.openPath(folder);
  });

  // ── Review Pending IPC ────────────────────────────────────────────────
  // The handlers open the DB in-process (Electron's Node 18, ABI 119) via
  // src/commands/shared.openDb, which returns better-sqlite3 — the same
  // binary the test runner uses. Each call opens + closes the DB so we
  // don't hold a long-lived handle across renderer hot reloads.
  const reviewCmds = require('../src/commands/review-pending');

  function withDb(fn) {
    const { openDb } = require('../src/commands/shared');
    const db = openDb();
    try { return fn(db); } finally { db.close(); }
  }

  ipcMain.handle('dlp:review:list',        (e, opts)                           => withDb(db => reviewCmds.listPending(db, opts || {})));
  ipcMain.handle('dlp:review:approve',     (e, { changeId, override = null }) => withDb(db => reviewCmds.approvePending(db, changeId, override)));
  ipcMain.handle('dlp:review:reject',      (e, { changeId })                  => withDb(db => reviewCmds.rejectPending(db, changeId)));
  ipcMain.handle('dlp:review:teach-alias', (e, { changeId, scope })           => withDb(db => reviewCmds.teachAliasAndApprove(db, changeId, { scope })));

  // ── BP grouping IPC (v2.0 Task 13) ────────────────────────────────────
  // Card-level operations over Business Process groups (rows sharing
  // source_snapshot_id + project + unit). Backed by src/commands/review-bps.js.
  const reviewBps = require('../src/commands/review-bps');
  ipcMain.handle('dlp:review:list-bps',       (e, opts)                       => withDb(db => reviewBps.listBps(db, opts || {})));
  ipcMain.handle('dlp:review:approve-bp',     (e, { bpId, overrides })        => withDb(db => reviewBps.approveBp(db, bpId, overrides || {})));
  ipcMain.handle('dlp:review:reject-bp',      (e, { bpId })                   => withDb(db => reviewBps.rejectBp(db, bpId)));
  ipcMain.handle('dlp:review:acknowledge-bp', (e, { bpId })                   => withDb(db => reviewBps.acknowledgeBp(db, bpId)));

  // ── Audit query IPC (v1.1 Task 12+) ───────────────────────────────────
  // Pure SELECTs against audit_log + master_data; safe to run on every
  // panel open. withDb() guarantees the better-sqlite3 handle is closed
  // even if the renderer disconnects mid-call.
  const auditQuery = require('../src/commands/audit-query');
  const auditRevert = require('../src/commands/audit-revert');
  ipcMain.handle('dlp:audit:unit-history', (e, args) => withDb(db => auditQuery.unitHistory(db, args || {})));
  ipcMain.handle('dlp:audit:global', (e, opts) => withDb(db => auditQuery.globalHistory(db, opts || {})));
  ipcMain.handle('dlp:audit:revert', (e, { auditId }) => withDb(db => auditRevert.revertAuditEntry(db, auditId)));
  ipcMain.handle('dlp:audit:export-csv', async (e, opts) => {
    const rows = withDb(db => auditQuery.globalHistory(db, Object.assign({}, opts || {}, { limit: 1000000, offset: 0 })));
    const cols = ['ts','project_name','unit_number_norm','table_name','field','old_value','new_value','action','source','change_id','user_note'];
    const lines = [cols.join(',')];
    for (const r of rows) {
      lines.push(cols.map(c => csvEscape(r[c])).join(','));
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export audit log',
      defaultPath: 'audit-log-' + new Date().toISOString().slice(0, 16).replace(/[:T-]/g, '') + '.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf8');
    return result.filePath;
  });

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ── Import DB modal IPC (v1.1 Task 14) ────────────────────────────────
  // probeZip reads the zip + a read-only handle on the live DB so the
  // renderer can show "what's in this backup vs. what's currently here".
  // commitZip does the atomic swap (writes a .bak.<ISO> safety copy
  // before replacing the DB).
  const dbBackup = require('../src/commands/db-backup');
  ipcMain.handle('dlp:db:probe-zip',  (e, { zipPath } = {}) => dbBackup.probeZip(zipPath,  { dataRoot: state.dataFolder }));
  ipcMain.handle('dlp:db:commit-zip', (e, { zipPath } = {}) => dbBackup.commitZip(zipPath, { dataRoot: state.dataFolder }));

  ipcMain.handle('dlp:update:check', async () => {
    return await checkForUpdates({
      currentVersion: app.getVersion(),
      baseUrl: 'https://dl-processor.pages.dev'
    });
  });

  ipcMain.handle('dlp:update:open-download', (event, url) => {
    shell.openExternal(url);
  });

  // ─── v1.2 patch system ──────────────────────────────────────────────────
  // probe is read-only — just verifies the zip and returns the manifest.
  // apply stages the new asar + .patch-pending marker, launches patch-apply.cmd,
  // and quits. The helper script waits for our PID to exit, swaps the asar,
  // and relaunches DL-Processor.exe.
  const patchEngine = require('./patch-engine');

  ipcMain.handle('dlp:patch:probe-zip', (event, { zipPath } = {}) => {
    return patchEngine.probeZip(zipPath);
  });

  ipcMain.handle('dlp:patch:apply', (event, { zipPath } = {}) => {
    if (!app.isPackaged) {
      return { ok: false, error: 'patches only apply to installed builds, not dev' };
    }
    const installDir = path.dirname(process.execPath);
    const probe = patchEngine.probeZip(zipPath);
    if (!probe.ok) return probe;
    try {
      patchEngine.stagePatch(zipPath, installDir);
    } catch (e) {
      return { ok: false, error: 'stage failed: ' + e.message };
    }
    const helper = path.join(installDir, 'resources', 'patch-apply.cmd');
    const resDir = path.join(installDir, 'resources');
    const pid    = String(process.pid);
    cp.spawn('cmd.exe', ['/c', 'start', '""', helper, pid, resDir, process.execPath], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
    setTimeout(() => app.quit(), 500);
    return { ok: true, scheduled: true };
  });

  ipcMain.handle('dlp:patch:revert-last', () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'revert only works on installed builds' };
    }
    const installDir = path.dirname(process.execPath);
    const result = patchEngine.revertLast(installDir);
    if (!result.canRevert) return { ok: false, ...result };
    setTimeout(() => app.quit(), 300);
    return { ok: true, scheduled: true };
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
