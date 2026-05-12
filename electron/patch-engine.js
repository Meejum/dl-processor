// electron/patch-engine.js
//
// Backend module for the v1.2 patch system. Used by IPC handlers in
// electron/main.js (wired in Task 5) to verify, stage, and revert app.asar
// patches without touching anything outside <installDir>/resources/.
//
// Public API:
//   probeZip(zipPath)            → { ok, manifest, currentVersion } | { ok:false, error }
//   stagePatch(zipPath, dir)     → { ok: true }              (throws on failure)
//   revertLast(dir)              → { canRevert, instructions? } | { canRevert:false }
//
// All three functions are sync — patch zips are small (~30 MB) and the IPC
// handlers run on a worker tick anyway.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const APP_VERSION = pkg.version;
const APP_ID      = 'ae.sobha.dl-processor';

const REQUIRED_MANIFEST_FIELDS = [
  'app_id', 'from_version_min', 'to_version', 'asar_sha256', 'asar_size'
];

// ---------- semver helper ----------

function compareSemver(a, b) {
  // Strip -dev / -beta / etc. suffixes for comparison purposes.
  const partsA = String(a).split('-')[0].split('.').map(Number);
  const partsB = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = (partsA[i] || 0) - (partsB[i] || 0);
    if (da !== 0) return da;
  }
  return 0;
}

// ---------- probeZip ----------

function probeZip(zipPath) {
  if (!fs.existsSync(zipPath)) {
    return { ok: false, error: 'zip-not-found' };
  }

  let zip;
  try {
    zip = new AdmZip(zipPath);
    // Force entries parse so corrupt zips throw here, not later.
    zip.getEntries();
  } catch {
    return { ok: false, error: 'malformed-zip' };
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    return { ok: false, error: 'missing-manifest' };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch {
    return { ok: false, error: 'malformed-manifest' };
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] == null) {
      return { ok: false, error: 'malformed-manifest' };
    }
  }

  if (manifest.app_id !== APP_ID) {
    return { ok: false, error: 'wrong-app-id' };
  }

  if (compareSemver(APP_VERSION, manifest.from_version_min) < 0) {
    return { ok: false, error: 'version-too-old' };
  }

  const asarEntry = zip.getEntry('app.asar');
  if (!asarEntry) {
    return { ok: false, error: 'missing-asar' };
  }

  const asarBytes = asarEntry.getData();
  const actualSha = crypto.createHash('sha256').update(asarBytes).digest('hex');
  if (actualSha !== manifest.asar_sha256) {
    return { ok: false, error: 'asar-hash-mismatch' };
  }

  return { ok: true, manifest, currentVersion: APP_VERSION };
}

// ---------- stagePatch ----------

function stagePatch(zipPath, installDir) {
  const zip = new AdmZip(zipPath);
  const asarEntry = zip.getEntry('app.asar');
  if (!asarEntry) {
    throw new Error('stagePatch: app.asar missing from zip — call probeZip first');
  }

  const resourcesDir = path.join(installDir, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });

  const pendingPath = path.join(resourcesDir, 'app.asar.pending');
  // Idempotent: overwrite any prior staged patch.
  fs.writeFileSync(pendingPath, asarEntry.getData());

  const markerPath = path.join(installDir, '.patch-pending');
  const manifestEntry = zip.getEntry('manifest.json');
  const markerBody = manifestEntry
    ? manifestEntry.getData().toString('utf8')
    : JSON.stringify({ staged_at: new Date().toISOString() });
  fs.writeFileSync(markerPath, markerBody);

  return { ok: true };
}

// ---------- revertLast ----------

function revertLast(installDir) {
  const resourcesDir = path.join(installDir, 'resources');
  const bakPath  = path.join(resourcesDir, 'app.asar.bak');
  const asarPath = path.join(resourcesDir, 'app.asar');

  if (!fs.existsSync(bakPath)) {
    return { canRevert: false };
  }

  // Stage the swap by moving the current app.asar to .pending and renaming
  // .bak → .asar. The running Electron process holds the post-patch code in
  // memory, so it's safe to rename the on-disk asar — the rename takes effect
  // on next launch.
  const pendingPath = path.join(resourcesDir, 'app.asar.pending');
  try {
    if (fs.existsSync(asarPath)) {
      // If a .pending already exists from a prior staging, overwrite it.
      if (fs.existsSync(pendingPath)) fs.rmSync(pendingPath, { force: true });
      fs.renameSync(asarPath, pendingPath);
    }
    fs.renameSync(bakPath, asarPath);
  } catch (err) {
    return { canRevert: false, error: 'revert-failed: ' + err.message };
  }

  // Write a marker so the next launch (or a follow-up helper) knows a revert
  // happened. Task 7 may extend patch-apply.cmd to consume this.
  try {
    fs.writeFileSync(path.join(installDir, '.patch-reverted'),
                     JSON.stringify({ reverted_at: new Date().toISOString() }));
  } catch { /* marker is best-effort */ }

  return {
    canRevert: true,
    instructions: 'Restart DL-Processor to complete the revert.',
  };
}

module.exports = {
  compareSemver,
  probeZip,
  stagePatch,
  revertLast,
  // Exposed for tests / diagnostics:
  APP_ID,
  APP_VERSION,
};
