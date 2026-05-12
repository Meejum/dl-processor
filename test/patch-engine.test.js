const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const {
  compareSemver,
  probeZip,
  stagePatch,
  revertLast,
} = require('../electron/patch-engine');

const APP_ID = 'ae.sobha.dl-processor';

function tmpDir(label) {
  const dir = path.join(os.tmpdir(), 'dl-patch-test-' + label + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Build a patch zip on disk for tests.
function buildZip(zipPath, opts = {}) {
  const asarBytes = opts.asarBytes != null ? opts.asarBytes : Buffer.from('FAKE-ASAR-' + Math.random());
  const asarSha = opts.asarShaOverride
    || crypto.createHash('sha256').update(asarBytes).digest('hex');

  const manifest = Object.assign({
    app_id:           APP_ID,
    from_version_min: '1.0.0',
    to_version:       '1.2.0',
    built_at:         new Date().toISOString(),
    asar_sha256:      asarSha,
    asar_size:        asarBytes.length,
    release_notes:    '',
  }, opts.manifestOverrides || {});

  const zip = new AdmZip();
  if (!opts.skipManifest) {
    const body = opts.manifestRaw != null
      ? opts.manifestRaw
      : Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    zip.addFile('manifest.json', body);
  }
  if (!opts.skipAsar) {
    zip.addFile('app.asar', asarBytes);
  }
  zip.writeZip(zipPath);
  return { manifest, asarBytes };
}

// ---------- compareSemver ----------

test('compareSemver: equal versions return 0', () => {
  assert.equal(compareSemver('1.2.0', '1.2.0'), 0);
});

test('compareSemver: smaller version returns negative', () => {
  assert.ok(compareSemver('1.1.9', '1.2.0') < 0);
});

test('compareSemver: greater version returns positive', () => {
  assert.ok(compareSemver('1.3.0', '1.2.0') > 0);
});

test('compareSemver: -dev suffix is treated as the bare version', () => {
  // 1.2.0-dev compared against 1.2.0 → equal (per spec: equal-to or just-below)
  assert.equal(compareSemver('1.2.0-dev', '1.2.0'), 0);
  // And -dev should still be >= an older version
  assert.ok(compareSemver('1.2.0-dev', '1.1.0') > 0);
});

test('compareSemver: handles three-vs-two part versions', () => {
  assert.equal(compareSemver('1.2', '1.2.0'), 0);
  assert.ok(compareSemver('1.2', '1.2.1') < 0);
});

// ---------- probeZip ----------

test('probeZip: returns ok=true with manifest + currentVersion for a valid zip', () => {
  const dir = tmpDir('probe-valid');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    const { manifest } = buildZip(zipPath, {
      manifestOverrides: { from_version_min: '1.0.0', to_version: '1.2.0' },
    });
    const res = probeZip(zipPath);
    assert.equal(res.ok, true);
    assert.equal(res.manifest.app_id, APP_ID);
    assert.equal(res.manifest.to_version, '1.2.0');
    assert.equal(res.manifest.asar_sha256, manifest.asar_sha256);
    assert.ok(typeof res.currentVersion === 'string' && res.currentVersion.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns zip-not-found when path does not exist', () => {
  const res = probeZip(path.join(os.tmpdir(), 'definitely-missing-' + Date.now() + '.zip'));
  assert.equal(res.ok, false);
  assert.equal(res.error, 'zip-not-found');
});

test('probeZip: returns malformed-zip for non-zip file', () => {
  const dir = tmpDir('probe-bad');
  try {
    const zipPath = path.join(dir, 'not-a-zip.zip');
    fs.writeFileSync(zipPath, 'this is not a zip file at all');
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'malformed-zip');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns missing-manifest when manifest.json absent', () => {
  const dir = tmpDir('probe-no-manifest');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath, { skipManifest: true });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing-manifest');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns malformed-manifest when manifest is not valid JSON', () => {
  const dir = tmpDir('probe-bad-manifest');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath, { manifestRaw: Buffer.from('not-json{{{', 'utf8') });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'malformed-manifest');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns wrong-app-id when manifest.app_id mismatch', () => {
  const dir = tmpDir('probe-wrong-id');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath, { manifestOverrides: { app_id: 'some.other.app' } });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'wrong-app-id');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns version-too-old when current < from_version_min', () => {
  const dir = tmpDir('probe-too-old');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    // Current app is 1.2.0-dev (from package.json). Require a future version.
    buildZip(zipPath, { manifestOverrides: { from_version_min: '99.0.0', to_version: '99.1.0' } });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'version-too-old');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns missing-asar when app.asar absent', () => {
  const dir = tmpDir('probe-no-asar');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath, { skipAsar: true });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing-asar');
  } finally {
    cleanup(dir);
  }
});

test('probeZip: returns asar-hash-mismatch when stored hash does not match bytes', () => {
  const dir = tmpDir('probe-hash');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath, { asarShaOverride: 'a'.repeat(64) });
    const res = probeZip(zipPath);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'asar-hash-mismatch');
  } finally {
    cleanup(dir);
  }
});

// ---------- stagePatch ----------

test('stagePatch: extracts app.asar to .pending and writes marker', () => {
  const dir = tmpDir('stage-ok');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    const { asarBytes } = buildZip(zipPath);

    const installDir = path.join(dir, 'install');
    fs.mkdirSync(path.join(installDir, 'resources'), { recursive: true });

    const res = stagePatch(zipPath, installDir);
    assert.equal(res.ok, true);

    const pendingPath = path.join(installDir, 'resources', 'app.asar.pending');
    assert.ok(fs.existsSync(pendingPath), 'pending asar should exist');
    const written = fs.readFileSync(pendingPath);
    assert.equal(written.length, asarBytes.length);
    assert.equal(crypto.createHash('sha256').update(written).digest('hex'),
                 crypto.createHash('sha256').update(asarBytes).digest('hex'));

    const markerPath = path.join(installDir, '.patch-pending');
    assert.ok(fs.existsSync(markerPath), 'marker file should exist');
  } finally {
    cleanup(dir);
  }
});

test('stagePatch: is idempotent — overwrites existing .pending and marker', () => {
  const dir = tmpDir('stage-idempotent');
  try {
    const zipPath = path.join(dir, 'patch.zip');
    buildZip(zipPath);

    const installDir = path.join(dir, 'install');
    fs.mkdirSync(path.join(installDir, 'resources'), { recursive: true });

    // Pre-existing stale files
    fs.writeFileSync(path.join(installDir, 'resources', 'app.asar.pending'), 'stale-old-content');
    fs.writeFileSync(path.join(installDir, '.patch-pending'), 'stale-marker');

    const res = stagePatch(zipPath, installDir);
    assert.equal(res.ok, true);

    const written = fs.readFileSync(path.join(installDir, 'resources', 'app.asar.pending'), 'utf8');
    assert.notEqual(written, 'stale-old-content', 'pending should have been overwritten');
  } finally {
    cleanup(dir);
  }
});
