(async function() {
  let currentDataFolder = null;
  let currentProjectFilter = null;
  console.log('[wizard] boot');
  try {
    console.log('[wizard] window.dlp =', !!window.dlp, 'firstRun =', !!(window.dlp && window.dlp.firstRun));
    const needed = await window.dlp.firstRun.needed();
    console.log('[wizard] needed =', needed);

    if (needed) {
      document.getElementById('first-run-wizard').hidden = false;
      const defaultFolder = await window.dlp.firstRun.defaultFolder();
      console.log('[wizard] defaultFolder =', defaultFolder);
      document.getElementById('wizard-folder').value = defaultFolder;

      document.getElementById('wizard-pick').addEventListener('click', async () => {
        try {
          console.log('[wizard] pick clicked');
          const picked = await window.dlp.firstRun.pickFolder();
          console.log('[wizard] pickFolder returned:', picked);
          if (picked) document.getElementById('wizard-folder').value = picked;
        } catch (e) {
          console.error('[wizard] pick failed:', e);
          alert('Folder picker failed:\n\n' + (e && e.message ? e.message : String(e)));
        }
      });

      let legacy = null;
      try {
        legacy = await window.dlp.firstRun.detectLegacy();
        console.log('[wizard] legacy =', legacy);
        if (legacy) {
          document.getElementById('wizard-legacy').hidden = false;
          document.getElementById('wizard-legacy-path').textContent = legacy.root;
        }
      } catch (e) {
        console.error('[wizard] detectLegacy failed:', e);
      }

      document.getElementById('wizard-continue').addEventListener('click', async () => {
        console.log('[wizard] continue clicked');
        const folder = document.getElementById('wizard-folder').value;
        if (!folder || !folder.trim()) {
          alert('Please choose or type a data folder path.');
          return;
        }
        const migrate = document.getElementById('wizard-migrate') && document.getElementById('wizard-migrate').checked;
        const migrateFrom = (legacy && migrate) ? legacy.root : null;
        try {
          console.log('[wizard] finalize start:', { folder: folder.trim(), migrateFrom });
          const result = await window.dlp.firstRun.finalize({ folder: folder.trim(), migrateFrom });
          console.log('[wizard] finalize done:', result);
          document.getElementById('first-run-wizard').hidden = true;
          showAppShell(result.folder);
        } catch (e) {
          console.error('[wizard] finalize failed:', e);
          alert('Could not finish setup:\n\n' + (e && e.message ? e.message : String(e)));
        }
      });
      console.log('[wizard] continue handler attached');
    } else {
      showAppShell(null);
    }
  } catch (e) {
    console.error('[wizard] boot failed:', e);
    alert('App init failed:\n\n' + (e && e.message ? e.message : String(e)));
  }

  async function showAppShell(dataFolder) {
    if (!dataFolder) dataFolder = await window.dlp.getDataFolder();
    currentDataFolder = dataFolder;
    document.getElementById('app-shell').hidden = false;
    if (dataFolder) document.getElementById('header-data-folder').textContent = dataFolder;

    // Settings modal + top bar (Task 10).
    const settingsModal = window.__initSettingsModal({
      getDataFolder: () => currentDataFolder,
      onCheckForUpdates: async () => {
        const result = await window.dlp.update.check();
        if (result.status === 'available') {
          if (confirm(result.message + '\n\nOpen download page?')) {
            window.dlp.update.openDownload(result.downloadUrl);
          }
        }
        return result;
      }
    });

    const topBar = window.__initTopBar({
      getDataFolder:    () => currentDataFolder,
      getProjectFilter: () => currentProjectFilter,
      setProjectFilter: (f) => {
        currentProjectFilter = f;
        // Auto-open the per-project compare report when a project is picked.
        // Falls through silently if the file doesn't exist yet (user hasn't
        // run [3] Compare for this project).
        if (f && currentDataFolder && window.__tabHost) {
          const slug = f.replace(/[^A-Za-z0-9_-]+/g, '_');
          const url = 'file:///' + currentDataFolder.replace(/\\/g, '/') + '/output/compare/' + slug + '.compare.html';
          window.__tabHost.open({ url, title: f });
        }
      },
      openSettings:     () => settingsModal.open()
    });
    topBar.refreshProjects();
    topBar.refreshDataFolder();

    // Initialize the tab host (creates the tab strip inside #tab-host).
    window.__tabHost = window.__initTabHost();

    const logInfoEl = document.getElementById('log-info');
    const logErrorEl = document.getElementById('log-error');

    function appendLog(level, text) {
      const target = level === 'error' ? logErrorEl : logInfoEl;
      if (!target) return;
      const line = document.createElement('div');
      line.className = 'log-line log-' + level;
      line.textContent = '[' + new Date().toISOString().slice(11, 19) + '] ' + text;
      target.appendChild(line);
      target.scrollTop = target.scrollHeight;
    }

    const logPanel = {
      appendInfo:  (text) => appendLog('info',  text),
      appendError: (text) => appendLog('error', text),
      appendWarn:  (text) => appendLog('warn',  text)
    };

    // Pipe main-process command-bridge log events into the right panel and
    // also derive a top-bar progress percentage from the markers the CLI
    // emits ("[N/5]" step headers, "-> Project Name" per-item lines, plus
    // the "— running:" / "— done:" lifecycle prefixes from command-bridge).
    window.dlp.onLog((payload) => {
      const level = (payload && payload.level) || 'info';
      const text  = (payload && payload.text)  || '';
      appendLog(level, text);

      if (text.startsWith('— running:')) {
        progressStep = 0;
        progressProjectCount = 0;
        setProgress('Running…', 1, null);
        return;
      }
      if (text.startsWith('— done:')) {
        const ok = !/exit (?!0)/.test(text);
        setProgress(ok ? 'Done' : 'Failed', 100, ok ? 'is-done' : 'is-error');
        progressTimer = setTimeout(() => setProgress(null), 3000);
        return;
      }
      const stepMatch = text.match(/\[(\d+)\/(\d+)\]/);
      if (stepMatch) {
        progressStep = parseInt(stepMatch[1], 10);
        const totalSteps = parseInt(stepMatch[2], 10) || STEP_TOTAL;
        progressProjectCount = 0;
        const pct = Math.round((progressStep - 1) / totalSteps * 100);
        setProgress('Step ' + progressStep + '/' + totalSteps, Math.max(2, pct), null);
        return;
      }
      // Per-project advance: "  -> Project Name". Tally to refine % inside
      // the current step. 39 projects is the typical batch size.
      if (/^\s*->\s+\S/.test(text)) {
        progressProjectCount++;
        const totalSteps = STEP_TOTAL;
        const stepBase  = progressStep > 0 ? (progressStep - 1) / totalSteps : 0;
        const stepSpan  = 1 / totalSteps;
        const within    = Math.min(progressProjectCount / 39, 1);
        const pct = Math.min(95, Math.round((stepBase + within * stepSpan) * 100));
        const label = progressStep > 0
          ? 'Step ' + progressStep + '/' + totalSteps + '  ' + progressProjectCount + '/39'
          : progressProjectCount + ' processed';
        setProgress(label, pct, null);
      }
    });

    // Hide / show the sidebar (main menu). Pure CSS — the flex layout
    // gives the freed width to the tab area automatically.
    const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleSidebarBtn) {
      toggleSidebarBtn.addEventListener('click', () => {
        const hidden = document.body.classList.toggle('sidebar-hidden');
        toggleSidebarBtn.classList.toggle('is-off', hidden);
        toggleSidebarBtn.title = hidden ? 'Show menu' : 'Hide menu';
      });
    }

    // Hide / show the log column. With iframes (instead of BrowserView) the
    // tab area reflows automatically — no IPC bounds math needed.
    const toggleLogBtn = document.getElementById('btn-toggle-log');
    if (toggleLogBtn) {
      toggleLogBtn.addEventListener('click', () => {
        const hidden = document.body.classList.toggle('log-hidden');
        toggleLogBtn.classList.toggle('is-off', hidden);
        toggleLogBtn.title = hidden ? 'Show log' : 'Hide log';
      });
    }

    // Top-bar progress widget. Stays visible even when the log column is
    // hidden so the user can still see how far along a command is.
    const progressEl   = document.getElementById('progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    let progressTimer = null;
    function setProgress(text, pct, state) {
      if (!progressEl) return;
      if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
      if (text == null) { progressEl.hidden = true; return; }
      progressEl.hidden = false;
      progressEl.classList.remove('is-done', 'is-error');
      if (state) progressEl.classList.add(state);
      progressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      progressText.textContent = text;
    }
    const STEP_TOTAL = 5;
    let progressStep = 0;
    let progressProjectCount = 0;

    // Copy buttons (Output / Errors).
    for (const btn of document.querySelectorAll('.log-copy-btn')) {
      btn.addEventListener('click', async () => {
        const target = document.getElementById(btn.dataset.target);
        const text = target ? target.innerText : '';
        try {
          await navigator.clipboard.writeText(text);
          btn.classList.add('copied');
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.classList.remove('copied'); btn.textContent = orig; }, 1200);
        } catch (e) {
          console.error('copy failed:', e);
        }
      });
    }

    const reportPathsByCommand = {
      'review-pending': (df) => 'file:///' + df.replace(/\\/g, '/') + '/output/approve-pending.html',
      'compare':        (df) => 'file:///' + df.replace(/\\/g, '/') + '/output/dashboard.html',
      'all':            (df) => 'file:///' + df.replace(/\\/g, '/') + '/output/dashboard.html'
    };
    const tabTitles = {
      'review-pending': 'Approve pending',
      'compare':        'Dashboard',
      'all':            'Dashboard'
    };

    // Initialize sidebar buttons.
    if (window.__initSidebar) {
      window.__initSidebar({
        logPanel,
        getProjectFilter: () => currentProjectFilter,
        onCommandDone: async (result) => {
          if (result.exitCode !== 0) return;
          const builder = reportPathsByCommand[result.command];
          if (!builder || !currentDataFolder) return;
          const url = builder(currentDataFolder);
          await window.__tabHost.open({ url, title: tabTitles[result.command] });
        }
      });
    }
  }
})();
