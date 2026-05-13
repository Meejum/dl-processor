// Renders the global History page natively into a tab-host render-mode pane.
//
// Architecture (v2.0 Task 6 — converted from srcdoc-iframe):
//   - Caller: tabHost.open({ title, render: (container) => window.__renderHistoryPage(container, initialFilters) }).
//   - Scripts run in the main renderer context — uses window.dlp.audit.* /
//     window.dlp.projects.* directly (no window.parent.* indirection because
//     we are no longer inside an iframe).
//   - All CSS lives in styles.css under the .history-page scope.
//   - DOM lookups are scoped to `container` so multiple History tabs don't
//     collide via global IDs.
//
// Behaviour parity with v1.1 srcdoc version:
//   - Filter bar: Range / Project / Action / Source / Unit / Apply / Export CSV.
//   - Paginated table (100 rows/page) with Prev / Next.
//   - Click a unit cell → window.__openUnitHistoryPanel(projectId, unitNumberNorm).
//   - initialFilters honoured on first render (used by per-unit panel's
//     "View in global History →" deep link via the dlp:open-history event).
//   - Export CSV uses window.dlp.audit.exportCsv(opts) (full filtered set,
//     not just the current page).

(function () {

  // Mirror of src/audit-fields.js REVERTABLE_ACTIONS — duplicated here because
  // renderer can't require() from src/. The backend re-validates this set in
  // revertAuditEntry, so this is purely an advisory affordance: rows whose
  // action is NOT in this set get no Revert button. Likewise, only audit rows
  // for table_name === 'master_data' are revertable (e.g. learn_alias rows
  // target buyer_alias and are skipped). If REVERTABLE_ACTIONS changes in
  // src/audit-fields.js, update here too.
  const REVERTABLE = new Set(['approve', 'override', 'approve_bp', 'revert']);

  function renderHistoryPage(container, initialFilters) {
    container.classList.add('history-page');

    // Sanitize the initial filters down to known fields.
    const safe = {};
    if (initialFilters) {
      if (initialFilters.projectId)      safe.projectId      = initialFilters.projectId;
      if (initialFilters.unitNumberNorm) safe.unitNumberNorm = initialFilters.unitNumberNorm;
      if (initialFilters.action)         safe.action         = initialFilters.action;
      if (initialFilters.source)         safe.source         = initialFilters.source;
      if (initialFilters.range)          safe.range          = initialFilters.range;
    }
    const initial = safe;

    container.innerHTML = [
      '<div class="hp-filters">',
        '<label>Range ',
          '<select class="hp-range">',
            '<option value="7">Last 7 days</option>',
            '<option value="30" selected>Last 30 days</option>',
            '<option value="90">Last 90 days</option>',
            '<option value="all">All time</option>',
          '</select>',
        '</label>',
        '<label>Project ',
          '<select class="hp-project"><option value="">All</option></select>',
        '</label>',
        '<label>Action ',
          '<select class="hp-action">',
            '<option value="">All</option>',
            '<option value="approve">approve</option>',
            '<option value="override">override</option>',
            '<option value="reject">reject</option>',
            '<option value="auto_apply">auto_apply</option>',
            '<option value="learn_alias">learn_alias</option>',
          '</select>',
        '</label>',
        '<label>Source ',
          '<select class="hp-source">',
            '<option value="">All</option>',
            '<option value="review_pending">review_pending</option>',
            '<option value="import_dld">import_dld</option>',
            '<option value="import_sf">import_sf</option>',
          '</select>',
        '</label>',
        '<label>Unit ',
          '<input class="hp-unit" type="text" placeholder="e.g. 101">',
        '</label>',
        '<button class="hp-btn hp-btn-primary hp-apply">Apply</button>',
        '<button class="hp-btn hp-export">Export CSV</button>',
      '</div>',
      '<div class="hp-status"></div>',
      '<table class="hp-table">',
        '<thead><tr>',
          '<th>When</th><th>Project</th><th>Unit</th><th>Field</th>',
          '<th>Old → New</th><th>Action · Source</th><th></th>',
        '</tr></thead>',
        '<tbody class="hp-tbody"></tbody>',
      '</table>',
      '<div class="hp-pager"></div>',
      '<div class="hp-footer">Audit log reads from audit_log JOIN dld_project. Export CSV writes the full filtered set, not just the current page.</div>'
    ].join('');

    const api = (window.dlp && window.dlp.audit) || null;
    const statusEl  = container.querySelector('.hp-status');
    const tbodyEl   = container.querySelector('.hp-tbody');
    const pagerEl   = container.querySelector('.hp-pager');
    const tableEl   = container.querySelector('.hp-table');
    const rangeSel  = container.querySelector('.hp-range');
    const projectSel = container.querySelector('.hp-project');
    const actionSel = container.querySelector('.hp-action');
    const sourceSel = container.querySelector('.hp-source');
    const unitInput = container.querySelector('.hp-unit');
    const applyBtn  = container.querySelector('.hp-apply');
    const exportBtn = container.querySelector('.hp-export');

    if (!api) {
      statusEl.textContent = 'window.dlp.audit is not available — preload may not have loaded.';
      statusEl.classList.add('is-error');
      return;
    }

    const PAGE_SIZE = 100;
    let offset = 0;
    let rows = [];
    let lastFilters = {};

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

    function fmtWhen(s) {
      if (!s) return '';
      const d = new Date(String(s).replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return String(s);
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
             ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function fmtField(f) {
      return ({
        buyer_name: 'buyer',
        purchase_price_aed: 'price',
        procedure_number: 'procedure',
        area_sqm: 'area',
        status: 'status'
      })[f] || f || '';
    }

    function rangeToFromTs(value) {
      if (value === 'all') return null;
      const days = parseInt(value, 10);
      if (!isFinite(days) || days <= 0) return null;
      const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      // SQLite "YYYY-MM-DD HH:MM:SS" UTC to match audit_log.ts default.
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
             ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    }

    function currentFilters() {
      const f = {};
      const fromTs = rangeToFromTs(rangeSel.value);
      if (fromTs) f.fromTs = fromTs;
      if (projectSel.value) f.projectId = Number(projectSel.value);
      if (actionSel.value)  f.action    = actionSel.value;
      if (sourceSel.value)  f.source    = sourceSel.value;
      const unit = (unitInput.value || '').trim();
      if (unit) f.unitNumberNorm = unit;
      return f;
    }

    async function populateProjectSelect() {
      // Reuse the existing projects list IPC.
      const pApi = window.dlp && window.dlp.projects;
      if (!pApi || !pApi.list) return;
      let list = [];
      try { list = await pApi.list(); } catch { list = []; }
      const sorted = list.slice().sort((a, b) =>
        String(a.project_name || '').localeCompare(String(b.project_name || ''))
      );
      const opts = ['<option value="">All</option>'];
      for (const p of sorted) {
        opts.push('<option value="' + p.project_id + '">' + esc(p.project_name) + '</option>');
      }
      projectSel.innerHTML = opts.join('');
    }

    function applyInitial() {
      if (initial && initial.projectId) {
        // Set option value; if the option doesn't exist yet (projects list
        // hasn't loaded) it'll silently no-op. We retry after the list
        // populates.
        projectSel.value = String(initial.projectId);
      }
      if (initial && initial.unitNumberNorm) {
        unitInput.value = String(initial.unitNumberNorm);
      }
      if (initial && initial.action)   actionSel.value = initial.action;
      if (initial && initial.source)   sourceSel.value = initial.source;
      if (initial && initial.range)    rangeSel.value  = initial.range;
      // Deep-link from per-unit panel always wants full history.
      if (initial && initial.unitNumberNorm) rangeSel.value = 'all';
    }

    function rowHtml(r) {
      const old = r.old_value == null ? '' : String(r.old_value);
      const nv  = r.new_value == null ? '' : String(r.new_value);
      const diffHtml = (old || nv)
        ? '<span class="hp-old">' + esc(old) + '</span>' +
          '<span class="hp-arrow">→</span>' +
          '<span class="hp-new">' + esc(nv) + '</span>'
        : '';
      const actionCls = 'hp-action-' + (r.action || '').replace(/[^a-z_]/gi, '');
      const isRevertable = REVERTABLE.has(r.action) && r.table_name === 'master_data' && r.audit_id;
      const revertCell = isRevertable
        ? '<button type="button" class="hp-revert-btn" data-role="revert"' +
          ' data-audit-id="' + esc(r.audit_id) + '"' +
          ' title="Revert this change">↶ Revert</button>'
        : '';
      return [
        '<tr data-project-id="' + (r.project_id || '') + '" data-unit="' + esc(r.unit_number_norm) + '">',
          '<td class="hp-when">', esc(fmtWhen(r.ts)), '</td>',
          '<td class="hp-project">', esc(r.project_name || ''), '</td>',
          '<td class="hp-unit">',
            '<a href="#" class="hp-unit-link" data-role="open-unit">',
              esc(r.unit_number_norm || ''),
            '</a>',
          '</td>',
          '<td>', esc(fmtField(r.field)), '</td>',
          '<td class="hp-diff">', diffHtml, '</td>',
          '<td>',
            '<span class="hp-action-chip ', actionCls, '">', esc(r.action || ''), '</span>',
            r.source ? '<span class="hp-src-sub">' + esc(r.source) + '</span>' : '',
          '</td>',
          '<td class="hp-revert-cell">', revertCell, '</td>',
        '</tr>'
      ].join('');
    }

    // Indexed by audit_id, populated each render() so the click handler can
    // build the confirm dialog text without re-fetching.
    const rowById = new Map();

    async function handleRevert(auditId) {
      const r = rowById.get(String(auditId));
      if (!r) {
        window.alert('Revert failed: row data not found for audit_id ' + auditId);
        return;
      }
      const oldVal = r.old_value == null || r.old_value === '' ? '(empty)' : String(r.old_value);
      const newVal = r.new_value == null || r.new_value === '' ? '(empty)' : String(r.new_value);
      const msg = [
        'Revert this change?',
        '',
        'Unit:    ' + (r.unit_number_norm || '') + ' · ' + (r.project_name || ''),
        'Field:   ' + (r.field || ''),
        'Restore: ' + newVal + '  →  ' + oldVal,
        '',
        'This will be recorded in the audit log as action=revert.'
      ].join('\n');
      if (!window.confirm(msg)) return;

      setStatus('Reverting…');
      try {
        await api.revert({ auditId: Number(auditId) });
        setStatus('Reverted.', 'ok');
        // Reload the page to reflect the new audit_log entry + updated master_data.
        load(lastFilters);
      } catch (e) {
        const errMsg = (e && e.message) ? e.message : String(e);
        setStatus('Revert failed: ' + errMsg, 'error');
        window.alert('Revert failed: ' + errMsg);
      }
    }

    function render() {
      if (rows.length === 0) {
        tbodyEl.innerHTML = '';
        pagerEl.innerHTML = '';
        if (tableEl) tableEl.hidden = true;
        let emptyEl = container.querySelector('.hp-empty');
        if (!emptyEl) {
          emptyEl = document.createElement('div');
          emptyEl.className = 'hp-empty';
          tableEl.parentNode.insertBefore(emptyEl, tableEl.nextSibling);
        }
        emptyEl.innerHTML = '<strong>No audit entries match</strong>Try widening the date range or clearing filters.';
        emptyEl.hidden = false;
        return;
      }
      const emptyEl = container.querySelector('.hp-empty');
      if (emptyEl) emptyEl.hidden = true;
      if (tableEl) tableEl.hidden = false;
      tbodyEl.innerHTML = rows.map(rowHtml).join('');

      const from = offset + 1;
      // We over-fetch one row to know if there's a next page.
      const hasMore = rows.length > PAGE_SIZE;
      if (hasMore) {
        rows = rows.slice(0, PAGE_SIZE);
        tbodyEl.innerHTML = rows.map(rowHtml).join('');
      }
      // Index rows by audit_id so the Revert click handler can find them.
      rowById.clear();
      for (const r of rows) {
        if (r && r.audit_id != null) rowById.set(String(r.audit_id), r);
      }
      const actualTo = offset + rows.length;
      pagerEl.innerHTML =
        '<span class="hp-pager-info">Showing ' + from + '–' + actualTo + '</span>' +
        '<span class="hp-pager-btns">' +
          '<button class="hp-btn hp-prev"' + (offset === 0 ? ' disabled' : '') + '>← Prev</button>' +
          '<button class="hp-btn hp-next"' + (hasMore ? '' : ' disabled') + '>Next →</button>' +
        '</span>';
      const prev = pagerEl.querySelector('.hp-prev');
      const next = pagerEl.querySelector('.hp-next');
      if (prev) prev.addEventListener('click', () => {
        if (offset === 0) return;
        offset = Math.max(0, offset - PAGE_SIZE);
        load(lastFilters);
      });
      if (next) next.addEventListener('click', () => {
        offset += PAGE_SIZE;
        load(lastFilters);
      });
    }

    async function load(filters) {
      lastFilters = filters || {};
      setStatus('Loading…');
      try {
        // Over-fetch by 1 to detect "has more" cheaply.
        const fetched = await api.global(Object.assign({}, lastFilters, {
          limit: PAGE_SIZE + 1,
          offset: offset
        }));
        rows = Array.isArray(fetched) ? fetched : [];
        setStatus('');
        render();
      } catch (e) {
        setStatus('Load failed: ' + (e && e.message ? e.message : String(e)), 'error');
      }
    }

    function wireRowClicks() {
      tbodyEl.addEventListener('click', (ev) => {
        const revertBtn = ev.target.closest('button[data-role="revert"]');
        if (revertBtn) {
          ev.preventDefault();
          const auditId = revertBtn.getAttribute('data-audit-id');
          if (auditId) handleRevert(auditId);
          return;
        }
        const link = ev.target.closest('a[data-role="open-unit"]');
        if (!link) return;
        ev.preventDefault();
        const tr = link.closest('tr');
        if (!tr) return;
        const projectId = Number(tr.getAttribute('data-project-id'));
        const unit      = tr.getAttribute('data-unit');
        if (!projectId || !unit) return;
        const opener = window.__openUnitHistoryPanel;
        if (typeof opener === 'function') {
          try { opener(projectId, unit); }
          catch (e) { setStatus('Could not open unit history: ' + (e && e.message ? e.message : String(e)), 'error'); }
        }
      });
    }

    applyBtn.addEventListener('click', () => {
      offset = 0;
      load(currentFilters());
    });

    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      setStatus('Exporting…');
      try {
        const filePath = await api.exportCsv(currentFilters());
        if (filePath) setStatus('Saved to ' + filePath, 'ok');
        else          setStatus('Export cancelled.');
      } catch (e) {
        setStatus('Export failed: ' + (e && e.message ? e.message : String(e)), 'error');
      } finally {
        exportBtn.disabled = false;
      }
    });

    unitInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { offset = 0; load(currentFilters()); }
    });

    wireRowClicks();

    // Boot: populate the project select, apply any initial filters, then fetch.
    (async () => {
      await populateProjectSelect();
      applyInitial();
      offset = 0;
      load(currentFilters());
    })();
  }

  window.__renderHistoryPage = renderHistoryPage;

})();
