const fs   = require('fs');
const path = require('path');
const { applyDecision } = require('../pending-change');
const { openDb, CSV_DIR } = require('./shared');

function cmdApplyPending(csvPath) {
  const db = openDb();
  const inputPath = csvPath || path.join(CSV_DIR(), 'pending-changes.csv');
  if (!fs.existsSync(inputPath)) {
    console.log('  no pending CSV at ' + inputPath);
    db.close();
    return;
  }
  const content = fs.readFileSync(inputPath, 'utf8');
  // Use the same csv-parse already in deps (used by src/sources/csv.js).
  const { parse } = require('csv-parse/sync');
  const rows = parse(content, { relax_quotes: true, columns: true, skip_empty_lines: true });
  let approved = 0, rejected = 0, deferred = 0, errors = 0;
  for (const r of rows) {
    const cid = parseInt(r.change_id, 10);
    if (isNaN(cid)) { errors += 1; continue; }
    const decision = String(r.decision || '').trim().toLowerCase();
    const notes = r.notes || '';
    const applied = r.applied_value === '' || r.applied_value == null ? null : r.applied_value;
    if (decision === 'approve') {
      try { applyDecision(db, cid, 'approve', notes, applied); approved += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'reject') {
      try { applyDecision(db, cid, 'reject', notes, applied); rejected += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'pending' || decision === '') {
      deferred += 1;
    } else {
      console.log('  warn change_id ' + cid + ': unknown decision "' + decision + '", skipping');
      errors += 1;
    }
  }
  const masterCount = db.prepare('SELECT COUNT(*) AS n FROM master_data').get().n;
  console.log('  applied ' + approved + ' approval' + (approved === 1 ? '' : 's') + ' · ' + rejected + ' rejection' + (rejected === 1 ? '' : 's') + ' · ' + deferred + ' deferred (still pending)');
  if (errors) console.log('  ' + errors + ' row' + (errors === 1 ? '' : 's') + ' had errors (see warnings above)');
  console.log('  master_data now has ' + masterCount + ' canonical row' + (masterCount === 1 ? '' : 's'));
  db.close();
}

module.exports = { cmdApplyPending };
