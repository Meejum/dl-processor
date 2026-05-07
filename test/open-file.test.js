const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openFile } = require('../src/open-file');

test('openFile does not throw on the host platform; spawns detached', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-openfile-'));
  const f = path.join(dir, 'smoke.txt');
  fs.writeFileSync(f, 'hello');
  try {
    if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
      assert.doesNotThrow(() => openFile(f));
    } else {
      assert.throws(() => openFile(f), /unsupported platform/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
