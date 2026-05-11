const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createCommandBridge } = require('./command-bridge');

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

app.whenReady().then(() => {
  // Data folder will be set by the first-run wizard in Task 6. For now,
  // default to ~/Documents/DL-Processor.
  const dataFolder = path.join(app.getPath('documents'), 'DL-Processor');
  createCommandBridge(ipcMain, { dataFolder });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
