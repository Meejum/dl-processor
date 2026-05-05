const test = require('node:test');
const assert = require('node:assert/strict');
const { getAreaThreshold } = require('../src/project-mapping');

test('returns hard default 5 when nothing supplied', () => {
  assert.equal(getAreaThreshold({}, {}, 'Sobha One'), 5);
  assert.equal(getAreaThreshold(null, null, 'Sobha One'), 5);
});

test('uses config defaults.areaThresholdPct when no project override', () => {
  const config = { defaults: { areaThresholdPct: 7 } };
  assert.equal(getAreaThreshold({}, config, 'Sobha One'), 7);
});

test('config per-project override beats config defaults', () => {
  const config = {
    defaults: { areaThresholdPct: 5 },
    overrides: { 'Sobha Reserve': { areaThresholdPct: 8 } }
  };
  assert.equal(getAreaThreshold({}, config, 'Sobha Reserve'), 8);
  assert.equal(getAreaThreshold({}, config, 'Sobha One'), 5);
});

test('DB project_mapping.area_threshold_pct beats everything', () => {
  const mapping = { area_threshold_pct: 12 };
  const config = {
    defaults: { areaThresholdPct: 5 },
    overrides: { 'Sobha Reserve': { areaThresholdPct: 8 } }
  };
  assert.equal(getAreaThreshold(mapping, config, 'Sobha Reserve'), 12);
});

test('null/undefined DB value falls through', () => {
  const mapping = { area_threshold_pct: null };
  const config = { defaults: { areaThresholdPct: 6 } };
  assert.equal(getAreaThreshold(mapping, config, 'X'), 6);
});

test('zero is rejected as invalid; falls through', () => {
  const mapping = { area_threshold_pct: 0 };
  const config = { defaults: { areaThresholdPct: 6 } };
  assert.equal(getAreaThreshold(mapping, config, 'X'), 6);
});
