// Per-unit history side panel — v1.1 Task 12.
//
// Slide-in 400px panel rendered at document.body level. One instance is
// created on first open and re-used for every subsequent call (cheaper
// than tearing down and rebuilding the DOM each time, and lets us keep
// the Escape handler bound just once).
//
// Public API (exposed on `window` so iframe-hosted pages can reach us via
// `window.parent.__openUnitHistoryPanel(...)`):
//   __openUnitHistoryPanel(projectId, unitNumberNorm)
//   __closeUnitHistoryPanel()
//
// The footer's "View in global History →" link fires a `dlp:open-history`
// CustomEvent on document — Task 13 listens for it and pre-filters the
// global History page.

(function () {
  let panel = null;
  let escapeBound = false;

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'unit-history-panel';
    panel.hidden = true;
    panel.innerHTML = [
      '<div class="uhp-head">',
      '  <span class="uhp-title">Unit</span>',
      '  <button class="uhp-close" aria-label="Close" type="button">×</button>',
      '</div>',
      '<section class="uhp-current"></section>',
      '<section class="uhp-history"></section>',
      '<footer class="uhp-footer">',
      '  <a class="uhp-deeplink" href="#">View in global History →</a>',
      '</footer>'
    ].join('\n');
    document.body.appendChild(panel);
    panel.querySelector('.uhp-close').addEventListener('click', closeUnitHistoryPanel);
    if (!escapeBound) {
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && panel && !panel.hidden) closeUnitHistoryPanel();
      });
      escapeBound = true;
    }
    return panel;
  }

  async function openUnitHistoryPanel(projectId, unitNumberNorm) {
    const p = ensurePanel();
    p.hidden = false;
    p.querySelector('.uhp-title').textContent = 'Unit ' + unitNumberNorm;
    // Show a "loading" line while the IPC round-trip is in flight so the
    // panel doesn't look broken on a cold DB cache.
    const currentEl = p.querySelector('.uhp-current');
    const historyEl = p.querySelector('.uhp-history');
    currentEl.innerHTML = '<p class="uhp-empty">Loading…</p>';
    historyEl.innerHTML = '';

    let data;
    try {
      data = await window.dlp.audit.unitHistory({ projectId, unitNumberNorm });
    } catch (err) {
      currentEl.innerHTML = '<p class="uhp-empty">Failed to load: ' + escapeHtml(err && err.message ? err.message : String(err)) + '</p>';
      return;
    }

    renderCurrent(currentEl, data.current);
    renderHistory(historyEl, data.events);

    const deeplink = p.querySelector('.uhp-deeplink');
    deeplink.onclick = (ev) => {
      ev.preventDefault();
      // Task 13's global History page listens for this event. Until that
      // task lands the dispatch is a no-op, which is the desired behaviour
      // (panel stays open, link is harmless).
      document.dispatchEvent(new CustomEvent('dlp:open-history', {
        detail: { projectId, unitNumberNorm }
      }));
    };
  }

  function closeUnitHistoryPanel() {
    if (panel) panel.hidden = true;
  }

  function renderCurrent(el, current) {
    if (!current) {
      el.innerHTML = '<h3>Current state (master_data)</h3>' +
                     '<p class="uhp-empty">No master_data record for this unit.</p>';
      return;
    }
    const fields = ['buyer_name', 'purchase_price_aed', 'area_sqm', 'status', 'procedure_number'];
    el.innerHTML = '<h3>Current state (master_data)</h3>' +
      '<dl>' +
      fields.map(f => '<dt>' + escapeHtml(f) + '</dt><dd>' + escapeHtml(current[f]) + '</dd>').join('') +
      '</dl>';
  }

  function renderHistory(el, events) {
    if (!events || !events.length) {
      el.innerHTML = '<h3>History</h3><p class="uhp-empty">No history yet.</p>';
      return;
    }
    el.innerHTML = '<h3>History (newest first)</h3>' +
      events.map(e => [
        '<article class="uhp-event">',
        '  <header>' + escapeHtml(e.ts) + '</header>',
        '  <p>' + escapeHtml(e.field) + ': ' + escapeHtml(e.old_value) + ' → ' + escapeHtml(e.new_value) + '</p>',
        '  <small>' + escapeHtml(e.action) + ' · ' + escapeHtml(e.source) + '</small>',
        '</article>'
      ].join('\n')).join('\n');
  }

  function escapeHtml(s) {
    if (s == null) return '<em>null</em>';
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  window.__openUnitHistoryPanel = openUnitHistoryPanel;
  window.__closeUnitHistoryPanel = closeUnitHistoryPanel;
})();
