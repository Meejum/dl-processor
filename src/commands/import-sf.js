const path = require('path');
const { importSfSnapshot } = require('../salesforce');
const { openDb } = require('./shared');

function cmdImportSf(targets) {
  const db = openDb();
  for (const t of targets) {
    console.log(`  -> SF: ${path.basename(t)}`);
    try {
      const result = importSfSnapshot({ db, filePath: t });
      if (result.deduped) {
        console.log(`     already imported (sha matches) — snapshot #${result.sfSnapshotId} reused`);
      } else {
        console.log(`     imported snapshot #${result.sfSnapshotId} (${result.rowsInserted} rows, generated ${result.generatedAt || 'unknown'})`);
      }
    } catch (e) {
      const msg = e.message || '';
      if (msg.match(/EBUSY|EPERM|being used by another process/i)) {
        console.log(`     SKIPPED: ${path.basename(t)} is open in another program (close Excel and re-run)`);
      } else {
        throw e;  // unexpected — let it propagate
      }
    }
    console.log('');
  }
  db.close();
}

module.exports = { cmdImportSf };
