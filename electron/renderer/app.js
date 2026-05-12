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

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    const PAGE_CSS = `
      :root { --bg:#F6F1E9; --surface:#FFFFFF; --surface-2:#FBF5EA; --border:#E3D9C8; --border-2:#C8B896; --ink:#1F1A14; --ink-2:#5A4A37; --muted:#8A7E69; --accent:#85633B; --accent-dark:#5C3D1E; --accent-soft:#F0E4CE; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px 28px; font: 13px/1.5 'Segoe UI', Tahoma, Arial, sans-serif; background: var(--bg); color: var(--ink); }
      .page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
      .page-logo { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%); display: inline-flex; align-items: center; justify-content: center; color: var(--accent-soft); font-weight: 700; font-size: 18px; }
      .page-title { font-size: 20px; font-weight: 700; color: var(--accent-dark); line-height: 1.1; }
      .page-sub { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
      .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
      .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
      .stat-value { font-size: 22px; font-weight: 700; color: var(--accent-dark); line-height: 1.1; }
      .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
      .stat-card.stat-tone-ok   { border-left: 4px solid #4F7A3A; }
      .stat-card.stat-tone-ok   .stat-value { color: #3F6A2A; }
      .stat-card.stat-tone-warn { border-left: 4px solid #B98410; }
      .stat-card.stat-tone-warn .stat-value { color: #8A5A08; }
      .stat-card.stat-tone-down { border-left: 4px solid #A12C1B; }
      .stat-card.stat-tone-down .stat-value { color: #8A2415; }
      .callout { background: #FBEAE5; border: 1px solid #E7B5A8; color: #7A2415; border-radius: 8px; padding: 12px 16px; margin: 10px 0 14px; font-size: 12px; }
      .next-list { margin: 0; padding-left: 18px; }
      .next-list li { margin: 4px 0; }
      .next-list b { color: var(--accent-dark); }
      .info-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; box-shadow: 0 1px 2px rgba(0,0,0,.04); margin-bottom: 12px; }
      .info-row { display: flex; gap: 14px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
      .info-row:last-child { border-bottom: 0; }
      .info-label { color: var(--muted); flex: 0 0 140px; }
      .info-value { color: var(--ink); flex: 1; font-family: 'Consolas','Cascadia Mono',monospace; font-size: 12px; word-break: break-all; }
      .section-h { font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin: 14px 0 6px 4px; font-weight: 600; }
      .chip { display: inline-block; background: var(--accent-soft); color: var(--accent-dark); border: 1px solid var(--border-2); padding: 0 8px; border-radius: 10px; font-size: 11px; font-family: Dubai, 'Segoe UI', sans-serif; font-weight: 600; margin-left: 8px; }
      .tools { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
      .tools input { flex: 1; max-width: 320px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); font: inherit; }
      .count-chip { background: var(--accent-soft); color: var(--accent-dark); border: 1px solid var(--border-2); padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
      th { background: var(--surface-2); color: var(--accent-dark); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); position: sticky; top: 0; }
      td { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
      tr:nth-child(even) td { background: var(--surface-2); }
      tr:hover td { background: var(--accent-soft); }
      td.num { font-family: 'Consolas','Cascadia Mono',monospace; text-align: right; }
      .footer { color: var(--muted); font-size: 11px; margin-top: 14px; }
    `;

    function pageShell(title, bodyHtml) {
      const generated = new Date().toLocaleString();
      // Self-CSP for the srcdoc so inline <style> + small inline <script>
      // (used for the Projects filter) work — the iframe otherwise inherits
      // the parent's strict policy which blocks inline scripts.
      const cspMeta = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src data:;\">";
      return [
        '<!doctype html><html><head>',
        '<meta charset="utf-8">', cspMeta,
        '<title>', escapeHtml(title), '</title>',
        '<style>', PAGE_CSS, '</style></head><body>',
        '<div class="page-head"><span class="page-logo">S</span>',
        '<div><div class="page-title">', escapeHtml(title), '</div>',
        '<div class="page-sub">DL-Processor · Sobha Realty · Registration</div></div></div>',
        bodyHtml,
        '<div class="footer">Generated ', escapeHtml(generated), '</div>',
        '</body></html>'
      ].join('');
    }

    function buildStatusPage(capture) {
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
      const body = '<div class="stat-grid">' + cards + '</div>' + dbCard + sfCard;
      return pageShell('Status', body);
    }

    function buildApplyPendingPage(capture) {
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

      const body =
        '<div class="stat-grid">' + cards + '</div>' +
        warnNote +
        masterCard +
        nextSteps;
      return pageShell('Apply pending · Results', body);
    }

    async function buildProjectsPage() {
      let rows = [];
      try { rows = await window.dlp.projects.list(); } catch { rows = []; }
      const cells = rows.map((p) =>
        '<tr>' +
          '<td>' + escapeHtml(p.project_name || '') + '</td>' +
          '<td>' + escapeHtml(p.sf_sub_project || '—') + '</td>' +
          '<td>' + escapeHtml(p.sf_unit_prefix || '—') + '</td>' +
          '<td class="num">' + (p.snapshot_count || 0) + '</td>' +
          '<td>' + escapeHtml(p.last_imported || '—') + '</td>' +
        '</tr>'
      ).join('');
      const tableHtml =
        '<div class="tools"><span class="count-chip">' + rows.length + ' project' + (rows.length === 1 ? '' : 's') + '</span>' +
        '<input id="q" type="search" placeholder="Filter projects…"></div>' +
        '<table><thead><tr>' +
          '<th>Project</th><th>SF Sub-Project</th><th>Prefix</th><th>Snapshots</th><th>Last Imported</th>' +
        '</tr></thead><tbody>' + cells + '</tbody></table>' +
        '<script>document.getElementById("q").addEventListener("input",function(e){' +
          'var q=e.target.value.toLowerCase();' +
          'document.querySelectorAll("tbody tr").forEach(function(r){' +
            'r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?"":"none";' +
          '});' +
        '});<\/script>';
      return pageShell('Projects', tableHtml);
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

    // Non-CLI sidebar actions — buttons that just open a tab, show a
    // file picker before running a CLI command, or call shell.showInFolder.
    for (const btn of document.querySelectorAll('.cmd-btn[data-action]')) {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'open-history') {
          // Task 13 will replace this stub with a real History page.
          const srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>History</title></head><body style="margin:0;font-family:Inter,Segoe UI,Tahoma,sans-serif;background:#F6F1E9;color:#1F1A14"><p style="padding:24px">History page coming in Task 13.</p></body></html>';
          window.__tabHost.open({ srcdoc, title: 'History' });
          return;
        }
        if (action === 'open-dashboard' && currentDataFolder) {
          const url = 'file:///' + currentDataFolder.replace(/\\/g, '/') + '/output/dashboard.html';
          window.__tabHost.open({ url, title: 'Dashboard' });
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
          const inPath = await window.dlp.pickOpen({
            title: 'Choose a DL-Processor backup zip',
            filters: [{ name: 'Zip', extensions: ['zip'] }]
          });
          if (!inPath) return;
          if (!confirm('Importing will REPLACE the current database.\n\nThe current DB is backed up automatically as .bak-<timestamp> in your data/ folder.\n\nContinue?')) return;
          if (sidebarApi) sidebarApi.setRunning(true, btn);
          logPanel.appendInfo('— running: Import DB —');
          try {
            const result = await window.dlp.runCommand('db-import', [inPath]);
            logPanel.appendInfo('— done: Import DB (exit ' + result.exitCode + ') —');
            // After a successful import the project list and master_data
            // counts have changed — refresh the top-bar dropdown so the
            // picker reflects the restored DB without requiring a restart.
            if (result.exitCode === 0 && topBar && topBar.refreshProjects) {
              topBar.refreshProjects();
            }
          } finally {
            if (sidebarApi) sidebarApi.setRunning(false, btn);
          }
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
            window.__tabHost.open({ srcdoc: buildStatusPage(logCapture), title: 'Status' });
            return;
          }
          if (result.command === 'projects') {
            const srcdoc = await buildProjectsPage();
            window.__tabHost.open({ srcdoc, title: 'Projects' });
            return;
          }
          if (result.command === 'apply-pending') {
            window.__tabHost.open({
              srcdoc: buildApplyPendingPage(logCapture),
              title: 'Apply pending'
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
