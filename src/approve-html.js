const fs = require('fs');
const { SOBHA_STYLE_CSS, brandBar, escHtml } = require('./html-styles');

const FIELD_LABEL = {
  buyer_name: 'buyer',
  purchase_price_aed: 'price',
  status: 'status',
  procedure_number: 'procedure',
  area_sqm: 'area'
};

const SECTIONS = [
  { id: 'buyer', title: 'Buyer', fields: ['buyer_name'] },
  { id: 'price', title: 'Price', fields: ['purchase_price_aed'] },
  { id: 'area',  title: 'Area',  fields: ['area_sqm'] },
  { id: 'other', title: 'Other', fields: ['status', 'procedure_number'] }
];

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

function safeJsonForScriptTag(value) {
  return JSON.stringify(value).replace(/<\/(script)/gi, '<\\/$1');
}

function fieldBreakdown(rows) {
  const counts = { buyer: 0, price: 0, status: 0, procedure: 0, area: 0 };
  for (const r of rows) {
    const k = FIELD_LABEL[r.field_name];
    if (k) counts[k] += 1;
  }
  return [
    '<a class="count-link" data-target="buyer" href="#section-buyer">' + counts.buyer + ' buyer</a>',
    '<a class="count-link" data-target="price" href="#section-price">' + counts.price + ' price</a>',
    '<a class="count-link" data-target="area"  href="#section-area">'  + counts.area  + ' area</a>',
    '<a class="count-link" data-target="other" href="#section-other">' + (counts.status + counts.procedure) + ' other</a>'
  ].join(' · ');
}

function projectBreakdown(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.project_name, (m.get(r.project_name) || 0) + 1);
  return Array.from(m, ([name, n]) => escHtml(name) + ': ' + n).join(' · ');
}

function rowsForSection(rows, section) {
  return rows.filter(r => section.fields.includes(r.field_name));
}

function groupByProject(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.project_name)) m.set(r.project_name, []);
    m.get(r.project_name).push(r);
  }
  return Array.from(m.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, projRows]) => ({
      name,
      rows: projRows.sort((a, b) => String(a.unit_number_norm || '').localeCompare(String(b.unit_number_norm || '')))
    }));
}

function renderSfUnit(r) {
  if (r.sf_unit) return '<span class="sf-unit">' + escHtml(String(r.sf_unit)) + '</span>';
  return '<span class="sf-unit dld-only">' + escHtml(String(r.unit_number_norm || '')) + ' <span class="pill pill-dld">[DLD only]</span></span>';
}

function renderRow(r, tolerances) {
  const isNum = isNumericField(r.field_name);
  const dPct  = isNum ? deltaPct(r.old_value, r.proposed_value) : null;
  const dCls  = deltaClass(r.field_name, dPct, tolerances);
  const dPctText = dPct == null ? '' : (Math.round(dPct * 100) / 100).toFixed(2) + '%';
  const dPctSort = dPct == null ? '' : String(Math.round(dPct * 100) / 100);
  const inputType = isNum ? 'number' : 'text';
  const inputStep = isNum ? ' step="any"' : '';
  const proposedRaw = r.proposed_value == null ? '' : String(r.proposed_value);
  return [
    '<tr data-change-id="' + r.change_id + '" data-field="' + escHtml(r.field_name) + '" data-numeric="' + (isNum ? '1' : '0') + '" data-delta-pct="' + (dPct == null ? '' : dPct) + '" data-sf-unit="' + escHtml(r.sf_unit == null ? '' : String(r.sf_unit)) + '">',
    '<td class="col-project">' + escHtml(r.project_name || '') + '</td>',
    '<td class="col-sfunit">' + renderSfUnit(r) + '</td>',
    '<td class="col-field">' + escHtml(FIELD_LABEL[r.field_name] || r.field_name) + '</td>',
    '<td class="col-diff diff ' + dCls + '">',
      '<span class="old">' + escHtml(r.old_value == null ? '' : String(r.old_value)) + '</span>',
      ' → ',
      '<input class="proposed-input" type="' + inputType + '"' + inputStep + ' data-original="' + escHtml(proposedRaw) + '" value="' + escHtml(proposedRaw) + '">',
      isNum ? ' <span class="dpct num" data-sort-val="' + dPctSort + '">' + dPctText + '</span>' : '',
    '</td>',
    '<td class="col-buyer">' + escHtml(r.current_buyer == null ? '' : String(r.current_buyer)) + '</td>',
    '<td class="col-decision">',
      '<button type="button" class="seg seg-approve" data-action="approve">Approve</button>',
      '<button type="button" class="seg seg-reject"  data-action="reject">Reject</button>',
      '<button type="button" class="seg seg-skip is-active" data-action="skip">Skip</button>',
    '</td>',
    '<td class="col-notes"><input type="text" class="notes-input" placeholder="optional"></td>',
    '</tr>'
  ].join('');
}

