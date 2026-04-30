const test = require('node:test');
const assert = require('node:assert/strict');
const { detectHeaderRow, buildSfHeaderIndex } = require('../src/salesforce');

const HEADERS_FULL = [
  null,
  'Business Process: Business Process Name',
  null,
  'Booking: Sub Project',
  'Unit',
  'Booking: Booking Name',
  'Project',
  'Booking: Tower Name',
  'Booking: Primary Applicant Name',
  'Booking: Purchase Price',
  'Booking: DLD Amount'
];

test('buildSfHeaderIndex maps known headers to column indices', () => {
  const idx = buildSfHeaderIndex(HEADERS_FULL);
  assert.equal(idx.bpName, 1);
  assert.equal(idx.subProject, 3);
  assert.equal(idx.unit, 4);
  assert.equal(idx.applicantName, 8);
  assert.equal(idx.purchasePrice, 9);
});

test('buildSfHeaderIndex matches "Applicant Name" alias', () => {
  const idx = buildSfHeaderIndex([null, 'Applicant Name']);
  assert.equal(idx.applicantName, 1);
});

test('buildSfHeaderIndex returns empty object for unrecognized headers', () => {
  const idx = buildSfHeaderIndex(['random', 'unrelated', 'columns']);
  for (const k of Object.keys(idx)) assert.equal(k, '_natCols', 'unexpected mapped field: ' + k);
});

test('buildSfHeaderIndex is case-insensitive and ignores extra whitespace', () => {
  const idx = buildSfHeaderIndex([null, '  BOOKING:  PRIMARY  APPLICANT  NAME  ']);
  assert.equal(idx.applicantName, 1);
});

test('detectHeaderRow finds the header row when buried under preamble', () => {
  const aoa = [
    [null], ['Some title'], ['Generated 2026-04-21'], [null], [null], [null], [null], [null], [null],
    HEADERS_FULL
  ];
  const { row, count } = detectHeaderRow(aoa);
  assert.equal(row, 9);
  assert.ok(count >= 6, 'expected ≥6 fields mapped, got ' + count);
});

test('detectHeaderRow scans rows 0..12 for best match', () => {
  const aoa = [HEADERS_FULL, [null], [null]];
  const { row } = detectHeaderRow(aoa);
  assert.equal(row, 0);
});

test('detectHeaderRow collects nationality columns into _natCols', () => {
  const headers = [null, 'Booking: Nationality', 'Unit', 'Booking: Primary Applicant Name', 'Booking: Sub Project', 'Project', 'Booking: Booking Name', 'Nationality'];
  const idx = buildSfHeaderIndex(headers);
  assert.deepEqual(idx._natCols, [1, 7]);
});
