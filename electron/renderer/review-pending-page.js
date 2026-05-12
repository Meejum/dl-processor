// Builds the Review Pending page as a self-contained srcdoc HTML document.
// Returned as { html } — caller passes to tabHost.open({ srcdoc: html, ... }).
//
// Architecture:
//   - The iframe loads the srcdoc with its own context. Inline <script>
//     reaches into window.parent.dlp.review.* to call the IPC bridge
//     (preload's contextBridge survives the parent/child boundary because
//     both iframes share the same origin under webSecurity: false).
//   - No external CSS/JS files — everything is inline, mirroring the
//     buildStatusPage / buildApplyPendingPage pattern in app.js.
//   - Task 10 ships the "Needs review" tab fully functional. The "Drift log"
//     tab is rendered as a placeholder; Task 11 will fill it in.

(function() {

  const PAGE_CSS = `
    :root {
      --bg:#F6F1E9; --surface:#FFFFFF; --surface-2:#FBF5EA; --border:#E3D9C8;
      --border-2:#C8B896; --ink:#1F1A14; --ink-2:#5A4A37; --muted:#8A7E69;
      --accent:#85633B; --accent-dark:#5C3D1E; --accent-soft:#F0E4CE;
      --ok:#3F6A2A; --ok-soft:#E8F0DC; --ok-border:#B9CFA0;
      --warn:#8A5A08; --warn-soft:#FBEFD2; --warn-border:#E5C885;
      --danger:#8A2415; --danger-soft:#FBEAE5; --danger-border:#E7B5A8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 18px 24px;
      font: 13px/1.5 'Segoe UI', Tahoma, Arial, sans-serif;
      background: var(--bg); color: var(--ink);
    }
    .page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .page-logo {
      width: 36px; height: 36px; border-radius: 8px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--accent-soft); font-weight: 700; font-size: 18px;
    }
    .page-title { font-size: 20px; font-weight: 700; color: var(--accent-dark); line-height: 1.1; }
    .page-sub { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }

    .rp-toolbar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      padding: 8px 12px;
    }
    .rp-toolbar label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .rp-toolbar select {
      padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--surface); font: inherit; color: var(--ink); min-width: 220px;
    }
    .rp-count-chip {
      background: var(--accent-soft); color: var(--accent-dark);
      border: 1px solid var(--border-2); padding: 2px 10px; border-radius: 12px;
      font-size: 11px; font-weight: 600;
    }
    .rp-spacer { flex: 1; }
    .rp-status { color: var(--muted); font-size: 11px; min-height: 14px; }
    .rp-status.is-ok    { color: var(--ok); }
    .rp-status.is-error { color: var(--danger); }

    .rp-tabs {
      display: flex; gap: 0; margin-bottom: 0; border-bottom: 1px solid var(--border);
    }
    .rp-tab {
      background: transparent; border: 0; border-bottom: 3px solid transparent;
      padding: 10px 18px; color: var(--ink-2); font: inherit; cursor: pointer;
      font-weight: 600; font-size: 13px;
    }
    .rp-tab:hover { color: var(--accent-dark); }
    .rp-tab.active {
      color: var(--accent-dark); border-bottom-color: var(--accent-dark);
      background: var(--surface);
    }
    .rp-tab .rp-tab-badge {
      display: inline-block; margin-left: 8px;
      background: var(--accent-soft); color: var(--accent-dark);
      border: 1px solid var(--border-2); padding: 0 7px; border-radius: 10px;
      font-size: 10px; font-weight: 700; min-width: 18px; text-align: center;
    }

    .rp-content {
      background: var(--surface); border: 1px solid var(--border); border-top: 0;
      border-radius: 0 0 8px 8px; padding: 14px;
    }

    .rp-empty {
      padding: 36px 24px; text-align: center; color: var(--muted);
      border: 1px dashed var(--border-2); border-radius: 8px; background: var(--surface-2);
    }
    .rp-empty strong { color: var(--accent-dark); display: block; margin-bottom: 4px; font-size: 14px; }

    table.rp-table {
      width: 100%; border-collapse: collapse; background: var(--surface);
      border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    }
    .rp-table th {
      background: var(--surface-2); color: var(--accent-dark);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border);
      position: sticky; top: 0;
    }
    .rp-table td {
      padding: 8px 10px; border-bottom: 1px solid var(--border);
      font-size: 12px; vertical-align: middle;
    }
    .rp-table tr:nth-child(even) td { background: var(--surface-2); }
    .rp-table tr.is-resolved { opacity: 0.45; }
    .rp-table td.rp-old, .rp-table td.rp-proposed { font-family: 'Consolas','Cascadia Mono',monospace; font-size: 11px; word-break: break-all; }
    .rp-table td.rp-unit  { font-weight: 600; }
    .rp-table td.rp-project { color: var(--ink-2); }

    .rp-edit { width: 160px; padding: 4px 6px; border: 1px solid var(--border-2); border-radius: 4px; font: inherit; font-family: 'Consolas','Cascadia Mono',monospace; font-size: 11px; background: var(--surface); }
    .rp-edit:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

    .rp-actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .rp-btn {
      border: 1px solid transparent; border-radius: 4px; padding: 4px 10px;
      cursor: pointer; font: inherit; font-size: 11px; font-weight: 600;
    }
    .rp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .rp-btn-approve { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-border); }
    .rp-btn-approve:hover:not(:disabled) { background: #DCE9C8; }
    .rp-btn-reject  { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-border); }
    .rp-btn-reject:hover:not(:disabled)  { background: #F5D9D0; }
    .rp-btn-teach   { background: var(--accent-soft); color: var(--accent-dark); border-color: var(--border-2); }
    .rp-btn-teach:hover:not(:disabled)   { background: #E6D6B5; }

    .rp-change-type {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 8px; text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .rp-ct-MISMATCH  { background: var(--warn-soft); color: var(--warn); border: 1px solid var(--warn-border); }
    .rp-ct-DLD_DRIFT { background: var(--accent-soft); color: var(--accent-dark); border: 1px solid var(--border-2); }
    .rp-ct-SF_DRIFT  { background: #E5E1F3; color: #3C2E80; border: 1px solid #BDB3DD; }

    /* Inline teach-alias confirm row */
    tr.rp-teach-confirm td {
      background: #FFF7E0 !important; border-top: 1px dashed var(--warn-border);
    }
    .rp-confirm-msg { font-size: 12px; color: var(--accent-dark); }
    .rp-confirm-msg b { color: var(--accent-dark); }
    .rp-confirm-actions { display: flex; gap: 6px; margin-top: 4px; }

    .footer { color: var(--muted); font-size: 11px; margin-top: 14px; text-align: right; }
  `;

  // Note: the inline script string is also self-contained — runs inside the
  // iframe. It looks up window.parent.dlp.review.* via the contextBridge.
  const PAGE_SCRIPT = `
    (function() {
      const api = (window.parent && window.parent.dlp && window.parent.dlp.review) || null;
      if (!api) {
        document.getElementById('rp-status').textContent = 'window.parent.dlp.review is not available — preload may not have loaded.';
        document.getElementById('rp-status').classList.add('is-error');
        return;
      }

      let activeTab = 'needs_review';
      let allRows = [];
      let projectFilter = '';

      const statusEl    = document.getElementById('rp-status');
      const contentEl   = document.getElementById('rp-content');
      const projectSel  = document.getElementById('rp-project');
      const tabsEl      = document.getElementById('rp-tabs');

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
        // Build unique project list from all currently-loaded rows.
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
            'Needs review <span class="rp-tab-badge" id="rp-badge-needs">0</span>',
          '</button>',
          '<button class="rp-tab' + (activeTab === 'drift' ? ' active' : '') + '" data-tab="drift">',
            'Drift log <span class="rp-tab-badge">' + (counts.drift || 0) + '</span>',
          '</button>'
        ].join('');
      }

      function updateNeedsBadge() {
        const badge = document.getElementById('rp-badge-needs');
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
          '</tr></thead><tbody id="rp-tbody">',
          rows.map(rowHtml).join(''),
          '</tbody></table>'
        ].join('');
        contentEl.innerHTML = html;
        wireRowHandlers();
      }

      function renderDrift() {
        contentEl.innerHTML =
          '<div class="rp-empty"><strong>Drift log — coming in Task 11</strong>' +
          'Auto-applied DLD-drift rows will be reviewable here. For now, run a SQL query against pending_change WHERE decision = \\'auto_applied\\' if you need to inspect them.' +
          '</div>';
      }

      function render() {
        updateProjectFilterOptions();
        renderTabs();
        if (activeTab === 'needs_review') renderNeedsReview();
        else                              renderDrift();
        updateNeedsBadge();
      }

      function wireRowHandlers() {
        const tbody = document.getElementById('rp-tbody');
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
        for (const i of tr.querySelectorAll('input')) i.disabled = disabled;
      }

      function removeRow(tr, changeId) {
        tr.classList.add('is-resolved');
        // Drop from allRows so badge counts decrement correctly.
        allRows = allRows.filter(r => r.change_id !== changeId);
        // Fade then remove on next tick for a tiny bit of feedback.
        setTimeout(() => {
          if (tr.parentNode) tr.parentNode.removeChild(tr);
          // If the table is now empty in current view, re-render the empty state.
          if (visibleRows().length === 0 && activeTab === 'needs_review') renderNeedsReview();
          updateProjectFilterOptions();
          updateNeedsBadge();
          // Refresh the drift badge too.
          renderTabs();
        }, 120);
      }

      async function doApprove(tr, changeId) {
        const editEl = tr.querySelector('input[data-role="edit"]');
        const row = allRows.find(r => r.change_id === changeId);
        if (!row) return;
        const typed = editEl ? editEl.value : '';
        // Override only if the user actually changed the proposed value.
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
        // Inject an inline confirm row right after the source row.
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
        // confirmRow is the inline confirm row, not the source. Find the source.
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
          // Reload list from scratch so siblings vanish too.
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
          // Fetch both tabs in parallel so the badges stay accurate.
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
        updateNeedsBadge();
      });

      // Initial fetch.
      loadList();
    })();
  `;

  function buildReviewPendingPage() {
    const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src data:;">';
    const html = [
      '<!doctype html><html><head>',
      '<meta charset="utf-8">',
      cspMeta,
      '<title>Review Pending</title>',
      '<style>', PAGE_CSS, '</style>',
      '</head><body>',
      '<div class="page-head">',
        '<span class="page-logo">S</span>',
        '<div>',
          '<div class="page-title">Review pending</div>',
          '<div class="page-sub">DL-Processor · Sobha Realty · Registration</div>',
        '</div>',
      '</div>',
      '<div class="rp-toolbar">',
        '<label for="rp-project">Project</label>',
        '<select id="rp-project"><option value="">All projects</option></select>',
        '<span class="rp-spacer"></span>',
        '<span class="rp-status" id="rp-status"></span>',
      '</div>',
      '<div class="rp-tabs" id="rp-tabs"></div>',
      '<div class="rp-content" id="rp-content"></div>',
      '<div class="footer">Approvals write directly to master_data, pending_change, and audit_log in a single transaction.</div>',
      '<script>', PAGE_SCRIPT, '<\/script>',
      '</body></html>'
    ].join('');
    return { html };
  }

  window.__buildReviewPendingPage = buildReviewPendingPage;

})();
