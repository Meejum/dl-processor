const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { listFilesInDir, parseSelection } = require('../src/file-picker');

function makeTmpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-test-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x', 'utf8');
  return dir;
}

test('listFilesInDir filters by extension (case-insensitive) and sorts', () => {
  const dir = makeTmpDir(['b.CSV', 'a.xps', 'note.txt', 'c.xps']);
  try {
    const result = listFilesInDir(dir, ['.xps', '.csv']);
    const names = result.map(p => path.basename(p));
    assert.deepEqual(names, ['a.xps', 'b.CSV', 'c.xps']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listFilesInDir returns [] for missing directory', () => {
  assert.deepEqual(listFilesInDir(path.join(os.tmpdir(), 'no-such-dir-' + Date.now()), ['.xps']), []);
  assert.deepEqual(listFilesInDir(null, ['.xps']), []);
});

test('listFilesInDir with empty extensions returns all files', () => {
  const dir = makeTmpDir(['a.xps', 'b.txt']);
  try {
    const result = listFilesInDir(dir, []);
    assert.equal(result.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSelection picks single file by number', () => {
  const files = ['/p/a', '/p/b', '/p/c'];
  assert.deepEqual(parseSelection('1', files, false), ['/p/a']);
  assert.deepEqual(parseSelection('2', files, true),  ['/p/b']);
});

test('parseSelection picks multiple files with comma list when multi=true', () => {
  const files = ['/p/a', '/p/b', '/p/c'];
  assert.deepEqual(parseSelection('1,3', files, true), ['/p/a', '/p/c']);
});

test('parseSelection limits to first when multi=false', () => {
  const files = ['/p/a', '/p/b', '/p/c'];
  assert.deepEqual(parseSelection('1,3', files, false), ['/p/a']);
});

test('parseSelection accepts numeric range', () => {
  const files = ['/p/a', '/p/b', '/p/c', '/p/d'];
  assert.deepEqual(parseSelection('2-4', files, true), ['/p/b', '/p/c', '/p/d']);
});

test('parseSelection ignores out-of-range indices', () => {
  const files = ['/p/a', '/p/b'];
  assert.deepEqual(parseSelection('5', files, false), []);
});

test('parseSelection returns typed path verbatim when not numeric', () => {
  assert.deepEqual(parseSelection('input/foo.csv', [], false), ['input/foo.csv']);
  assert.deepEqual(parseSelection('"C:\\path with spaces\\foo.csv"', [], false), ['C:\\path with spaces\\foo.csv']);
});

test('parseSelection returns [] for empty input', () => {
  assert.deepEqual(parseSelection('', [], false), []);
  assert.deepEqual(parseSelection('   ', [], false), []);
});
