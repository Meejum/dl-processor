const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const { openFile } = require('../src/open-file');

function withStubbedSpawn(fn) {
  const calls = [];
  const orig = cp.spawn;
  cp.spawn = (...args) => {
    calls.push(args);
    return { unref() {} };
  };
  try {
    fn(calls);
  } finally {
    cp.spawn = orig;
  }
}

test('openFile spawns a detached child for the host platform', () => {
  withStubbedSpawn((calls) => {
    if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') {
      assert.doesNotThrow(() => openFile('C:/fake/path/smoke.txt'));
      assert.equal(calls.length, 1);
      const [, , opts] = calls[0];
      assert.equal(opts.detached, true);
      assert.equal(opts.stdio, 'ignore');
    } else {
      assert.throws(() => openFile('C:/fake/path/smoke.txt'), /unsupported platform/);
      assert.equal(calls.length, 0);
    }
  });
});

test('openFile on win32 uses cmd /s /c start "" with verbatim-quoted path', () => {
  if (process.platform !== 'win32') return;
  withStubbedSpawn((calls) => {
    openFile('C:/some dir/has & special.txt');
    const [cmd, args, opts] = calls[0];
    assert.equal(cmd, 'cmd');
    assert.deepEqual(args.slice(0, 2), ['/s', '/c']);
    assert.match(args[2], /^start "" "C:\/some dir\/has & special\.txt"$/);
    assert.equal(opts.windowsVerbatimArguments, true);
    assert.equal(opts.shell, false);
  });
});
