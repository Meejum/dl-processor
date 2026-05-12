const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig
} = require('../../electron/data-folder');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('defaultDataFolder is ~/Documents/DL-Processor on the host platform', () => {
  const d = defaultDataFolder(path.join(os.tmpdir(), 'fake-home', 'Documents'));
  assert.equal(d, path.join(os.tmpdir(), 'fake-home', 'Documents', 'DL-Processor'));
});

test('ensureDataFolderLayout creates root + 5 subfolders + an empty config file', () => {
  const root = path.join(tmpDir('dlp-data-'), 'DL-Processor');
  try {
    ensureDataFolderLayout(root);
    assert.ok(fs.existsSync(path.join(root, 'db')));
    assert.ok(fs.existsSync(path.join(root, 'input')));
    assert.ok(fs.existsSync(path.join(root, 'input', 'Changes Template Input')));
    assert.ok(fs.existsSync(path.join(root, 'output')));
    assert.ok(fs.existsSync(path.join(root, 'sf-input')));
    assert.ok(fs.existsSync(path.join(root, 'config')));
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

test('detectLegacyInstall finds a legacy db file when present', () => {
  const dir = tmpDir('dlp-legacy-');
  try {
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'db', 'dl-processor.db'), 'fakebinary');
    const result = detectLegacyInstall([dir]);
    assert.ok(result);
    assert.equal(result.dbPath, path.join(dir, 'db', 'dl-processor.db'));
    assert.equal(result.root, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('detectLegacyInstall returns null when no candidate paths have a db', () => {
  const dir = tmpDir('dlp-empty-');
  try {
    const result = detectLegacyInstall([dir]);
    assert.equal(result, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migrateLegacyData copies db/input/output/sf-input/config to target; leaves source intact', () => {
  const legacyDir = tmpDir('dlp-legacy-');
  const targetDir = path.join(tmpDir('dlp-target-'), 'DL-Processor');
  try {
    fs.mkdirSync(path.join(legacyDir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'db', 'dl-processor.db'), 'fakedb');
    fs.mkdirSync(path.join(legacyDir, 'input'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'input', 'sample.xps'), 'XPSDATA');
    fs.mkdirSync(path.join(legacyDir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'config', 'auto-approve.json'), '{"price_tolerance_pct":0.5,"area_tolerance_pct":0.5}');
    ensureDataFolderLayout(targetDir);
    const summary = migrateLegacyData(legacyDir, targetDir);
    assert.ok(fs.existsSync(path.join(targetDir, 'db', 'dl-processor.db')));
    assert.ok(fs.existsSync(path.join(targetDir, 'input', 'sample.xps')));
    assert.ok(fs.existsSync(path.join(targetDir, 'config', 'auto-approve.json')));
    // Source still intact.
    assert.ok(fs.existsSync(path.join(legacyDir, 'db', 'dl-processor.db')));
    assert.ok(summary.filesCopied >= 3);
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(targetDir), { recursive: true, force: true });
  }
});

test('loadAppConfig / saveAppConfig round-trip a config object through a JSON file', () => {
  const dir = tmpDir('dlp-cfg-');
  const cfgPath = path.join(dir, 'config.json');
  try {
    saveAppConfig(cfgPath, { dataFolder: 'C:/users/me/Documents/DL-Processor', version: '1.0.0' });
    const loaded = loadAppConfig(cfgPath);
    assert.equal(loaded.dataFolder, 'C:/users/me/Documents/DL-Processor');
    assert.equal(loaded.version, '1.0.0');
    // Missing file returns null without throwing.
    assert.equal(loadAppConfig(path.join(dir, 'nope.json')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
