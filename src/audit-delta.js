const fs = require('fs');
const path = require('path');
const { compareProject } = require('./compare');

const CATEGORY_LABEL = {
  AGREE_MATCH:    'Agree · match',
  AGREE_MISMATCH: 'Agree · mismatch',
  TOOL_SOLVED:    'Tool solved',
  TOOL_STRICTER:  'Tool flagged',
  MANUAL_ONLY:    'Manual only',
  DL_ONLY:        'Tool only',
  MANUAL_BLANK:   'Auditor blank'
};

const CATEGORY_CLASS = {
  AGREE_MATCH:    'ok',
  AGREE_MISMATCH: 'warn',
  TOOL_SOLVED:    'up',
  TOOL_STRICTER:  'down',
  MANUAL_ONLY:    'sf',
  DL_ONLY:        'dld',
  MANUAL_BLANK:   'flat'
};

function categorize(m, t) {
  if (m && !t) return 'MANUAL_ONLY';
  if (!m && t) return 'DL_ONLY';
  if (!m && !t) return 'MANUAL_BLANK';
  const manBlank = m.name_match == null && m.price_match == null;
  if (manBlank) return 'MANUAL_BLANK';
  const manYes = m.name_match === 1 && m.price_match === 1;
  const manNo  = m.name_match === 0 || m.price_match === 0;
  const toolMatch = t.match_status === 'MATCH';
  if (manYes && toolMatch)  return 'AGREE_MATCH';
  if (manNo  && !toolMatch) return 'AGREE_MISMATCH';
  if (manNo  && toolMatch)  return 'TOOL_SOLVED';
  if (manYes && !toolMatch) return 'TOOL_STRICTER';
  return 'AGREE_MATCH';
}

function up(s) { return s == null ? '' : String(s).toUpperCase().trim(); }

function makeDeltaRow(m, t) {
  return {
    unit_number_norm: (t && t.unit_number_norm) || (m && m.unit_number_norm) || null,
    sf_unit:          (m && m.sf_unit) || (t && t.sf_unit) || (t && t.expected_sf_unit) || null,
    dld_unit:         (t && t.dld_unit_number) || (m && m.dld_unit) || null,
    m_name_match:     m ? m.name_match  : null,
    m_price_match:    m ? m.price_match : null,
    m_sf_applicant:   m ? m.sf_applicant : null,
    m_sf_price:       m ? m.sf_price : null,
    m_details:        m ? m.details : null,
    m_procedure:      m ? m.procedure_type : null,
    m_booking_name:   m ? m.sf_booking_name : null,
    t_match_status:   t ? t.match_status : null,
    t_match_reasons:  t ? t.match_reasons : null,
    t_dld_buyer:      t ? t.dld_purchase_party : null,
    t_sf_applicant:   t ? t.sf_applicant : null,
    t_dld_price:      t ? t.dld_purchase_amount : null,
    t_sf_price:       t ? t.sf_purchase_price : null,
    t_price_diff_pct: t ? t.price_diff_pct : null,
    delta_category:   categorize(m, t)
  };
}

function buildProjectDelta(db, projectId, manualSnapshotId) {
  const toolResult = compareProject(db, projectId);
  if (toolResult.status !== 'ok') return { status: toolResult.status, rows: [] };

  const manualRows = db.prepare(`
    SELECT r.*
    FROM manual_audit_row r
    JOIN manual_audit_project p ON p.manual_audit_project_id = r.manual_audit_project_id
    WHERE p.manual_audit_snapshot_id = ? AND p.project_id = ?
  `).all(manualSnapshotId, projectId);

  const manualIdx = new Map();
  const addKey = (k, m) => { if (k && !manualIdx.has(k)) manualIdx.set(k, m); };
  for (const m of manualRows) {
    addKey(up(m.unit_number_norm), m);
    addKey(up(m.sf_unit), m);
    addKey(up(m.dld_unit), m);
  }

  const rows = [];
  const usedManual = new Set();

  for (const t of toolResult.rows) {
    const candidates = [
      up(t.unit_number_norm),
      up(t.expected_sf_unit),
      up(t.sf_unit),
      up(t.dld_unit_number)
    ].filter(Boolean);
    let m = null;
    for (const k of candidates) {
      const hit = manualIdx.get(k);
      if (hit) { m = hit; break; }
    }
    if (m) usedManual.add(m);
    rows.push(makeDeltaRow(m, t));
  }

  for (const m of manualRows) {
    if (!usedManual.has(m)) rows.push(makeDeltaRow(m, null));
  }

  return { status: 'ok', rows };
}

