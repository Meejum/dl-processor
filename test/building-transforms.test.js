const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedSfUnit } = require('../src/project-mapping');

test('falls back to unitTransforms when buildingName is not in buildingTransforms', () => {
  const mapping = {
    sf_unit_prefix: 'W',
    unitTransforms: [{ match: '^RETAIL\\s*(\\d+)$', replace: 'R$1' }]
  };
  assert.equal(expectedSfUnit('RETAIL 5', mapping, 'Some Building'), 'W-R5');
});

test('uses buildingTransforms[buildingName] when key matches', () => {
  const mapping = {
    sf_unit_prefix: '',
    buildingTransforms: {
      'Sobha One - A': [{ match: '^A(\\d+)$', replace: 'SO-A$1' }],
      'Sobha One - B': [{ match: '^B(\\d+)$', replace: 'SO-B$1' }]
    }
  };
  assert.equal(expectedSfUnit('A1001', mapping, 'Sobha One - A'), 'SO-A1001');
  assert.equal(expectedSfUnit('B1001', mapping, 'Sobha One - B'), 'SO-B1001');
});

test('empty sf_unit_prefix returns transform output verbatim (no prepend)', () => {
  const mapping = {
    sf_unit_prefix: '',
    unitTransforms: [{ match: '^(\\d+)$', replace: '310 RSC-$1' }]
  };
  assert.equal(expectedSfUnit('101', mapping, null), '310 RSC-101');
});

test('non-empty prefix prepends to transform output', () => {
  const mapping = {
    sf_unit_prefix: 'CG',
    unitTransforms: [{ match: '^([ABC])(\\d+)$', replace: '$1$2' }]
  };
  assert.equal(expectedSfUnit('A1001', mapping, null), 'CG-A1001');
});

test('returns null for empty unit', () => {
  assert.equal(expectedSfUnit(null, { sf_unit_prefix: 'W' }, null), null);
  assert.equal(expectedSfUnit('', { sf_unit_prefix: 'W' }, null), null);
});

test('buildingTransforms takes priority even when unitTransforms also matches', () => {
  const mapping = {
    sf_unit_prefix: '',
    unitTransforms:    [{ match: '^A(\\d+)$', replace: 'GENERIC-$1' }],
    buildingTransforms: { 'Tower X': [{ match: '^A(\\d+)$', replace: 'TX-$1' }] }
  };
  assert.equal(expectedSfUnit('A100', mapping, 'Tower X'), 'TX-100');
});
