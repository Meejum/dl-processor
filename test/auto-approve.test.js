const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadAutoApproveConfig, shouldAutoApprove } = require('../src/auto-approve');

const REPO_CONFIG = path.join(__dirname, '..', 'config', 'auto-approve.json');

function withTempConfig(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-auto-'));
  const p = path.join(dir, 'auto-approve.json');
  fs.writeFileSync(p, contents, 'utf8');
  try { fn(p); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('loadAutoApproveConfig returns repo defaults when no path given and repo file exists', () => {
  const cfg = loadAutoApproveConfig();
  assert.equal(cfg.price_tolerance_pct, 0.5);
  assert.equal(cfg.area_tolerance_pct, 0.5);
});

test('loadAutoApproveConfig returns baked-in defaults when explicit path is missing', () => {
  const cfg = loadAutoApproveConfig('/nonexistent/path/auto-approve.json');
  assert.equal(cfg.price_tolerance_pct, 0.5);
  assert.equal(cfg.area_tolerance_pct, 0.5);
});

test('loadAutoApproveConfig reads valid file at explicit path', () => {
  withTempConfig(JSON.stringify({ price_tolerance_pct: 1.0, area_tolerance_pct: 2.5 }), p => {
    const cfg = loadAutoApproveConfig(p);
    assert.equal(cfg.price_tolerance_pct, 1.0);
    assert.equal(cfg.area_tolerance_pct, 2.5);
  });
});

test('loadAutoApproveConfig throws on negative tolerance', () => {
  withTempConfig(JSON.stringify({ price_tolerance_pct: -0.1, area_tolerance_pct: 0.5 }), p => {
    assert.throws(() => loadAutoApproveConfig(p), /price_tolerance_pct/);
  });
});

test('loadAutoApproveConfig throws on missing key', () => {
  withTempConfig(JSON.stringify({ price_tolerance_pct: 0.5 }), p => {
    assert.throws(() => loadAutoApproveConfig(p), /area_tolerance_pct/);
  });
});

test('loadAutoApproveConfig throws on non-numeric value', () => {
  withTempConfig(JSON.stringify({ price_tolerance_pct: 'low', area_tolerance_pct: 0.5 }), p => {
    assert.throws(() => loadAutoApproveConfig(p), /price_tolerance_pct/);
  });
});

const CFG = { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };

test('shouldAutoApprove: identity fields always false', () => {
  assert.equal(shouldAutoApprove('buyer_name',       'A', 'B',   'dld_approved', CFG), false);
  assert.equal(shouldAutoApprove('procedure_number', '1', '2',   'dld_approved', CFG), false);
  assert.equal(shouldAutoApprove('status',           'X', 'Y',   'dld_approved', CFG), false);
});

test('shouldAutoApprove: price within tolerance returns true', () => {
  assert.equal(shouldAutoApprove('purchase_price_aed', 1000000, 1004000, 'dld_approved', CFG), true);
  assert.equal(shouldAutoApprove('purchase_price_aed', 1000000, 1005000, 'dld_approved', CFG), true);
});

test('shouldAutoApprove: price above tolerance returns false', () => {
  assert.equal(shouldAutoApprove('purchase_price_aed', 1000000, 1006000, 'dld_approved', CFG), false);
});

test('shouldAutoApprove: area within tolerance returns true; staff source returns false', () => {
  assert.equal(shouldAutoApprove('area_sqm', 100,  100.4, 'dld_approved', CFG), true);
  assert.equal(shouldAutoApprove('area_sqm', 100,  100.4, 'staff',        CFG), false);
});

test('shouldAutoApprove: null/zero old values disqualify', () => {
  assert.equal(shouldAutoApprove('purchase_price_aed', null, 100,   'dld_approved', CFG), false);
  assert.equal(shouldAutoApprove('purchase_price_aed', 100,  null,  'dld_approved', CFG), false);
  assert.equal(shouldAutoApprove('purchase_price_aed', 0,    100,   'dld_approved', CFG), false);
});