function summarize(rows) {
  const c = { AGREE_MATCH: 0, AGREE_MISMATCH: 0, TOOL_SOLVED: 0, TOOL_STRICTER: 0, MANUAL_ONLY: 0, DL_ONLY: 0, MANUAL_BLANK: 0 };
  for (const r of rows) c[r.delta_category] = (c[r.delta_category] || 0) + 1;
  return c;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null || v === '') return '';
  return Math.round(+v).toLocaleString();
}

function csvEsc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeAuditDeltaCsv(outPath, projectName, rows) {
  const header = [
    'project','delta_category','sf_unit','dld_unit',
    'manual_name_match','manual_price_match','manual_sf_applicant','manual_sf_price','manual_procedure',
    'tool_match_status','tool_match_reasons','tool_dld_buyer','tool_sf_applicant','tool_dld_price','tool_sf_price','tool_price_diff_pct'
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      projectName, r.delta_category, r.sf_unit, r.dld_unit,
      r.m_name_match, r.m_price_match, r.m_sf_applicant, r.m_sf_price, r.m_procedure,
      r.t_match_status, r.t_match_reasons, r.t_dld_buyer, r.t_sf_applicant, r.t_dld_price, r.t_sf_price, r.t_price_diff_pct
    ].map(csvEsc).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
}

