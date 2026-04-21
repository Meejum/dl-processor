const fs = require('fs');
const path = require('path');
const { expectedSfUnit, applyUnitTransforms } = require('./project-mapping');

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

function getLatestSnapshotForProject(db, projectId) {
  return db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId);
}

function getLatestSfSnapshot(db) {
  return db.prepare(`SELECT * FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`).get();
}

function getUnitsForSnapshot(db, snapshotId) {
  return db.prepare(`
    SELECT u.*, b.name AS building_name, b.type AS building_type
    FROM dld_unit u
    LEFT JOIN dld_building b ON b.building_id = u.building_id
    WHERE u.snapshot_id = ?
    ORDER BY u.unit_number
  `).all(snapshotId);
}

function getTxForUnit(db, unitId) {
  return db.prepare(`SELECT * FROM dld_transaction WHERE unit_id = ? ORDER BY tx_id`).all(unitId);
}

function getSfBookingsForSub(db, sfSnapshotId, subProject) {
  return db.prepare(`
    SELECT * FROM sf_booking
    WHERE sf_snapshot_id = ? AND sub_project = ?
  `).all(sfSnapshotId, subProject);
}

const PURCHASE_TX_TYPES = new Set([
  'Complete Delayed Sell', 'Sell - Pre registration', 'Sale', 'Delayed Sell', 'Grant', 'Lease to Own Registration'
]);
const BANK_PREFIX_RE = /^(BANK|COMMERCIAL|EMIRATES|DUBAI|ABU DHABI|AJMAN|SHARJAH|AL\s|HSBC|MASHREQ|UNION NATIONAL|FIRST ABU DHABI|FAB|RAK BANK|NATIONAL BANK OF|ENBD|SAMBA|SABB|RIYAD|ARAB |EMIRATES NBD|EMIRATES ISLAMIC)/i;

function pickLatestPurchase(dldTxs) {
  const purchases = dldTxs.filter(t => PURCHASE_TX_TYPES.has(t.tx_type));
  if (purchases.length === 0) return null;
  purchases.sort((a, b) => {
    const da = a.tx_date_iso || '';
    const db = b.tx_date_iso || '';
    return db.localeCompare(da);
  });
  const top = purchases[0];
  const sameDate = purchases.filter(t => (t.tx_date_iso || '') === (top.tx_date_iso || ''));
  const withName = sameDate.find(t => t.party_name && !BANK_PREFIX_RE.test(t.party_name));
  return withName || top;
}

function namesOverlap(a, b) {
  if (!a || !b) return false;
  const norm = s => s.toUpperCase().replace(/^(MR|MRS|MS|MISS|DR)\.?\s*/, '').replace(/[^A-Z ]/g, '').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  const aW = new Set(A.split(/\s+/).filter(w => w.length > 2));
  const bW = new Set(B.split(/\s+/).filter(w => w.length > 2));
  for (const w of aW) if (bW.has(w)) return true;
  return false;
}

function classifyMatch(dldUnit, dldTxs, sfRow) {
  if (!sfRow) return { status: 'DLD_ONLY', reasons: ['no SF booking'] };
  const reasons = [];

  const purchase = pickLatestPurchase(dldTxs);
  const dldPrice = purchase ? purchase.amount_aed : null;

  if (sfRow.purchase_price != null && dldPrice != null) {
    const diff = Math.abs(sfRow.purchase_price - dldPrice);
    const rel  = diff / Math.max(dldPrice, 1);
    if (rel > 0.01) reasons.push(`price diff ${Math.round(diff).toLocaleString()} AED (DLD ${Math.round(dldPrice).toLocaleString()} vs SF ${Math.round(sfRow.purchase_price).toLocaleString()})`);
  }

  if (purchase && purchase.party_name && !BANK_PREFIX_RE.test(purchase.party_name) && sfRow.applicant_name) {
    if (!namesOverlap(purchase.party_name, sfRow.applicant_name)) {
      reasons.push(`buyer mismatch: DLD "${purchase.party_name}" vs SF "${sfRow.applicant_name}"`);
    }
  }

  if (reasons.length === 0) return { status: 'MATCH', reasons: [] };
  return { status: 'MISMATCH', reasons };
}

