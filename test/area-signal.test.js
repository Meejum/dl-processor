const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAreaSignal } = require('../src/compare');

test('returns kind="none" when either side is null', () => {
  assert.equal(computeAreaSignal(null, 100, 5).kind, 'none');
  assert.equal(computeAreaSignal(100, null, 5).kind, 'none');
});

test('returns kind="none" when either side is non-positive', () => {
  assert.equal(computeAreaSignal(0, 100, 5).kind, 'none');
  assert.equal(computeAreaSignal(100, -5, 5).kind, 'none');
});

test('returns kind="none" when |Δ%| < 0.5', () => {
  // 100.4 vs 100 = 0.4%, below noise floor
  const s = computeAreaSignal(100.4, 100, 5);
  assert.equal(s.kind, 'none');
});

test('returns kind="flag" when |Δ%| ≥ 0.5 and < threshold', () => {
  // 102 vs 100 = 2%, threshold 5
  const s = computeAreaSignal(102, 100, 5);
  assert.equal(s.kind, 'flag');
  assert.equal(Math.round(s.diff), 2);
  assert.ok(Math.abs(s.pct - 2) < 0.001);
});

test('returns kind="hard" when |Δ%| ≥ threshold', () => {
  // 110 vs 100 = 10%, threshold 5
  const s = computeAreaSignal(110, 100, 5);
  assert.equal(s.kind, 'hard');
  assert.equal(Math.round(s.diff), 10);
  assert.ok(Math.abs(s.pct - 10) < 0.001);
});

test('threshold boundary is inclusive of "hard"', () => {
  // exactly 5%
  const s = computeAreaSignal(105, 100, 5);
  assert.equal(s.kind, 'hard');
});

test('negative direction (DLD smaller than recorded) escalates by absolute value', () => {
  const s = computeAreaSignal(90, 100, 5);
  assert.equal(s.kind, 'hard');
  assert.equal(Math.round(s.diff), -10);
});

test('per-project threshold honoured', () => {
  // 7% gap, threshold 8 → flag (not hard)
  const s = computeAreaSignal(107, 100, 8);
  assert.equal(s.kind, 'flag');
});
