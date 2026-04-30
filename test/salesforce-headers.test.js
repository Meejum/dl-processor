const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSfColumns, REQUIRED_HEADERS } = require('../src/salesforce');

test('resolveSfColumns maps every required header to a column index', () => {
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = label; });
  const cols = resolveSfColumns(headerRow);
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number', `missing column index for header "${label}"`);
  }
});

test('resolveSfColumns throws with a clear list when required headers are missing', () => {
  const partial = [null, 'Business Process: Business Process Name', 'something else'];
  assert.throws(
    () => resolveSfColumns(partial),
    /missing required Salesforce header/i
  );
});

test('resolveSfColumns trims whitespace around header cells', () => {
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = '  ' + label + '  '; });
  const cols = resolveSfColumns(headerRow);
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number');
  }
});

test('resolveSfColumns ignores extra columns not in REQUIRED_HEADERS', () => {
  const headerRow = [];
  REQUIRED_HEADERS.forEach((label, i) => { headerRow[i + 1] = label; });
  headerRow.push('Some Future Column');
  const cols = resolveSfColumns(headerRow);
  for (const label of REQUIRED_HEADERS) {
    assert.equal(typeof cols[label], 'number');
  }
});
