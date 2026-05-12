// Backup / restore the entire DL-Processor working set as a single zip:
//   - data/dld-sync.sqlite  (the only stateful artifact)
//   - config/project-mapping.json  (hand-tuned mappings — worth bundling so
//                                   a restored backup behaves the same)
//   - meta.json (v1.1+) — { exported_at, app_version, schema_ver, row_counts }
//                         lets the desktop Import DB modal show what's
//                         in the zip before the user confirms.
//
// db-export <outPath?>   → writes the zip to <outPath>, defaults to
//                          output/dl-processor-backup-<UTC-stamp>.zip
// db-import <inPath>     → extracts the zip back over the working set.
//                          The current DB is preserved as <dbPath>.bak.<ts>
//                          before being replaced. The restored DB is then
//                          opened once to confirm it isn't corrupt.
//
// Public API:
//   cmdDbExport(args)          — CLI entry. Writes a zip via exportZip().
//   cmdDbImport(args)          — CLI entry. Calls commitZip() (no probe step).
//   exportZip({ dataRoot, outPath })            — programmatic export.
//   probeZip(zipPath, { dataRoot })             — read-only inspection.
//   commitZip(zipPath, { dataRoot })            — atomic swap with backup.

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const { openDb, repoRoot, OUTPUT_DIR, CONFIG_DIR } = require('./shared');

const COUNTED_TABLES = ['dld_project', 'master_data', 'pending_change', 'audit_log'];

function resolveDbPath(dataRoot) {
  if (dataRoot) return path.join(dataRoot, 'data', 'dld-sync.sqlite');
  return path.join(repoRoot(), 'data', 'dld-sync.sqlite');
}
function resolveMappingPath(dataRoot) {
  if (dataRoot) return path.join(dataRoot, 'config', 'project-mapping.json');
  return path.join(CONFIG_DIR(), 'project-mapping.json');
}

// Count COUNTED_TABLES on a *read-only* connection. Returns zero for any
// table the schema doesn't have yet (fresh or pre-migration DBs).
function countRows(dbPath) {
  const counts = {};
  for (const t of COUNTED_TABLES) counts[t] = 0;
  if (!fs.existsSync(dbPath)) return counts;
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    for (const t of COUNTED_TABLES) {
      if (!tables.has(t)) { counts[t] = 0; continue; }
      try {
        const row = db.prepare('SELECT COUNT(*) AS n FROM ' + t).get();
        counts[t] = row && typeof row.n === 'number' ? row.n : 0;
      } catch {
        counts[t] = 0;
      }
    }
  } catch {
    /* DB unreadable — leave zeros */
  } finally {
    if (db) try { db.close(); } catch { /* noop */ }
  }
  return counts;
}

function latestSchemaVer(dbPath) {
  if (!fs.existsSync(dbPath)) return 'unknown';
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migration'").get();
    if (!tables) return 'unknown';
    const row = db.prepare('SELECT id FROM schema_migration ORDER BY applied_at DESC, id DESC LIMIT 1').get();
    return (row && row.id) ? row.id : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    if (db) try { db.close(); } catch { /* noop */ }
  }
}

function readAppVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Programmatic export. Used by cmdDbExport (CLI) and any future caller.
function exportZip({ dataRoot, outPath } = {}) {
  const db = resolveDbPath(dataRoot);
  if (!fs.existsSync(db)) {
    throw new Error('DB not found at ' + db);
  }
  const mapping = resolveMappingPath(dataRoot);
  const meta = {
    exported_at: new Date().toISOString(),
    app_version: readAppVersion(),
    schema_ver:  latestSchemaVer(db),
    row_counts:  countRows(db)
  };

  const zip = new AdmZip();
  zip.addLocalFile(db);                                 // → "dld-sync.sqlite" at zip root
  if (fs.existsSync(mapping)) {
    zip.addLocalFile(mapping, 'config');                // → "config/project-mapping.json"
  }
  zip.addFile('meta.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  zip.writeZip(outPath);

  return { outPath, meta, bytes: fs.statSync(outPath).size };
}

// Inspect a backup zip without touching the live DB. Extracts the zipped
// DB to a temp file so we can count rows on a read-only handle, then
// deletes the temp copy.
function probeZip(zipPath, { dataRoot } = {}) {
  if (!fs.existsSync(zipPath)) throw new Error('zip not found: ' + zipPath);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const dbEntry   = entries.find((e) => e.entryName === 'dld-sync.sqlite');
  const metaEntry = entries.find((e) => e.entryName === 'meta.json');
  if (!dbEntry) {
    throw new Error("zip does not contain a top-level 'dld-sync.sqlite' entry");
  }

  let meta = null;
  if (metaEntry) {
    try { meta = JSON.parse(metaEntry.getData().toString('utf8')); }
    catch { meta = null; }
  }

  // Extract the zipped DB to a temp file for a read-only count pass.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-probe-'));
  const tmpDb = path.join(tmpRoot, 'dld-sync.sqlite');
  let zipRowCounts;
  try {
    fs.writeFileSync(tmpDb, dbEntry.getData());
    zipRowCounts = countRows(tmpDb);
  } finally {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ }
  }

  const currentRowCounts = countRows(resolveDbPath(dataRoot));

  return { meta, zipRowCounts, currentRowCounts };
}

