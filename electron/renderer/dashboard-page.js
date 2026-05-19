// Renders the Dashboard page natively into a tab-host render-mode pane.
// Replaces output/dashboard.html. (Spec § 4.)
//
// Caller: tabHost.open({ title, render: (c) => window.__renderDashboardPage(c) }).

(function () {

  const COUNT_KEYS = ['BUYER_MISMATCH', 'AREA_MISMATCH', 'DLD_ONLY', 'SF_ONLY', 'PRICE_UP', 'PRICE_DOWN'];
  const COUNT_LABEL = {
    BUYER_MISMATCH: 'BUYER',
    AREA_MISMATCH:  'AREA',
    DLD_ONLY:       'DLD-only',
    SF_ONLY:        'SF-only',
    PRICE_UP:       'PRICE ↑',
    PRICE_DOWN:     'PRICE ↓'
  };
  const COUNT_CLASS = {
    BUYER_MISMATCH: 'warn',
    AREA_MISMATCH:  'area',
    DLD_ONLY:       'dld',
    SF_ONLY:        'sf',
    PRICE_UP:       'up',
    PRICE_DOWN:     'down'
  };

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 10);
  }

  function renderCard(summary) {
    const card = document.createElement('div');
    card.className = 'dashboard-card';
    if (summary.source === 'SF only') card.classList.add('is-sf-only');
    card.dataset.projectName = (summary.project_name || '').toLowerCase();
    if (summary.project_id != null) card.dataset.projectId = String(summary.project_id);

    const head = document.createElement('div');
    head.className = 'dc-head';
    head.innerHTML =
      '<h3 class="dc-name">' + escHtml(summary.project_name) + '</h3>' +
      '<span class="dc-source">' + escHtml(summary.source) + '</span>';
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'dc-meta';
    meta.innerHTML =
      '<span class="dc-total">' + (summary.total || 0).toLocaleString() + ' units</span>';
    card.appendChild(meta);

    const chips = document.createElement('div');
    chips.className = 'dc-chips';
    let nonZeroAny = false;
    for (const key of COUNT_KEYS) {
      const n = (summary.counts && summary.counts[key]) || 0;
      if (n <= 0) continue;
      nonZeroAny = true;
      const c = document.createElement('span');
      c.className = 'chip ' + (COUNT_CLASS[key] || '');
      c.textContent = COUNT_LABEL[key] + ' ' + n;
      chips.appendChild(c);
    }
    if (nonZeroAny) card.appendChild(chips);

    if (summary.pending_count > 0) {
      const pendRow = document.createElement('div');
      pendRow.className = 'dc-pending-row';
      const pchip = document.createElement('button');
      pchip.type = 'button';
      pchip.className = 'chip warn dc-pending-chip';
      pchip.textContent = 'PENDING ' + summary.pending_count + ' →';
      pchip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        document.dispatchEvent(new CustomEvent('dlp:open-review-pending', {
          detail: { projectId: summary.project_id, projectName: summary.project_name }
        }));
      });
      pendRow.appendChild(pchip);
      card.appendChild(pendRow);
    }

    const ts = document.createElement('div');
    ts.className = 'dc-timestamps';
    const dld = fmtDate(summary.last_dld_at);
    const sf  = fmtDate(summary.last_sf_at);
    ts.innerHTML =
      (dld ? '<span>DLD ' + escHtml(dld) + '</span>' : '') +
      (sf  ? '<span>SF '  + escHtml(sf)  + '</span>' : '');
    card.appendChild(ts);

    const m = (summary.counts && summary.counts.MATCH) || 0;
    const matchEl = document.createElement('div');
    matchEl.className = 'dc-match';
    matchEl.textContent = 'MATCH ' + m.toLocaleString();
    card.appendChild(matchEl);

    if (summary.project_id != null) {
      card.addEventListener('click', () => {
        if (typeof window.__renderProjectComparePage !== 'function') return;
        window.__tabHost.open({
          title: summary.project_name,
          render: (c) => window.__renderProjectComparePage(c, summary.project_id)
        });
      });
    } else {
      card.classList.add('is-disabled');
      card.title = 'SF-only — no DLD data to compare';
    }
    return card;
  }

  function renderDashboardPage(container) {
    container.classList.add('dashboard-page');
    container.innerHTML = [
      '<div class="dp-head">',
      '  <h2>Portfolio overview</h2>',
      '  <div class="dp-totals"></div>',
      '  <input class="dp-search" placeholder="Search projects…" autocomplete="off">',
      '  <button class="dp-refresh">Refresh</button>',
      '</div>',
      '<div class="dp-status"></div>',
      '<div class="dp-grid"></div>'
    ].join('');

    const totalsEl = container.querySelector('.dp-totals');
    const statusEl = container.querySelector('.dp-status');
    const gridEl   = container.querySelector('.dp-grid');
    const searchEl = container.querySelector('.dp-search');
    const refreshBtn = container.querySelector('.dp-refresh');

    let summaries = [];

    function applySearch() {
      const needle = searchEl.value.trim().toLowerCase();
      const cards = Array.from(gridEl.children);
      for (const card of cards) {
        const match = !needle || (card.dataset.projectName || '').indexOf(needle) !== -1;
        card.classList.toggle('hidden', !match);
      }
    }

    function renderTotals() {
      const projectCount = summaries.length;
      const unitTotal = summaries.reduce((a, s) => a + (s.total || 0), 0);
      const issueTotal = summaries.reduce((a, s) => {
        const c = s.counts || {};
        return a + COUNT_KEYS.reduce((b, k) => b + (c[k] || 0), 0);
      }, 0);
      const pendingTotal = summaries.reduce((a, s) => a + (s.pending_count || 0), 0);
      totalsEl.innerHTML =
        '<span><b>' + projectCount + '</b> projects</span>' +
        '<span>· <b>' + unitTotal.toLocaleString() + '</b> units</span>' +
        '<span>· <b>' + issueTotal.toLocaleString() + '</b> issues</span>' +
        '<span>· <b>' + pendingTotal.toLocaleString() + '</b> pending</span>';
    }

    async function load() {
      statusEl.textContent = 'Loading…';
      gridEl.innerHTML = '';
      try {
        summaries = await window.dlp.compare.summary();
        statusEl.textContent = '';
        renderTotals();
        for (const s of summaries) gridEl.appendChild(renderCard(s));
        applySearch();
      } catch (e) {
        statusEl.textContent = 'Failed to load: ' + (e && e.message ? e.message : e);
        statusEl.classList.add('is-error');
      }
    }

    searchEl.addEventListener('input', applySearch);
    refreshBtn.addEventListener('click', load);
    load();
  }

  window.__renderDashboardPage = renderDashboardPage;
})();
