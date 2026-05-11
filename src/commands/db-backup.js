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

  // Strict-match only the exact filenames we produced — `endsWith()` would
  // accept a hostile zip with `../../dld-sync.sqlite` or any other nested
  // path; reject anything that isn't exactly what cmdDbExport writes.
  const dbEntry      = entries.find((e) => e.entryName === 'dld-sync.sqlite');
  const mappingEntry = entries.find((e) => e.entryName === 'config/project-mapping.json');

  if (!dbEntry) {
    console.error("  zip does not contain a top-level 'dld-sync.sqlite' entry");
    process.exit(1);
  }

  // Reject implausibly large entries early. A real Sobha DB is < 100 MB;
  // 500 MB is a comfortable ceiling that still catches a malicious zip
  // crafted to fill the user's disk.
  const MAX_BYTES = 500 * 1024 * 1024;
  if (dbEntry.header.size > MAX_BYTES) {
    console.error('  dld-sync.sqlite in zip is too large (' + (dbEntry.header.size / 1024 / 1024).toFixed(1) + ' MB > 500 MB cap)');
    process.exit(1);
  }
  if (mappingEntry && mappingEntry.header.size > 10 * 1024 * 1024) {
    console.error('  config/project-mapping.json in zip is too large (>10 MB)');
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

  if (mappingEntry) {
    const targetMapping = mappingPath();
    fs.mkdirSync(path.dirname(targetMapping), { recursive: true });
    fs.writeFileSync(targetMapping, mappingEntry.getData());
    console.log('  restored config: ' + targetMapping);
  }

  // Sanity: open the new DB and confirm it has at least one table. We don't
  // require `dld_project` to exist because a brand-new empty DB is also a
  // legitimate thing to restore (e.g. "reset to a fresh state").
  try {
    const db = openDb();
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get();
    db.close();
    if (!tbl) console.log('  validated: DB opens cleanly (no tables yet — fresh state)');
    else      console.log('  validated: DB opens cleanly');
  } catch (e) {
    console.error('  WARNING: restored DB failed to open — ' + e.message);
    process.exit(1);
  }
}

module.exports = { cmdDbExport, cmdDbImport };
