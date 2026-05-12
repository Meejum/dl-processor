const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlp', {
  version:    () => ipcRenderer.invoke('dlp:version'),
  runCommand: (name, args) => ipcRenderer.invoke('dlp:cmd:' + name, args || []),
  pickCsv:    (opts) => ipcRenderer.invoke('dlp:pick:csv', opts || {}),
  pickSave:      (opts) => ipcRenderer.invoke('dlp:pick:save',       opts || {}),
  pickOpen:      (opts) => ipcRenderer.invoke('dlp:pick:open',       opts || {}),
  pickOpenMulti: (opts) => ipcRenderer.invoke('dlp:pick:open-multi', opts || {}),
  getDataFolder: () => ipcRenderer.invoke('dlp:data-folder'),
  projects: { list: () => ipcRenderer.invoke('dlp:projects:list') },
  review: {
    list:       (opts) => ipcRenderer.invoke('dlp:review:list', opts || {}),
    approve:    (args) => ipcRenderer.invoke('dlp:review:approve', args),
    reject:     (args) => ipcRenderer.invoke('dlp:review:reject', args),
    teachAlias: (args) => ipcRenderer.invoke('dlp:review:teach-alias', args)
  },
  audit: {
    unitHistory: (args) => ipcRenderer.invoke('dlp:audit:unit-history', args)
  },
  shell:    { showInFolder: (p) => ipcRenderer.invoke('dlp:shell:show-in-folder', p) },
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
