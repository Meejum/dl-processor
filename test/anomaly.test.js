const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceJump, areaJump, novelProcedure, lateBuyerChange } = require('../src/anomaly');

// ───── priceJump (>25% on purchase_price) ─────

test('priceJump: >25% on purchase_price triggers', () => {
  assert.equal(priceJump({ field: 'purchase_price', delta_pct: 30 }), true);
  assert.equal(priceJump({ field: 'purchase_price', delta_pct: 25.01 }), true);
});

test('priceJump: boundary 25% does NOT trigger (strict >)', () => {
  assert.equal(priceJump({ field: 'purchase_price', delta_pct: 25 }), false);
});

test('priceJump: <25% does not trigger', () => {
  assert.equal(priceJump({ field: 'purchase_price', delta_pct: 10 }), false);
  assert.equal(priceJump({ field: 'purchase_price', delta_pct: -30 }), false);
});

test('priceJump: wrong field returns false even at >25%', () => {
  assert.equal(priceJump({ field: 'buyer_name', delta_pct: 99 }), false);
  assert.equal(priceJump({ field: 'area_sqm', delta_pct: 99 }), false);
});

// ───── areaJump (>10% on area_sqm) ─────

test('areaJump: >10% on area_sqm triggers', () => {
  assert.equal(areaJump({ field: 'area_sqm', delta_pct: 11 }), true);
  assert.equal(areaJump({ field: 'area_sqm', delta_pct: 50 }), true);
});

test('areaJump: boundary 10% does NOT trigger (strict >)', () => {
  assert.equal(areaJump({ field: 'area_sqm', delta_pct: 10 }), false);
});

test('areaJump: wrong field returns false', () => {
  assert.equal(areaJump({ field: 'purchase_price', delta_pct: 99 }), false);
});

// ───── novelProcedure ─────

test('novelProcedure: unseen in trailing months triggers', () => {
  const ctx = { seenInTrailingMonths: () => false };
  assert.equal(novelProcedure({ field: 'procedure_number', new_value: 'X-9999' }, ctx), true);
});

test('novelProcedure: seen returns false', () => {
  const ctx = { seenInTrailingMonths: () => true };
  assert.equal(novelProcedure({ field: 'procedure_number', new_value: 'X-9999' }, ctx), false);
});

test('novelProcedure: passes value + window to ctx callback', () => {
  let captured = null;
  const ctx = { seenInTrailingMonths: (val, months) => { captured = { val, months }; return false; } };
  novelProcedure({ field: 'procedure_number', new_value: 'P-42' }, ctx);
  assert.deepEqual(captured, { val: 'P-42', months: 6 });
});

test('novelProcedure: wrong field returns false', () => {
  const ctx = { seenInTrailingMonths: () => false };
  assert.equal(novelProcedure({ field: 'buyer_name', new_value: 'X' }, ctx), false);
});

test('novelProcedure: missing ctx helper returns false (safe default)', () => {
  assert.equal(novelProcedure({ field: 'procedure_number', new_value: 'X-9999' }, {}), false);
  assert.equal(novelProcedure({ field: 'procedure_number', new_value: 'X-9999' }, null), false);
});

// ───── lateBuyerChange ─────

test('lateBuyerChange: buyer change on completed BP triggers', () => {
  assert.equal(lateBuyerChange({ field: 'buyer_name', bp_state: 'completed' }), true);
});

test('lateBuyerChange: incomplete BP returns false', () => {
  assert.equal(lateBuyerChange({ field: 'buyer_name', bp_state: 'pending' }), false);
  assert.equal(lateBuyerChange({ field: 'buyer_name', bp_state: null }), false);
  assert.equal(lateBuyerChange({ field: 'buyer_name' }), false);
});

test('lateBuyerChange: wrong field returns false', () => {
  assert.equal(lateBuyerChange({ field: 'purchase_price', bp_state: 'completed' }), false);
});
