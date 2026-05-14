// Renders the Project Compare page natively into a tab-host render-mode
// pane. Replaces output/compare/<slug>.compare.html — same 23 columns,
// same filter chips, same sort behaviour, plus native row → side panel
// and procedure / PENDING deep links. (Spec § 2.)
//
// Caller: tabHost.open({ title, render: (container) =>
//   window.__renderProjectComparePage(container, projectId) });

(function () {

  const STATUS_CLASS = {
    MATCH:          'ok',
    PRICE_UP:       'up',
    PRICE_DOWN:     'down',
    BUYER_MISMATCH: 'warn',
    AREA_MISMATCH:  'area',
    DLD_ONLY:       'dld',
    SF_ONLY:        'sf'
  };
  const STATUS_LABEL = {
    MATCH:          'MATCH',
    PRICE_UP:       'PRICE ↑',
    PRICE_DOWN:     'PRICE ↓',
    BUYER_MISMATCH: 'BUYER MISMATCH',
    AREA_MISMATCH:  'AREA',
    DLD_ONLY:       'DLD-only',
    SF_ONLY:        'SF-only'
  };

  // 23-column definition — matches src/compare.js writeCompareHtml exactly.
  const COLUMNS = [
    { key: 'dld_unit_number',     label: 'DLD Unit',         align: 'left'  },
    { key: 'expected_sf_unit',    label: 'Expected SF Unit', align: 'left'  },
    { key: 'sf_unit',             label: 'SF Unit (actual)', align: 'left'  },
    { key: 'dld_unit_type',       label: 'Type',             align: 'left'  },
    { key: 'dld_net_area',        label: 'SQM',              align: 'num'   },
    { key: 'manual_area_sqm',     label: 'Manual SQM',       align: 'num'   },
    { key: 'area_diff_pct',       label: 'Area Δ %',    align: 'num'   },
    { key: 'area_diff_sqm',       label: 'Area Δ sqm',  align: 'num'   },
    { key: 'dld_purchase_type',   label: 'DLD Tx',           align: 'left'  },
    { key: 'dld_purchase_date',   label: 'DLD Date',         align: 'left'  },
    { key: 'days_outstanding',    label: 'Days',             align: 'num'   },
    { key: 'dld_purchase_amount', label: 'DLD Price',        align: 'num'   },
    { key: 'dld_purchase_party',  label: 'DLD Buyer',        align: 'left'  },
    { key: 'sf_applicant',        label: 'SF Applicant',     align: 'left'  },
    { key: 'dld_count',           label: 'DLD #',            align: 'center', cell: 'buyers'    },
    { key: 'sf_count',            label: 'SF #',             align: 'center', cell: 'applicants'},
    { key: 'sf_purchase_price',   label: 'SF Price',         align: 'num'   },
    { key: 'price_diff_pct',      label: 'Δ %',         align: 'num'   },
    { key: 'price_diff_aed',      label: 'Δ AED',       align: 'num'   },
    { key: 'sf_status',           label: 'SF Status',        align: 'left',  cell: 'sf_status' },
    { key: 'match_status',        label: 'Match',            align: 'left',  cell: 'status_badge' },
    { key: 'match_reasons',       label: 'Reason',           align: 'left'  },
    { key: 'audit_flags',         label: 'Flags',            align: 'left',  cell: 'flags' }
  ];

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoney(v) {
    if (v == null) return '';
    return Math.round(v).toLocaleString();
  }

  function fmtPct(v) {
    if (v == null) return '';
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(2) + '%';
  }

  function computeDaysOutstanding(row) {
    if (row.match_status === 'MATCH') return null;
    const iso = row.dld_purchase_date_iso;
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    if (isNaN(ms)) return null;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  function buildCell(col, row) {
    const raw = row[col.key];
    const td = document.createElement('td');
    const cls = [];
    if (col.align === 'num')    cls.push('num');
    if (col.align === 'center') cls.push('center');

    if (col.cell === 'buyers') {
      return window.__compareCells.buildBuyerCell('dld', row.dld_buyers || []);
    }
    if (col.cell === 'applicants') {
      return window.__compareCells.buildBuyerCell('sf', row.sf_applicants || []);
    }
    if (col.cell === 'status_badge') {
      const sClass = STATUS_CLASS[raw] || '';
      td.innerHTML = '<span class="badge ' + sClass + '">' + escHtml(STATUS_LABEL[raw] || raw) + '</span>';
      td.dataset.sortVal = String(raw || '');
      return td;
    }
    if (col.cell === 'flags') {
      const flags = Array.isArray(row.match_flags) ? row.match_flags
                  : (row.audit_flags ? String(row.audit_flags).split('|').filter(Boolean) : []);
      if (flags.length === 0) { td.textContent = ''; td.dataset.sortVal = ''; return td; }
      td.dataset.sortVal = flags.join(',');
      for (const f of flags) {
        const chip = document.createElement('span');
        chip.className = 'flag-chip' + (f === 'PENDING' ? ' is-pending' : '');
        chip.textContent = f;
        if (f === 'PENDING') chip.dataset.unitNumber = row.dld_unit_number || row.expected_sf_unit || '';
        td.appendChild(chip);
        td.appendChild(document.createTextNode(' '));
      }
      return td;
    }
    if (col.cell === 'sf_status') {
      td.textContent = raw == null ? '' : String(raw);
      td.dataset.sortVal = raw == null ? '' : String(raw);
      if (row.sf_procedure_number) {
        const chip = document.createElement('span');
        chip.className = 'proc-chip';
        chip.textContent = String(row.sf_procedure_number);
        chip.dataset.procNumber = String(row.sf_procedure_number);
        chip.title = 'Open History filtered to this procedure';
        td.appendChild(document.createTextNode(' '));
        td.appendChild(chip);
      }
      return td;
    }

    let html = '';
    let sortVal = raw == null ? '' : String(raw);
    if (col.key === 'dld_purchase_amount' || col.key === 'sf_purchase_price') {
      html = raw == null ? '' : fmtMoney(raw);
      sortVal = raw == null ? '-Infinity' : String(raw);
    } else if (col.key === 'price_diff_pct') {
      sortVal = raw == null ? '-999999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.01) { html = ''; cls.push('flat'); }
      else { html = fmtPct(raw); cls.push(raw > 0 ? 'up' : 'down'); }
    } else if (col.key === 'price_diff_aed') {
      sortVal = raw == null ? '-Infinity' : String(raw);
      if (raw == null || Math.abs(raw) < 1) { html = ''; }
      else {
        const sign = raw > 0 ? '+' : '-';
        html = sign + fmtMoney(Math.abs(raw));
        cls.push(raw > 0 ? 'up' : 'down');
      }
    } else if (col.key === 'dld_purchase_date') {
      const m = raw ? String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
      sortVal = m ? (m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0')) : (raw == null ? '' : String(raw));
      html = escHtml(raw);
    } else if (col.key === 'days_outstanding') {
      const d = computeDaysOutstanding(row);
      sortVal = d == null ? '99999' : String(d);
      if (d == null) { html = ''; }
      else { html = String(d); if (d > 180) cls.push('down'); else if (d > 90) cls.push('warn-days'); }
    } else if (col.key === 'dld_net_area' || col.key === 'manual_area_sqm') {
      sortVal = raw == null ? '-1' : String(raw);
      if (raw == null) html = '';
      else { const n = +raw; html = isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : ''; }
    } else if (col.key === 'area_diff_pct') {
      sortVal = raw == null ? '-99999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.5) { html = ''; cls.push('flat'); }
      else { html = (raw > 0 ? '+' : '') + raw.toFixed(1) + '%'; cls.push(raw > 0 ? 'up' : 'down'); }
    } else if (col.key === 'area_diff_sqm') {
      sortVal = raw == null ? '-99999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.01) html = '';
      else { html = (raw > 0 ? '+' : '') + raw.toFixed(2).replace(/\.?0+$/, ''); cls.push(raw > 0 ? 'up' : 'down'); }
    } else {
      html = escHtml(raw);
    }

    td.className = cls.join(' ');
    td.dataset.sortVal = sortVal;
    td.innerHTML = html;
    return td;
  }

  function buildRow(row) {
    const tr = document.createElement('tr');
    tr.className = STATUS_CLASS[row.match_status] || '';
    tr.dataset.status = row.match_status || '';
    const searchText = COLUMNS
      .map(c => row[c.key] == null ? '' : String(row[c.key]))
      .join(' ').toLowerCase();
    tr.dataset.search = searchText;
    for (const col of COLUMNS) tr.appendChild(buildCell(col, row));
    return tr;
  }

  function renderProjectComparePage(container, projectId) {
    container.classList.add('project-compare-page');
    container.innerHTML = [
      '<div class="pcp-head">',
      '  <h2 class="pcp-title">Loading…</h2>',
      '  <div class="pcp-meta"></div>',
      '  <button class="pcp-refresh">Refresh</button>',
      '</div>',
      '<div class="pcp-status"></div>',
      '<div class="pcp-controls"></div>',
      '<div class="pcp-table-wrap"><table class="pcp-table">',
      '  <thead><tr></tr></thead>',
      '  <tbody></tbody>',
      '</table></div>'
    ].join('');

    const titleEl    = container.querySelector('.pcp-title');
    const metaEl     = container.querySelector('.pcp-meta');
    const statusEl   = container.querySelector('.pcp-status');
    const tbodyEl    = container.querySelector('.pcp-table tbody');
    const theadRow   = container.querySelector('.pcp-table thead tr');
    const refreshBtn = container.querySelector('.pcp-refresh');

    for (const col of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.align = col.align;
      theadRow.appendChild(th);
    }

    // Declared with `let` so Task 7 can wrap it to also call applyFilter().
    let load = async function () {
      statusEl.textContent = 'Loading…';
      try {
        const data = await window.dlp.compare.project(projectId);
        titleEl.textContent = data.project ? data.project.project_name : ('Project ' + projectId);
        metaEl.textContent = (data.rows || []).length.toLocaleString() + ' units compared';
        statusEl.textContent = '';
        tbodyEl.innerHTML = '';
        for (const r of (data.rows || [])) tbodyEl.appendChild(buildRow(r));
        container.dataset.totalRows = String((data.rows || []).length);
      } catch (e) {
        statusEl.textContent = 'Failed to load: ' + (e && e.message ? e.message : e);
        statusEl.classList.add('is-error');
      }
    };

    refreshBtn.addEventListener('click', () => load());
    load();
  }

  window.__renderProjectComparePage = renderProjectComparePage;
})();
