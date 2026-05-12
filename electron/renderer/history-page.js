// Builds the global History page as a self-contained srcdoc HTML document.
// Returned as { html } — caller passes to tabHost.open({ srcdoc: html, ... }).
//
// Architecture mirrors review-pending-page.js:
//   - Inline <style> + inline <script> served via srcdoc with a self CSP.
//   - The inline script reaches up to window.parent.dlp.audit.* via the
//     contextBridge, and to window.parent.__openUnitHistoryPanel(...) for
//     deep-linking into the per-unit side panel.
//   - initialFilters comes from app.js when the page is opened via the
//     dlp:open-history event (the per-unit panel's "View in global
//     History →" link).

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

    .hp-filters {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px 12px; margin-bottom: 10px;
    }
    .hp-filters label {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    }
    .hp-filters select, .hp-filters input {
      padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--surface); font: inherit; color: var(--ink);
    }
    .hp-filters select { min-width: 130px; }
    .hp-filters input { min-width: 110px; }
    .hp-btn {
      border: 1px solid var(--border-2); border-radius: 6px;
      padding: 5px 12px; cursor: pointer; font: inherit; font-size: 12px;
      font-weight: 600; background: var(--accent-soft); color: var(--accent-dark);
    }
    .hp-btn:hover:not(:disabled) { background: #E6D6B5; }
    .hp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .hp-btn-primary { background: var(--accent); color: #FFF; border-color: var(--accent-dark); }
    .hp-btn-primary:hover:not(:disabled) { background: var(--accent-dark); }

    .hp-status {
      color: var(--muted); font-size: 11px; min-height: 14px; margin-bottom: 6px;
    }
    .hp-status.is-ok    { color: var(--ok); }
    .hp-status.is-error { color: var(--danger); }

    table.hp-table {
      width: 100%; border-collapse: collapse; background: var(--surface);
      border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
    }
    .hp-table th {
      background: var(--surface-2); color: var(--accent-dark);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border);
      position: sticky; top: 0;
    }
    .hp-table td {
      padding: 8px 10px; border-bottom: 1px solid var(--border);
      font-size: 12px; vertical-align: middle;
    }
    .hp-table tr:nth-child(even) td { background: var(--surface-2); }
    .hp-table td.hp-when    { font-family: 'Consolas','Cascadia Mono',monospace; font-size: 11px; color: var(--ink-2); white-space: nowrap; }
    .hp-table td.hp-project { color: var(--ink-2); }
    .hp-table td.hp-unit    { font-weight: 600; }
    .hp-table td.hp-diff    { font-family: 'Consolas','Cascadia Mono',monospace; font-size: 11px; word-break: break-all; }
    .hp-old  { color: var(--danger); text-decoration: line-through; }
    .hp-new  { color: var(--ok); }
    .hp-arrow { color: var(--muted); margin: 0 4px; }
    .hp-unit-link { color: inherit; text-decoration: none; cursor: pointer; }
    .hp-unit-link:hover { color: var(--accent-dark); text-decoration: underline; }

    .hp-action-chip {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 8px; text-transform: uppercase;
      letter-spacing: 0.04em;
      background: var(--accent-soft); color: var(--accent-dark); border: 1px solid var(--border-2);
    }
    .hp-action-approve     { background: var(--ok-soft);     color: var(--ok);     border-color: var(--ok-border); }
    .hp-action-override    { background: var(--warn-soft);   color: var(--warn);   border-color: var(--warn-border); }
    .hp-action-reject      { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-border); }
    .hp-action-auto_apply  { background: var(--accent-soft); color: var(--accent-dark); border-color: var(--border-2); }
    .hp-action-learn_alias { background: #E5E1F3; color: #3C2E80; border-color: #BDB3DD; }
    .hp-src-sub { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; font-weight: 400; letter-spacing: 0; text-transform: none; }

    .hp-empty {
      padding: 36px 24px; text-align: center; color: var(--muted);
      border: 1px dashed var(--border-2); border-radius: 8px; background: var(--surface-2);
    }
    .hp-empty strong { color: var(--accent-dark); display: block; margin-bottom: 4px; font-size: 14px; }

    .hp-pager {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 10px; color: var(--muted); font-size: 11px;
    }
    .hp-pager .hp-pager-info { font-family: 'Consolas','Cascadia Mono',monospace; }
    .hp-pager .hp-pager-btns { display: flex; gap: 6px; }
    .footer { color: var(--muted); font-size: 11px; margin-top: 14px; text-align: right; }
  `;

  // Initial-filters JSON is interpolated in buildHistoryPage so the inline
  // script can read it directly. All other state lives in the iframe.
  function pageScript(initialFiltersJson) {
    return `
    (function() {
      const api = (window.parent && window.parent.dlp && window.parent.dlp.audit) || null;
      if (!api) {
        document.getElementById('hp-status').textContent = 'window.parent.dlp.audit is not available — preload may not have loaded.';
        document.getElementById('hp-status').classList.add('is-error');
        return;
      }

      const initial = ${initialFiltersJson};
      const PAGE_SIZE = 100;
      let offset = 0;
      let rows = [];
      let lastFilters = {};

      const statusEl    = document.getElementById('hp-status');
      const tbodyEl     = document.getElementById('hp-tbody');
      const pagerEl     = document.getElementById('hp-pager');
      const rangeSel    = document.getElementById('hp-range');
      const projectSel  = document.getElementById('hp-project');
      const actionSel   = document.getElementById('hp-action');
      const sourceSel   = document.getElementById('hp-source');
      const unitInput   = document.getElementById('hp-unit');
      const applyBtn    = document.getElementById('hp-apply');
      const exportBtn   = document.getElementById('hp-export');

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
        const pApi = window.parent && window.parent.dlp && window.parent.dlp.projects;
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
          '</tr>'
        ].join('');
      }

      function render() {
        if (rows.length === 0) {
          tbodyEl.innerHTML = '';
          pagerEl.innerHTML = '';
          const tbl = document.getElementById('hp-table');
          if (tbl) tbl.hidden = true;
          let emptyEl = document.getElementById('hp-empty');
          if (!emptyEl) {
            emptyEl = document.createElement('div');
            emptyEl.id = 'hp-empty';
            emptyEl.className = 'hp-empty';
            tbl.parentNode.insertBefore(emptyEl, tbl.nextSibling);
          }
          emptyEl.innerHTML = '<strong>No audit entries match</strong>Try widening the date range or clearing filters.';
          emptyEl.hidden = false;
          return;
        }
        const emptyEl = document.getElementById('hp-empty');
        if (emptyEl) emptyEl.hidden = true;
        const tbl = document.getElementById('hp-table');
        if (tbl) tbl.hidden = false;
        tbodyEl.innerHTML = rows.map(rowHtml).join('');

        const from = offset + 1;
        const to   = offset + rows.length;
        // We over-fetch one row to know if there's a next page.
        const hasMore = rows.length > PAGE_SIZE;
        if (hasMore) {
          rows = rows.slice(0, PAGE_SIZE);
          tbodyEl.innerHTML = rows.map(rowHtml).join('');
        }
        const actualTo = offset + rows.length;
        pagerEl.innerHTML =
          '<span class="hp-pager-info">Showing ' + from + '–' + actualTo + '</span>' +
          '<span class="hp-pager-btns">' +
            '<button class="hp-btn" id="hp-prev"' + (offset === 0 ? ' disabled' : '') + '>← Prev</button>' +
            '<button class="hp-btn" id="hp-next"' + (hasMore ? '' : ' disabled') + '>Next →</button>' +
          '</span>';
        const prev = document.getElementById('hp-prev');
        const next = document.getElementById('hp-next');
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
          const link = ev.target.closest('a[data-role="open-unit"]');
          if (!link) return;
          ev.preventDefault();
          const tr = link.closest('tr');
          if (!tr) return;
          const projectId = Number(tr.getAttribute('data-project-id'));
          const unit      = tr.getAttribute('data-unit');
          if (!projectId || !unit) return;
          const opener = window.parent && window.parent.__openUnitHistoryPanel;
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
    })();
    `;
  }

  function buildHistoryPage(initialFilters = {}) {
    // Sanitize the initial filters down to known fields so the inline script
    // can JSON.parse them without trusting arbitrary keys.
    const safe = {};
    if (initialFilters) {
      if (initialFilters.projectId)      safe.projectId      = initialFilters.projectId;
      if (initialFilters.unitNumberNorm) safe.unitNumberNorm = initialFilters.unitNumberNorm;
      if (initialFilters.action)         safe.action         = initialFilters.action;
      if (initialFilters.source)         safe.source         = initialFilters.source;
      if (initialFilters.range)          safe.range          = initialFilters.range;
    }
    // Embed JSON in a way that survives </script> in the data. Audit fields
    // don't contain raw </script> but defense-in-depth keeps the inline
    // script intact.
    const initialJson = JSON.stringify(safe).replace(/</g, '\\u003c');

    const cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src data:;">';
    const html = [
      '<!doctype html><html><head>',
      '<meta charset="utf-8">',
      cspMeta,
      '<title>History</title>',
      '<style>', PAGE_CSS, '</style>',
      '</head><body>',
      '<div class="page-head">',
        '<span class="page-logo">S</span>',
        '<div>',
          '<div class="page-title">History</div>',
          '<div class="page-sub">DL-Processor · Sobha Realty · Registration</div>',
        '</div>',
      '</div>',
      '<div class="hp-filters">',
        '<label>Range ',
          '<select id="hp-range">',
            '<option value="7">Last 7 days</option>',
            '<option value="30" selected>Last 30 days</option>',
            '<option value="90">Last 90 days</option>',
            '<option value="all">All time</option>',
          '</select>',
        '</label>',
        '<label>Project ',
          '<select id="hp-project"><option value="">All</option></select>',
        '</label>',
        '<label>Action ',
          '<select id="hp-action">',
            '<option value="">All</option>',
            '<option value="approve">approve</option>',
            '<option value="override">override</option>',
            '<option value="reject">reject</option>',
            '<option value="auto_apply">auto_apply</option>',
            '<option value="learn_alias">learn_alias</option>',
          '</select>',
        '</label>',
        '<label>Source ',
          '<select id="hp-source">',
            '<option value="">All</option>',
            '<option value="review_pending">review_pending</option>',
            '<option value="import_dld">import_dld</option>',
            '<option value="import_sf">import_sf</option>',
          '</select>',
        '</label>',
        '<label>Unit ',
          '<input id="hp-unit" type="text" placeholder="e.g. 101">',
        '</label>',
        '<button class="hp-btn hp-btn-primary" id="hp-apply">Apply</button>',
        '<button class="hp-btn" id="hp-export">Export CSV</button>',
      '</div>',
      '<div class="hp-status" id="hp-status"></div>',
      '<table class="hp-table" id="hp-table">',
        '<thead><tr>',
          '<th>When</th><th>Project</th><th>Unit</th><th>Field</th>',
          '<th>Old → New</th><th>Action · Source</th>',
        '</tr></thead>',
        '<tbody id="hp-tbody"></tbody>',
      '</table>',
      '<div class="hp-pager" id="hp-pager"></div>',
      '<div class="footer">Audit log reads from audit_log JOIN dld_project. Export CSV writes the full filtered set, not just the current page.</div>',
      '<script>', pageScript(initialJson), '<\/script>',
      '</body></html>'
    ].join('');
    return { html };
  }

  window.__buildHistoryPage = buildHistoryPage;

})();
