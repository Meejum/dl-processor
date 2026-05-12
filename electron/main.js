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

  ipcMain.handle('dlp:update:check', async () => {
    return await checkForUpdates({
      currentVersion: app.getVersion(),
      baseUrl: 'https://dl-processor.pages.dev'
    });
  });

  ipcMain.handle('dlp:update:open-download', (event, url) => {
    shell.openExternal(url);
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