function compareProject(db, projectId) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id=?').get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  if (!project.sf_sub_project || !project.sf_unit_prefix) {
    return { project, status: 'no-mapping', rows: [] };
  }

  const dldSnap = getLatestSnapshotForProject(db, projectId);
  if (!dldSnap) return { project, status: 'no-dld-snapshot', rows: [] };
  const sfSnap  = getLatestSfSnapshot(db);
  if (!sfSnap)  return { project, status: 'no-sf-snapshot', rows: [] };

  const mapping = db.prepare('SELECT * FROM project_mapping WHERE project_id=?').get(projectId);
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'project-mapping.json'), 'utf8')).overrides || {};
  const transforms = overrides[project.project_name]?.unitTransforms || [];

  const dldUnits = getUnitsForSnapshot(db, dldSnap.snapshot_id);
  const sfBookings = getSfBookingsForSub(db, sfSnap.sf_snapshot_id, project.sf_sub_project);
  const sfByUnit = new Map();
  for (const b of sfBookings) {
    if (b.unit_norm) sfByUnit.set(b.unit_norm, b);
  }

  const rows = [];
  const matchedSfUnits = new Set();

  for (const u of dldUnits) {
    const expected = expectedSfUnit(u.unit_number_norm, {
      sf_unit_prefix: project.sf_unit_prefix,
      unitTransforms: transforms
    });
    const sfRow = expected ? sfByUnit.get(expected) : null;
    const dldTxs = getTxForUnit(db, u.unit_id);
    const purchase = pickLatestPurchase(dldTxs) || dldTxs[dldTxs.length - 1] || {};
    const latestTx = dldTxs[dldTxs.length - 1] || {};
    const cls = classifyMatch(u, dldTxs, sfRow);
    if (sfRow) matchedSfUnits.add(sfRow.unit_norm);

    rows.push({
      dld_project:         project.project_name,
      sf_sub_project:      project.sf_sub_project,
      dld_unit_number:     u.unit_number,
      expected_sf_unit:    expected,
      sf_unit:             sfRow?.unit || null,
      dld_unit_id:         u.dld_unit_id,
      dld_unit_type:       u.unit_type,
      dld_building:        u.building_name,
      dld_net_area:        u.net_area,
      dld_tx_count:        dldTxs.length,
      dld_purchase_type:   purchase.tx_type || null,
      dld_purchase_date:   purchase.tx_date || null,
      dld_purchase_amount: purchase.amount_aed || null,
      dld_purchase_party:  purchase.party_name || null,
      dld_last_tx_type:    latestTx.tx_type || null,
      dld_last_tx_date:    latestTx.tx_date || null,
      dld_last_amount_aed: latestTx.amount_aed || null,
      dld_last_party:      latestTx.party_name || null,
      sf_applicant:        sfRow?.applicant_name || null,
      sf_purchase_price:   sfRow?.purchase_price || null,
      sf_dld_amount:       sfRow?.dld_amount || null,
      sf_status:           sfRow?.status || null,
      sf_pre_reg_status:   sfRow?.pre_reg_status || null,
      sf_procedure_number: sfRow?.procedure_number || null,
      sf_booking_name:     sfRow?.booking_name || null,
      match_status:        cls.status,
      match_reasons:       cls.reasons.join('; ')
    });
  }

  for (const b of sfBookings) {
    if (!matchedSfUnits.has(b.unit_norm)) {
      rows.push({
        dld_project:         project.project_name,
        sf_sub_project:      project.sf_sub_project,
        dld_unit_number:     null,
        expected_sf_unit:    b.unit_norm,
        sf_unit:             b.unit,
        dld_unit_id:         null,
        dld_unit_type:       null,
        dld_building:        null,
        dld_net_area:        null,
        dld_tx_count:        0,
        dld_purchase_type:   null,
        dld_purchase_date:   null,
        dld_purchase_amount: null,
        dld_purchase_party:  null,
        dld_last_tx_type:    null,
        dld_last_tx_date:    null,
        dld_last_amount_aed: null,
        dld_last_party:      null,
        sf_applicant:        b.applicant_name,
        sf_purchase_price:   b.purchase_price,
        sf_dld_amount:       b.dld_amount,
        sf_status:           b.status,
        sf_pre_reg_status:   b.pre_reg_status,
        sf_procedure_number: b.procedure_number,
        sf_booking_name:     b.booking_name,
        match_status:        'SF_ONLY',
        match_reasons:       'unit in SF but not in DLD'
      });
    }
  }

  return { project, status: 'ok', rows, dldSnapshotId: dldSnap.snapshot_id, sfSnapshotId: sfSnap.sf_snapshot_id };
}

