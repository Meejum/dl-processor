function initSettingsModal({ getDataFolder, onCheckForUpdates }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'settings-title');
  modal.innerHTML = `
    <div class="modal-card">
      <h2 id="settings-title">Settings</h2>
      <div class="settings-row">
        <label>Data folder</label>
        <code id="settings-data-folder"></code>
      </div>
      <div class="settings-row">
        <label>Version</label>
        <code id="settings-version"></code>
      </div>
      <div class="settings-row">
        <button id="settings-check-updates" class="primary">Check for updates</button>
        <span id="settings-update-status" class="muted"></span>
      </div>
      <div class="settings-row">
        <button id="settings-revert-patch">Revert last patch</button>
        <span id="settings-revert-status" class="muted">Restores the previous app.asar from .bak — used if a patch causes problems.</span>
      </div>
      <div class="modal-actions">
        <button id="settings-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#settings-close');
  let openerEl = null;   // remember who opened the modal so we can return focus

  function close() {
    modal.hidden = true;
    if (openerEl && openerEl.focus) openerEl.focus();
    openerEl = null;
  }

  function open() {
    openerEl = document.activeElement;
    modal.hidden = false;
    document.getElementById('settings-data-folder').textContent = getDataFolder() || '';
    document.getElementById('settings-update-status').textContent = '';
    window.dlp.version().then(v => {
      document.getElementById('settings-version').textContent = v;
    });
    // Move focus into the modal so the Esc/Tab handlers below have a target.
    setTimeout(() => closeBtn.focus(), 0);
  }

  closeBtn.addEventListener('click', close);
  modal.querySelector('#settings-check-updates').addEventListener('click', async () => {
    const statusEl = document.getElementById('settings-update-status');
    statusEl.textContent = 'checking…';
    try {
      const result = await onCheckForUpdates();
      statusEl.textContent = (result && result.message) || 'no update info';
    } catch (e) { statusEl.textContent = 'error: ' + (e && e.message ? e.message : String(e)); }
  });

  modal.querySelector('#settings-revert-patch').addEventListener('click', async () => {
    const statusEl = document.getElementById('settings-revert-status');
    if (!confirm('Revert to the previous app.asar? The app will restart.')) return;
    statusEl.textContent = 'reverting…';
    try {
      const result = await window.dlp.patch.revertLast();
      if (result && result.ok) {
        statusEl.textContent = 'Reverting — app will restart momentarily.';
      } else {
        statusEl.textContent = (result && result.error) || 'no .bak available — nothing to revert';
      }
    } catch (e) { statusEl.textContent = 'error: ' + (e && e.message ? e.message : String(e)); }
  });

  // Click outside the card closes the modal.
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });

  // Esc closes the modal. Tab cycles focus within the modal so it never
  // escapes to the obscured app behind.
  modal.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); close(); return; }
    if (ev.key !== 'Tab') return;
    const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });

  return { open };
}

window.__initSettingsModal = initSettingsModal;
