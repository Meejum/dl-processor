const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyBp } = require('../src/bp-classifier');

test('classifyBp: Resale = buyer + price + procedure', () => {
  assert.equal(classifyBp(new Set(['buyer_name', 'purchase_price_aed', 'procedure_number'])), 'Resale');
});

test('classifyBp: Resale with status optional in the mix', () => {
  assert.equal(classifyBp(new Set(['buyer_name', 'purchase_price_aed', 'procedure_number', 'status'])), 'Resale');
});

test('classifyBp: Buyer correction = buyer_name alone', () => {
  assert.equal(classifyBp(new Set(['buyer_name'])), 'Buyer correction');
});

test('classifyBp: Price amendment = purchase_price_aed alone', () => {
  assert.equal(classifyBp(new Set(['purchase_price_aed'])), 'Price amendment');
});

test('classifyBp: Status update = status alone', () => {
  assert.equal(classifyBp(new Set(['status'])), 'Status update');
});

test('classifyBp: Procedure update = procedure_number alone', () => {
  assert.equal(classifyBp(new Set(['procedure_number'])), 'Procedure update');
});

test('classifyBp: Area correction = area_sqm alone', () => {
  assert.equal(classifyBp(new Set(['area_sqm'])), 'Area correction');
});

test('classifyBp: Multi-field update = any other combination (e.g., buyer + price WITHOUT procedure)', () => {
  assert.equal(classifyBp(new Set(['buyer_name', 'purchase_price_aed'])), 'Multi-field update');
});

test('classifyBp: Multi-field update for status + procedure together', () => {
  assert.equal(classifyBp(new Set(['status', 'procedure_number'])), 'Multi-field update');
});

test('classifyBp: defensive — empty set or non-Set input falls through to Multi-field update', () => {
  assert.equal(classifyBp(new Set()), 'Multi-field update');
  assert.equal(classifyBp(null), 'Multi-field update');
  assert.equal(classifyBp(undefined), 'Multi-field update');
});
