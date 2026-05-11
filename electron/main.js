const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
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
  // even when DevTools isn't engaged. Remove for production.
  mainWindow.webContents.on('console-message', (event, level, message, line, source) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'INFO'];
    console.log('[renderer:' + (levels[level] || level) + '] ' + message);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  state.appConfigPath = path.join(app.getPath('userData'), 'config.json');
  const cfg = loadAppConfig(state.appConfigPath);

  if (cfg && cfg.dataFolder) {
    state.dataFolder = cfg.dataFolder;
    process.env.DLP_DATA_ROOT = state.dataFolder;
  } else {
    // First-run flow handled by the renderer; main exposes the helpers via IPC.
    state.dataFolder = defaultDataFolder(app.getPath('documents'));
    process.env.DLP_DATA_ROOT = state.dataFolder;
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
    process.env.DLP_DATA_ROOT = state.dataFolder;
    setDataFolder(folder);  // updates the command-bridge's env-var target
    return { folder, summary };
  });

  ipcMain.handle('dlp:data-folder', () => state.dataFolder);

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
    return new Promise((resolve) => {
      const indexJs = path.join(__dirname, '..', 'index.js');
      const env = Object.assign({}, process.env);
      if (state.dataFolder) env.DLP_DATA_ROOT = state.dataFolder;
      const child = cp.spawn('node', [indexJs, 'projects', '--json'], {
        env, cwd: path.join(__dirname, '..'), windowsHide: true
      });
      let out = '';
      child.stdout.on('data', (c) => { out += c.toString(); });
      child.on('error', () => resolve([]));
      child.on('close', () => {
        try {
          const start = out.indexOf('[');
          if (start < 0) { resolve([]); return; }
          resolve(JSON.parse(out.slice(start)));
        } catch { resolve([]); }
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
