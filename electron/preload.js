const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal API to the renderer. Task 4+ will expand this when IPC
// handlers exist on the main side.
contextBridge.exposeInMainWorld('dlp', {
  version: () => ipcRenderer.invoke('dlp:version'),
});
