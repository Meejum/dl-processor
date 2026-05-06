const fs = require('fs');
const path = require('path');
const { SOBHA_STYLE_CSS, brandBar, escHtml } = require('./html-styles');

function countFlag(rows, flag) {
  let n = 0;
  for (const r of rows) {
    if (Array.isArray(r.match_flags) && r.match_flags.includes(flag)) n++;
  }
  return n;
}

function buildProjectStat(project, result, auditTaskCount, pendingCount) {
  const base = project.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
  if (!result || result.status !== 'ok') {
    return {
      name: project.project_name,
      base,
      status: result ? result.status : 'no-result',
      matchCount: null,
      buyerCount: null,
      auditCount: null,
      pendingCount: null,
      a10: null,
      a11: null,
      a12: null,
      hasCompare: false
    };
  }
  const rows = result.rows || [];
  const counts = {};
  for (const r of rows) counts[r.match_status] = (counts[r.match_status] || 0) + 1;
  return {
    name:       project.project_name,
    base,
    status:     'ok',
    matchCount: counts.MATCH || 0,
    buyerCount: counts.BUYER_MISMATCH || 0,
    auditCount: auditTaskCount != null ? auditTaskCount : 0,
    pendingCount: pendingCount != null ? pendingCount : 0,
    a10:        countFlag(rows, 'A10'),
    a11:        countFlag(rows, 'A11'),
    a12:        countFlag(rows, 'A12'),
    hasCompare: true
  };
}

function writeDashboardHtml(outPath, stats) {
  const totals = stats.reduce((t, s) => ({
    match: t.match + (s.matchCount || 0),
    buyer: t.buyer + (s.buyerCount || 0),
    audit: t.audit + (s.auditCount || 0),
    pending: t.pending + (s.pendingCount || 0),
    a10:   t.a10   + (s.a10        || 0),
    a11:   t.a11   + (s.a11        || 0),
    a12:   t.a12   + (s.a12        || 0)
  }), { match: 0, buyer: 0, audit: 0, pending: 0, a10: 0, a11: 0, a12: 0 });

  const fmt = (n) => n == null ? '—' : Number(n).toLocaleString();

  const rowsHtml = stats.map(s => {
    const link = s.hasCompare
      ? `<a href="compare/${escHtml(s.base)}.compare.html">${escHtml(s.name)}</a>`
      : `<span class="skipped">${escHtml(s.name)}</span>`;
    const statusBadge = s.hasCompare
      ? ''
      : `<span class="badge skipped">${escHtml(s.status)}</span>`;
    const num = (v, cls) => {
      const c = cls ? `num ${cls}` : 'num';
      return v == null
        ? `<td class="${c}" data-sort-val="-1">—</td>`
        : `<td class="${c}" data-sort-val="${v}">${fmt(v)}</td>`;
    };
    return `<tr data-search="${escHtml(s.name.toLowerCase())}">` +
      `<td>${link} ${statusBadge}</td>` +
      num(s.matchCount, 'good') +
      num(s.buyerCount, 'bad') +
      num(s.auditCount, 'warn') +
      num(s.pendingCount, 'warn') +
      num(s.a10, '') +
      num(s.a11, '') +
      num(s.a12, '') +
    `</tr>`;
  }).join('\n');

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DL-Processor — Reconciliation Dashboard</title>
<style>${SOBHA_STYLE_CSS}
  /* Dashboard-specific overrides (the shared style targets compare-table widths). */
  table { min-width: 900px; }
  td.num.warn { color: var(--warn); font-weight: 700; }
  td.num.bad  { color: var(--down); font-weight: 700; }
  td.num.good { color: var(--ok);   font-weight: 700; }
  .skipped    { color: var(--muted); font-style: italic; }
  .badge.skipped { background: var(--warn-bg); color: var(--warn) }
  td a { color: var(--accent-dark); text-decoration: none; font-weight: 600; border-bottom: 1px dotted var(--border-2); }
  td a:hover { color: var(--accent); border-bottom-color: var(--accent); }
</style>
</head>
<body>
${brandBar(generatedAt)}
<div class="page">
  <div class="title-row">
    <h1>Reconciliation Dashboard</h1>
  </div>
  <div class="meta">
    <b>${stats.length}</b> project${stats.length === 1 ? '' : 's'}
    <span class="sep">·</span>
    click a project to open its compare report
    <span class="sep">·</span>
    click headers to sort
  </div>
  <div class="controls">
    <input class="search" id="q" placeholder="Filter by project name…" autocomplete="off">
    <span class="count" id="count"><b>${stats.length}</b> projects</span>
  </div>
  <div class="table-wrap">
    <div class="table-scroll">
      <table id="tbl">
        <thead><tr>
          <th data-col="0">Project</th>
          <th data-col="1" data-align="num">MATCH</th>
          <th data-col="2" data-align="num">BUYER MISMATCH</th>
          <th data-col="3" data-align="num">Audit Tasks</th>
          <th data-col="4" data-align="num">Pending</th>
          <th data-col="5" data-align="num">A10</th>
          <th data-col="6" data-align="num">A11</th>
          <th data-col="7" data-align="num">A12</th>
        </tr></thead>
        <tbody>
${rowsHtml}
        </tbody>
        <tfoot><tr>
          <td>TOTAL · ${stats.length} project${stats.length === 1 ? '' : 's'}</td>
          <td class="num good">${fmt(totals.match)}</td>
          <td class="num bad">${fmt(totals.buyer)}</td>
          <td class="num warn">${fmt(totals.audit)}</td>
          <td class="num warn">${fmt(totals.pending)}</td>
          <td class="num">${fmt(totals.a10)}</td>
          <td class="num">${fmt(totals.a11)}</td>
          <td class="num">${fmt(totals.a12)}</td>
        </tr></tfoot>
      </table>
    </div>
  </div>
  <footer>
    generated ${escHtml(generatedAt)}
    <span class="sep">·</span>
    A10/A11/A12 columns populate as the matching feature branches merge
    <span class="sig">SOBHA REALTY</span>
  </footer>
</div>
<script>
(function(){
  const tbl = document.getElementById('tbl');
  const q = document.getElementById('q');
  const rows = [...tbl.querySelectorAll('tbody tr')];
  const headers = [...tbl.querySelectorAll('thead th')];
  const countEl = document.getElementById('count');
  let sortCol = null, sortDir = 1;
  function applyFilter(){
    const needle = q.value.trim().toLowerCase();
    let v = 0;
    for (const r of rows) {
      const hide = !!needle && r.dataset.search.indexOf(needle) === -1;
      r.classList.toggle('hidden', hide);
      if (!hide) v++;
    }
    countEl.innerHTML = '<b>' + v.toLocaleString() + '</b> / ' + rows.length.toLocaleString() + ' projects';
  }
  q.addEventListener('input', applyFilter);
  headers.forEach((th, i) => th.addEventListener('click', () => {
    if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = 1; }
    headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
    th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    const tbody = tbl.querySelector('tbody');
    const sorted = rows.slice().sort((a, b) => {
      const av = a.children[i].dataset.sortVal != null ? a.children[i].dataset.sortVal : a.children[i].textContent.trim();
      const bv = b.children[i].dataset.sortVal != null ? b.children[i].dataset.sortVal : b.children[i].textContent.trim();
      const an = parseFloat(String(av).replace(/,/g, ''));
      const bn = parseFloat(String(bv).replace(/,/g, ''));
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    for (const r of sorted) tbody.appendChild(r);
  }));
  applyFilter();
})();
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

module.exports = { buildProjectStat, writeDashboardHtml, countFlag };
