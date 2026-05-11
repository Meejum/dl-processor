const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const { openFile } = require('../src/open-file');

function withStubbedSpawn(fn) {
  const calls = [];
  const stubs = [];
  const orig = cp.spawn;
  cp.spawn = (...args) => {
    calls.push(args);
    const handlers = {};
    const stub = {
      on(event, fn) { handlers[event] = fn; return stub; },
      unref() {},
      emit(event, ...rest) { if (handlers[event]) handlers[event](...rest); }
    };
    stubs.push(stub);
    return stub;
  };
  try {
    fn(calls, stubs);
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

test('openFile attaches an error listener so async spawn failures do not crash the parent', () => {
  withStubbedSpawn((calls, stubs) => {
    openFile('C:/fake/path/smoke.txt');
    assert.equal(stubs.length, 1);
    // Simulate child_process emitting 'error' (e.g. xdg-open not installed).
    // Without an attached listener this would throw an uncaught exception.
    assert.doesNotThrow(() => stubs[0].emit('error', new Error('ENOENT: xdg-open not found')));
  });
});
