const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTier2, DEFAULT_THRESHOLDS } = require('../src/tier2');

test('isTier2: price % threshold crossed → true', () => {
  // 100 → 120 = 20% change, default threshold is 10% → tier-2
  assert.equal(isTier2('purchase_price_aed', '100', '120', DEFAULT_THRESHOLDS), true);
});

test('isTier2: price absolute threshold crossed → true', () => {
  // 100,000 → 200,000 = 100% change AND 100K absolute. Default abs threshold
  // is 50,000 → tier-2 (either dimension can fire).
  assert.equal(isTier2('purchase_price_aed', '100000', '200000', DEFAULT_THRESHOLDS), true);
});

test('isTier2: area % threshold crossed → true', () => {
  // 100 → 110 = 10% change, default area threshold is 5% → tier-2
  assert.equal(isTier2('area_sqm', '100', '110', DEFAULT_THRESHOLDS), true);
});

test('isTier2: sub-threshold change → false', () => {
  // 100 → 105 = 5% change, BELOW default 10% AND below 50K abs (just 5)
  assert.equal(isTier2('purchase_price_aed', '100', '105', DEFAULT_THRESHOLDS), false);
  // 100 → 103 = 3% change, BELOW default 5% area threshold
  assert.equal(isTier2('area_sqm', '100', '103', DEFAULT_THRESHOLDS), false);
  // buyer_name change is never tier-2
  assert.equal(isTier2('buyer_name', 'Ali', 'Mohamed', DEFAULT_THRESHOLDS), false);
});
