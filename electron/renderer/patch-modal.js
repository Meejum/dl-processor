// Patch update modal — v1.2 Task 6.
//
// Native renderer-DOM modal (not an iframe) for applying a DL-Processor
// patch zip. Reference pattern: electron/renderer/unit-history-panel.js.
//
// Public API (window-scoped — Task 7 wires the sidebar button to this):
//   __openPatchModal()
//   __closePatchModal()
//
// State machine driven by re-rendering .patch-body. Event delegation on
// the body dispatches on data-action.

(function () {
  const ERROR_MESSAGES = {
    'zip-not-found':      'Patch file not found.',
    'malformed-zip':      'This file is not a valid zip archive.',
    'missing-manifest':   'Patch zip is missing manifest.json.',
    'malformed-manifest': 'Patch manifest is malformed or missing required fields.',
    'wrong-app-id':       'This patch is for a different application.',
    'version-too-old':    'Your installed version is older than this patch supports. Install a newer base version first.',
    'missing-asar':       'Patch zip is missing the application archive.',
    'asar-hash-mismatch': 'Patch archive failed integrity check — the file may be corrupted.'
  };

  let modalEl = null;
  let bodyEl  = null;
  let escapeBound = false;
  let verifiedZipPath = null;   // remember across renders for Apply step

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('aside');
    modalEl.id = 'patch-modal';
    modalEl.hidden = true;
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'patch-modal-title');
    modalEl.innerHTML = [
      '<div class="patch-card">',
      '  <header class="patch-head">',
      '    <h2 id="patch-modal-title">Apply DL-Processor update</h2>',
      '    <button class="patch-close" aria-label="Close" type="button">×</button>',
      '  </header>',
      '  <section class="patch-body"></section>',
      '</div>'
    ].join('\n');
    document.body.appendChild(modalEl);

    bodyEl = modalEl.querySelector('.patch-body');

    modalEl.querySelector('.patch-close').addEventListener('click', closeModal);

    // Click-outside (on the backdrop) closes. Clicks inside .patch-card stop here.
    modalEl.addEventListener('click', (ev) => {
      if (ev.target === modalEl) closeModal();
    });

    // Event delegation on the body — dispatch on data-action.
    bodyEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'pick')   { pickAndVerify(); }
      else if (action === 'apply')  { applyPatch(verifiedZipPath); }
      else if (action === 'cancel') { closeModal(); }
      else if (action === 'retry')  { pickAndVerify(); }
    });

    if (!escapeBound) {
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && modalEl && !modalEl.hidden) closeModal();
      });
      escapeBound = true;
    }
    return modalEl;
  }

  // ── Render states ──────────────────────────────────────────────────────

  function renderInitial() {
    verifiedZipPath = null;
    bodyEl.innerHTML = [
      '<p class="patch-intro">Select a patch zip file (provided by IT) to update DL-Processor. ',
      'The patch will be verified before anything is applied.</p>',
      '<div class="patch-actions">',
      '  <button class="patch-btn patch-btn-primary" data-action="pick" type="button">Choose patch file…</button>',
      '</div>'
    ].join('\n');
  }

  function renderVerifying() {
    bodyEl.innerHTML = [
      '<div class="patch-status">',
      '  <span class="patch-spinner" aria-hidden="true"></span>',
      '  <span>Verifying patch…</span>',
      '</div>'
    ].join('\n');
  }

  function renderError(errCode, raw, opts) {
    opts = opts || {};
    const friendly = ERROR_MESSAGES[errCode];
    const message  = friendly || ('Patch verification failed: ' + escapeHtml(String(errCode || 'unknown error')));
    const btnLabel = opts.applyFailed ? 'Close' : 'Try another file';
    const btnAction = opts.applyFailed ? 'cancel' : 'retry';
    bodyEl.innerHTML = [
      '<div class="patch-banner patch-banner-error" role="alert">',
      '  <strong>' + (opts.applyFailed ? 'Apply failed' : 'Could not verify patch') + '</strong>',
      '  <p>' + (friendly ? escapeHtml(message) : message) + '</p>',
      '</div>',
      '<div class="patch-actions">',
      '  <button class="patch-btn" data-action="' + btnAction + '" type="button">' + btnLabel + '</button>',
      '</div>'
    ].join('\n');
  }

  function renderVerified(probe) {
    verifiedZipPath = probe.zipPath;
    const m = probe.manifest || {};
    const builtAt = m.built_at ? formatDate(m.built_at) : '—';
    const asarSize = m.asar_size != null ? formatBytes(m.asar_size) : '—';
    const sha = m.asar_sha256 ? String(m.asar_sha256) : '—';
    const notes = m.release_notes ? String(m.release_notes) : '';

    bodyEl.innerHTML = [
      '<div class="patch-banner patch-banner-ok">',
      '  <strong>✓ Patch verified</strong>',
      '</div>',
      '<dl class="patch-meta">',
      '  <dt>Current version</dt><dd>' + escapeHtml(probe.currentVersion || '—') + '</dd>',
      '  <dt>Target version</dt><dd>' + escapeHtml(m.to_version || '—') + '</dd>',
      '  <dt>Built</dt><dd>' + escapeHtml(builtAt) + '</dd>',
      '  <dt>Archive size</dt><dd>' + escapeHtml(asarSize) + '</dd>',
      '  <dt>SHA-256</dt><dd><code class="patch-sha">' + escapeHtml(sha) + '</code></dd>',
      (notes ? '  <dt>Release notes</dt><dd class="patch-notes">' + escapeHtml(notes) + '</dd>' : ''),
      '</dl>',
      '<div class="patch-warn">⚠ The app will close and restart automatically. Your data is NOT affected.</div>',
      '<div class="patch-actions">',
      '  <button class="patch-btn" data-action="cancel" type="button">Cancel</button>',
      '  <button class="patch-btn patch-btn-primary" data-action="apply" type="button">Apply &amp; Restart</button>',
      '</div>'
    ].join('\n');
  }

  function renderApplying() {
    bodyEl.innerHTML = [
      '<div class="patch-status">',
      '  <span class="patch-spinner" aria-hidden="true"></span>',
      '  <span>Applying patch — the app will restart in a moment…</span>',
      '</div>'
    ].join('\n');
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async function pickAndVerify() {
    let zipPath;
    try {
      zipPath = await window.dlp.pickOpen({
        title: 'Choose patch zip',
        filters: [{ name: 'DL-Processor patch (.zip)', extensions: ['zip'] }]
      });
    } catch (err) {
      renderError('pick-failed', { error: String(err && err.message ? err.message : err) });
      return;
    }
    if (!zipPath) return;   // user cancelled — stay on current state (initial)

    renderVerifying();

    let probe;
    try {
      probe = await window.dlp.patch.probeZip({ zipPath });
    } catch (err) {
      renderError('probe-threw', { error: String(err && err.message ? err.message : err) });
      return;
    }

    if (!probe || !probe.ok) {
      renderError(probe && probe.error, probe);
    } else {
      renderVerified(Object.assign({}, probe, { zipPath }));
    }
  }

  async function applyPatch(zipPath) {
    if (!zipPath) { renderError('no-zip-path', {}); return; }
    renderApplying();
    let result;
    try {
      result = await window.dlp.patch.apply({ zipPath });
    } catch (err) {
      renderError(String(err && err.message ? err.message : err) || 'apply-failed', {}, { applyFailed: true });
      return;
    }
    if (!result || !result.ok) {
      renderError((result && result.error) || 'apply-failed', result, { applyFailed: true });
      return;
    }
    // Success: main process will quit the app in ~500ms. Keep the spinner up.
  }

  // ── Open / close ───────────────────────────────────────────────────────

  function openModal() {
    const m = ensureModal();
    m.hidden = false;
    renderInitial();
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return String(n);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      // YYYY-MM-DD HH:MM UTC — locale-free, matches the rest of the app's logs.
      const pad = (n) => String(n).padStart(2, '0');
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
             ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
    } catch {
      return String(iso);
    }
  }

  window.__openPatchModal  = openModal;
  window.__closePatchModal = closeModal;
})();
