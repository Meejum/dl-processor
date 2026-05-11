// Backup / restore the entire DL-Processor working set as a single zip:
//   - data/dld-sync.sqlite  (the only stateful artifact)
//   - config/project-mapping.json  (hand-tuned mappings — worth bundling so
//                                   a restored backup behaves the same)
//
// db-export <outPath?>   → writes the zip to <outPath>, defaults to
//                          output/dl-processor-backup-<UTC-stamp>.zip
// db-import <inPath>     → extracts the zip back over the working set.
//                          The current DB is preserved as <dbPath>.bak-<ts>
//                          before being replaced. The restored DB is then
//                          opened once to confirm it isn't corrupt.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { openDb, repoRoot, OUTPUT_DIR, CONFIG_DIR } = require('./shared');

function dbPath() {
  return path.join(repoRoot(), 'data', 'dld-sync.sqlite');
}
function mappingPath() {
  return path.join(CONFIG_DIR(), 'project-mapping.json');
}

function cmdDbExport(args) {
  const outArg = args && args[0];
  const db = dbPath();
  if (!fs.existsSync(db)) {
    console.error('  DB not found at ' + db);
    process.exit(1);
  }

  const zip = new AdmZip();
  zip.addLocalFile(db);                   // → "dld-sync.sqlite" at zip root
  if (fs.existsSync(mappingPath())) {
    zip.addLocalFile(mappingPath(), 'config');  // → "config/project-mapping.json"
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = 'dl-processor-backup-' + stamp + '.zip';
  const outPath = outArg || path.join(OUTPUT_DIR(), defaultName);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  zip.writeZip(outPath);

  const bytes = fs.statSync(outPath).size;
  console.log('  wrote: ' + outPath);
  console.log('  size:  ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');
}

function cmdDbImport(args) {
  const inArg = args && args[0];
  if (!inArg) {
    console.error('  usage: db-import <zip-file>');
    process.exit(1);
  }
  if (!fs.existsSync(inArg)) {
    console.error('  zip not found: ' + inArg);
    process.exit(1);
  }

  const zip = new AdmZip(inArg);
  const entries = zip.getEntries();
  const dbEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('dld-sync.sqlite'));
  if (!dbEntry) {
    console.error('  zip does not contain dld-sync.sqlite');
    process.exit(1);
  }

  const targetDb = dbPath();
  if (fs.existsSync(targetDb)) {
    const bak = targetDb + '.bak-' + Date.now();
    fs.copyFileSync(targetDb, bak);
    console.log('  backed up current DB → ' + path.basename(bak));
  }

  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  fs.writeFileSync(targetDb, dbEntry.getData());
  console.log('  restored DB: ' + targetDb);
  console.log('  size:        ' + (fs.statSync(targetDb).size / 1024 / 1024).toFixed(2) + ' MB');

  const mappingEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('project-mapping.json'));
  if (mappingEntry) {
    const targetMapping = mappingPath();
    fs.mkdirSync(path.dirname(targetMapping), { recursive: true });
    fs.writeFileSync(targetMapping, mappingEntry.getData());
    console.log('  restored config: ' + targetMapping);
  }

  // Quick sanity: open the new DB and count projects.
  try {
    const db = openDb();
    const row = db.prepare('SELECT COUNT(*) AS n FROM dld_project').get();
    db.close();
    console.log('  validated: ' + row.n + ' projects in the restored DB');
  } catch (e) {
    console.error('  WARNING: restored DB failed to open — ' + e.message);
    process.exit(1);
  }
}

module.exports = { cmdDbExport, cmdDbImport };
