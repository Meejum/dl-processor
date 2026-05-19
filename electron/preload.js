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
    list:           (opts) => ipcRenderer.invoke('dlp:review:list', opts || {}),
    approve:        (args) => ipcRenderer.invoke('dlp:review:approve', args),
    reject:         (args) => ipcRenderer.invoke('dlp:review:reject', args),
    teachAlias:     (args) => ipcRenderer.invoke('dlp:review:teach-alias', args),
    // v2.0 BP grouping
    listBps:        (opts) => ipcRenderer.invoke('dlp:review:list-bps',      opts || {}),
    approveBp:      (args) => ipcRenderer.invoke('dlp:review:approve-bp',    args),
    rejectBp:       (args) => ipcRenderer.invoke('dlp:review:reject-bp',     args),
    acknowledgeBp:  (args) => ipcRenderer.invoke('dlp:review:acknowledge-bp', args)
  },
  audit: {
    unitHistory: (args) => ipcRenderer.invoke('dlp:audit:unit-history', args),
    global:      (opts) => ipcRenderer.invoke('dlp:audit:global', opts || {}),
    exportCsv:   (opts) => ipcRenderer.invoke('dlp:audit:export-csv', opts || {}),
    exportXlsx:  (opts) => ipcRenderer.invoke('dlp:audit:export-xlsx', opts || {}),
    revert:      (args) => ipcRenderer.invoke('dlp:audit:revert', args)
  },
  // v2.2: native dashboard compare bridge (spec § 1)
  compare: {
    summary: ()          => ipcRenderer.invoke('dlp:compare:summary'),
    project: (projectId) => ipcRenderer.invoke('dlp:compare:project', projectId),
    // v2.3 dry-run (spec § 8)
    dryRun:  (opts)      => ipcRenderer.invoke('dlp:compare:dry-run', opts || {})
  },
  // v2.3 Automation rules (spec § 4)
  rules: {
    list:   ()                     => ipcRenderer.invoke('dlp:rules:list'),
    get:    (id)                   => ipcRenderer.invoke('dlp:rules:get', id),
    create: (payload)              => ipcRenderer.invoke('dlp:rules:create', payload),
    update: (id, patch)            => ipcRenderer.invoke('dlp:rules:update', { id, patch }),
    remove: (id)                   => ipcRenderer.invoke('dlp:rules:delete', id),
    test:   (id, snapshotId)       => ipcRenderer.invoke('dlp:rules:test', { id, snapshotId })
  },
  // v2.3 Trending (spec § 7)
  trending: {
    get: (opts) => ipcRenderer.invoke('dlp:trending:get', opts || {})
  },
  // v2.3 Bulk operations (spec § 6)
  bulk: {
    approve: (rowIds, justification) => ipcRenderer.invoke('dlp:bulk:approve', { rowIds, justification }),
    reject:  (rowIds)                => ipcRenderer.invoke('dlp:bulk:reject',  { rowIds })
  },
  db: {
    probeZip:  (args) => ipcRenderer.invoke('dlp:db:probe-zip',  args || {}),
    commitZip: (args) => ipcRenderer.invoke('dlp:db:commit-zip', args || {})
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
  },
  patch: {
    probeZip:   (args) => ipcRenderer.invoke('dlp:patch:probe-zip',   args || {}),
    apply:      (args) => ipcRenderer.invoke('dlp:patch:apply',       args || {}),
    revertLast: ()     => ipcRenderer.invoke('dlp:patch:revert-last')
  },
  settings: {
    get: () => ipcRenderer.invoke('dlp:settings:get'),
    set: (partial) => ipcRenderer.invoke('dlp:settings:set', partial || {})
  }
});
