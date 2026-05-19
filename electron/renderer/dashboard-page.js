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

  // v2.3 Phase 7.2 — render the "Unusual activity" tile.
  // entries: rows from window.dlp.trending.get(...) — [] hides the tile.
  function renderTrendingTile(tileEl, entries) {
    if (!entries || entries.length === 0) {
      tileEl.innerHTML = '';
      tileEl.hidden = true;
      return;
    }
    tileEl.hidden = false;
    const rowsHtml = entries.map(e => {
      const ratioStr = (e.ratio === Infinity || e.ratio >= 999)
        ? '∞×'
        : (Math.round(e.ratio * 10) / 10).toFixed(1) + '×';
      const avgStr = (Math.round((e.trailing_avg || 0) * 10) / 10).toString();
      const pid = e.project_id != null ? ' data-project-id="' + escHtml(e.project_id) + '"' : '';
      return '<button type="button" class="trending-row"' + pid + '>' +
        '<span class="tr-name">' + escHtml(e.project_name) + '</span>' +
        '<span class="tr-stats">' +
          '<b>' + escHtml(e.this_month) + '</b> pending ' +
          '<span class="muted">(avg ' + escHtml(avgStr) + ' / 6mo, ' + escHtml(ratioStr) + ')</span>' +
        '</span>' +
      '</button>';
    }).join('');
    tileEl.innerHTML =
      '<div class="trending-head">' +
        '<h3>⚠ Unusual activity (' + entries.length + ' project' + (entries.length === 1 ? '' : 's') + ')</h3>' +
      '</div>' +
      '<div class="trending-rows">' + rowsHtml + '</div>';

    tileEl.querySelectorAll('.trending-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.dataset.projectId != null ? Number(btn.dataset.projectId) : null;
        if (projectId == null || Number.isNaN(projectId)) return;
        // Reuse the same path the project cards take so deep-linking lands on
        // the existing Compare page. Also dispatch the documented event for
        // any listeners that want to intercept.
        document.dispatchEvent(new CustomEvent('dlp:open-project-compare', { detail: { projectId } }));
        if (typeof window.__renderProjectComparePage === 'function' && window.__tabHost) {
          window.__tabHost.open({
            title: btn.querySelector('.tr-name')?.textContent || 'Project',
            render: (c) => window.__renderProjectComparePage(c, projectId)
          });
        }
      });
    });
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
      '<div class="trending-tile" hidden></div>',
      '<div class="dp-grid"></div>'
    ].join('');

    const totalsEl = container.querySelector('.dp-totals');
    const statusEl = container.querySelector('.dp-status');
    const gridEl   = container.querySelector('.dp-grid');
    const searchEl = container.querySelector('.dp-search');
    const refreshBtn = container.querySelector('.dp-refresh');
    const trendingEl = container.querySelector('.trending-tile');

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

    // v2.3 Phase 7.2 — load trending tile alongside summaries. Read the user's
    // configured thresholds from settings so the dashboard honours the
    // Phase 11 fields on every refresh.
    async function loadTrending() {
      let opts = {};
      try {
        if (window.dlp && window.dlp.settings && window.dlp.settings.get) {
          const s = await window.dlp.settings.get();
          if (s && s.trending_min_baseline != null)    opts.minBaseline    = Number(s.trending_min_baseline);
          if (s && s.trending_ratio_threshold != null) opts.ratioThreshold = Number(s.trending_ratio_threshold);
        }
      } catch (_) { /* fall through with defaults */ }
      try {
        const entries = await window.dlp.trending.get(opts);
        renderTrendingTile(trendingEl, Array.isArray(entries) ? entries : []);
      } catch (_) {
        // Trending is informational — never block the dashboard on failure.
        renderTrendingTile(trendingEl, []);
      }
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
      // Trending runs in parallel with grid render — failure must not affect it.
      loadTrending();
    }

    searchEl.addEventListener('input', applySearch);
    refreshBtn.addEventListener('click', load);
    load();
  }

  window.__renderDashboardPage = renderDashboardPage;
})();
