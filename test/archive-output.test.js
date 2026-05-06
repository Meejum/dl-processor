const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { archiveOutput } = require('../src/archive');

test('archiveOutput copies all files except archive/ subdirectory', () => {
  const tmp = path.join(__dirname, '..', 'tmp-archive-test-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    fs.mkdirSync(path.join(tmp, 'compare'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dashboard.html'), '<html>x</html>');
    fs.writeFileSync(path.join(tmp, 'compare', 'A.html'), '<html>a</html>');
    // Pre-existing archive subdir should NOT be copied:
    fs.mkdirSync(path.join(tmp, 'archive', 'older'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'archive', 'older', 'old.html'), '<html>old</html>');

    const res = archiveOutput(tmp);
    assert.equal(res.ok, true);
    assert.equal(res.count, 2, 'only the 2 non-archive files should be copied');
    assert.ok(fs.existsSync(path.join(res.dest, 'dashboard.html')));
    assert.ok(fs.existsSync(path.join(res.dest, 'compare', 'A.html')));
    assert.ok(!fs.existsSync(path.join(res.dest, 'archive')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('archiveOutput returns ok=false when output dir does not exist', () => {
  const tmp = path.join(__dirname, '..', 'tmp-archive-nonexistent-' + Date.now());
  const res = archiveOutput(tmp);
  assert.equal(res.ok, false);
});
