(async function() {
  let currentDataFolder = null;
  let currentProjectFilter = null;
  console.log('[wizard] boot');
  try {
    console.log('[wizard] window.dlp =', !!window.dlp, 'firstRun =', !!(window.dlp && window.dlp.firstRun));
    // Main now auto-creates the data folder layout on launch (defaults to
    // Desktop\DL-Processor in the packaged .exe, project root in dev), so
    // the wizard is no longer needed for a fresh install. Kept the IPC
    // surface in place in case a future "Change data folder" Settings
    // panel wants to reuse it.
    const needed = false;
    console.log('[wizard] auto-mode (skipped)');

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
        if (!f || !window.__tabHost) return;
        const pid = topBar.getProjectIdFor(f);
        if (pid != null && typeof window.__renderProjectComparePage === 'function') {
          window.__tabHost.open({
            title: f,
            render: (container) => window.__renderProjectComparePage(container, pid)
          });
        } else if (currentDataFolder) {
          // SF-only project or renderer not loaded — fall back to the static HTML file.
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

    // Top-bar progress widget. State + setProgress must be initialized
    // before window.dlp.onLog below, which references them. Defined here
    // to keep the order top-down even though `let` hoists.
    const progressEl   = document.getElementById('progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    let progressTimer = null;
    const STEP_TOTAL = 5;
    let progressStep = 0;
    let progressProjectCount = 0;
    let logCapture = [];

    function setProgress(text, pct, state) {
      if (!progressEl) return;
      if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
      if (text == null) { progressEl.hidden = true; return; }
      progressEl.hidden = false;
      progressEl.classList.remove('is-done', 'is-error');
      if (state) progressEl.classList.add(state);
      const clamped = Math.max(0, Math.min(100, pct));
      progressFill.style.width = clamped + '%';
      if (state === 'is-error') progressText.textContent = text || 'Failed';
      else                      progressText.textContent = clamped + '%';
    }

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
        logCapture = [];
        setProgress('Running…', 1, null);
        return;
      }
      if (text.startsWith('— done:')) {
        const ok = !/exit (?!0)/.test(text);
        setProgress(ok ? 'Done' : 'Failed', 100, ok ? 'is-done' : 'is-error');
        progressTimer = setTimeout(() => setProgress(null), 3000);
        return;
      }
      // Capture every regular output/warn line for possible page rendering.
      if (level !== 'error') logCapture.push({ level, text });
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

    // Hide / show the log column. v2.1: log starts hidden by default —
    // most users never need to read the raw CLI output. The 📋 button in
    // the top bar toggles it visible when debugging is needed.
    const toggleLogBtn = document.getElementById('btn-toggle-log');
    document.body.classList.add('log-hidden');
    if (toggleLogBtn) {
      toggleLogBtn.classList.add('is-off');
      toggleLogBtn.title = 'Show log';
      toggleLogBtn.addEventListener('click', () => {
        const hidden = document.body.classList.toggle('log-hidden');
        toggleLogBtn.classList.toggle('is-off', hidden);
        toggleLogBtn.title = hidden ? 'Show log' : 'Hide log';
      });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    // Task 6.5 (v2.0): Status / Projects / Apply pending pages render natively
    // into the tab pane (no iframe / srcdoc). Shared page styling lives in
    // styles.css under the .app-render-page scope; per-page tweaks (if any)
    // hang off .status-page / .projects-page / .apply-pending-page.

    function renderPageHead(title) {
      return [
        '<div class="page-head"><span class="page-logo">S</span>',
        '<div><div class="page-title">', escapeHtml(title), '</div>',
        '<div class="page-sub">DL-Processor · Sobha Realty · Registration</div></div></div>'
      ].join('');
    }

    function renderPageFooter() {
      const generated = new Date().toLocaleString();
      return '<div class="footer">Generated ' + escapeHtml(generated) + '</div>';
    }

    function renderStatusPage(container, capture) {
      container.classList.add('app-render-page');
      container.classList.add('status-page');

      // Pull "key: value" pairs out of the captured CLI output.
      const kv = {};
      for (const e of capture) {
        const m = e.text.match(/^\s*([^:]+?):\s*(.+)$/);
        if (m) kv[m[1].trim()] = m[2].trim();
      }
      const stat = (label, key, fmt) => {
        let v = kv[key];
        if (v == null) return '';
        if (fmt && /^[0-9]+$/.test(v)) v = Number(v).toLocaleString();
        return '<div class="stat-card"><div class="stat-value">' + escapeHtml(v) + '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
      };
      const cards = [
        stat('Projects',       'projects',                    true),
        stat('DLD Snapshots',  'DLD snapshots',               true),
        stat('DLD Units',      'DLD units (all snapshots)',   true),
        stat('DLD Tx Rows',    'DLD tx rows (all snapshots)', true),
        stat('SF Bookings',    'SF bookings (all snapshots)', true)
      ].join('');
      const dbPath   = kv['DB']        || '—';
      const latestSf = kv['latest SF'] || '';
      // Parse:  <file>.xlsx (As of <ts> <tz> • Generated by <name>)
      let sfFile = '', sfAsOf = '', sfTz = '', sfBy = '';
      const m = latestSf.match(/^(.+?\.xlsx)\s*\((?:As of\s*)?([^•)]+?)(?:\s*•\s*Generated by\s*([^)]+))?\)\s*$/i);
      if (m) {
        sfFile = (m[1] || '').trim();
        const asOfRaw = (m[2] || '').trim();
        const asOfMatch = asOfRaw.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*(.*)$/);
        if (asOfMatch) { sfAsOf = asOfMatch[1]; sfTz = asOfMatch[2].trim(); }
        else { sfAsOf = asOfRaw; }
        sfBy = (m[3] || '').trim();
      } else {
        sfFile = latestSf || '—';
      }
      const dbCard =
        '<h2 class="section-h">Database</h2>' +
        '<div class="info-card">' +
          '<div class="info-row"><div class="info-label">Path</div><div class="info-value">' + escapeHtml(dbPath) + '</div></div>' +
        '</div>';
      const sfRows = [
        sfFile ? '<div class="info-row"><div class="info-label">File</div><div class="info-value">' + escapeHtml(sfFile) + '</div></div>' : '',
        sfAsOf ? '<div class="info-row"><div class="info-label">As of</div><div class="info-value">' + escapeHtml(sfAsOf) + (sfTz ? ' <span class="chip">' + escapeHtml(sfTz) + '</span>' : '') + '</div></div>' : '',
        sfBy   ? '<div class="info-row"><div class="info-label">Generated by</div><div class="info-value">' + escapeHtml(sfBy) + '</div></div>' : ''
      ].join('');
      const sfCard = sfRows
        ? '<h2 class="section-h">Latest Salesforce Import</h2><div class="info-card">' + sfRows + '</div>'
        : '';
      container.innerHTML =
        renderPageHead('Status') +
        '<div class="stat-grid">' + cards + '</div>' +
        dbCard +
        sfCard +
        renderPageFooter();
    }

    function renderApplyPendingPage(container, capture) {
      container.classList.add('app-render-page');
      container.classList.add('apply-pending-page');

      // Pull the summary numbers from apply-pending's CLI output.
      let approvals = 0, rejections = 0, deferred = 0;
      let errorRows = 0, canonicalRows = null;
      let warnCount = 0;
      for (const e of capture) {
        const t = e.text || '';
        let m;
        if ((m = t.match(/applied\s+(\d+)\s+approvals\D+(\d+)\s+rejections\D+(\d+)\s+deferred/i))) {
          approvals  = parseInt(m[1], 10);
          rejections = parseInt(m[2], 10);
          deferred   = parseInt(m[3], 10);
        }
        if ((m = t.match(/(\d+)\s+rows? had errors/i))) {
          errorRows = parseInt(m[1], 10);
        }
        if ((m = t.match(/master_data now has\s+(\d+)\s+canonical rows/i))) {
          canonicalRows = parseInt(m[1], 10);
        }
        if (/^\s*warn /i.test(t)) warnCount++;
      }
      const stat = (value, label, tone) => {
        const cls = tone ? ' stat-tone-' + tone : '';
        const fmt = typeof value === 'number' ? value.toLocaleString() : value;
        return '<div class="stat-card' + cls + '"><div class="stat-value">' + escapeHtml(String(fmt)) + '</div><div class="stat-label">' + escapeHtml(label) + '</div></div>';
      };
      const cards = [
        stat(approvals,  'Approved',  'ok'),
        stat(rejections, 'Rejected',  rejections > 0 ? 'down' : null),
        stat(deferred,   'Deferred',  deferred > 0 ? 'warn' : null),
        stat(errorRows,  'Skipped',   errorRows > 0 ? 'warn' : null)
      ].join('');

      const masterCard = canonicalRows != null
        ? '<h2 class="section-h">Master Data</h2>' +
          '<div class="info-card">' +
            '<div class="info-row"><div class="info-label">Canonical rows</div><div class="info-value">' + canonicalRows.toLocaleString() + '</div></div>' +
          '</div>'
        : '';

      const warnNote = errorRows > 0
        ? '<div class="callout"><strong>' + errorRows.toLocaleString() + '</strong> row' + (errorRows === 1 ? '' : 's') +
          ' were skipped because they were already decided in a prior run. The Output / Errors panes on the right have the full list.</div>'
        : '';

      const nextSteps =
        '<h2 class="section-h">What’s next</h2>' +
        '<div class="info-card">' +
          '<ul class="next-list">' +
            '<li>Click <b>[3] Compare</b> to refresh the reconciliation against your new master data.</li>' +
            '<li>Click <b>[4] Diff</b> to see month-over-month changes since the last snapshot.</li>' +
            '<li>Click <b>[⚡] Run full pipeline</b> to do all of the above in one go.</li>' +
          '</ul>' +
        '</div>';

      container.innerHTML =
        renderPageHead('Apply pending · Results') +
        '<div class="stat-grid">' + cards + '</div>' +
        warnNote +
        masterCard +
        nextSteps +
        renderPageFooter();
    }

    async function renderProjectsPage(container) {
      container.classList.add('app-render-page');
      container.classList.add('projects-page');

      container.innerHTML =
        renderPageHead('Projects') +
        '<p class="loading">Loading projects…</p>';

      let rows = [];
      try {
        rows = await window.dlp.projects.list();
      } catch (e) {
        container.innerHTML =
          renderPageHead('Projects') +
          '<p class="error">Failed to load projects: ' + escapeHtml((e && e.message) || String(e)) + '</p>' +
          renderPageFooter();
        return;
      }

      const cells = rows.map((p) =>
        '<tr>' +
          '<td>' + escapeHtml(p.project_name || '') + '</td>' +
          '<td>' + escapeHtml(p.sf_sub_project || '—') + '</td>' +
          '<td>' + escapeHtml(p.sf_unit_prefix || '—') + '</td>' +
          '<td class="num">' + (p.snapshot_count || 0) + '</td>' +
          '<td>' + escapeHtml(p.last_imported || '—') + '</td>' +
        '</tr>'
      ).join('');

      container.innerHTML =
        renderPageHead('Projects') +
        '<div class="tools"><span class="count-chip">' + rows.length + ' project' + (rows.length === 1 ? '' : 's') + '</span>' +
        '<input class="projects-filter" type="search" placeholder="Filter projects…"></div>' +
        '<table><thead><tr>' +
          '<th>Project</th><th>SF Sub-Project</th><th>Prefix</th><th>Snapshots</th><th>Last Imported</th>' +
        '</tr></thead><tbody>' + cells + '</tbody></table>' +
        renderPageFooter();

      // Wire the live filter via addEventListener (inline <script> blocked by
      // the renderer's strict CSP — fine in render mode, we have direct DOM).
      const input = container.querySelector('.projects-filter');
      const bodyRows = container.querySelectorAll('tbody tr');
      if (input) {
        input.addEventListener('input', (ev) => {
          const q = ev.target.value.toLowerCase();
          bodyRows.forEach((r) => {
            r.style.display = r.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
          });
        });
      }
    }

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

    // Task 10 (v1.1): hijack the "Review pending" sidebar button so it opens
    // the inline page instead of running the legacy CLI command + opening
    // the HTML file. Use capture phase so we run BEFORE sidebar.js's own
    // click handler. stopImmediatePropagation prevents the CLI run().
    //
    // Task 5 (v2.0): converted to render-mode tab — the page builds DOM
    // directly into the tab pane (no iframe / srcdoc).
    const reviewBtn = document.querySelector('.cmd-btn[data-cmd="review-pending"]');
    if (reviewBtn && window.__renderReviewPendingPage) {
      reviewBtn.addEventListener('click', (ev) => {
        ev.stopImmediatePropagation();
        window.__tabHost.open({
          title: 'Review pending',
          render: (container) => window.__renderReviewPendingPage(container)
        });
      }, true);
    }

    // Task 13: open the History page in a tab. Used by the sidebar
    // 📜 History button and by the dlp:open-history custom event the
    // per-unit side panel's "View in global History →" link dispatches.
    function openHistoryTab(initialFilters) {
      if (!window.__renderHistoryPage) {
        console.error('[history] __renderHistoryPage not available');
        return;
      }
      const filters = initialFilters || {};
      window.__tabHost.open({
        title: 'History',
        render: (container) => window.__renderHistoryPage(container, filters)
      });
    }

    document.addEventListener('dlp:open-history', (ev) => {
      openHistoryTab((ev && ev.detail) || {});
    });

    document.addEventListener('dlp:open-review-pending', (ev) => {
      const filters = (ev && ev.detail) || {};
      if (!window.__renderReviewPendingPage) {
        console.error('[review-pending] renderer not loaded');
        return;
      }
      window.__tabHost.open({
        title: 'Review pending',
        render: (container) => window.__renderReviewPendingPage(container, filters)
      });
    });

    // Non-CLI sidebar actions — buttons that just open a tab, show a
    // file picker before running a CLI command, or call shell.showInFolder.
    for (const btn of document.querySelectorAll('.cmd-btn[data-action]')) {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'open-history') {
          openHistoryTab({});
          return;
        }
        if (action === 'open-patch-modal') {
          if (typeof window.__openPatchModal === 'function') {
            window.__openPatchModal();
          } else {
            logPanel.appendError('patch modal not loaded — please restart the app');
          }
          return;
        }
        if (action === 'open-dashboard') {
          if (typeof window.__renderDashboardPage !== 'function') {
            logPanel.appendError('dashboard renderer not loaded — please restart');
            return;
          }
          window.__tabHost.open({
            title: 'Dashboard',
            render: (container) => window.__renderDashboardPage(container)
          });
          return;
        }
        if (action === 'open-automation') {
          if (typeof window.__renderAutomationPage !== 'function') {
            logPanel.appendError('automation renderer not loaded — please restart');
            return;
          }
          window.__tabHost.open({
            title: 'Automation',
            render: (container) => window.__renderAutomationPage(container)
          });
          return;
        }
        if (action === 'reveal-output' && currentDataFolder) {
          const folder = currentDataFolder + '\\output';
          if (window.dlp.shell && window.dlp.shell.showInFolder) {
            window.dlp.shell.showInFolder(folder);
          }
          return;
        }
        if (action === 'db-export') {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const defaultName = 'dl-processor-backup-' + stamp + '.zip';
          const out = await window.dlp.pickSave({
            title: 'Save database backup',
            defaultPath: defaultName,
            filters: [{ name: 'Zip', extensions: ['zip'] }]
          });
          if (!out) return;
          if (sidebarApi) sidebarApi.setRunning(true, btn);
          logPanel.appendInfo('— running: Export DB —');
          try {
            const result = await window.dlp.runCommand('db-export', [out]);
            logPanel.appendInfo('— done: Export DB (exit ' + result.exitCode + ') —');
          } finally {
            if (sidebarApi) sidebarApi.setRunning(false, btn);
          }
          return;
        }
        if (action === 'db-import') {
          // v1.1 Task 14: confirmation modal with backup metadata + current-DB
          // impact preview before the destructive replace. The modal handles
          // picker + probe + commit itself; we just refresh the top-bar
          // dropdown on completion so the project picker reflects the
          // restored DB without requiring a restart.
          if (!window.__openImportDbModal) {
            console.error('[import-db] __openImportDbModal not available');
            return;
          }
          await window.__openImportDbModal({
            onComplete: (result) => {
              logPanel.appendInfo('Imported DB — safety copy: ' + (result && result.backupPath ? result.backupPath : '(none — no prior DB)'));
              if (topBar && topBar.refreshProjects) topBar.refreshProjects();
            }
          });
          return;
        }
      });
    }

    // Initialize sidebar buttons.
    let sidebarApi = null;
    if (window.__initSidebar) {
      sidebarApi = window.__initSidebar({
        logPanel,
        getProjectFilter: () => currentProjectFilter,
        onCommandDone: async (result) => {
          if (result.exitCode !== 0) return;
          // Status and Projects render the captured terminal output as a
          // Sobha-styled page tab so the data is available outside the log
          // column.
          if (result.command === 'status') {
            const captured = logCapture.slice();
            window.__tabHost.open({
              title: 'Status',
              render: (container) => renderStatusPage(container, captured)
            });
            return;
          }
          if (result.command === 'projects') {
            window.__tabHost.open({
              title: 'Projects',
              render: (container) => renderProjectsPage(container)
            });
            return;
          }
          if (result.command === 'apply-pending') {
            const captured = logCapture.slice();
            window.__tabHost.open({
              title: 'Apply pending',
              render: (container) => renderApplyPendingPage(container, captured)
            });
            return;
          }
          const builder = reportPathsByCommand[result.command];
          if (!builder || !currentDataFolder) return;
          const url = builder(currentDataFolder);
          await window.__tabHost.open({ url, title: tabTitles[result.command] });
        }
      });
    }
  }
})();
