const fs   = require('fs');
const path = require('path');
const { diffProject, summarizeDiff, writeDiffCsv, writeDiffHtml } = require('../diff');
const { openDb, DIFF_DIR, CSV_DIR } = require('./shared');

function parseDiffArgs(rest) {
  const opts = { name: null, since: null, showMissing: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--show-missing') { opts.showMissing = true; continue; }
    if (a === '--since') {
      opts.since = rest[++i];
      if (!opts.since) throw new Error('--since requires a YYYY-MM-DD argument');
      continue;
    }
    if (a.startsWith('--since=')) { opts.since = a.slice('--since='.length); continue; }
    if (a.startsWith('--')) throw new Error('unknown flag: ' + a);
    if (!opts.name) { opts.name = a; continue; }
    throw new Error('unexpected argument: ' + a);
  }
  return opts;
}

function cmdDiff(rest) {
  let opts;
  try {
    opts = parseDiffArgs(Array.isArray(rest) ? rest : []);
  } catch (e) {
    console.log('  ' + e.message);
    return;
  }

  const db = openDb();
  const projects = db.prepare(
    opts.name
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project`
  ).all(...(opts.name ? [opts.name] : []));
  if (projects.length === 0) { console.log('  no projects in DB'); db.close(); return; }
  fs.mkdirSync(DIFF_DIR(), { recursive: true });
  fs.mkdirSync(CSV_DIR(), { recursive: true });

  const totals = { new: 0, changed: 0, hidden: 0, projects: 0 };

  for (const p of projects) {
    console.log(`  -> ${p.project_name}`);
    try {
      const result = diffProject(db, p.project_id, { since: opts.since, includeMissing: opts.showMissing });
      if (result.status !== 'ok') {
        const reasons = {
          'not-enough-snapshots': '(need >= 2 snapshots)',
          'no-baseline-before-date': `(no snapshot before ${opts.since})`
        };
        console.log(`     skipped: ${result.status} ${reasons[result.status] || ''}`.trimEnd());
        continue;
      }
      if (opts.since) result.sinceUsed = opts.since;

      const counts = summarizeDiff(result.rows);
      const oldLabel = result.oldSnapshot.snapshot_date + ' ' + result.oldSnapshot.source_format;
      const newLabel = result.newSnapshot.snapshot_date + ' ' + result.newSnapshot.source_format;
      const sinceTag = opts.since ? ` (--since ${opts.since})` : '';

      const newUnits   = counts.NEW_UNIT   || 0;
      const newTxs     = counts.NEW_TX     || 0;
      const newTotal   = newUnits + newTxs;
      const changedAmt = counts.AMOUNT_CHANGED   || 0;
      const changedAr  = counts.AREA_CHANGED     || 0;
      const changedTy  = counts.UNIT_TYPE_CHANGED|| 0;
      const changedTot = changedAmt + changedAr + changedTy;
      const missingU   = counts.MISSING_UNIT || 0;
      const missingT   = counts.MISSING_TX   || 0;
      const missingTot = missingU + missingT;
      const hiddenU    = (result.hiddenMissingCount && result.hiddenMissingCount.units) || 0;
      const hiddenT    = (result.hiddenMissingCount && result.hiddenMissingCount.txs)   || 0;
      const hiddenTot  = hiddenU + hiddenT;
      const totalRows  = result.rows.length;

      console.log(`     baseline  ${oldLabel}${sinceTag}   ->   latest  ${newLabel}`);
      if (totalRows === 0 && hiddenTot === 0) {
        console.log('     no changes');
      } else {
        console.log(`     new       :  ${newTotal}  (units ${newUnits}, tx ${newTxs})`);
        console.log(`     changed   :  ${changedTot}  (amount ${changedAmt}, area ${changedAr}, type ${changedTy})`);
        if (opts.showMissing && missingTot > 0) {
          console.log(`     missing   :  ${missingTot}  (units ${missingU}, tx ${missingT})`);
        } else if (!opts.showMissing && hiddenTot > 0) {
          const noun = hiddenTot === 1 ? 'row' : 'rows';
          console.log(`     hidden    :  ${hiddenTot} missing ${noun} (use --show-missing to include)`);
        }
      }

      const base = p.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
      const csvOut  = path.join(CSV_DIR(), base + '.diff.csv');
      const htmlOut = path.join(DIFF_DIR(), base + '.diff.html');
      writeDiffCsv(csvOut, result);
      writeDiffHtml(htmlOut, result, counts);
      console.log(`     wrote     :  ${path.relative(process.cwd(), csvOut)}`);
      console.log(`     wrote     :  ${path.relative(process.cwd(), htmlOut)}`);
      console.log('');

      totals.projects += 1;
      totals.new     += newTotal;
      totals.changed += changedTot;
      totals.hidden  += hiddenTot;
    } catch (e) {
      console.log(`     error: ${e.message}`);
    }
  }

  if (totals.projects > 0) {
    const hiddenSeg = (!opts.showMissing && totals.hidden > 0) ? `   hidden ${totals.hidden}` : '';
    console.log(`  TOTAL across ${totals.projects} project${totals.projects === 1 ? '' : 's'}:  new ${totals.new}   changed ${totals.changed}${hiddenSeg}`);
  }

  db.close();
}

module.exports = { cmdDiff, parseDiffArgs };
