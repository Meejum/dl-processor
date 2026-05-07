const fs = require('fs');
const { SOBHA_STYLE_CSS, brandBar, escHtml } = require('./html-styles');

const FIELD_LABEL = {
  buyer_name: 'buyer',
  purchase_price_aed: 'price',
  status: 'status',
  procedure_number: 'procedure',
  area_sqm: 'area'
};

function isNumericField(f) {
  return f === 'purchase_price_aed' || f === 'area_sqm';
}

function deltaPct(oldStr, newStr) {
  const o = Number(oldStr);
  const n = Number(newStr);
  if (!isFinite(o) || !isFinite(n) || o === 0) return null;
  return Math.abs((n - o) / o) * 100;
}

function deltaClass(field, dPct, tolerances) {
  if (dPct == null) return '';
  let tol = null;
  if (field === 'purchase_price_aed') tol = tolerances.price_tolerance_pct;
  else if (field === 'area_sqm')      tol = tolerances.area_tolerance_pct;
  if (tol != null && dPct <= tol) return 'delta-green';
  if (dPct <= 5) return 'delta-amber';
  return 'delta-red';
}

function fieldBreakdown(rows) {
  const counts = { buyer: 0, price: 0, status: 0, procedure: 0, area: 0 };
  for (const r of rows) {
    const k = FIELD_LABEL[r.field_name];
    if (k) counts[k] += 1;
  }
  return counts.buyer + ' buyer · ' + counts.price + ' price · ' + counts.status + ' status · ' + counts.procedure + ' procedure · ' + counts.area + ' area';
}

function projectBreakdown(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.project_name, (m.get(r.project_name) || 0) + 1);
  return Array.from(m, ([name, n]) => escHtml(name) + ': ' + n).join(' · ');
}

function safeJsonForScriptTag(value) {
  // JSON.stringify doesn't escape '</script>'; we must, so the inlined data
  // can't break out of the surrounding <script>...</script> block.
  return JSON.stringify(value).replace(/<\/(script)/gi, '<\\/$1');
}

function renderRow(r, tolerances) {
  const isNum = isNumericField(r.field_name);
  const dPct  = isNum ? deltaPct(r.old_value, r.proposed_value) : null;
  const dCls  = deltaClass(r.field_name, dPct, tolerances);
  const dPctText = dPct == null ? '' : (Math.round(dPct * 100) / 100).toFixed(2) + '%';
  const dPctSort = dPct == null ? '' : String(Math.round(dPct * 100) / 100);
  return [
    '<tr data-change-id="' + r.change_id + '" data-field="' + escHtml(r.field_name) + '" data-numeric="' + (isNum ? '1' : '0') + '" data-delta-pct="' + (dPct == null ? '' : dPct) + '">',
    '<td>' + escHtml(r.project_name || '') + '</td>',
    '<td>' + escHtml(r.unit_number_norm || '') + '</td>',
    '<td>' + escHtml(FIELD_LABEL[r.field_name] || r.field_name) + '</td>',
    '<td class="diff ' + dCls + '"><span class="old">' + escHtml(r.old_value || '') + '</span> → <span class="new">' + escHtml(r.proposed_value || '') + '</span></td>',
    '<td class="num" data-sort-val="' + dPctSort + '">' + dPctText + '</td>',
    '<td>' + escHtml(r.proposed_at || '') + '</td>',
    '<td>' + escHtml(r.source_snapshot_date || '') + '</td>',
    '<td class="decision">',
      '<button type="button" class="seg seg-approve" data-action="approve">Approve</button>',
      '<button type="button" class="seg seg-reject"  data-action="reject">Reject</button>',
      '<button type="button" class="seg seg-skip is-active" data-action="skip">Skip</button>',
    '</td>',
    '<td><input type="text" class="notes-input" placeholder="optional"></td>',
    '</tr>'
  ].join('');
}

