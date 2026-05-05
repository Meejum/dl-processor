const fs = require('fs');
const path = require('path');

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countFlag(rows, flag) {
  let n = 0;
  for (const r of rows) {
    if (Array.isArray(r.match_flags) && r.match_flags.includes(flag)) n++;
  }
  return n;
}

function buildProjectStat(project, result, auditTaskCount) {
  const base = project.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
  if (!result || result.status !== 'ok') {
    return {
      name: project.project_name,
      base,
      status: result ? result.status : 'no-result',
      matchCount: null,
      buyerCount: null,
      auditCount: null,
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
    a10:   t.a10   + (s.a10        || 0),
    a11:   t.a11   + (s.a11        || 0),
    a12:   t.a12   + (s.a12        || 0)
  }), { match: 0, buyer: 0, audit: 0, a10: 0, a11: 0, a12: 0 });

  const fmt = (n) => n == null ? '—' : Number(n).toLocaleString();

  const rowsHtml = stats.map(s => {
    const link = s.hasCompare
      ? `<a href="compare/${escHtml(s.base)}.compare.html">${escHtml(s.name)}</a>`
      : `<span class="skipped">${escHtml(s.name)}</span>`;
    const statusBadge = s.hasCompare
      ? ''
      : `<span class="badge skipped">${escHtml(s.status)}</span>`;
    const num = (v, cls) => v == null
      ? `<td class="num ${cls}" data-sort-val="-1">—</td>`
      : `<td class="num ${cls}" data-sort-val="${v}">${fmt(v)}</td>`;
    return `<tr data-search="${escHtml(s.name.toLowerCase())}">` +
      `<td>${link} ${statusBadge}</td>` +
      num(s.matchCount, 'good') +
      num(s.buyerCount, 'bad') +
      num(s.auditCount, 'warn') +
      num(s.a10, 'flag a10') +
      num(s.a11, 'flag a11') +
      num(s.a12, 'flag a12') +
    `</tr>`;
  }).join('\n');

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DL-Processor — Reconciliation Dashboard</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:24px;background:#0b0f14;color:#e6e6e6}
  h1{margin:0 0 4px;color:#fff;font-size:22px}
  .meta{color:#888;margin-bottom:18px;font-size:12px}
  .controls{margin:12px 0;display:flex;gap:8px;align-items:center}
  .search{background:#0f141b;color:#fff;border:1px solid #222;padding:8px 12px;border-radius:6px;min-width:280px;font:inherit;outline:none}
  .search:focus{border-color:#3ea1ff;box-shadow:0 0 0 2px rgba(62,161,255,.18)}
  table{width:100%;border-collapse:collapse;font-size:13px;background:#0d1218;border:1px solid #1b2028;border-radius:8px;overflow:hidden}
  thead th{background:#11161d;color:#aaa;font-weight:600;text-align:left;padding:10px 12px;border-bottom:2px solid #1f252e;cursor:pointer;user-select:none;white-space:nowrap}
  thead th:hover{color:#fff;background:#151b24}
  thead th.sort-asc::after{content:"  ↑";color:#4ce38e}
  thead th.sort-desc::after{content:"  ↓";color:#ffcc55}
  thead th.num{text-align:right}
  tbody td{padding:8px 12px;border-bottom:1px solid #1a1f27;vertical-align:middle}
  tbody tr:hover td{background:#151b24}
  tbody tr.hidden{display:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  td.good{color:#4ce38e}
  td.bad{color:#ff7b7b}
  td.warn{color:#ffcc55}
  td.flag{color:#5ad4ff}
  td a{color:#fff;text-decoration:none;border-bottom:1px dotted #4a5260}
  td a:hover{color:#3ea1ff;border-bottom-color:#3ea1ff}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-left:6px}
  .badge.skipped{background:#2a1f0d;color:#ccaa55}
  .skipped{color:#888;font-style:italic}
  tfoot td{padding:10px 12px;border-top:2px solid #1f252e;font-weight:700;background:#11161d}
  tfoot td.num{font-variant-numeric:tabular-nums}
  footer{margin-top:14px;color:#555;font-size:11px;text-align:right}
</style>
</head>
<body>
<h1>DL-Processor — Reconciliation Dashboard</h1>
<div class="meta">${stats.length} project${stats.length === 1 ? '' : 's'} · click a project to open its compare report · click headers to sort</div>
<div class="controls">
  <input class="search" id="q" placeholder="Filter by project name…" autocomplete="off">
</div>
<table id="tbl">
<thead><tr>
  <th data-col="0">Project</th>
  <th data-col="1" class="num">MATCH</th>
  <th data-col="2" class="num">BUYER MISMATCH</th>
  <th data-col="3" class="num">Audit Tasks</th>
  <th data-col="4" class="num">A10</th>
  <th data-col="5" class="num">A11</th>
  <th data-col="6" class="num">A12</th>
</tr></thead>
<tbody>
${rowsHtml}
</tbody>
<tfoot><tr>
  <td>TOTAL · ${stats.length} project${stats.length === 1 ? '' : 's'}</td>
  <td class="num good">${fmt(totals.match)}</td>
  <td class="num bad">${fmt(totals.buyer)}</td>
  <td class="num warn">${fmt(totals.audit)}</td>
  <td class="num flag">${fmt(totals.a10)}</td>
  <td class="num flag">${fmt(totals.a11)}</td>
  <td class="num flag">${fmt(totals.a12)}</td>
</tr></tfoot>
</table>
<footer>generated ${escHtml(generatedAt)} · A10/A11/A12 columns populate as the matching branches merge</footer>
<script>
(function(){
  const tbl = document.getElementById('tbl');
  const q = document.getElementById('q');
  const rows = [...tbl.querySelectorAll('tbody tr')];
  const headers = [...tbl.querySelectorAll('thead th')];
  let sortCol = null, sortDir = 1;
  q.addEventListener('input', () => {
    const needle = q.value.trim().toLowerCase();
    for (const r of rows) {
      r.classList.toggle('hidden', !!needle && r.dataset.search.indexOf(needle) === -1);
    }
  });
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
})();
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

module.exports = { buildProjectStat, writeDashboardHtml, countFlag };
