const path = require('path');
const { importDldSnapshot } = require('../import-dld');
const { openDb, parseFileFromPath, printParseSummary, writeOutputFiles } = require('./shared');

function cmdImport(targets) {
  const db = openDb();
  for (const t of targets) {
    console.log(`  -> ${path.basename(t)}`);
    const { data, sourceFormat } = parseFileFromPath(t);
    printParseSummary(data);
    const result = importDldSnapshot({ db, data, sourceFormat, sourceFile: t });
    console.log(`     imported as snapshot #${result.snapshotId} (project #${result.projectId})`);
    console.log(`     db: ${result.totalUnits} units, ${result.totalTx} tx rows`);
    writeOutputFiles(data, path.basename(t));
    console.log('');
  }
  db.close();
}

module.exports = { cmdImport };
