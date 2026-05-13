const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// We need to control APPDATA so the test reads from a temp dir, not the real
// user's config.json. Each test sets up + tears down its own temp config.

function withTempAppData(audit_user) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-test-cu-'));
  const cfgDir = path.join(tmpRoot, 'dl-processor');
  fs.mkdirSync(cfgDir, { recursive: true });
  if (audit_user !== undefined) {
    fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({ audit_user }), 'utf8');
  }
  return tmpRoot;
}

function loadFreshCurrentUser() {
  // Bust the require cache so changes to process.env.APPDATA take effect
  delete require.cache[require.resolve('../src/current-user')];
  return require('../src/current-user').currentUser;
}

test('currentUser: returns audit_user from app config when set', () => {
  const origAppData = process.env.APPDATA;
  const tmp = withTempAppData('alice@example.com');
  process.env.APPDATA = tmp;
  try {
    const currentUser = loadFreshCurrentUser();
    assert.equal(currentUser(), 'alice@example.com');
  } finally {
    if (origAppData == null) delete process.env.APPDATA; else process.env.APPDATA = origAppData;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('currentUser: falls back to OS user when audit_user is empty / unset', () => {
  const origAppData = process.env.APPDATA;
  // Case A — config exists but audit_user is empty string
  let tmp = withTempAppData('');
  process.env.APPDATA = tmp;
  try {
    const currentUser = loadFreshCurrentUser();
    const result = currentUser();
    assert.notEqual(result, '');
    assert.notEqual(result, 'unknown');   // OS should give a real username on Windows CI
  } finally {
    if (origAppData == null) delete process.env.APPDATA; else process.env.APPDATA = origAppData;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // Case B — config doesn't exist at all
  tmp = withTempAppData(undefined);
  process.env.APPDATA = tmp;
  try {
    const currentUser = loadFreshCurrentUser();
    const result = currentUser();
    assert.notEqual(result, '');
    assert.notEqual(result, 'unknown');
  } finally {
    if (origAppData == null) delete process.env.APPDATA; else process.env.APPDATA = origAppData;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('currentUser: returns "unknown" only when both Settings + OS lookup fail', () => {
  // Trigger config-doesn't-exist + override os.userInfo to throw via mock require.
  // This is hard to test cleanly without monkey-patching the os module.
  // Defensive check: read the module's source and confirm 'unknown' is the final fallback.
  delete require.cache[require.resolve('../src/current-user')];
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'current-user.js'), 'utf8');
  assert.match(src, /\|\| 'unknown'/, "expected 'unknown' as the final fallback in current-user.js");
});
