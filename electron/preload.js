const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlp', {
  version:    () => ipcRenderer.invoke('dlp:version'),
  runCommand: (name, args) => ipcRenderer.invoke('dlp:cmd:' + name, args || []),
  pickCsv:    (opts) => ipcRenderer.invoke('dlp:pick:csv', opts || {}),
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