const APPROVE_CSS = `
  .approve-page{max-width:1400px;margin:0 auto;padding:16px}
  .approve-page h1{font-weight:600;margin:6px 0 12px}
  .header.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:12px}
  .header .counts{font-size:14px;color:var(--ink-2)}
  .header .counts .big{font-size:18px;font-weight:600;color:var(--ink);margin-right:8px}
  .header .counts .sep{margin:0 8px;color:var(--muted)}
  .header .byproj{margin-top:6px;color:var(--ink-2);font-size:13px}
  .header .tolerances{margin-top:4px;font-size:12px}
  .toolbar.sticky{position:sticky;top:0;z-index:10;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .toolbar button{background:var(--surface);border:1px solid var(--border-2);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--ink)}
  .toolbar button:hover{background:var(--accent-soft)}
  .toolbar button.primary{margin-left:auto;background:var(--accent);color:#fff;border-color:var(--accent-dark)}
  .toolbar .counter{margin-left:8px;color:var(--ink-2);font-size:13px}
  .toolbar .sep{flex:0 0 1px;height:20px;background:var(--border);margin:0 4px}
  table.approve{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
  table.approve th,table.approve td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:top}
  table.approve th{background:var(--surface-2);text-align:left;cursor:pointer;user-select:none}
  table.approve td.num{text-align:right;font-variant-numeric:tabular-nums}
  table.approve td.diff .old{color:var(--ink-2)}
  table.approve td.diff .new{font-weight:600}
  table.approve td.diff.delta-green .new{color:var(--up);background:var(--up-bg);padding:0 4px;border-radius:3px}
  table.approve td.diff.delta-amber .new{color:var(--warn);background:var(--warn-bg);padding:0 4px;border-radius:3px}
  table.approve td.diff.delta-red   .new{color:var(--down);background:var(--down-bg);padding:0 4px;border-radius:3px}
  td.decision{white-space:nowrap}
  td.decision .seg{background:var(--surface);border:1px solid var(--border);padding:3px 8px;font-size:12px;cursor:pointer}
  td.decision .seg:first-child{border-radius:4px 0 0 4px}
  td.decision .seg:last-child{border-radius:0 4px 4px 0;border-left-width:0}
  td.decision .seg + .seg{border-left-width:0}
  td.decision .seg.is-active.seg-approve{background:var(--up-bg);color:var(--up)}
  td.decision .seg.is-active.seg-reject{background:var(--down-bg);color:var(--down)}
  td.decision .seg.is-active.seg-skip{background:var(--accent-soft);color:var(--accent-dark)}
  .notes-input{width:100%;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font:inherit;background:var(--surface)}
  .muted{color:var(--muted)}
`;

