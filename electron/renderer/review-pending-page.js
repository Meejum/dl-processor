// Renders the Review Pending page natively into a tab-host render-mode pane.
//
// Architecture (v2.0):
//   Task 5  — converted from srcdoc-iframe to native DOM.
//   Task 15 — Needs review tab now renders a list of BP cards (one per
//             (snapshot, project, unit) group) via window.__renderBpCard.
//             A multi-dimension filter bar sits above the tab strip.
//             The Drift log tab still renders the v1.1 flat per-row table
//             (auto_applied rows) — drift is not card-grouped per spec.
//
//   - Caller: tabHost.open({ title, render: (container) => window.__renderReviewPendingPage(container) }).
//   - Scripts run in the main renderer context — uses window.dlp.review.* directly.
//   - All CSS lives in styles.css under the .review-pending-page scope.
//   - DOM lookups are scoped to `container` so multiple Review Pending tabs
//     (if ever opened) don't collide via global IDs.
//
// Filter defaults (first load):
//   - SF state ≠ REJECTED (applied client-side; backend still returns all states)
//   - Date range = Last 30 days (translates to fromTs)
//
// Card actions wired (per bp-card.js onAction event types):
//   approve-bp, reject-bp, acknowledge-bp, open-in-sf (clipboard copy for v2.0),
//   approve-row, reject-row, teach-alias (scope passed straight to IPC).

