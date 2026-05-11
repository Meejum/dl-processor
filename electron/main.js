const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { createCommandBridge, setDataFolder } = require('./command-bridge');
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
      sandbox: false  // we need Node in the preload for require('fs') etc.
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

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
    setDataFolder(folder);  // updates the command-bridge's env-var target
    return { folder, summary };
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