function renderSection(section, rows, tolerances) {
  const sectionRows = rowsForSection(rows, section);
  if (sectionRows.length === 0) {
    return '<section class="approve-section" id="section-' + section.id + '" data-section="' + section.id + '">' +
             '<h2 class="section-title" data-toggle="' + section.id + '">' +
               '<span class="caret">▶</span> ' + escHtml(section.title) + ' — 0 pending' +
             '</h2>' +
             '<div class="section-body" id="section-body-' + section.id + '" hidden>' +
               '<p class="muted">No pending changes in this category.</p>' +
             '</div>' +
           '</section>';
  }
  const groups = groupByProject(sectionRows);
  const tableHead =
    '<table class="approve"><thead><tr>' +
      '<th>Project</th>' +
      '<th>SF Unit</th>' +
      '<th>Field</th>' +
      '<th>Old → Proposed</th>' +
      '<th>Current Buyer</th>' +
      '<th>Decision</th>' +
      '<th>Notes</th>' +
    '</tr></thead><tbody>';
  const body = groups.map(g =>
    '<tr><td class="group-header" colspan="7">' + escHtml(g.name) + ' — ' + g.rows.length + ' pending</td></tr>' +
    g.rows.map(r => renderRow(r, tolerances)).join('')
  ).join('');
  return '<section class="approve-section" id="section-' + section.id + '" data-section="' + section.id + '">' +
           '<h2 class="section-title" data-toggle="' + section.id + '">' +
             '<span class="caret">▶</span> ' + escHtml(section.title) + ' — ' + sectionRows.length + ' pending' +
           '</h2>' +
           '<div class="section-body" id="section-body-' + section.id + '" hidden>' +
             tableHead + body + '</tbody></table>' +
           '</div>' +
         '</section>';
}

const APPROVE_CSS = `
  .approve-page{max-width:1500px;margin:0 auto;padding:16px}
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
  .approve-section{margin-top:16px}
  .section-title{font-size:15px;font-weight:700;color:var(--ink);border-bottom:2px solid var(--accent-soft);padding-bottom:4px;margin:0 0 6px 0;cursor:pointer;user-select:none}
  .section-title .caret{display:inline-block;transition:transform .15s;font-size:11px;color:var(--muted);margin-right:4px}
  .approve-section.is-open .section-title .caret{transform:rotate(90deg)}
  .count-link{color:var(--accent-dark);text-decoration:none;border-bottom:1px dotted var(--border-2)}
  .count-link:hover{color:var(--accent);border-bottom-color:var(--accent)}
  table.approve{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
  table.approve th,table.approve td{padding:6px 10px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:top}
  table.approve th{background:var(--surface-2);text-align:left;font-weight:600}
  td.group-header{background:var(--surface-2);font-weight:600;color:var(--ink-2);font-size:12px;letter-spacing:.02em;padding:4px 10px}
  td.col-diff .old{color:var(--ink-2);background:var(--surface-2);padding:0 4px;border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  td.col-diff input.proposed-input{font:inherit;background:var(--surface);border:1px solid var(--border);padding:2px 6px;border-radius:3px;min-width:90px;box-shadow:0 1px 3px rgba(0,0,0,.18), inset 0 -2px 0 rgba(0,0,0,.06)}
  td.col-diff input.proposed-input:focus{outline:2px solid var(--accent);outline-offset:1px}
  td.col-diff.delta-green input.proposed-input{background:var(--up-bg);color:var(--up)}
  td.col-diff.delta-amber input.proposed-input{background:var(--warn-bg);color:var(--warn)}
  td.col-diff.delta-red   input.proposed-input{background:var(--down-bg);color:var(--down)}
  td.col-diff .dpct{margin-left:6px;color:var(--muted);font-size:12px}
  tr.is-overridden{background:#FFFBE6}
  .pill{display:inline-block;padding:0 6px;border-radius:8px;font-size:11px;line-height:16px}
  .pill-dld{background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
  .pill-override{background:var(--warn-bg);color:var(--warn);border:1px solid var(--border-2);margin-left:6px}
  td.col-decision{white-space:nowrap}
  td.col-decision .seg{background:var(--surface);border:1px solid var(--border);padding:3px 8px;font-size:12px;cursor:pointer}
  td.col-decision .seg:first-child{border-radius:4px 0 0 4px}
  td.col-decision .seg:last-child{border-radius:0 4px 4px 0;border-left-width:0}
  td.col-decision .seg + .seg{border-left-width:0}
  td.col-decision .seg.is-active.seg-approve{background:var(--up-bg);color:var(--up)}
  td.col-decision .seg.is-active.seg-reject{background:var(--down-bg);color:var(--down)}
  td.col-decision .seg.is-active.seg-skip{background:var(--accent-soft);color:var(--accent-dark)}
  .notes-input{width:100%;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font:inherit;background:var(--surface)}
  .muted{color:var(--muted)}
`;