(function () {

  // ─────────────────────────────────────────────────────────────────────
  // Static option lists for the BP type / SF state filters.
  // Must match the labels emitted by classifyBp / classifyState.
  // ─────────────────────────────────────────────────────────────────────
  const BP_TYPES = [
    'Resale',
    'Buyer correction',
    'Price amendment',
    'Status update',
    'Procedure update',
    'Area correction',
    'Multi-field update'
  ];

  const SF_STATES = [
    'READY',
    'IN_PROGRESS',
    'DLD_ISSUE',
    'REJECTED',
    'NO_SF_ROW'
  ];

  // Date-range presets: maps preset key → ISO fromTs (relative to now).
  function computeFromTs(preset) {
    const now = Date.now();
    const DAY = 86400 * 1000;
    switch (preset) {
      case 'last_7_days':   return new Date(now - 7 * DAY).toISOString();
      case 'last_30_days':  return new Date(now - 30 * DAY).toISOString();
      case 'last_90_days':  return new Date(now - 90 * DAY).toISOString();
      case 'all_time':      return null;
      default:              return null;
    }
  }

  function renderReviewPendingPage(container, _opts) {
    container.classList.add('review-pending-page');

    // Page skeleton — filter bar sits above the tab strip; content area
    // below switches between Needs review (BP cards) and Drift log (table).
    container.innerHTML = [
      '<div class="rp-filter-bar">',
        '<div class="rp-filter-row rp-filter-row-1">',
          '<label class="rp-f">Project',
            '<select class="rp-f-project"><option value="">All</option></select>',
          '</label>',
          '<label class="rp-f">Tower',
            '<select class="rp-f-tower"><option value="">All</option></select>',
          '</label>',
          '<label class="rp-f">BP type',
            '<select class="rp-f-bp-type"><option value="">All</option></select>',
          '</label>',
          '<label class="rp-f">SF state',
            '<select class="rp-f-sf-state"><option value="">All (except Rejected)</option></select>',
          '</label>',
          '<label class="rp-f">Assigned to',
            '<select class="rp-f-assigned"><option value="">All</option></select>',
          '</label>',
        '</div>',
        '<div class="rp-filter-row rp-filter-row-2">',
          '<label class="rp-f">Procedure #',
            '<input type="text" class="rp-f-procedure" placeholder="e.g. 123456">',
          '</label>',
          '<label class="rp-f">Date range',
            '<select class="rp-f-date">',
              '<option value="last_7_days">Last 7 days</option>',
              '<option value="last_30_days" selected>Last 30 days</option>',
              '<option value="last_90_days">Last 90 days</option>',
              '<option value="all_time">All time</option>',
            '</select>',
          '</label>',
          '<label class="rp-f rp-f-search">Search',
            '<input type="text" class="rp-f-search-input" placeholder="unit, buyer, comments…">',
          '</label>',
          '<div class="rp-filter-actions">',
            '<button type="button" class="rp-btn rp-btn-apply">Apply</button>',
            '<button type="button" class="rp-btn rp-btn-reset">Reset</button>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="rp-toolbar">',
        '<span class="rp-status"></span>',
      '</div>',
      '<div class="rp-tabs"></div>',
      '<div class="rp-content"></div>',
      '<div class="rp-footer">Approvals write directly to master_data, pending_change, and audit_log in a single transaction.</div>'
    ].join('');

    const api = (window.dlp && window.dlp.review) || null;
    const statusEl  = container.querySelector('.rp-status');
    const contentEl = container.querySelector('.rp-content');
    const tabsEl    = container.querySelector('.rp-tabs');

    // Filter bar elements.
    const fProject   = container.querySelector('.rp-f-project');
    const fTower     = container.querySelector('.rp-f-tower');
    const fBpType    = container.querySelector('.rp-f-bp-type');
    const fSfState   = container.querySelector('.rp-f-sf-state');
    const fAssigned  = container.querySelector('.rp-f-assigned');
    const fProcedure = container.querySelector('.rp-f-procedure');
    const fDate      = container.querySelector('.rp-f-date');
    const fSearch    = container.querySelector('.rp-f-search-input');
    const btnApply   = container.querySelector('.rp-btn-apply');
    const btnReset   = container.querySelector('.rp-btn-reset');

    if (!api) {
      statusEl.textContent = 'window.dlp.review is not available — preload may not have loaded.';
      statusEl.classList.add('is-error');
      return;
    }

    let activeTab = 'needs_review';
    let driftRowsCache = [];   // raw rows from api.list({ tab: 'drift' })
    let needsBpsCache  = [];   // raw BPs from api.listBps({ tab: 'needs_review' })

    // Active filter state — mirrored to the inputs at Reset.
    const filterDefaults = {
      projectId: null,
      towerName: null,
      bpType: null,
      // SF state filter — null means "all except REJECTED" (default). When set,
      // it's a single state string. Applied client-side per Task 15 spec.
      sfState: null,
      excludeRejectedByDefault: true,
      assignedTo: null,
      procedureNumber: null,
      datePreset: 'last_30_days',
      fromTs: computeFromTs('last_30_days'),
      toTs: null,
      search: null
    };
    let filterState = Object.assign({}, filterDefaults);

    function setStatus(text, tone) {
      statusEl.textContent = text || '';
      statusEl.classList.remove('is-ok', 'is-error');
      if (tone) statusEl.classList.add('is-' + tone);
    }

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }

    function fmtField(f) {
      return ({
        buyer_name: 'buyer',
        purchase_price_aed: 'price',
        procedure_number: 'procedure',
        area_sqm: 'area',
        status: 'status'
      })[f] || f;
    }

    // ─────────────────────────────────────────────────────────────────
    // Filter dropdown population
    // ─────────────────────────────────────────────────────────────────

    async function populateProjects() {
      try {
        const list = await window.dlp.projects.list();
        const opts = ['<option value="">All</option>'];
        for (const p of (list || [])) {
          opts.push('<option value="' + esc(p.project_id) + '">' + esc(p.project_name) + '</option>');
        }
        fProject.innerHTML = opts.join('');
      } catch (e) {
        // Projects list failure shouldn't block the page.
        fProject.innerHTML = '<option value="">All</option>';
      }
    }

    function populateStaticFilters() {
      const bpOpts = ['<option value="">All</option>']
        .concat(BP_TYPES.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>'));
      fBpType.innerHTML = bpOpts.join('');
      const stateOpts = ['<option value="">All (except Rejected)</option>']
        .concat(SF_STATES.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>'));
      fSfState.innerHTML = stateOpts.join('');
    }

    // Tower / Assigned dropdowns are rebuilt from the BPs returned by the
    // last needs-review fetch. We preserve the current selection if it is
    // still a valid option.
    function refreshDynamicFiltersFromBps(bps) {
      const towers = new Set();
      const assigned = new Set();
      for (const bp of bps) {
        const sf = bp.sfContext || {};
        if (sf.tower_name) towers.add(sf.tower_name);
        if (sf.current_step_assigned_name) assigned.add(sf.current_step_assigned_name);
      }
      const fillSelect = (sel, values, currentVal) => {
        const opts = ['<option value="">All</option>'];
        const sorted = Array.from(values).sort((a, b) => String(a).localeCompare(String(b)));
        for (const v of sorted) {
          opts.push('<option value="' + esc(v) + '">' + esc(v) + '</option>');
        }
        sel.innerHTML = opts.join('');
        if (currentVal && values.has(currentVal)) sel.value = currentVal;
      };
      fillSelect(fTower,    towers,   filterState.towerName);
      fillSelect(fAssigned, assigned, filterState.assignedTo);
    }

    // ─────────────────────────────────────────────────────────────────
    // Read filter inputs into filterState
    // ─────────────────────────────────────────────────────────────────
    function readFiltersFromInputs() {
      filterState.projectId       = fProject.value ? Number(fProject.value) : null;
      filterState.towerName       = fTower.value || null;
      filterState.bpType          = fBpType.value || null;
      const stateVal              = fSfState.value || null;
      filterState.sfState         = stateVal;
      filterState.excludeRejectedByDefault = !stateVal; // only filter REJECTED out when no explicit state
      filterState.assignedTo      = fAssigned.value || null;
      filterState.procedureNumber = fProcedure.value.trim() || null;
      filterState.datePreset      = fDate.value || 'last_30_days';
      filterState.fromTs          = computeFromTs(filterState.datePreset);
      filterState.toTs            = null;
      filterState.search          = fSearch.value.trim() || null;
    }

    function writeFiltersToInputs() {
      fProject.value   = filterState.projectId == null ? '' : String(filterState.projectId);
      fTower.value     = filterState.towerName || '';
      fBpType.value    = filterState.bpType || '';
      fSfState.value   = filterState.sfState || '';
      fAssigned.value  = filterState.assignedTo || '';
      fProcedure.value = filterState.procedureNumber || '';
      fDate.value      = filterState.datePreset || 'last_30_days';
      fSearch.value    = filterState.search || '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Tabs
    // ─────────────────────────────────────────────────────────────────

    function renderTabs(needsCount, driftCount) {
      tabsEl.innerHTML = [
        '<button class="rp-tab' + (activeTab === 'needs_review' ? ' active' : '') + '" data-tab="needs_review">',
          'Needs review <span class="rp-tab-badge rp-badge-needs">' + (needsCount || 0) + '</span>',
        '</button>',
        '<button class="rp-tab' + (activeTab === 'drift' ? ' active' : '') + '" data-tab="drift">',
          'Drift log <span class="rp-tab-badge rp-badge-drift">' + (driftCount || 0) + '</span>',
        '</button>'
      ].join('');
    }

    function setTabBadge(which, count) {
      const sel = which === 'needs-review' ? '.rp-badge-needs' : '.rp-badge-drift';
      const badge = tabsEl.querySelector(sel);
      if (badge) badge.textContent = String(count || 0);
    }

    // ─────────────────────────────────────────────────────────────────
    // Needs review — fetch + render BP cards
    // ─────────────────────────────────────────────────────────────────

    function applyClientSideBpFilters(bps) {
      // Backend already handles: projectId, fromTs/toTs, bpType, sfState,
      // assignedTo, procedureNumber, search. We additionally:
      //   1. Filter REJECTED when no explicit SF state was chosen.
      //   2. Apply the tower filter (renderer-only).
      return bps.filter(bp => {
        if (filterState.excludeRejectedByDefault && bp.state === 'REJECTED') return false;
        if (filterState.towerName) {
          const t = bp.sfContext && bp.sfContext.tower_name;
          if (t !== filterState.towerName) return false;
        }
        return true;
      });
    }

    async function loadAndRenderBpCards() {
      contentEl.innerHTML = '<div class="rp-bp-list-loading">Loading…</div>';

      // Build the listBps opts. Note: sfState is left as the explicit user
      // pick (or undefined for "all"). REJECTED default-exclusion happens
      // client-side per Task 15 spec.
      const opts = {
        tab: 'needs_review',
        projectId:       filterState.projectId || undefined,
        bpType:          filterState.bpType || undefined,
        sfState:         filterState.sfState || undefined,
        assignedTo:      filterState.assignedTo || undefined,
        procedureNumber: filterState.procedureNumber || undefined,
        fromTs:          filterState.fromTs || undefined,
        toTs:            filterState.toTs || undefined,
        search:          filterState.search || undefined
      };

      let bps;
      try {
        bps = await api.listBps(opts);
      } catch (e) {
        contentEl.innerHTML = '';
        setStatus('Failed to load BPs: ' + (e && e.message ? e.message : String(e)), 'error');
        return;
      }
      needsBpsCache = bps || [];

      // Repopulate dynamic dropdowns based on the unfiltered (server-side)
      // result, so the user can pick towers/assignees that exist in the
      // current scope. We use the cache BEFORE the local REJECTED/tower
      // filter so that selecting a tower from the dropdown stays consistent.
      refreshDynamicFiltersFromBps(needsBpsCache);

      const filtered = applyClientSideBpFilters(needsBpsCache);
      setTabBadge('needs-review', filtered.length);

      if (activeTab !== 'needs_review') return; // user switched tabs while loading

      if (filtered.length === 0) {
        contentEl.innerHTML =
          '<div class="rp-empty"><strong>Nothing to review</strong>' +
          'No BPs match the current filters. Try widening Date range, clearing Project/Tower, or [Reset].' +
          '</div>';
        return;
      }

      contentEl.innerHTML = '<div class="rp-bp-list"></div>';
      const listEl = contentEl.querySelector('.rp-bp-list');
      for (const bp of filtered) {
        const wrap = document.createElement('div');
        wrap.className = 'rp-bp-card-wrap';
        listEl.appendChild(wrap);
        window.__renderBpCard(wrap, bp, (event) => handleCardAction(event));
      }
    }

    async function handleCardAction(event) {
      const t = event && event.type;
      const bpId = event && event.bpId;
      const payload = (event && event.payload) || {};
      try {
        switch (t) {
          case 'approve-bp': {
            setStatus('Approving BP ' + bpId + '…');
            await api.approveBp({ bpId, overrides: payload.overrides || {} });
            setStatus('BP approved.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'reject-bp': {
            setStatus('Rejecting BP ' + bpId + '…');
            await api.rejectBp({ bpId });
            setStatus('BP rejected.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'acknowledge-bp': {
            setStatus('Acknowledging BP ' + bpId + '…');
            await api.acknowledgeBp({ bpId });
            setStatus('BP acknowledged.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'open-in-sf': {
            // For v2.0 the Sobha SF instance URL pattern isn't configured —
            // we just copy the booking_record_id to the clipboard.
            const id = payload.bookingRecordId;
            if (!id) { setStatus('No booking record id available.', 'error'); return; }
            try {
              await navigator.clipboard.writeText(String(id));
              setStatus('Copied SF record ID: ' + id, 'ok');
            } catch (clipErr) {
              setStatus('Could not copy to clipboard: ' + (clipErr && clipErr.message ? clipErr.message : String(clipErr)), 'error');
            }
            return;
          }
          case 'approve-row': {
            const changeId = Number(payload.changeId);
            setStatus('Approving change #' + changeId + '…');
            await api.approve({ changeId, override: payload.override == null ? null : payload.override });
            setStatus('Row approved.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'reject-row': {
            const changeId = Number(payload.changeId);
            setStatus('Rejecting change #' + changeId + '…');
            await api.reject({ changeId });
            setStatus('Row rejected.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'teach-alias': {
            // bp-card.js emits scope='unit' today; teach-alias backend accepts
            // 'project' or 'global'. We default to 'project' for v2.0 to keep
            // parity with the v1.1 conservative scope. A modal picker for
            // global is a v2.1 follow-up.
            const changeId = Number(payload.changeId);
            const scope = (payload.scope === 'global') ? 'global' : 'project';
            setStatus('Teaching alias (scope=' + scope + ')…');
            await api.teachAlias({ changeId, scope });
            setStatus('Alias taught.', 'ok');
            await loadAndRenderBpCards();
            return;
          }
          case 'expand-toggle':
            // Purely UI — no IPC needed.
            return;
          default:
            return;
        }
      } catch (e) {
        setStatus('Action failed: ' + (e && e.message ? e.message : String(e)), 'error');
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Drift log tab — unchanged v1.1 behaviour: flat table of auto_applied
    // ─────────────────────────────────────────────────────────────────

    function fmtWhen(s) {
      if (!s) return '';
      const d = new Date(String(s).replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return String(s);
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
             ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function fmtSource(changeType) {
      if (changeType === 'DLD_DRIFT') return 'DLD import';
      if (changeType === 'SF_DRIFT')  return 'SF import';
      return changeType || '';
    }

    function visibleDriftRows() {
      let rows = driftRowsCache.slice();
      // Project filter
      if (filterState.projectId) {
        rows = rows.filter(r => Number(r.project_id) === Number(filterState.projectId));
      }
      // Date range (uses decided_at)
      if (filterState.fromTs) {
        const fromMs = new Date(filterState.fromTs).getTime();
        rows = rows.filter(r => {
          if (!r.decided_at) return true;
          const t = new Date(String(r.decided_at).replace(' ', 'T') + 'Z').getTime();
          return isNaN(t) ? true : t >= fromMs;
        });
      }
      // Search across unit / project / field / values
      if (filterState.search) {
        const needle = filterState.search.toLowerCase();
        rows = rows.filter(r => {
          const hay = [r.unit_number_norm, r.project_name, r.field_name, r.old_value, r.proposed_value]
            .map(v => String(v == null ? '' : v).toLowerCase()).join(' ');
          return hay.includes(needle);
        });
      }
      rows.sort((a, b) => {
        const ad = a.decided_at || '';
        const bd = b.decided_at || '';
        if (ad === bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return bd.localeCompare(ad);
      });
      return rows;
    }

    function driftRowHtml(r) {
      return [
        '<tr data-change-id="' + r.change_id + '" data-project-id="' + r.project_id + '" data-unit="' + esc(r.unit_number_norm) + '">',
          '<td class="rp-when">', esc(fmtWhen(r.decided_at)), '</td>',
          '<td class="rp-unit-cell">',
            '<a href="#" class="rp-unit-link" data-role="open-history">',
              '<span class="rp-unit">', esc(r.unit_number_norm), '</span>',
              '<span class="rp-project-sub">', esc(r.project_name), '</span>',
            '</a>',
          '</td>',
          '<td>', esc(fmtField(r.field_name)), '</td>',
          '<td class="rp-old">', esc(r.old_value), '</td>',
          '<td class="rp-proposed">', esc(r.proposed_value), '</td>',
          '<td><span class="rp-change-type rp-ct-', esc(r.change_type), '">', esc(fmtSource(r.change_type)), '</span></td>',
        '</tr>'
      ].join('');
    }

    async function loadAndRenderDrift() {
      contentEl.innerHTML = '<div class="rp-bp-list-loading">Loading…</div>';
      try {
        driftRowsCache = await api.list({ tab: 'drift' }) || [];
      } catch (e) {
        contentEl.innerHTML = '';
        setStatus('Failed to load drift: ' + (e && e.message ? e.message : String(e)), 'error');
        return;
      }

      setTabBadge('drift', driftRowsCache.length);
      if (activeTab !== 'drift') return;

      const rows = visibleDriftRows();
      if (rows.length === 0) {
        contentEl.innerHTML =
          '<div class="rp-empty"><strong>Drift log is empty</strong>' +
          'No drift entries match the current filters — every import matched the previous snapshot.' +
          '</div>';
        return;
      }
      const MAX = 200;
      const shown = rows.slice(0, MAX);
      const overflow = rows.length - shown.length;
      const html = [
        '<table class="rp-table"><thead><tr>',
          '<th>When</th><th>Unit</th><th>Field</th>',
          '<th>Old</th><th>New</th><th>Source</th>',
        '</tr></thead><tbody class="rp-drift-tbody">',
        shown.map(driftRowHtml).join(''),
        '</tbody></table>',
        overflow > 0
          ? '<div class="rp-footer">Showing ' + shown.length + ' of ' + rows.length + ' rows (' + overflow + ' more not shown).</div>'
          : ''
      ].join('');
      contentEl.innerHTML = html;
      wireDriftHandlers();
    }

    function wireDriftHandlers() {
      const tbody = contentEl.querySelector('.rp-drift-tbody');
      if (!tbody) return;
      tbody.addEventListener('click', (ev) => {
        const link = ev.target.closest('a[data-role="open-history"]');
        if (!link) return;
        ev.preventDefault();
        const tr = link.closest('tr');
        if (!tr) return;
        const projectId = Number(tr.getAttribute('data-project-id'));
        const unit      = tr.getAttribute('data-unit');
        const opener = window.__openUnitHistoryPanel;
        if (typeof opener === 'function') {
          try { opener(projectId, unit); }
          catch (e) { setStatus('Could not open unit history: ' + (e && e.message ? e.message : String(e)), 'error'); }
        } else {
          setStatus('Unit history panel not available.', 'error');
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Top-level reload
    // ─────────────────────────────────────────────────────────────────
    async function reloadActiveTab() {
      if (activeTab === 'needs_review') {
        await loadAndRenderBpCards();
        // Refresh drift badge count opportunistically (cheap query).
        try {
          const dr = await api.list({ tab: 'drift' });
          driftRowsCache = dr || [];
          setTabBadge('drift', driftRowsCache.length);
        } catch (_) { /* non-fatal */ }
      } else {
        await loadAndRenderDrift();
        // Refresh needs badge count opportunistically.
        try {
          const bps = await api.listBps({ tab: 'needs_review' });
          needsBpsCache = bps || [];
          const filtered = applyClientSideBpFilters(needsBpsCache);
          setTabBadge('needs-review', filtered.length);
        } catch (_) { /* non-fatal */ }
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // Wire up event handlers
    // ─────────────────────────────────────────────────────────────────

    tabsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-tab]');
      if (!btn) return;
      const next = btn.getAttribute('data-tab');
      if (next === activeTab) return;
      activeTab = next;
      // Re-render the tab strip so the .active class moves.
      renderTabs(
        Number((tabsEl.querySelector('.rp-badge-needs') || {}).textContent) || 0,
        Number((tabsEl.querySelector('.rp-badge-drift') || {}).textContent) || 0
      );
      if (activeTab === 'needs_review') loadAndRenderBpCards();
      else                              loadAndRenderDrift();
    });

    btnApply.addEventListener('click', () => {
      readFiltersFromInputs();
      reloadActiveTab();
    });

    btnReset.addEventListener('click', () => {
      filterState = Object.assign({}, filterDefaults);
      writeFiltersToInputs();
      reloadActiveTab();
    });

    // Allow Enter inside text inputs to apply.
    for (const inp of [fProcedure, fSearch]) {
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); btnApply.click(); }
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Boot
    // ─────────────────────────────────────────────────────────────────
    (async function init() {
      populateStaticFilters();
      await populateProjects();
      writeFiltersToInputs();
      renderTabs(0, 0);
      await reloadActiveTab();
    })();
  }

  window.__renderReviewPendingPage = renderReviewPendingPage;

})();