function writeAuditDeltaHtml(outPath, projectName, rows, manualSnapshot) {
  const counts = summarize(rows);
  const total = rows.length;
  const pct = n => total ? ((n * 100) / total).toFixed(1) + '%' : '0%';
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const renderCell = v => v == null ? '' : escHtml(v);
  const renderFlag = v => v == null ? '<span class="flat">—</span>' : (v === 1 ? '<span class="ok">✓</span>' : '<span class="down">✗</span>');

  const bodyHtml = rows.map(r => {
    const search = [r.sf_unit, r.dld_unit, r.m_sf_applicant, r.t_dld_buyer, r.t_sf_applicant, r.t_match_reasons, r.delta_category]
      .filter(Boolean).join(' ').toLowerCase();
    return `<tr class="${CATEGORY_CLASS[r.delta_category] || ''}" data-cat="${escHtml(r.delta_category)}" data-search="${escHtml(search)}">` +
      `<td><span class="badge ${CATEGORY_CLASS[r.delta_category] || ''}">${escHtml(CATEGORY_LABEL[r.delta_category] || r.delta_category)}</span></td>` +
      `<td>${renderCell(r.sf_unit)}</td>` +
      `<td>${renderCell(r.dld_unit)}</td>` +
      `<td class="num">${renderFlag(r.m_name_match)}</td>` +
      `<td class="num">${renderFlag(r.m_price_match)}</td>` +
      `<td>${renderCell(r.m_sf_applicant)}</td>` +
      `<td class="num">${fmtMoney(r.m_sf_price)}</td>` +
      `<td>${renderCell(r.t_match_status)}</td>` +
      `<td>${renderCell(r.t_match_reasons)}</td>` +
      `<td>${renderCell(r.t_dld_buyer)}</td>` +
      `<td>${renderCell(r.t_sf_applicant)}</td>` +
      `<td class="num">${fmtMoney(r.t_dld_price)}</td>` +
      `<td class="num">${fmtMoney(r.t_sf_price)}</td>` +
      `</tr>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(projectName)} — Audit Delta</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:20px 24px;background:#0b0f14;color:#e6e6e6}
  h1{margin:0 0 4px;color:#fff;font-size:22px}
  .meta{color:#888;margin-bottom:14px;font-size:12px}
  .meta b{color:#ccc}
  .controls{display:flex;gap:8px;margin:12px 0 14px;align-items:center;flex-wrap:wrap}
  .search{background:#0f141b;color:#fff;border:1px solid #222;padding:8px 12px;border-radius:6px;min-width:320px;font:inherit;outline:none}
  .chip{padding:6px 12px;border-radius:20px;font-weight:600;cursor:pointer;border:2px solid transparent;font-size:12px;user-select:none}
  .chip:hover{filter:brightness(1.25)}
  .chip.off{opacity:.28;filter:grayscale(.4)}
  .chip.ok{background:#0d3a1d;color:#4ce38e}
  .chip.up{background:#0f3a2f;color:#5cf0aa}
  .chip.down{background:#3a0f1a;color:#ff7fa6}
  .chip.warn{background:#3a2a0d;color:#ffcc55}
  .chip.dld{background:#0d2d3a;color:#5ad4ff}
  .chip.sf{background:#2d0d3a;color:#d88eff}
  .chip.flat{background:#1c1f25;color:#888}
  .count{color:#888;margin-left:auto;font-size:12px}
  .count b{color:#fff}
  .table-wrap{overflow-x:auto;border:1px solid #1b2028;border-radius:8px;background:#0d1218}
  table{width:100%;border-collapse:collapse;font-size:12px;min-width:1400px}
  thead th{background:#11161d;color:#aaa;font-weight:600;text-align:left;padding:8px 10px;border-bottom:2px solid #1f252e;position:sticky;top:0}
  tbody td{padding:6px 10px;border-bottom:1px solid #1a1f27;vertical-align:top;white-space:nowrap}
  tbody td.num{text-align:right;font-variant-numeric:tabular-nums}
  tbody tr.hidden{display:none}
  tbody tr.ok td{background:rgba(76,227,142,.04)}
  tbody tr.up td{background:rgba(92,240,170,.06)}
  tbody tr.down td{background:rgba(255,127,166,.06)}
  tbody tr.warn td{background:rgba(255,204,85,.05)}
  tbody tr.dld td{background:rgba(90,212,255,.05)}
  tbody tr.sf td{background:rgba(216,142,255,.05)}
  tbody tr.flat td{background:rgba(140,140,140,.04)}
  tbody tr:hover td{background:#151b24 !important}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge.ok{background:#0d3a1d;color:#4ce38e}
  .badge.up{background:#0f3a2f;color:#5cf0aa}
  .badge.down{background:#3a0f1a;color:#ff7fa6}
  .badge.warn{background:#3a2a0d;color:#ffcc55}
  .badge.dld{background:#0d2d3a;color:#5ad4ff}
  .badge.sf{background:#2d0d3a;color:#d88eff}
  .badge.flat{background:#1c1f25;color:#aaa}
  .ok{color:#4ce38e}.down{color:#ff6b88}.flat{color:#666}
  footer{margin-top:14px;color:#555;font-size:11px;text-align:right}
</style>
</head>
<body>
<h1>${escHtml(projectName)} — Audit Delta</h1>
<div class="meta">
  <b>As-of ${escHtml(manualSnapshot.as_of_month || '')}</b>
  &nbsp;·&nbsp; Source: <b>${escHtml(manualSnapshot.source_file || '')}</b>
  &nbsp;·&nbsp; ${total.toLocaleString()} unit-level deltas
</div>
<div class="controls">
  <input class="search" id="q" placeholder="Filter: unit, buyer, status, any text…" autocomplete="off">
  <span class="chip ok off"   data-cat="AGREE_MATCH">AGREE · MATCH ${counts.AGREE_MATCH} (${pct(counts.AGREE_MATCH)})</span>
  <span class="chip warn"     data-cat="AGREE_MISMATCH">AGREE · MISMATCH ${counts.AGREE_MISMATCH} (${pct(counts.AGREE_MISMATCH)})</span>
  <span class="chip up"       data-cat="TOOL_SOLVED">TOOL SOLVED ${counts.TOOL_SOLVED} (${pct(counts.TOOL_SOLVED)})</span>
  <span class="chip down"     data-cat="TOOL_STRICTER">TOOL FLAGGED ⚠ ${counts.TOOL_STRICTER} (${pct(counts.TOOL_STRICTER)})</span>
  <span class="chip sf"       data-cat="MANUAL_ONLY">MANUAL ONLY ${counts.MANUAL_ONLY} (${pct(counts.MANUAL_ONLY)})</span>
  <span class="chip dld"      data-cat="DL_ONLY">TOOL ONLY ${counts.DL_ONLY} (${pct(counts.DL_ONLY)})</span>
  <span class="chip flat"     data-cat="MANUAL_BLANK">BLANK ${counts.MANUAL_BLANK} (${pct(counts.MANUAL_BLANK)})</span>
  <span class="count" id="count">— rows</span>
</div>
<div class="table-wrap">
<table>
<thead><tr>
  <th>Category</th><th>SF Unit</th><th>DLD Unit</th>
  <th class="num">Name?</th><th class="num">Price?</th>
  <th>Manual SF Applicant</th><th class="num">Manual SF Price</th>
  <th>Tool Status</th><th>Tool Reasons</th>
  <th>Tool DLD Buyer</th><th>Tool SF Applicant</th>
  <th class="num">Tool DLD Price</th><th class="num">Tool SF Price</th>
</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div>
<footer>generated ${escHtml(generatedAt)} · click chips to toggle · TOOL FLAGGED ⚠ = likely false-positive worth reviewing</footer>
<script>
(function(){
  const tbody = document.querySelector('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  const q = document.getElementById('q');
  const chips = [...document.querySelectorAll('.chip')];
  const countEl = document.getElementById('count');
  const active = new Set(chips.filter(c => !c.classList.contains('off')).map(c => c.dataset.cat));

  function applyFilter(){
    const needle = q.value.trim().toLowerCase();
    let visible = 0;
    for (const tr of rows) {
      const catOn = active.has(tr.dataset.cat);
      const searchOn = !needle || tr.dataset.search.indexOf(needle) !== -1;
      const show = catOn && searchOn;
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    }
    countEl.innerHTML = '<b>' + visible.toLocaleString() + '</b> / ' + rows.length.toLocaleString() + ' rows';
  }
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const c = chip.dataset.cat;
      if (active.has(c)) { active.delete(c); chip.classList.add('off'); }
      else               { active.add(c);    chip.classList.remove('off'); }
      applyFilter();
    });
  });
  q.addEventListener('input', applyFilter);
  applyFilter();
})();
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function runAuditDelta({ db, projectFilter, outDir = path.join(__dirname, '..', 'output') }) {
  const manualSnapshot = db.prepare('SELECT * FROM manual_audit_snapshot ORDER BY manual_audit_snapshot_id DESC LIMIT 1').get();
  if (!manualSnapshot) {
    throw new Error('runAuditDelta: no manual_audit_snapshot found. Run import-audit first.');
  }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let projects = db.prepare(`
    SELECT p.project_id, p.project_name
    FROM dld_project p
    WHERE p.project_id IN (
      SELECT DISTINCT project_id FROM manual_audit_project
        WHERE manual_audit_snapshot_id = ? AND project_id IS NOT NULL
    )
    ORDER BY p.project_name
  `).all(manualSnapshot.manual_audit_snapshot_id);
  if (projectFilter) projects = projects.filter(p => p.project_name === projectFilter);

  const summary = { AGREE_MATCH: 0, AGREE_MISMATCH: 0, TOOL_SOLVED: 0, TOOL_STRICTER: 0, MANUAL_ONLY: 0, DL_ONLY: 0, MANUAL_BLANK: 0 };
  const written = [];

  for (const p of projects) {
    const d = buildProjectDelta(db, p.project_id, manualSnapshot.manual_audit_snapshot_id);
    if (d.status !== 'ok') {
      written.push({ project: p.project_name, status: d.status, csv: null, html: null });
      continue;
    }
    const counts = summarize(d.rows);
    for (const k of Object.keys(summary)) summary[k] += counts[k] || 0;

    const base = safeName(p.project_name);
    const csvPath  = path.join(outDir, base + '.audit-delta.csv');
    const htmlPath = path.join(outDir, base + '.audit-delta.html');
    writeAuditDeltaCsv(csvPath, p.project_name, d.rows);
    writeAuditDeltaHtml(htmlPath, p.project_name, d.rows, manualSnapshot);
    written.push({ project: p.project_name, status: 'ok', total: d.rows.length, counts, csv: csvPath, html: htmlPath });
  }

  return { manualSnapshot, projectsRun: projects.length, summary, written };
}

module.exports = {
  categorize, buildProjectDelta, summarize, makeDeltaRow,
  writeAuditDeltaCsv, writeAuditDeltaHtml, runAuditDelta, safeName,
  CATEGORY_LABEL, CATEGORY_CLASS
};