const APPROVE_JS = `
(function(){
  var data = window.__APPROVE_DATA__ || [];
  var TOL  = window.__TOLERANCES__ || { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };
  var state = {};
  data.forEach(function(r){ state[r.change_id] = { decision: 'skip', notes: '' }; });

  function setDecision(changeId, decision){
    if (!state[changeId]) return;
    state[changeId].decision = decision;
    var row = document.querySelector('tr[data-change-id="' + changeId + '"]');
    if (!row) return;
    row.querySelectorAll('.seg').forEach(function(b){ b.classList.toggle('is-active', b.getAttribute('data-action') === decision); });
    refreshCounter();
  }

  function refreshCounter(){
    var a = 0, r = 0, s = 0;
    Object.keys(state).forEach(function(k){
      if (state[k].decision === 'approve') a++;
      else if (state[k].decision === 'reject') r++;
      else s++;
    });
    document.getElementById('counter-approved').textContent = a;
    document.getElementById('counter-rejected').textContent = r;
    document.getElementById('counter-skipped').textContent  = s;
  }

  document.querySelectorAll('tr[data-change-id]').forEach(function(row){
    var id = row.getAttribute('data-change-id');
    row.querySelectorAll('.seg').forEach(function(btn){
      btn.addEventListener('click', function(){ setDecision(id, btn.getAttribute('data-action')); });
    });
    var notesInp = row.querySelector('.notes-input');
    if (notesInp) notesInp.addEventListener('input', function(){ state[id].notes = notesInp.value; });
  });

  function applyAll(predicate, decision){
    data.forEach(function(r){
      if (predicate(r)) setDecision(r.change_id, decision);
    });
  }
  document.getElementById('btn-approve-all').addEventListener('click', function(){ applyAll(function(){ return true; }, 'approve'); });
  document.getElementById('btn-approve-within-tolerance').addEventListener('click', function(){
    applyAll(function(r){
      var row = document.querySelector('tr[data-change-id="' + r.change_id + '"]');
      var d = row ? parseFloat(row.getAttribute('data-delta-pct')) : NaN;
      if (isNaN(d)) return false;
      var tol = r.field_name === 'purchase_price_aed' ? TOL.price_tolerance_pct
              : r.field_name === 'area_sqm'           ? TOL.area_tolerance_pct
              : null;
      return tol != null && d <= tol;
    }, 'approve');
  });
  document.getElementById('btn-approve-field-price').addEventListener('click', function(){
    applyAll(function(r){ return r.field_name === 'purchase_price_aed'; }, 'approve');
  });
  document.getElementById('btn-reject-field-buyer').addEventListener('click', function(){
    applyAll(function(r){ return r.field_name === 'buyer_name'; }, 'reject');
  });
  document.getElementById('btn-reset-skip').addEventListener('click', function(){
    applyAll(function(){ return true; }, 'skip');
  });

  var tbody = document.querySelector('table.approve tbody');
  document.querySelectorAll('table.approve thead th[data-sort]').forEach(function(th, idx){
    var asc = true;
    th.addEventListener('click', function(){
      var rows = Array.from(tbody.querySelectorAll('tr'));
      var mode = th.getAttribute('data-sort');
      rows.sort(function(a, b){
        var av, bv;
        if (mode === 'num') {
          var sa = a.children[idx].getAttribute('data-sort-val');
          var sb = b.children[idx].getAttribute('data-sort-val');
          av = sa === '' || sa == null ? -Infinity : parseFloat(sa);
          bv = sb === '' || sb == null ? -Infinity : parseFloat(sb);
        } else {
          av = a.children[idx].textContent.toLowerCase();
          bv = b.children[idx].textContent.toLowerCase();
        }
        return av < bv ? (asc ? -1 : 1) : av > bv ? (asc ? 1 : -1) : 0;
      });
      asc = !asc;
      rows.forEach(function(r){ tbody.appendChild(r); });
    });
  });

  function csvEsc(v){ var s = v == null ? '' : String(v); return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  document.getElementById('btn-export-decisions').addEventListener('click', function(){
    var FIELD_DISPLAY = { buyer_name:'buyer', purchase_price_aed:'price', status:'status', procedure_number:'procedure', area_sqm:'area' };
    var lines = ['change_id,project_name,unit,field,old_value,proposed_value,source_snapshot_date,proposed_at,decision,notes'];
    data.forEach(function(r){
      var d = state[r.change_id];
      if (!d || d.decision === 'skip') return;
      lines.push([
        r.change_id, r.project_name, r.unit_number_norm,
        FIELD_DISPLAY[r.field_name] || r.field_name,
        r.old_value, r.proposed_value, r.source_snapshot_date, r.proposed_at,
        d.decision === 'approve' ? 'approve' : 'reject',
        d.notes || ''
      ].map(csvEsc).join(','));
    });
    var blob = new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'pending-changes.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById('btn-save-draft').addEventListener('click', function(){
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'approve-pending-draft.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });
  var fileInput = document.getElementById('file-load-draft');
  document.getElementById('btn-load-draft').addEventListener('click', function(){ fileInput.click(); });
  fileInput.addEventListener('change', function(ev){
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var obj = JSON.parse(reader.result);
        Object.keys(obj).forEach(function(id){
          if (state[id]) {
            setDecision(id, obj[id].decision || 'skip');
            state[id].notes = obj[id].notes || '';
            var row = document.querySelector('tr[data-change-id="' + id + '"]');
            var inp = row && row.querySelector('.notes-input');
            if (inp) inp.value = state[id].notes;
          }
        });
      } catch (e) { alert('Invalid draft file: ' + e.message); }
    };
    reader.readAsText(f);
  });

  refreshCounter();
})();
`;

