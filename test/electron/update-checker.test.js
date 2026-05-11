const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLatestYml, compareVersions, buildUpdateResult } = require('../../electron/update-checker');

const SAMPLE_YML = `version: 1.0.1
path: DL-Processor Setup 1.0.1.exe
releaseDate: '2026-05-11T10:00:00.000Z'
`;

test('parseLatestYml extracts version, path, and releaseDate', () => {
  const parsed = parseLatestYml(SAMPLE_YML);
  assert.equal(parsed.version, '1.0.1');
  assert.equal(parsed.path, 'DL-Processor Setup 1.0.1.exe');
  assert.equal(parsed.releaseDate, '2026-05-11T10:00:00.000Z');
});

test('compareVersions returns +1 / 0 / -1 for newer / same / older', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'),  1);
  assert.equal(compareVersions('1.0.0', '1.0.0'),  0);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.1.0', '1.0.9'),  1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('buildUpdateResult: newer available → status=available with downloadUrl', () => {
  const r = buildUpdateResult('1.0.0', {
    version: '1.0.1', path: 'DL-Processor Setup 1.0.1.exe', releaseDate: '2026-05-11T10:00:00.000Z'
  }, 'https://dl-processor.pages.dev');
  assert.equal(r.status, 'available');
  assert.equal(r.available, '1.0.1');
  assert.equal(r.downloadUrl, 'https://dl-processor.pages.dev/DL-Processor%20Setup%201.0.1.exe');
  assert.match(r.message, /update available: 1\.0\.1/i);
});

test('buildUpdateResult: same or older → status=up-to-date', () => {
  const r = buildUpdateResult('1.0.0', { version: '1.0.0', path: 'x' }, 'https://x');
  assert.equal(r.status, 'up-to-date');
  assert.match(r.message, /up to date/i);
});
