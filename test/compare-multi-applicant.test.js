const test = require('node:test');
const assert = require('node:assert/strict');
const { findMatchingApplicant, SF_APPLICANT_FIELDS } = require('../src/compare');

test('returns null when buyer is empty', () => {
  assert.equal(findMatchingApplicant(null, { applicant_name: 'JOHN DOE' }), null);
  assert.equal(findMatchingApplicant('', { applicant_name: 'JOHN DOE' }), null);
});

test('returns "applicant_name" when primary matches', () => {
  const sfRow = { applicant_name: 'JOHN DOE' };
  assert.equal(findMatchingApplicant('JOHN DOE', sfRow), 'applicant_name');
});

test('returns "applicant_2_name" when only applicant_2 matches', () => {
  const sfRow = { applicant_name: 'JOHN DOE', applicant_2_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_2_name');
});

test('returns "applicant_3_name" when only applicant_3 matches', () => {
  const sfRow = { applicant_name: 'A', applicant_2_name: 'B', applicant_3_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_3_name');
});

test('returns "applicant_4_name" when only applicant_4 matches', () => {
  const sfRow = { applicant_name: 'A', applicant_2_name: 'B', applicant_3_name: 'C', applicant_4_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_4_name');
});

test('returns "applicant_details" when only applicant_details matches', () => {
  const sfRow = { applicant_name: 'A', applicant_details: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_details');
});

test('primary takes precedence when multiple slots could match', () => {
  const sfRow = { applicant_name: 'JANE SMITH', applicant_2_name: 'JANE SMITH' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), 'applicant_name');
});

test('returns null when no slot matches', () => {
  const sfRow = { applicant_name: 'A B', applicant_2_name: 'C D' };
  assert.equal(findMatchingApplicant('JANE SMITH', sfRow), null);
});

test('SF_APPLICANT_FIELDS lists the five slots in priority order', () => {
  assert.deepEqual(SF_APPLICANT_FIELDS, [
    'applicant_name',
    'applicant_2_name',
    'applicant_3_name',
    'applicant_4_name',
    'applicant_details'
  ]);
});
