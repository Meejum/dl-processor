function initSettingsModal({ getDataFolder, onCheckForUpdates }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Settings</h2>
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
      <div class="modal-actions">
        <button id="settings-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  function open() {
    modal.hidden = false;
    document.getElementById('settings-data-folder').textContent = getDataFolder() || '';
    document.getElementById('settings-update-status').textContent = '';
    window.dlp.version().then(v => {
      document.getElementById('settings-version').textContent = v;
    });
  }

  modal.querySelector('#settings-close').addEventListener('click', () => { modal.hidden = true; });
  modal.querySelector('#settings-check-updates').addEventListener('click', async () => {
    const statusEl = document.getElementById('settings-update-status');
    statusEl.textContent = 'checking…';
    try {
      const result = await onCheckForUpdates();
      statusEl.textContent = (result && result.message) || 'no update info';
    } catch (e) { statusEl.textContent = 'error: ' + (e && e.message ? e.message : String(e)); }
  });

  // Click outside the card closes the modal.
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) modal.hidden = true;
  });

  return { open };
}

window.__initSettingsModal = initSettingsModal;
