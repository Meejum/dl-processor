const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName } = require('../src/normalize-name');

test('returns empty string for null/undefined/empty', () => {
  assert.equal(normalizeName(null), '');
  assert.equal(normalizeName(undefined), '');
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName('   '), '');
});

test('lowercases', () => {
  assert.equal(normalizeName('ALI ALGHUMLASI'), 'ali alghumlasi');
});

test('collapses internal whitespace', () => {
  assert.equal(normalizeName('Ali   Alghumlasi'), 'ali alghumlasi');
});

test('strips leading title Mr./Mrs./Ms./Dr./Eng./Sheikh/Sh.', () => {
  assert.equal(normalizeName('Mr. Ali Alghumlasi'),  'ali alghumlasi');
  assert.equal(normalizeName('Mrs Ali Alghumlasi'),  'ali alghumlasi');
  assert.equal(normalizeName('Ms. Aisha Khan'),      'aisha khan');
  assert.equal(normalizeName('Dr Ahmed Salem'),      'ahmed salim');     // via transliteration map (salem → salim)
  assert.equal(normalizeName('Eng. Omar Marri'),     'omar marri');
  assert.equal(normalizeName('Sheikh Mohammed'),     'mohamed');         // via transliteration map
  assert.equal(normalizeName('Sh. Khalid'),          'khaled');          // via transliteration map
});

test('punctuation becomes single space', () => {
  assert.equal(normalizeName('Ali-Alghumlasi'),    'ali alghumlasi');
  assert.equal(normalizeName('Ali, Alghumlasi'),   'ali alghumlasi');
  assert.equal(normalizeName('A.B.Smith'),         'a b smith');
});

test('applies transliteration map (al- prefix collapse)', () => {
  assert.equal(normalizeName('Ali Al-Ghumlasi'),  'ali alghumlasi');
  assert.equal(normalizeName('Ali Al Ghumlasi'),  'ali alghumlasi');
});

test('applies transliteration map (mohammad/mohammed/muhammad → mohamed)', () => {
  assert.equal(normalizeName('Mohammad Hassan'),   'mohamed hassan');
  assert.equal(normalizeName('Mohammed Hassan'),   'mohamed hassan');
  assert.equal(normalizeName('Muhammad Hassan'),   'mohamed hassan');
});

test('idempotent — normalize(normalize(x)) === normalize(x)', () => {
  const inputs = ['Mr. Ali Al-Ghumlasi', 'MOHAMMAD HASSAN', 'Sheikh Mohammed bin Rashid'];
  for (const x of inputs) {
    assert.equal(normalizeName(normalizeName(x)), normalizeName(x));
  }
});

test('non-string input is coerced via String()', () => {
  assert.equal(normalizeName(12345), '12345');
});