// Atomic-ish swap: write a .bak.<ISO> safety copy, then replace the DB
// from the zip, then optionally replace project-mapping.json. We don't
// roll back if the mapping copy fails — by that point the DB is the
// source of truth and the .bak file is the user's escape hatch.
function commitZip(zipPath, { dataRoot } = {}) {
  if (!fs.existsSync(zipPath)) throw new Error('zip not found: ' + zipPath);

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const dbEntry      = entries.find((e) => e.entryName === 'dld-sync.sqlite');
  const mappingEntry = entries.find((e) => e.entryName === 'config/project-mapping.json');
  if (!dbEntry) throw new Error("zip does not contain a top-level 'dld-sync.sqlite' entry");

  const MAX_BYTES = 500 * 1024 * 1024;
  if (dbEntry.header.size > MAX_BYTES) {
    throw new Error('dld-sync.sqlite in zip is too large (' + (dbEntry.header.size / 1024 / 1024).toFixed(1) + ' MB > 500 MB cap)');
  }
  if (mappingEntry && mappingEntry.header.size > 10 * 1024 * 1024) {
    throw new Error('config/project-mapping.json in zip is too large (>10 MB)');
  }

  const targetDb = resolveDbPath(dataRoot);
  let backupPath = null;
  if (fs.existsSync(targetDb)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = targetDb + '.bak.' + stamp;
    fs.copyFileSync(targetDb, backupPath);
  }

  fs.mkdirSync(path.dirname(targetDb), { recursive: true });
  fs.writeFileSync(targetDb, dbEntry.getData());

  let replacedConfig = false;
  if (mappingEntry) {
    const targetMapping = resolveMappingPath(dataRoot);
    fs.mkdirSync(path.dirname(targetMapping), { recursive: true });
    fs.writeFileSync(targetMapping, mappingEntry.getData());
    replacedConfig = true;
  }

  // Sanity-open the replaced DB to confirm it isn't corrupt. We don't
  // require a specific table — a brand-new empty DB is a legitimate
  // thing to restore (e.g. "reset to a fresh state").
  let opened = null;
  try {
    opened = new Database(targetDb, { readonly: true, fileMustExist: true });
    opened.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get();
  } catch (e) {
    throw new Error('restored DB failed to open — ' + e.message);
  } finally {
    if (opened) try { opened.close(); } catch { /* noop */ }
  }

  return { backupPath, replacedDb: true, replacedConfig };
}

// ─── CLI entries ──────────────────────────────────────────────────────

function cmdDbExport(args) {
  const outArg = args && args[0];
  const db = resolveDbPath();
  if (!fs.existsSync(db)) {
    console.error('  DB not found at ' + db);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = 'dl-processor-backup-' + stamp + '.zip';
  const outPath = outArg || path.join(OUTPUT_DIR(), defaultName);

  const result = exportZip({ dataRoot: process.env.DLP_DATA_ROOT || null, outPath });
  console.log('  wrote: ' + result.outPath);
  console.log('  size:  ' + (result.bytes / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  meta:  schema_ver=' + result.meta.schema_ver + ', rows=' + JSON.stringify(result.meta.row_counts));
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

  try {
    const result = commitZip(inArg, { dataRoot: process.env.DLP_DATA_ROOT || null });
    if (result.backupPath) {
      console.log('  backed up current DB → ' + path.basename(result.backupPath));
    }
    const targetDb = resolveDbPath();
    console.log('  restored DB: ' + targetDb);
    console.log('  size:        ' + (fs.statSync(targetDb).size / 1024 / 1024).toFixed(2) + ' MB');
    if (result.replacedConfig) {
      console.log('  restored config: ' + resolveMappingPath());
    }
    // Validate via the project-standard openDb() path so any schema
    // migrations queued for the restored DB run before the user touches it.
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
  } catch (e) {
    console.error('  ' + e.message);
    process.exit(1);
  }
}

module.exports = { cmdDbExport, cmdDbImport, exportZip, probeZip, commitZip };
