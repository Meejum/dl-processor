const fs = require('fs');
const path = require('path');
const { compareProject } = require('./compare');
const { SOBHA_STYLE_CSS, brandBar } = require('./html-styles');

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
    m_size:           m ? m.size : null,
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
  const renderFlag = v => v == null ? '<span class="flag-blank">—</span>' : (v === 1 ? '<span class="flag-ok">✓</span>' : '<span class="flag-no">✗</span>');
  const renderSqm = v => v == null || v === '' ? '' : (+v).toFixed(2).replace(/\.?0+$/, '');

  const bodyHtml = rows.map(r => {
    const search = [r.sf_unit, r.dld_unit, r.m_sf_applicant, r.t_dld_buyer, r.t_sf_applicant, r.t_match_reasons, r.delta_category]
      .filter(Boolean).join(' ').toLowerCase();
    return `<tr class="${CATEGORY_CLASS[r.delta_category] || ''}" data-cat="${escHtml(r.delta_category)}" data-search="${escHtml(search)}">` +
      `<td><span class="badge ${CATEGORY_CLASS[r.delta_category] || ''}">${escHtml(CATEGORY_LABEL[r.delta_category] || r.delta_category)}</span></td>` +
      `<td>${renderCell(r.sf_unit)}</td>` +
      `<td>${renderCell(r.dld_unit)}</td>` +
      `<td class="num">${renderSqm(r.m_size)}</td>` +
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
<title>${escHtml(projectName)} — Audit Delta · Sobha Realty</title>
<style>${SOBHA_STYLE_CSS}</style>
</head>
<body>
${brandBar(generatedAt)}
<div class="page">
<div class="title-row"><h1>${escHtml(projectName)}<span class="sub" style="font-size:14px;color:var(--accent-dark);margin-left:10px">— Audit Delta</span></h1></div>
<div class="meta">
  <b>As-of ${escHtml(manualSnapshot.as_of_month || '')}</b>
  <span class="sep">·</span> Source: <b>${escHtml(manualSnapshot.source_file || '')}</b>
  <span class="sep">·</span> <b>${total.toLocaleString()}</b> unit-level deltas
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
<div class="table-wrap"><div class="table-scroll">
<table>
<thead><tr>
  <th>Category</th><th>SF Unit</th><th>DLD Unit</th>
  <th data-align="num">SQM</th>
  <th data-align="num">Name?</th><th data-align="num">Price?</th>
  <th>Manual SF Applicant</th><th data-align="num">Manual SF Price</th>
  <th>Tool Status</th><th>Tool Reasons</th>
  <th>Tool DLD Buyer</th><th>Tool SF Applicant</th>
  <th data-align="num">Tool DLD Price</th><th data-align="num">Tool SF Price</th>
</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div></div>
<footer>generated ${escHtml(generatedAt)} · click chips to toggle · TOOL FLAGGED ⚠ = likely false-positive worth reviewing<span class="sig">Sobha Realty · Registration / DLD</span></footer>
</div>
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

function runAuditDelta({ db, projectFilter, outDir = path.join(__dirname, '..', 'output', 'audit-delta') }) {
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
