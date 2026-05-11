const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlp', {
  version:    () => ipcRenderer.invoke('dlp:version'),
  runCommand: (name, args) => ipcRenderer.invoke('dlp:cmd:' + name, args || []),
  pickCsv:    (opts) => ipcRenderer.invoke('dlp:pick:csv', opts || {}),
  getDataFolder: () => ipcRenderer.invoke('dlp:data-folder'),
  tabs: {
    open:     ({ url, title }) => ipcRenderer.invoke('dlp:tab:open',     { url, title }),
    activate: (id)             => ipcRenderer.invoke('dlp:tab:activate', { id }),
    close:    (id)             => ipcRenderer.invoke('dlp:tab:close',    { id })
  },
  projects: { list: () => ipcRenderer.invoke('dlp:projects:list') },
  shell:    { showInFolder: (p) => ipcRenderer.invoke('dlp:shell:show-in-folder', p) },
  layout:   { setLogVisible: (v) => ipcRenderer.invoke('dlp:layout:set-log-visible', !!v) },
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
  },
  update: {
    check:        () => ipcRenderer.invoke('dlp:update:check'),
    openDownload: (url) => ipcRenderer.invoke('dlp:update:open-download', url)
  }
});
