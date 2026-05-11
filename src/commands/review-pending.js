const fs   = require('fs');
const path = require('path');
const { listPending } = require('../pending-change');
const { generateApproveHtml } = require('../approve-html');
const { loadAutoApproveConfig } = require('../auto-approve');
const { lookupSfUnit } = require('../sf-lookup');
const { openFile } = require('../open-file');
const { getMasterRow } = require('../master-data');
const { openDb, OUTPUT_DIR, CSV_DIR } = require('./shared');

function cmdReviewPending(filterProjectName) {
  const db = openDb();
  const rows = listPending(db, filterProjectName);
  if (rows.length === 0) {
    console.log('  no pending changes');
    db.close();
    return;
  }
  // Group counts for terminal output.
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.project_name)) byProject.set(r.project_name, { total: 0, byField: {} });
    const slot = byProject.get(r.project_name);
    slot.total += 1;
    slot.byField[r.field_name] = (slot.byField[r.field_name] || 0) + 1;
  }
  console.log('  pending changes:');
  for (const [name, slot] of byProject) {
    const fields = Object.entries(slot.byField).map(([k, v]) => v + ' ' + k.replace('buyer_name', 'buyer').replace('purchase_price_aed', 'price').replace('procedure_number', 'procedure').replace('area_sqm', 'area')).join(', ');
    console.log('    ' + name + ': ' + slot.total + ' (' + fields + ')');
  }
  console.log('  TOTAL: ' + rows.length + ' pending across ' + byProject.size + ' project' + (byProject.size === 1 ? '' : 's'));

  // Enrich rows with SF unit, applicant, price, and current master_data buyer.
  for (const r of rows) {
    const sf = lookupSfUnit(db, r.project_id, r.unit_number_norm);
    r.sf_unit      = sf ? sf.sf_unit      : null;
    r.sf_applicant = sf ? sf.sf_applicant : null;
    r.sf_price     = sf ? sf.sf_price     : null;
    const masterRow = getMasterRow(db, r.project_id, r.unit_number_norm);
    r.current_buyer = masterRow ? masterRow.buyer_name : null;
  }

  fs.mkdirSync(CSV_DIR(), { recursive: true });
  const outPath = path.join(CSV_DIR(), 'pending-changes.csv');
  const header = ['change_id', 'project_name', 'unit', 'field', 'old_value', 'proposed_value', 'applied_value', 'source_snapshot_date', 'proposed_at', 'decision', 'notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(h => {
      const v = h === 'project_name' ? r.project_name :
                h === 'unit' ? r.unit_number_norm :
                h === 'field' ? r.field_name :
                h === 'source_snapshot_date' ? (r.source_snapshot_date || '') :
                h === 'decision' ? 'pending' :
                h === 'notes' ? '' :
                h === 'applied_value' ? '' :   // initial CSV has no override; staff fill in via HTML or edit
                r[h] == null ? '' : r[h];
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  }
  // Excel locks files while open. If pending-changes.csv is locked from a
  // prior run, write to a timestamped fallback so we don't crash the command
  // (the HTML is the primary surface anyway).
  let csvWrittenPath = outPath;
  const csvBody = lines.join('\r\n') + '\r\n';
  try {
    fs.writeFileSync(outPath, csvBody, 'utf8');
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      csvWrittenPath = path.join(CSV_DIR(), 'pending-changes-' + stamp + '.csv');
      fs.writeFileSync(csvWrittenPath, csvBody, 'utf8');
      console.log('  (pending-changes.csv was locked — close Excel; wrote fallback)');
    } else {
      throw e;
    }
  }
  console.log('  wrote: ' + path.relative(process.cwd(), csvWrittenPath));
  const htmlPath = path.join(OUTPUT_DIR(), 'approve-pending.html');
  const tolerances = loadAutoApproveConfig();
  generateApproveHtml(rows, tolerances, htmlPath);
  console.log('  wrote: ' + path.relative(process.cwd(), htmlPath));
  try {
    openFile(htmlPath);
    console.log('  opened in browser');
  } catch (e) {
    console.log('  (could not auto-open: ' + e.message + ')');
  }
  db.close();
}

module.exports = { cmdReviewPending };
