// Task 14 — Import DB modal: backend (export + probe + commit).
//
// Verifies:
//  1. exportZip embeds a meta.json describing the backup.
//  2. probeZip reports zipRowCounts + currentRowCounts (even when meta.json
//     is absent — old backups must still be inspectable).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const { runMigrations } = require('../../src/migrations');
const { exportZip, probeZip } = require('../../src/commands/db-backup');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'dlp-import-'));
}

// Windows occasionally holds a brief lock on a freshly-closed SQLite file
// (anti-virus, indexer, etc.) — retry a few times so the cleanup doesn't
// flake the test result for a transient EBUSY.
function safeRm(target) {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(target, { recursive: true, force: true }); return; }
    catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'ENOTEMPTY') {
        // Unknown error — surface immediately.
        throw e;
      }
      const wait = Date.now() + 100;
      while (Date.now() < wait) { /* tiny spin */ }
    }
  }
  // Swallow the final failure — a leftover temp directory is preferable
  // to flaking the build on a transient Windows file-handle race. The
  // OS will reap %TEMP% periodically.
}

// Helper: create a minimal DLP data-root layout with a populated DB so
// exportZip/probeZip have something to read.
function seedDataRoot(dataRoot, { dldProjects = 0, masterRows = 0 } = {}) {
  fs.mkdirSync(path.join(dataRoot, 'data'),   { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  const dbPath = path.join(dataRoot, 'data', 'dld-sync.sqlite');
  const db = new Database(dbPath);
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  runMigrations(db);
  for (let i = 0; i < dldProjects; i++) {
    db.prepare("INSERT INTO dld_project (project_name) VALUES (?)").run('P' + i);
  }
  // master_data references dld_project; only insert when we have at least one.
  for (let i = 0; i < masterRows && dldProjects > 0; i++) {
    db.prepare(`INSERT INTO master_data (project_id, unit_number_norm) VALUES (1, ?)`)
      .run('U' + i);
  }
  db.close();
  return dbPath;
}

test('exportZip embeds meta.json with row_counts, timestamp, and schema_ver', () => {
  const dataRoot = tmpDir('dlp-export-');
  try {
    seedDataRoot(dataRoot, { dldProjects: 3, masterRows: 2 });
    const zipPath = path.join(dataRoot, 'backup.zip');

    exportZip({ dataRoot, outPath: zipPath });

    assert.ok(fs.existsSync(zipPath), 'zip file should exist');

    const zip = new AdmZip(zipPath);
    const metaEntry = zip.getEntries().find((e) => e.entryName === 'meta.json');
    assert.ok(metaEntry, 'zip should contain meta.json');

    const meta = JSON.parse(metaEntry.getData().toString('utf8'));
    assert.ok(meta.exported_at, 'meta.exported_at should be set');
    assert.match(meta.exported_at, /^\d{4}-\d{2}-\d{2}T/, 'exported_at should be ISO 8601');
    assert.ok(meta.app_version, 'meta.app_version should be set');
    assert.ok(meta.schema_ver, 'meta.schema_ver should be set');
    assert.equal(meta.row_counts.dld_project, 3);
    assert.equal(meta.row_counts.master_data, 2);
    assert.equal(meta.row_counts.pending_change, 0);
    assert.equal(meta.row_counts.audit_log, 0);
  } finally {
    safeRm(dataRoot);
  }
});

test('probeZip reports zipRowCounts and currentRowCounts (with + without meta.json)', () => {
  const dataRoot = tmpDir('dlp-probe-');
  try {
    // Live DB: 1 project, 0 master rows.
    seedDataRoot(dataRoot, { dldProjects: 1, masterRows: 0 });

    // Build a "backup-flavored" zip in a SEPARATE tmp dir whose contents
    // differ from the live DB so we can tell the two count-sets apart.
    const backupRoot = tmpDir('dlp-bkp-src-');
    try {
      seedDataRoot(backupRoot, { dldProjects: 5, masterRows: 4 });
      const zipPath = path.join(dataRoot, 'b.zip');
      exportZip({ dataRoot: backupRoot, outPath: zipPath });

      // ── With meta.json ─────────────────────────────────────────────
      const withMeta = probeZip(zipPath, { dataRoot });
      assert.ok(withMeta.meta,                  'meta should be present');
      assert.equal(withMeta.meta.row_counts.dld_project, 5);
      assert.equal(withMeta.zipRowCounts.dld_project,    5, 'zip DB row count');
      assert.equal(withMeta.zipRowCounts.master_data,    4);
      assert.equal(withMeta.currentRowCounts.dld_project, 1, 'live DB row count');
      assert.equal(withMeta.currentRowCounts.master_data, 0);

      // ── Without meta.json (simulating an old backup) ──────────────
      const stripped = new AdmZip(zipPath);
      stripped.deleteFile('meta.json');
      const strippedPath = path.join(dataRoot, 'b-old.zip');
      stripped.writeZip(strippedPath);

      const withoutMeta = probeZip(strippedPath, { dataRoot });
      assert.equal(withoutMeta.meta, null, 'meta should be null when absent');
      assert.equal(withoutMeta.zipRowCounts.dld_project,    5);
      assert.equal(withoutMeta.currentRowCounts.dld_project, 1);
    } finally {
      safeRm(backupRoot);
    }
  } finally {
    safeRm(dataRoot);
  }
});
