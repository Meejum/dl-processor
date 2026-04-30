const test = require('node:test');
const assert = require('node:assert/strict');
const { namesOverlap } = require('../src/compare');

test('returns false when either input is empty/null', () => {
  assert.equal(namesOverlap(null, 'JOHN DOE'), false);
  assert.equal(namesOverlap('JOHN DOE', null), false);
  assert.equal(namesOverlap('', 'JOHN DOE'), false);
  assert.equal(namesOverlap('JOHN DOE', ''), false);
});

test('strips English title prefixes before comparing', () => {
  assert.equal(namesOverlap('MR. JOHN DOE', 'JOHN DOE'), true);
  assert.equal(namesOverlap('Dr SARAH SMITH', 'SARAH SMITH'), true);
});

test('matches identical names', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JOHN DOE'), true);
});

test('matches when one name is a token-subset of the other (extra middle name)', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JOHN MICHAEL DOE'), true);
  assert.equal(namesOverlap('JOHN MICHAEL DOE', 'JOHN DOE'), true);
});

test('matches name-order swaps', () => {
  assert.equal(namesOverlap('SARAH JANE THOMPSON', 'THOMPSON SARAH JANE'), true);
});

test('matches Mohammed/Mohammad transliteration variants', () => {
  assert.equal(namesOverlap('MOHAMMED HASSAN AL FARSI', 'MOHAMMAD HASSAN AL FARSI'), true);
  assert.equal(namesOverlap('MUHAMMAD ALI', 'MOHAMMED ALI'), true);
});

test('matches common Arabic-name transliteration variants', () => {
  assert.equal(namesOverlap('IBRAHIM KHALID', 'EBRAHIM KHALED'), true);
  assert.equal(namesOverlap('YUSUF AHMED', 'YOUSEF AHMAD'), true);
  assert.equal(namesOverlap('FATIMA HUSSEIN', 'FATHIMA HUSSAIN'), true);
});

test('does NOT match when 3-char Arabic particles are the only overlap', () => {
  assert.equal(namesOverlap('AHMED BIN SULTAN', 'HAMAD BIN RASHID'), false);
});

test('does NOT match when only AL/EL/ABU/UMM/BINT particles overlap', () => {
  assert.equal(namesOverlap('SAEED AL FARSI', 'KHALID AL ANSARI'), false);
  assert.equal(namesOverlap('AHMED ABU BAKR', 'HAMAD ABU YOUSEF'), false);
});

test('does NOT match completely unrelated names', () => {
  assert.equal(namesOverlap('JOHN DOE', 'JANE SMITH'), false);
});

test('does NOT match when shared token is a stripped title', () => {
  assert.equal(namesOverlap('MR. ALICE BROWN', 'MR. CHARLIE GREEN'), false);
});

test('handles Arabic-script-only inputs gracefully (no crash, returns false)', () => {
  assert.equal(namesOverlap('احمد', 'محمد'), false);
});
