const fs = require('fs');
const path = require('path');

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function writeCsv(filePath, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(','));
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtMoney(v) { return v == null ? '' : Math.round(v).toLocaleString(); }

function latestTwoSnapshots(db, projectId) {
  return db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ?
    ORDER BY imported_at DESC
    LIMIT 2
  `).all(projectId);
}

function isValidIsoDate(s) {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function pickBaseline(db, projectId, { since } = {}) {
  if (since === undefined || since === null) {
    const snaps = latestTwoSnapshots(db, projectId);
    if (snaps.length < 2) {
      return { status: 'not-enough-snapshots', oldSnap: null, newSnap: null };
    }
    return { status: 'ok', oldSnap: snaps[1], newSnap: snaps[0] };
  }

  if (!isValidIsoDate(since)) {
    throw new Error('invalid --since date: "' + since + '" (expected YYYY-MM-DD)');
  }

  const newSnap = db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId);

  const oldSnap = db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ? AND imported_at < ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId, since);

  if (!newSnap || !oldSnap) {
    return { status: 'no-baseline-before-date', oldSnap: null, newSnap: null };
  }
  return { status: 'ok', oldSnap, newSnap };
}

function loadUnitsWithTx(db, snapshotId) {
  const units = db.prepare(`
    SELECT u.*, b.name AS building_name, b.type AS building_type
    FROM dld_unit u
    LEFT JOIN dld_building b ON b.building_id = u.building_id
    WHERE u.snapshot_id = ?
  `).all(snapshotId);
  const txByUnit = new Map();
  const txs = db.prepare(`SELECT * FROM dld_transaction WHERE snapshot_id = ?`).all(snapshotId);
  for (const t of txs) {
    if (!txByUnit.has(t.unit_id)) txByUnit.set(t.unit_id, []);
    txByUnit.get(t.unit_id).push(t);
  }
  for (const u of units) u.transactions = txByUnit.get(u.unit_id) || [];
  return units;
}

function txKey(t) {
  return [
    t.tx_type || '',
    t.tx_date || '',
    (t.party_name || '').trim().toUpperCase()
  ].join('|');
}

function diffProject(db, projectId, { oldSnapshotId, newSnapshotId, includeMissing = false, since } = {}) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id = ?').get(projectId);
  if (!project) throw new Error('project not found');

  let oldSnap, newSnap;
  if (oldSnapshotId && newSnapshotId) {
    oldSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(oldSnapshotId);
    newSnap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(newSnapshotId);
  } else {
    const picked = pickBaseline(db, projectId, { since });
    if (picked.status !== 'ok') {
      return { project, status: picked.status, snaps: [], hiddenMissingCount: { units: 0, txs: 0 } };
    }
    oldSnap = picked.oldSnap;
    newSnap = picked.newSnap;
  }

  const oldUnits = loadUnitsWithTx(db, oldSnap.snapshot_id);
  const newUnits = loadUnitsWithTx(db, newSnap.snapshot_id);
  const oldByKey = new Map(oldUnits.map(u => [u.unit_number_norm, u]));
  const newByKey = new Map(newUnits.map(u => [u.unit_number_norm, u]));

  const rows = [];
  const push = (row) => rows.push(row);
  const unitRow = (unitNumber, u, n) => ({
    unit_number:  unitNumber,
    unit_type:    (n && n.unit_type) || (u && u.unit_type) || null,
    dld_unit_id:  (n && n.dld_unit_id) || (u && u.dld_unit_id) || null,
    building:     (n && n.building_name) || (u && u.building_name) || null
  });

  const allKeys = new Set([...oldByKey.keys(), ...newByKey.keys()]);
  for (const key of allKeys) {
    const o = oldByKey.get(key);
    const n = newByKey.get(key);

    if (!o && n) {
      push({
        ...unitRow(key, null, n),
        change_type: 'NEW_UNIT',
        category:    'unit',
        old_value:   '',
        new_value:   `${n.unit_type || ''} · ${n.net_area || ''} sqm · ${n.transactions.length} tx`,
        detail:      'unit not present in previous snapshot'
      });
      // Still detect new transactions for this new unit
      for (const t of n.transactions) {
        push({
          ...unitRow(key, null, n),
          change_type: 'NEW_TX',
          category:    'tx',
          old_value:   '',
          new_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          detail:      'new transaction recorded'
        });
      }
      continue;
    }
    if (o && !n) {
      push({
        ...unitRow(key, o, null),
        change_type: 'MISSING_UNIT',
        category:    'unit',
        old_value:   `${o.unit_type || ''} · ${o.net_area || ''} sqm · ${o.transactions.length} tx`,
        new_value:   '',
        detail:      'unit not present in latest snapshot (may be out of report scope)'
      });
      // Still detect missing transactions for this missing unit
      for (const t of o.transactions) {
        push({
          ...unitRow(key, o, null),
          change_type: 'MISSING_TX',
          category:    'tx',
          old_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          new_value:   '',
          detail:      'transaction not present in latest snapshot (may be out of report scope)'
        });
      }
      continue;
    }

    if (o.unit_type !== n.unit_type) {
      push({
        ...unitRow(key, o, n),
        change_type: 'UNIT_TYPE_CHANGED',
        category:    'unit',
        old_value:   o.unit_type,
        new_value:   n.unit_type,
        detail:      'unit type changed'
      });
    }
    const oa = o.net_area, na = n.net_area;
    if (oa != null && na != null && Math.abs(oa - na) > 0.01) {
      push({
        ...unitRow(key, o, n),
        change_type: 'AREA_CHANGED',
        category:    'unit',
        old_value:   String(oa),
        new_value:   String(na),
        detail:      `net area ${oa} -> ${na}`
      });
    }

    const oTx = new Map(o.transactions.map(t => [txKey(t), t]));
    const nTx = new Map(n.transactions.map(t => [txKey(t), t]));
    for (const [k, t] of nTx.entries()) {
      const prev = oTx.get(k);
      if (!prev) {
        push({
          ...unitRow(key, o, n),
          change_type: 'NEW_TX',
          category:    'tx',
          old_value:   '',
          new_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          detail:      'new transaction recorded'
        });
      } else if (Math.abs((prev.amount_aed || 0) - (t.amount_aed || 0)) > 0.5) {
        const diff    = (t.amount_aed || 0) - (prev.amount_aed || 0);
        const sign    = diff > 0 ? '+' : '-';
        const pct     = prev.amount_aed ? (diff / prev.amount_aed) * 100 : null;
        const pctStr  = pct != null ? ` (${diff > 0 ? '+' : ''}${pct.toFixed(2)}%)` : '';
        push({
          ...unitRow(key, o, n),
          change_type: 'AMOUNT_CHANGED',
          category:    'tx',
          old_value:   fmtMoney(prev.amount_aed),
          new_value:   fmtMoney(t.amount_aed),
          detail:      `${t.tx_type} ${t.tx_date || ''}: ${sign}${Math.abs(diff).toLocaleString()} AED${pctStr}`
        });
      }
    }
    for (const [k, t] of oTx.entries()) {
      if (!nTx.has(k)) {
        push({
          ...unitRow(key, o, n),
          change_type: 'MISSING_TX',
          category:    'tx',
          old_value:   `${t.tx_type} · ${t.tx_date || ''} · ${fmtMoney(t.amount_aed)} AED · ${t.party_name || ''}`,
          new_value:   '',
          detail:      'transaction not present in latest snapshot (may be out of report scope)'
        });
      }
    }
  }

  let hiddenUnits = 0;
  let hiddenTxs = 0;
  let outRows = rows;
  if (!includeMissing) {
    outRows = [];
    for (const r of rows) {
      if (r.change_type === 'MISSING_UNIT') { hiddenUnits++; continue; }
      if (r.change_type === 'MISSING_TX')   { hiddenTxs++;   continue; }
      outRows.push(r);
    }
  }

  return {
    project,
    status: 'ok',
    oldSnapshot: oldSnap,
    newSnapshot: newSnap,
    rows: outRows,
    hiddenMissingCount: { units: hiddenUnits, txs: hiddenTxs }
  };
}

function summarizeDiff(rows) {
  const counts = {};
  for (const r of rows) counts[r.change_type] = (counts[r.change_type] || 0) + 1;
  return counts;
}

function writeDiffCsv(outPath, result) {
  if (!result.rows || result.rows.length === 0) {
    fs.writeFileSync(outPath, 'unit_number,change_type,old_value,new_value,detail\r\n', 'utf8');
    return;
  }
  const header = ['unit_number','unit_type','dld_unit_id','building','change_type','category','old_value','new_value','detail'];
  writeCsv(outPath, header, result.rows);
}

const CHANGE_CLASS = {
  NEW_UNIT:         'ok',
  NEW_TX:           'ok',
  MISSING_UNIT:     'warn',
  MISSING_TX:       'warn',
  AMOUNT_CHANGED:   'amt',
  UNIT_TYPE_CHANGED:'dld',
  AREA_CHANGED:     'dld'
};

function writeDiffHtml(outPath, result, counts) {
  const project = result.project;
  const total   = result.rows.length;
  const oldDate = result.oldSnapshot.snapshot_date + ' (' + result.oldSnapshot.source_format + ')';
  const newDate = result.newSnapshot.snapshot_date + ' (' + result.newSnapshot.source_format + ')';
  const oldFile = result.oldSnapshot.source_file;
  const newFile = result.newSnapshot.source_file;

  const columns = [
    { key: 'unit_number',  label: 'Unit',     align: 'left' },
    { key: 'unit_type',    label: 'Type',     align: 'left' },
    { key: 'building',     label: 'Building', align: 'left' },
    { key: 'change_type',  label: 'Change',   align: 'left' },
    { key: 'category',     label: 'Scope',    align: 'left' },
    { key: 'old_value',    label: 'Was',      align: 'left' },
    { key: 'new_value',    label: 'Now',      align: 'left' },
    { key: 'detail',       label: 'Detail',   align: 'left' }
  ];

  const renderCell = (col, r) => {
    const raw = r[col.key];
    let html  = escHtml(raw);
    const cls = [];
    if (col.align === 'num') cls.push('num');
    if (col.key === 'change_type') {
      html = `<span class="badge ${CHANGE_CLASS[raw] || ''}">${escHtml(raw)}</span>`;
    }
    return `<td class="${cls.join(' ')}" data-sort-val="${escHtml(raw == null ? '' : String(raw))}">${html}</td>`;
  };

  const renderRow = r => {
    const searchText = columns.map(c => r[c.key] == null ? '' : String(r[c.key])).join(' ').toLowerCase();
    const klass = CHANGE_CLASS[r.change_type] || '';
    return `<tr class="${klass}" data-change="${escHtml(r.change_type)}" data-search="${escHtml(searchText)}">` +
      columns.map(c => renderCell(c, r)).join('') + '</tr>';
  };

  const headHtml = columns
    .map((c, i) => `<th data-col="${i}" data-align="${c.align}">${escHtml(c.label)}</th>`).join('');
  const bodyHtml = result.rows.map(renderRow).join('\n');

  const knownChanges = ['NEW_UNIT','NEW_TX','AMOUNT_CHANGED','MISSING_UNIT','MISSING_TX','UNIT_TYPE_CHANGED','AREA_CHANGED'];
  const chipsHtml = knownChanges.map(ct => {
    const count = counts[ct] || 0;
    const cls = CHANGE_CLASS[ct] || '';
    return `<span class="chip ${cls}" data-change="${ct}">${ct.replace(/_/g,' ')} ${count}</span>`;
  }).join('');

  const empty = total === 0 ? `<div class="empty">No changes between the two snapshots. DLD data is identical.</div>` : '';
  const generatedAt = new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(project.project_name)} — Month-over-Month Changes</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:20px 24px;background:#0b0f14;color:#e6e6e6}
  h1{margin:0 0 4px;color:#fff;font-size:22px}
  .meta{color:#888;margin-bottom:14px;font-size:12px}
  .meta b{color:#ccc}
  .snaps{display:flex;gap:18px;margin:6px 0 14px;font-size:12px;color:#aaa}
  .snap{padding:8px 12px;border:1px solid #1b2028;border-radius:6px;background:#0d1218}
  .snap b{color:#fff}
  .arrow{color:#555;font-size:20px;align-self:center}
  .controls{display:flex;gap:8px;margin:12px 0;align-items:center;flex-wrap:wrap}
  .search{background:#0f141b;color:#fff;border:1px solid #222;padding:8px 12px;border-radius:6px;min-width:320px;font:inherit;outline:none}
  .search:focus{border-color:#3ea1ff;box-shadow:0 0 0 2px rgba(62,161,255,.18)}
  .chip{padding:6px 10px;border-radius:20px;font-weight:600;cursor:pointer;transition:filter .15s,opacity .15s;user-select:none;font-size:11px}
  .chip:hover{filter:brightness(1.25)}
  .chip.off{opacity:.28;filter:grayscale(.4)}
  .chip.ok{background:#0d3a1d;color:#4ce38e}
  .chip.warn{background:#3a2a0d;color:#ffcc55}
  .chip.dld{background:#0d2d3a;color:#5ad4ff}
  .chip.amt{background:#2d0d3a;color:#d88eff}
  .count{color:#888;margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px}
  .count b{color:#fff}
  .btn-reset{background:#11161d;color:#aaa;border:1px solid #222;padding:6px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px}
  .btn-reset:hover{color:#fff;border-color:#333}
  .table-wrap{overflow-x:auto;border:1px solid #1b2028;border-radius:8px;background:#0d1218}
  table{width:100%;border-collapse:collapse;font-size:12px;min-width:1100px}
  thead th{background:#11161d;color:#aaa;font-weight:600;text-align:left;padding:8px 10px;border-bottom:2px solid #1f252e;cursor:pointer;position:sticky;top:0;user-select:none;white-space:nowrap}
  thead th:hover{color:#fff;background:#151b24}
  thead th.sort-asc::after{content:"  ↑";color:#4ce38e}
  thead th.sort-desc::after{content:"  ↓";color:#ffcc55}
  tbody td{padding:6px 10px;border-bottom:1px solid #1a1f27;vertical-align:top}
  tbody tr.ok td{background:rgba(76,227,142,.05)}
  tbody tr.warn td{background:rgba(255,204,85,.06)}
  tbody tr.dld td{background:rgba(90,212,255,.05)}
  tbody tr.amt td{background:rgba(216,142,255,.05)}
  tbody tr:hover td{background:#151b24 !important}
  tbody tr.hidden{display:none}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge.ok{background:#0d3a1d;color:#4ce38e}
  .badge.warn{background:#3a2a0d;color:#ffcc55}
  .badge.dld{background:#0d2d3a;color:#5ad4ff}
  .badge.amt{background:#2d0d3a;color:#d88eff}
  .empty{color:#777;padding:40px;text-align:center;border:1px dashed #1f252e;border-radius:8px;background:#0d1218}
  footer{margin-top:14px;color:#555;font-size:11px;text-align:right}
</style>
</head>
<body>
<h1>${escHtml(project.project_name)} — Month-over-Month Diff</h1>
<div class="meta">${total.toLocaleString()} change row(s) detected between snapshots</div>
<div class="snaps">
  <div class="snap">PREVIOUS<br><b>${escHtml(oldDate)}</b><br><small>${escHtml(oldFile)}</small></div>
  <div class="arrow">→</div>
  <div class="snap">LATEST<br><b>${escHtml(newDate)}</b><br><small>${escHtml(newFile)}</small></div>
</div>
<div class="controls">
  <input class="search" id="q" placeholder="Filter: unit, change, any text…" autocomplete="off">
  ${chipsHtml}
  <button class="btn-reset" id="reset">Reset</button>
  <span class="count" id="count">— rows</span>
</div>
${empty}
${total === 0 ? '' : `<div class="table-wrap">
<table id="tbl">
<thead><tr>${headHtml}</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div>`}
<footer>generated ${escHtml(generatedAt)} · click headers to sort · click chips to toggle change types</footer>
<script>
(function(){
  const tbl = document.getElementById('tbl');
  if (!tbl) return;
  const tbody   = tbl.querySelector('tbody');
  const q       = document.getElementById('q');
  const chips   = [...document.querySelectorAll('.chip')];
  const headers = [...tbl.querySelectorAll('thead th')];
  const countEl = document.getElementById('count');
  const reset   = document.getElementById('reset');
  const rows    = [...tbody.querySelectorAll('tr')];
  const active  = new Set(chips.map(c => c.dataset.change));
  let sortCol=null, sortDir=1;
  function applyFilter(){
    const needle = q.value.trim().toLowerCase();
    let v = 0;
    for (const tr of rows) {
      const on = active.has(tr.dataset.change) && (!needle || tr.dataset.search.indexOf(needle) !== -1);
      tr.classList.toggle('hidden', !on);
      if (on) v++;
    }
    countEl.innerHTML = '<b>' + v.toLocaleString() + '</b> / ' + rows.length.toLocaleString() + ' rows';
  }
  chips.forEach(ch => ch.addEventListener('click', () => {
    const s = ch.dataset.change;
    if (active.has(s)) { active.delete(s); ch.classList.add('off'); }
    else               { active.add(s);    ch.classList.remove('off'); }
    applyFilter();
  }));
  q.addEventListener('input', applyFilter);
  reset.addEventListener('click', () => {
    q.value='';
    chips.forEach(c => { active.add(c.dataset.change); c.classList.remove('off'); });
    sortCol=null; sortDir=1;
    headers.forEach(h => h.classList.remove('sort-asc','sort-desc'));
    for (const r of rows) tbody.appendChild(r);
    applyFilter();
  });
  headers.forEach((th, i) => th.addEventListener('click', () => {
    if (sortCol === i) sortDir = -sortDir;
    else { sortCol = i; sortDir = 1; }
    headers.forEach(h => h.classList.remove('sort-asc','sort-desc'));
    th.classList.add(sortDir===1 ? 'sort-asc' : 'sort-desc');
    const sorted = rows.slice().sort((a,b) => {
      const av = a.children[i].dataset.sortVal || a.children[i].textContent;
      const bv = b.children[i].dataset.sortVal || b.children[i].textContent;
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn) && isFinite(an) && isFinite(bn)) return (an-bn)*sortDir;
      return av.localeCompare(bv, undefined, {numeric:true}) * sortDir;
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

module.exports = { diffProject, summarizeDiff, writeDiffCsv, writeDiffHtml, pickBaseline };
