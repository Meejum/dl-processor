// Renders the Review Pending page natively into a tab-host render-mode pane.
//
// Architecture (v2.0 Task 5 — converted from srcdoc-iframe):
//   - Caller: tabHost.open({ title, render: (container) => window.__renderReviewPendingPage(container) }).
//   - Scripts run in the main renderer context — uses window.dlp.review.* directly
//     (no window.parent.* indirection because we are no longer inside an iframe).
//   - All CSS lives in styles.css under the .review-pending-page scope.
//   - DOM lookups are scoped to `container` so multiple Review Pending tabs
//     (if ever opened) don't collide via global IDs.
//
// Behaviour parity with v1.1 srcdoc version:
//   - Two sub-tabs: "Needs review" (pending_change rows) and "Drift log" (auto_applied).
//   - Project filter dropdown built from row data.
//   - Per-row Approve / Reject / Override (typed edit overrides proposed value).
//   - "Teach alias" inline confirm flow for BUYER_MISMATCH rows.
//   - Drift log: read-only, sorted by decided_at desc, capped at 200 rows.
//   - Click a unit cell in drift log → window.__openUnitHistoryPanel side panel.

(function () {

  function renderReviewPendingPage(container, _opts) {
    container.classList.add('review-pending-page');

    // The page is a static skeleton; tabs/content get populated by render().
    container.innerHTML = [
      '<div class="rp-toolbar">',
        '<label for="rp-project">Project</label>',
        '<select class="rp-project-select"><option value="">All projects</option></select>',
        '<span class="rp-spacer"></span>',
        '<span class="rp-status"></span>',
      '</div>',
      '<div class="rp-tabs"></div>',
      '<div class="rp-content"></div>',
      '<div class="rp-footer">Approvals write directly to master_data, pending_change, and audit_log in a single transaction.</div>'
    ].join('');

    const api = (window.dlp && window.dlp.review) || null;
    const statusEl   = container.querySelector('.rp-status');
    const contentEl  = container.querySelector('.rp-content');
    const projectSel = container.querySelector('.rp-project-select');
    const tabsEl     = container.querySelector('.rp-tabs');

    if (!api) {
      statusEl.textContent = 'window.dlp.review is not available — preload may not have loaded.';
      statusEl.classList.add('is-error');
      return;
    }

    let activeTab = 'needs_review';
    let allRows = [];
    let projectFilter = '';

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

    function updateProjectFilterOptions() {
      const seen = new Map();
      for (const r of allRows) {
        if (!seen.has(r.project_id)) seen.set(r.project_id, r.project_name);
      }
      const current = projectSel.value;
      const opts = ['<option value="">All projects (' + allRows.length + ')</option>'];
      const sorted = Array.from(seen.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      for (const [id, name] of sorted) {
        const n = allRows.filter(r => r.project_id === id).length;
        opts.push('<option value="' + id + '">' + esc(name) + ' (' + n + ')</option>');
      }
      projectSel.innerHTML = opts.join('');
      if (current && seen.has(Number(current))) projectSel.value = current;
    }

    function visibleRows() {
      if (!projectFilter) return allRows;
      return allRows.filter(r => String(r.project_id) === String(projectFilter));
    }

    function renderTabs() {
      const counts = { needs_review: 0, drift: 0 };
      for (const r of allRows) {
        if (r.decision === 'pending') counts.needs_review++;
        else if (r.decision === 'auto_applied') counts.drift++;
      }
      tabsEl.innerHTML = [
        '<button class="rp-tab' + (activeTab === 'needs_review' ? ' active' : '') + '" data-tab="needs_review">',
          'Needs review <span class="rp-tab-badge rp-badge-needs">0</span>',
        '</button>',
        '<button class="rp-tab' + (activeTab === 'drift' ? ' active' : '') + '" data-tab="drift">',
          'Drift log <span class="rp-tab-badge">' + (counts.drift || 0) + '</span>',
        '</button>'
      ].join('');
    }

    function updateNeedsBadge() {
      const badge = tabsEl.querySelector('.rp-badge-needs');
      if (badge) badge.textContent = String(visibleRows().length);
    }

    function rowHtml(r) {
      const isBuyer = r.field_name === 'buyer_name';
      const teachBtn = isBuyer
        ? '<button class="rp-btn rp-btn-teach" data-action="teach" title="Teach this name pair">🔗 Teach alias</button>'
        : '';
      return [
        '<tr data-change-id="' + r.change_id + '" data-field="' + esc(r.field_name) + '">',
          '<td class="rp-project">', esc(r.project_name), '</td>',
          '<td class="rp-unit">', esc(r.unit_number_norm), '</td>',
          '<td>', esc(fmtField(r.field_name)), '</td>',
          '<td><span class="rp-change-type rp-ct-', esc(r.change_type), '">', esc(r.change_type), '</span></td>',
          '<td class="rp-old">', esc(r.old_value), '</td>',
          '<td class="rp-proposed">', esc(r.proposed_value), '</td>',
          '<td><input class="rp-edit" data-role="edit" value="', esc(r.proposed_value == null ? '' : r.proposed_value), '"></td>',
          '<td><div class="rp-actions">',
            '<button class="rp-btn rp-btn-approve" data-action="approve">Approve</button>',
            '<button class="rp-btn rp-btn-reject"  data-action="reject">Reject</button>',
            teachBtn,
          '</div></td>',
        '</tr>'
      ].join('');
    }

    function renderNeedsReview() {
      // Note: v1.1 used visibleRows() unfiltered here (badge count includes
      // all rows including drift). Preserved for byte-for-byte parity.
      const rows = visibleRows();
      if (rows.length === 0) {
        contentEl.innerHTML =
          '<div class="rp-empty"><strong>Nothing to review</strong>' +
          'No pending changes in the current scope. Run [3] Compare to generate fresh proposals.' +
          '</div>';
        return;
      }
      const html = [
        '<table class="rp-table"><thead><tr>',
          '<th>Project</th><th>Unit</th><th>Field</th><th>Type</th>',
          '<th>Current</th><th>Proposed (DLD)</th><th>New (edit)</th><th>Actions</th>',
        '</tr></thead><tbody class="rp-tbody">',
        rows.map(rowHtml).join(''),
        '</tbody></table>'
      ].join('');
      contentEl.innerHTML = html;
      wireRowHandlers();
    }

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

    function driftRows() {
      const rows = visibleRows().filter(r => r.decision === 'auto_applied');
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

    function renderDrift() {
      const rows = driftRows();
      if (rows.length === 0) {
        contentEl.innerHTML =
          '<div class="rp-empty"><strong>Drift log is empty</strong>' +
          'No drift entries — every import matched the previous snapshot.' +
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

    function render() {
      updateProjectFilterOptions();
      renderTabs();
      if (activeTab === 'needs_review') renderNeedsReview();
      else                              renderDrift();
      updateNeedsBadge();
    }

    function wireRowHandlers() {
      const tbody = contentEl.querySelector('.rp-tbody');
      if (!tbody) return;
      tbody.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr || tr.classList.contains('is-resolved')) return;
        const changeId = Number(tr.getAttribute('data-change-id'));
        const action = btn.getAttribute('data-action');
        if (action === 'approve') return doApprove(tr, changeId);
        if (action === 'reject')  return doReject(tr, changeId);
        if (action === 'teach')   return doTeachStart(tr, changeId);
        if (action === 'teach-project' || action === 'teach-global' || action === 'teach-cancel') {
          return doTeachFinish(tr, changeId, action);
        }
      });
    }

    function setRowDisabled(tr, disabled) {
      for (const b of tr.querySelectorAll('button')) b.disabled = disabled;
      for (const i of tr.querySelectorAll('input'))  i.disabled = disabled;
    }

    function removeRow(tr, changeId) {
      tr.classList.add('is-resolved');
      allRows = allRows.filter(r => r.change_id !== changeId);
      setTimeout(() => {
        if (tr.parentNode) tr.parentNode.removeChild(tr);
        if (visibleRows().length === 0 && activeTab === 'needs_review') renderNeedsReview();
        updateProjectFilterOptions();
        updateNeedsBadge();
        renderTabs();
      }, 120);
    }

    async function doApprove(tr, changeId) {
      const editEl = tr.querySelector('input[data-role="edit"]');
      const row = allRows.find(r => r.change_id === changeId);
      if (!row) return;
      const typed = editEl ? editEl.value : '';
      const override = (typed !== '' && typed !== String(row.proposed_value == null ? '' : row.proposed_value))
        ? typed
        : null;
      setRowDisabled(tr, true);
      setStatus('Approving change #' + changeId + '…');
      try {
        await api.approve({ changeId, override });
        setStatus('Approved #' + changeId + (override == null ? '' : ' (override)'), 'ok');
        removeRow(tr, changeId);
      } catch (e) {
        setStatus('Approve failed: ' + (e && e.message ? e.message : String(e)), 'error');
        setRowDisabled(tr, false);
      }
    }

    async function doReject(tr, changeId) {
      setRowDisabled(tr, true);
      setStatus('Rejecting change #' + changeId + '…');
      try {
        await api.reject({ changeId });
        setStatus('Rejected #' + changeId, 'ok');
        removeRow(tr, changeId);
      } catch (e) {
        setStatus('Reject failed: ' + (e && e.message ? e.message : String(e)), 'error');
        setRowDisabled(tr, false);
      }
    }

    function doTeachStart(tr, changeId) {
      const row = allRows.find(r => r.change_id === changeId);
      if (!row) return;
      if (tr.nextSibling && tr.nextSibling.classList && tr.nextSibling.classList.contains('rp-teach-confirm')) return;
      const cr = document.createElement('tr');
      cr.className = 'rp-teach-confirm';
      cr.setAttribute('data-change-id', String(changeId));
      cr.innerHTML =
        '<td colspan="8">' +
          '<div class="rp-confirm-msg">' +
            'Always treat <b>' + esc(row.proposed_value) + '</b> as <b>' + esc(row.old_value) + '</b>?' +
          '</div>' +
          '<div class="rp-confirm-actions">' +
            '<button class="rp-btn rp-btn-teach" data-action="teach-project">Project only</button>' +
            '<button class="rp-btn rp-btn-teach" data-action="teach-global">All projects</button>' +
            '<button class="rp-btn rp-btn-reject" data-action="teach-cancel">Cancel</button>' +
          '</div>' +
        '</td>';
      tr.parentNode.insertBefore(cr, tr.nextSibling);
    }

    async function doTeachFinish(confirmRow, changeId, action) {
      let src = confirmRow.previousSibling;
      while (src && (!src.getAttribute || src.getAttribute('data-change-id') !== String(changeId))) {
        src = src.previousSibling;
      }
      if (action === 'teach-cancel') {
        confirmRow.parentNode.removeChild(confirmRow);
        return;
      }
      const scope = action === 'teach-global' ? 'global' : 'project';
      if (src) setRowDisabled(src, true);
      setStatus('Teaching alias…');
      try {
        await api.teachAlias({ changeId, scope });
        setStatus('Alias taught (' + scope + ') — sibling rows auto-approved', 'ok');
        confirmRow.parentNode.removeChild(confirmRow);
        await loadList();
      } catch (e) {
        setStatus('Teach alias failed: ' + (e && e.message ? e.message : String(e)), 'error');
        if (src) setRowDisabled(src, false);
        confirmRow.parentNode.removeChild(confirmRow);
      }
    }

    async function loadList() {
      setStatus('Loading…');
      try {
        const [needs, drift] = await Promise.all([
          api.list({ tab: 'needs_review' }),
          api.list({ tab: 'drift' })
        ]);
        allRows = [].concat(needs || []).concat(drift || []);
        setStatus('');
        render();
      } catch (e) {
        setStatus('Failed to load: ' + (e && e.message ? e.message : String(e)), 'error');
      }
    }

    tabsEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-tab]');
      if (!btn) return;
      activeTab = btn.getAttribute('data-tab');
      render();
    });

    projectSel.addEventListener('change', () => {
      projectFilter = projectSel.value;
      if (activeTab === 'needs_review') renderNeedsReview();
      else                              renderDrift();
      updateNeedsBadge();
    });

    // Initial fetch.
    loadList();
  }

  window.__renderReviewPendingPage = renderReviewPendingPage;

})();