const APPROVE_JS = `
(function(){
  var data = window.__APPROVE_DATA__ || [];
  var TOL  = window.__TOLERANCES__ || { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };
  var state = {};
  data.forEach(function(r){ state[r.change_id] = { decision: 'skip', notes: '', applied: r.proposed_value }; });

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

  function refreshOverrideStyling(row, changeId){
    var input = row.querySelector('.proposed-input');
    if (!input) return;
    var orig = input.getAttribute('data-original') || '';
    var cur  = input.value;
    var overridden = cur !== orig;
    row.classList.toggle('is-overridden', overridden);
    state[changeId].applied = cur;
    var approveBtn = row.querySelector('.seg-approve');
    if (approveBtn) approveBtn.textContent = overridden ? 'Approve with override' : 'Approve';
  }

  document.querySelectorAll('tr[data-change-id]').forEach(function(row){
    var id = row.getAttribute('data-change-id');
    row.querySelectorAll('.seg').forEach(function(btn){
      btn.addEventListener('click', function(){ setDecision(id, btn.getAttribute('data-action')); });
    });
    var notesInp = row.querySelector('.notes-input');
    if (notesInp) notesInp.addEventListener('input', function(){ state[id].notes = notesInp.value; });
    var propInp = row.querySelector('.proposed-input');
    if (propInp) propInp.addEventListener('input', function(){ refreshOverrideStyling(row, id); });
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
  document.getElementById('btn-reset-skip').addEventListener('click', function(){
    applyAll(function(){ return true; }, 'skip');
  });

  function csvEsc(v){ var s = v == null ? '' : String(v); return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  document.getElementById('btn-export-decisions').addEventListener('click', function(){
    var FIELD_DISPLAY = { buyer_name:'buyer', purchase_price_aed:'price', status:'status', procedure_number:'procedure', area_sqm:'area' };
    var lines = ['change_id,project_name,unit,field,old_value,proposed_value,applied_value,source_snapshot_date,proposed_at,decision,notes'];
    data.forEach(function(r){
      var d = state[r.change_id];
      if (!d || d.decision === 'skip') return;
      lines.push([
        r.change_id, r.project_name, r.unit_number_norm,
        FIELD_DISPLAY[r.field_name] || r.field_name,
        r.old_value, r.proposed_value,
        d.applied == null ? '' : d.applied,
        r.source_snapshot_date, r.proposed_at,
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
            state[id].applied = obj[id].applied != null ? obj[id].applied : state[id].applied;
            var row = document.querySelector('tr[data-change-id="' + id + '"]');
            var inp = row && row.querySelector('.notes-input');
            if (inp) inp.value = state[id].notes;
            var pInp = row && row.querySelector('.proposed-input');
            if (pInp && obj[id].applied != null) { pInp.value = obj[id].applied; refreshOverrideStyling(row, id); }
          }
        });
      } catch (e) { alert('Invalid draft file: ' + e.message); }
    };
    reader.readAsText(f);
  });

  document.querySelectorAll('.section-title[data-toggle]').forEach(function(h){
    h.addEventListener('click', function(){
      var id = h.getAttribute('data-toggle');
      var body = document.getElementById('section-body-' + id);
      if (!body) return;
      var section = h.closest('.approve-section');
      var nowHidden = body.hasAttribute('hidden');
      if (nowHidden) {
        body.removeAttribute('hidden');
        section.classList.add('is-open');
      } else {
        body.setAttribute('hidden', '');
        section.classList.remove('is-open');
      }
    });
  });

  document.querySelectorAll('.count-link[data-target]').forEach(function(a){
    a.addEventListener('click', function(){
      var id = a.getAttribute('data-target');
      var body = document.getElementById('section-body-' + id);
      var section = document.getElementById('section-' + id);
      if (body && body.hasAttribute('hidden')) {
        body.removeAttribute('hidden');
        if (section) section.classList.add('is-open');
      }
    });
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
        '<span>' + fieldBreakdown(rows) + '</span>' +
      '</div>' +
      '<div class="byproj">' + projectBreakdown(rows) + '</div>' +
      '<div class="tolerances muted">tolerance: price ' + tolerances.price_tolerance_pct + '% · area ' + tolerances.area_tolerance_pct + '%</div>' +
    '</section>';

  const toolbar =
    '<div class="toolbar sticky">' +
      '<button id="btn-approve-all" type="button">Approve all</button>' +
      '<button id="btn-approve-within-tolerance" type="button">Approve all where Δ&lt;tolerance</button>' +
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

  const sectionsHtml = SECTIONS.map(s => renderSection(s, rows, tolerances)).join('');

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
      '<main class="approve-page">' + headerCard + toolbar + sectionsHtml + '</main>' +
      dataScript +
      '<script>' + APPROVE_JS + '</script>' +
    '</body></html>',
    'utf8'
  );
}

module.exports = { generateApproveHtml };
