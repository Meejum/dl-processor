const test = require('node:test');
const assert = require('node:assert/strict');
const { guessSubProjectFromDldName } = require('../src/project-mapping');

function makeInferred(entries) {
  const m = new Map();
  for (const [sub, info] of entries) m.set(sub, info);
  return m;
}

test('exact-substring match still wins (no regression)', () => {
  const inferred = makeInferred([
    ['Waves', { sub_project: 'Waves', prefix: 'W', total: 100 }],
    ['Waves 2', { sub_project: 'Waves 2', prefix: 'W2', total: 50 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Hartland Waves 2', inferred), 'Waves 2');
});

test('fuzzy match finds SF sub_project when DLD name is shorter', () => {
  const inferred = makeInferred([
    ['Sobha ONE Tower A', { sub_project: 'Sobha ONE Tower A', prefix: 'SO-A', total: 80 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha One', inferred), 'Sobha ONE Tower A');
});

test('fuzzy match handles spacing/case differences', () => {
  const inferred = makeInferred([
    ['Sea Haven', { sub_project: 'Sea Haven', prefix: 'SH', total: 60 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Seahaven', inferred), 'Sea Haven');
});

test('returns null when no candidate shares meaningful tokens', () => {
  const inferred = makeInferred([
    ['Creek Vistas', { sub_project: 'Creek Vistas', prefix: 'CV', total: 40 }]
  ]);
  assert.equal(guessSubProjectFromDldName('Sobha Hartland Waves', inferred), null);
});

test('returns null when input is empty', () => {
  const inferred = makeInferred([
    ['Waves', { sub_project: 'Waves', prefix: 'W', total: 100 }]
  ]);
  assert.equal(guessSubProjectFromDldName('', inferred), null);
  assert.equal(guessSubProjectFromDldName(null, inferred), null);
});

test('prefers the candidate with more shared distinctive tokens', () => {
  const inferred = makeInferred([
    ['Creek Vistas', { sub_project: 'Creek Vistas', prefix: 'CV', total: 40 }],
    ['Creek Vistas Grande', { sub_project: 'Creek Vistas Grande', prefix: 'CVG', total: 30 }]
  ]);
  assert.equal(
    guessSubProjectFromDldName('Creek Vistas Grande Tower A', inferred),
    'Creek Vistas Grande'
  );
});
