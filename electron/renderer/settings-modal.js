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
      <h3 id="settings-audit-title">Audit &amp; approval thresholds (v2.1)</h3>
      <div class="settings-row">
        <label for="settings-audit-user">Your name (audit attribution)</label>
        <input id="settings-audit-user" type="text" placeholder="empty = OS user" />
      </div>
      <div class="settings-row">
        <label for="settings-tier2-price-pct">Tier-2 price threshold (%)</label>
        <input id="settings-tier2-price-pct" type="number" min="0" />
      </div>
      <div class="settings-row">
        <label for="settings-tier2-price-abs">Tier-2 price threshold (AED)</label>
        <input id="settings-tier2-price-abs" type="number" min="0" />
      </div>
      <div class="settings-row">
        <label for="settings-tier2-area-pct">Tier-2 area threshold (%)</label>
        <input id="settings-tier2-area-pct" type="number" min="0" />
      </div>
      <h3 id="settings-v23-title">Workflow automation (v2.3)</h3>
      <div class="settings-row">
        <label for="settings-trending-min-baseline">Trending: min baseline</label>
        <input id="settings-trending-min-baseline" type="number" min="0" step="1" />
      </div>
      <div class="settings-row">
        <label for="settings-trending-ratio-threshold">Trending: ratio threshold</label>
        <input id="settings-trending-ratio-threshold" type="number" min="0" step="0.1" />
      </div>
      <div class="settings-row">
        <label for="settings-rules-warn-builtin">
          <input id="settings-rules-warn-builtin" type="checkbox" />
          Rules: warn before disabling built-in
        </label>
      </div>
      <div class="settings-row">
        <label for="settings-bulk-confirmation-threshold">Bulk: confirmation threshold</label>
        <input id="settings-bulk-confirmation-threshold" type="number" min="0" step="1" />
      </div>
      <div class="settings-row">
        <button id="settings-save" class="primary">Save settings</button>
        <span id="settings-save-status" class="muted"></span>
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
    document.getElementById('settings-save-status').textContent = '';
    window.dlp.version().then(v => {
      document.getElementById('settings-version').textContent = v;
    });
    // v2.1 — pre-fill audit/threshold fields from app config.
    if (window.dlp && window.dlp.settings && window.dlp.settings.get) {
      window.dlp.settings.get().then(s => {
        document.getElementById('settings-audit-user').value      = s.audit_user || '';
        document.getElementById('settings-tier2-price-pct').value = s.tier2_price_pct;
        document.getElementById('settings-tier2-price-abs').value = s.tier2_price_abs;
        document.getElementById('settings-tier2-area-pct').value  = s.tier2_area_pct;
        // v2.3 — fall back to spec defaults when keys are absent from the
        // saved config (existing handler whitelists v2.1 keys; v2.3 keys
        // round-trip once Phase 11 IPC wire-up lands).
        document.getElementById('settings-trending-min-baseline').value =
          s.trending_min_baseline != null ? s.trending_min_baseline : 5;
        document.getElementById('settings-trending-ratio-threshold').value =
          s.trending_ratio_threshold != null ? s.trending_ratio_threshold : 2.0;
        document.getElementById('settings-rules-warn-builtin').checked =
          s.rules_warn_before_disabling_builtin != null ? !!s.rules_warn_before_disabling_builtin : true;
        document.getElementById('settings-bulk-confirmation-threshold').value =
          s.bulk_confirmation_threshold != null ? s.bulk_confirmation_threshold : 25;
      }).catch(() => { /* leave fields empty on error */ });
    }
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

  modal.querySelector('#settings-save').addEventListener('click', async () => {
    const statusEl = document.getElementById('settings-save-status');
    // Validate numeric fields: reject NaN / negative.
    const numericIds = [
      'settings-tier2-price-pct',
      'settings-tier2-price-abs',
      'settings-tier2-area-pct',
      'settings-trending-min-baseline',
      'settings-trending-ratio-threshold',
      'settings-bulk-confirmation-threshold'
    ];
    for (const id of numericIds) {
      const raw = document.getElementById(id).value;
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n) || n < 0) {
        statusEl.textContent = 'invalid value in "' +
          (document.querySelector('label[for="' + id + '"]').textContent || id).trim() + '"';
        return;
      }
    }
    const partial = {
      audit_user:       document.getElementById('settings-audit-user').value,
      tier2_price_pct:  Number(document.getElementById('settings-tier2-price-pct').value),
      tier2_price_abs:  Number(document.getElementById('settings-tier2-price-abs').value),
      tier2_area_pct:   Number(document.getElementById('settings-tier2-area-pct').value),
      // v2.3 keys — flow through dlp:settings:set IPC.
      trending_min_baseline:               Number(document.getElementById('settings-trending-min-baseline').value),
      trending_ratio_threshold:            Number(document.getElementById('settings-trending-ratio-threshold').value),
      rules_warn_before_disabling_builtin: document.getElementById('settings-rules-warn-builtin').checked,
      bulk_confirmation_threshold:         Number(document.getElementById('settings-bulk-confirmation-threshold').value)
    };
    statusEl.textContent = 'saving…';
    try {
      const result = await window.dlp.settings.set(partial);
      statusEl.textContent = (result && result.ok) ? 'Settings saved' : 'save failed';
    } catch (e) {
      statusEl.textContent = 'error: ' + (e && e.message ? e.message : String(e));
    }
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
