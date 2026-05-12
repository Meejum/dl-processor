// Import DB confirmation modal — v1.1 Task 14.
//
// Replaces the legacy "click → file picker → destructive replace" flow with:
//   1. File picker (.zip)
//   2. Probe the zip read-only via window.dlp.db.probeZip
//   3. Render a centered <div role="dialog"> with:
//      - File info (name, size, created, app_version)
//      - "This backup contains:" row counts (zip-side)
//      - "Current database (will be replaced):" row counts (live-side)
//      - ⚠ warning callout
//      - [Cancel] [Confirm import]
//   4. On Confirm → window.dlp.db.commitZip then a toast + onComplete()
//
// Public API (exposed on window):
//   __openImportDbModal({ onComplete }?)  → opens picker → probe → modal.
//
// Reuses the .modal / .modal-card styles from settings-modal so the look
// matches without bloating styles.css. Lazy-creates the overlay on first
// call and reuses it for every subsequent open (same pattern as
// unit-history-panel.js).

(function () {
  let overlay = null;
  let escapeBound = false;
  let activeOnComplete = null;
  let activeZipPath = null;
  let openerEl = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.id = 'import-db-modal';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'import-db-title');
    overlay.innerHTML = [
      '<div class="modal-card import-db-card">',
      '  <h2 id="import-db-title">Import database</h2>',
      '  <section class="idb-file-info"></section>',
      '  <section class="idb-counts"></section>',
      '  <div class="idb-warn">',
      '    <strong>⚠ This replaces the current database.</strong>',
      '    A safety copy <code>.bak.&lt;timestamp&gt;</code> of your current DB is written first.',
      '  </div>',
      '  <div class="modal-actions">',
      '    <button class="idb-cancel" type="button">Cancel</button>',
      '    <button class="idb-confirm primary" type="button">Confirm import</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    document.body.appendChild(overlay);

    overlay.querySelector('.idb-cancel').addEventListener('click', close);
    overlay.querySelector('.idb-confirm').addEventListener('click', confirmImport);
    // Click outside the card closes the modal.
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

    if (!escapeBound) {
      document.addEventListener('keydown', (ev) => {
        if (overlay && !overlay.hidden && ev.key === 'Escape') { ev.preventDefault(); close(); }
      });
      escapeBound = true;
    }
    return overlay;
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    activeZipPath = null;
    activeOnComplete = null;
    if (openerEl && openerEl.focus) openerEl.focus();
    openerEl = null;
  }

  async function openImportDbModal({ onComplete } = {}) {
    openerEl = document.activeElement;

    // 1. Pick a zip.
    let inPath;
    try {
      inPath = await window.dlp.pickOpen({
        title: 'Choose a DL-Processor backup zip',
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      });
    } catch (e) {
      alert('Could not open file picker:\n\n' + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!inPath) return;   // user cancelled the picker

    // 2. Probe.
    let probe;
    try {
      probe = await window.dlp.db.probeZip({ zipPath: inPath });
    } catch (e) {
      alert('Could not read backup zip:\n\n' + (e && e.message ? e.message : String(e)));
      return;
    }

    // 3. Render and show.
    const o = ensureOverlay();
    renderInfo(o, inPath, probe);
    renderCounts(o, probe);
    activeZipPath = inPath;
    activeOnComplete = onComplete || null;
    o.hidden = false;
    setTimeout(() => {
      const btn = o.querySelector('.idb-cancel');
      if (btn) btn.focus();
    }, 0);
  }

  async function confirmImport() {
    if (!activeZipPath) { close(); return; }
    const confirmBtn = overlay.querySelector('.idb-confirm');
    const cancelBtn  = overlay.querySelector('.idb-cancel');
    const zipPath = activeZipPath;
    const onComplete = activeOnComplete;

    confirmBtn.disabled = true; cancelBtn.disabled = true;
    confirmBtn.textContent = 'Importing…';
    try {
      const result = await window.dlp.db.commitZip({ zipPath });
      toast('Restore complete' + (result && result.backupPath ? ' — safety copy: ' + basename(result.backupPath) : ''));
      close();
      if (typeof onComplete === 'function') {
        try { onComplete(result); } catch (e) { console.error('[import-db] onComplete threw:', e); }
      }
    } catch (e) {
      alert('Import failed:\n\n' + (e && e.message ? e.message : String(e)));
      confirmBtn.disabled = false; cancelBtn.disabled = false;
      confirmBtn.textContent = 'Confirm import';
    }
  }

  function renderInfo(o, zipPath, probe) {
    const fileSection = o.querySelector('.idb-file-info');
    let size = '—';
    // We don't have the size from the renderer side without an IPC round-trip
    // and meta.json doesn't store it either — leave size as the file path's
    // basename for now. Created comes from meta.json.exported_at if present.
    const created    = (probe.meta && probe.meta.exported_at) ? probe.meta.exported_at : 'unknown';
    const appVersion = (probe.meta && probe.meta.app_version) ? probe.meta.app_version : 'unknown';
    const schemaVer  = (probe.meta && probe.meta.schema_ver)  ? probe.meta.schema_ver  : 'unknown';
    fileSection.innerHTML = [
      '<dl class="idb-meta">',
      '  <dt>File</dt><dd><code>', escapeHtml(zipPath), '</code></dd>',
      '  <dt>Created</dt><dd>', escapeHtml(created), '</dd>',
      '  <dt>App version</dt><dd>', escapeHtml(appVersion), '</dd>',
      '  <dt>Schema</dt><dd>', escapeHtml(schemaVer), '</dd>',
      '</dl>'
    ].join('');
  }

  function renderCounts(o, probe) {
    const section = o.querySelector('.idb-counts');
    const fields = ['dld_project', 'master_data', 'pending_change', 'audit_log'];
    const haveMeta = !!probe.meta;

    function rowsTable(title, counts) {
      return [
        '<div class="idb-counts-group">',
        '  <h3>', escapeHtml(title), '</h3>',
        '  <table class="idb-counts-table">',
        '    <tbody>',
        fields.map((f) => [
          '      <tr><td>', escapeHtml(f), '</td><td class="idb-num">',
          formatNum(counts && counts[f]),
          '</td></tr>'
        ].join('')).join(''),
        '    </tbody>',
        '  </table>',
        '</div>'
      ].join('');
    }

    let html = '';
    if (haveMeta) {
      html += rowsTable('This backup contains', probe.zipRowCounts);
    } else {
      html += [
        '<p class="idb-empty">',
        '  No <code>meta.json</code> in this zip (older backup). Showing counts read directly from the zipped DB.',
        '</p>',
        rowsTable('This backup contains', probe.zipRowCounts)
      ].join('');
    }
    html += rowsTable('Current database (will be replaced)', probe.currentRowCounts);
    section.innerHTML = html;
  }

  function toast(msg) {
    // Reuse a lightweight transient toast — created on first use, reused.
    let el = document.getElementById('dlp-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dlp-toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'background:#1F1A14;color:#F0E4CE;padding:10px 18px;border-radius:8px;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.25);font:13px/1.4 "Segoe UI",sans-serif;' +
        'z-index:9999;opacity:0;transition:opacity 180ms ease;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
  }

  function basename(p) {
    if (!p) return '';
    const s = String(p).replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function formatNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  window.__openImportDbModal = openImportDbModal;
})();