function generateApproveHtml(pendingRows, tolerances, outPath) {
  const rows = Array.isArray(pendingRows) ? pendingRows : [];
  const total = rows.length;
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const head =
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<title>Approve Pending Master-Data Changes</title>' +
    '<style>' + SOBHA_STYLE_CSS + APPROVE_CSS + '</style>' +
    '</head><body>' + brandBar(stamp);

  if (total === 0) {
    const empty =
      '<main class="approve-page">' +
      '<h1>Approve Pending Master-Data Changes</h1>' +
      '<p class="muted">No pending changes.</p>' +
      '</main></body></html>';
    fs.writeFileSync(outPath, head + empty, 'utf8');
    return;
  }

  const headerCard =
    '<section class="card header">' +
      '<h1>Approve Pending Master-Data Changes</h1>' +
      '<div class="counts">' +
        '<span class="big">' + total + ' pending</span>' +
        '<span class="sep">·</span>' +
        '<span>' + escHtml(fieldBreakdown(rows)) + '</span>' +
      '</div>' +
      '<div class="byproj">' + projectBreakdown(rows) + '</div>' +
      '<div class="tolerances muted">tolerance: price ' + tolerances.price_tolerance_pct + '% · area ' + tolerances.area_tolerance_pct + '%</div>' +
    '</section>';

  const toolbar =
    '<div class="toolbar sticky">' +
      '<button id="btn-approve-all" type="button">Approve all</button>' +
      '<button id="btn-approve-within-tolerance" type="button">Approve all where Δ&lt;tolerance</button>' +
      '<button id="btn-approve-field-price" type="button">Approve all where field=price</button>' +
      '<button id="btn-reject-field-buyer" type="button">Reject all where field=buyer</button>' +
      '<button id="btn-reset-skip" type="button">Reset to skip</button>' +
      '<span class="sep"></span>' +
      '<button id="btn-save-draft" type="button">Save draft</button>' +
      '<button id="btn-load-draft" type="button">Load draft</button>' +
      '<input id="file-load-draft" type="file" accept=".json" style="display:none">' +
      '<span class="counter">' +
        'Approved: <span id="counter-approved">0</span> · ' +
        'Rejected: <span id="counter-rejected">0</span> · ' +
        'Skipped: <span id="counter-skipped">' + total + '</span>' +
      '</span>' +
      '<button id="btn-export-decisions" type="button" class="primary">Export decisions</button>' +
    '</div>';

  const tableHead =
    '<table class="approve"><thead><tr>' +
      '<th data-sort="text">Project</th>' +
      '<th data-sort="text">Unit</th>' +
      '<th data-sort="text">Field</th>' +
      '<th>Old → Proposed</th>' +
      '<th data-sort="num">Δ%</th>' +
      '<th data-sort="text">Proposed at</th>' +
      '<th data-sort="text">Source snapshot</th>' +
      '<th>Decision</th>' +
      '<th>Notes</th>' +
    '</tr></thead><tbody>';

  const body = rows.map(r => renderRow(r, tolerances)).join('');
  const tableEnd = '</tbody></table>';

  const dataRows = rows.map(r => ({
    change_id: r.change_id,
    project_name: r.project_name,
    unit_number_norm: r.unit_number_norm,
    field_name: r.field_name,
    old_value: r.old_value == null ? '' : String(r.old_value),
    proposed_value: r.proposed_value == null ? '' : String(r.proposed_value),
    source_snapshot_date: r.source_snapshot_date || '',
    proposed_at: r.proposed_at || ''
  }));

  const dataScript = '<script>window.__APPROVE_DATA__ = ' + safeJsonForScriptTag(dataRows) + ';' +
                     'window.__TOLERANCES__ = ' + safeJsonForScriptTag(tolerances) + ';</script>';

  fs.writeFileSync(
    outPath,
    head +
      '<main class="approve-page">' + headerCard + toolbar + tableHead + body + tableEnd + '</main>' +
      dataScript +
      '<script>' + APPROVE_JS + '</script>' +
    '</body></html>',
    'utf8'
  );
}

module.exports = { generateApproveHtml };