function summarize(rows) {
  const counts = { MATCH: 0, MISMATCH: 0, DLD_ONLY: 0, SF_ONLY: 0 };
  for (const r of rows) counts[r.match_status] = (counts[r.match_status] || 0) + 1;
  return counts;
}

function writeCompareCsv(outPath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(outPath, '', 'utf8');
    return;
  }
  const header = Object.keys(rows[0]);
  writeCsv(outPath, header, rows);
}

function writeCompareHtml(outPath, project, rows, counts) {
  const total = rows.length;
  const pct = n => total ? ((n * 100) / total).toFixed(1) + '%' : '0%';
  const statusClass = {
    MATCH: 'ok', MISMATCH: 'warn', DLD_ONLY: 'dld', SF_ONLY: 'sf'
  };
  const header = ['dld_unit_number','expected_sf_unit','sf_unit','dld_last_tx_type','dld_last_amount_aed','sf_applicant','sf_purchase_price','sf_status','match_status','match_reasons'];
  const body = rows.map(r => `<tr class="${statusClass[r.match_status] || ''}">` + header.map(h => `<td>${(r[h] == null ? '' : String(r[h]).replace(/&/g,'&amp;').replace(/</g,'&lt;'))}</td>`).join('') + '</tr>').join('\n');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${project.project_name} — DLD vs SF</title>
<style>
  body{font:13px/1.4 system-ui,Segoe UI,Arial;margin:20px;color:#111;background:#0b0f14;color:#e6e6e6}
  h1,h2{color:#fff}
  .chips{display:flex;gap:8px;margin:12px 0}
  .chip{padding:6px 10px;border-radius:20px;font-weight:600}
  .chip.ok{background:#0d3a1d;color:#4ce38e}
  .chip.warn{background:#3a2a0d;color:#ffcc55}
  .chip.dld{background:#0d2d3a;color:#5ad4ff}
  .chip.sf{background:#2d0d3a;color:#d88eff}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
  th,td{border-bottom:1px solid #222;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#11161d;color:#aaa;font-weight:600}
  tr.ok td{background:rgba(76,227,142,.05)}
  tr.warn td{background:rgba(255,204,85,.08)}
  tr.dld td{background:rgba(90,212,255,.08)}
  tr.sf td{background:rgba(216,142,255,.08)}
  td:nth-child(5),td:nth-child(7){text-align:right;font-variant-numeric:tabular-nums}
</style></head>
<body>
<h1>${project.project_name}</h1>
<div>Salesforce sub-project: <b>${project.sf_sub_project}</b> &nbsp;&nbsp; Unit prefix: <b>${project.sf_unit_prefix}-</b></div>
<div class="chips">
  <span class="chip ok">MATCH ${counts.MATCH || 0} (${pct(counts.MATCH || 0)})</span>
  <span class="chip warn">MISMATCH ${counts.MISMATCH || 0} (${pct(counts.MISMATCH || 0)})</span>
  <span class="chip dld">DLD-only ${counts.DLD_ONLY || 0} (${pct(counts.DLD_ONLY || 0)})</span>
  <span class="chip sf">SF-only ${counts.SF_ONLY || 0} (${pct(counts.SF_ONLY || 0)})</span>
</div>
<table>
<thead><tr>${header.map(h => '<th>' + h.replace(/_/g, ' ') + '</th>').join('')}</tr></thead>
<tbody>
${body}
</tbody></table>
</body></html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

function writeAuditTasks(outPath, project, rows) {
  const tasks = [];
  let n = 1;
  for (const r of rows) {
    if (r.match_status === 'MATCH') continue;
    let action;
    if (r.match_status === 'DLD_ONLY') action = `Add SF booking for unit ${r.expected_sf_unit} (DLD unit ${r.dld_unit_number}, ${r.dld_last_tx_type}, ${r.dld_last_amount_aed} AED)`;
    else if (r.match_status === 'SF_ONLY') action = `Verify SF booking ${r.sf_booking_name} / unit ${r.sf_unit} — not found in DLD snapshot`;
    else action = `Reconcile unit ${r.expected_sf_unit}: ${r.match_reasons}`;
    tasks.push({ n: n++, project: project.project_name, unit: r.expected_sf_unit || r.sf_unit, status: r.match_status, action });
  }
  const header = ['n', 'project', 'unit', 'status', 'action'];
  writeCsv(outPath, header, tasks);
  return tasks;
}

module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks };
