const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateApproveHtml } = require('../src/approve-html');

function tmpHtml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-html-'));
  return { dir, file: path.join(dir, 'approve-pending.html') };
}

const SAMPLE_ROWS = [
  { change_id: 1, project_name: 'Hartland II', unit_number_norm: 'A-101', field_name: 'purchase_price_aed',
    old_value: '1000000', proposed_value: '1004000', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30 10:00:00' },
  { change_id: 2, project_name: 'Hartland II', unit_number_norm: 'A-101', field_name: 'buyer_name',
    old_value: 'Smith', proposed_value: 'Smyth', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30 10:00:00' },
  { change_id: 3, project_name: 'Sky Tower',   unit_number_norm: 'B-202', field_name: 'area_sqm',
    old_value: '75', proposed_value: '75.4', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30 10:00:00' }
];

const TOLS = { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };

test('generateApproveHtml writes a self-contained HTML file with brandBar and totals', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(SAMPLE_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /class="brand"/);
    assert.match(html, /Approve Pending Master-Data Changes/);
    assert.match(html, /3 pending/);
    assert.match(html, /1 buyer/);
    assert.match(html, /1 price/);
    assert.match(html, /1 area/);
    assert.equal(/<script[^>]+src=/i.test(html), false, 'must not load external scripts');
    assert.equal(/<link[^>]+rel="stylesheet"/i.test(html), false, 'must not load external stylesheets');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('generateApproveHtml renders one row per pending change with all required columns', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(SAMPLE_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /data-change-id="1"/);
    assert.match(html, /data-change-id="2"/);
    assert.match(html, /data-change-id="3"/);
    assert.match(html, /1000000.*1004000/s);
    assert.match(html, /Smith.*Smyth/s);
    assert.match(html, /data-sort-val="0\.4"/);
    assert.match(html, /data-sort-val="0\.53"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('generateApproveHtml emits all required toolbar buttons + Save/Load draft', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(SAMPLE_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /id="btn-approve-all"/);
    assert.match(html, /id="btn-approve-within-tolerance"/);
    assert.match(html, /id="btn-approve-field-price"/);
    assert.match(html, /id="btn-reject-field-buyer"/);
    assert.match(html, /id="btn-reset-skip"/);
    assert.match(html, /id="btn-export-decisions"/);
    assert.match(html, /id="btn-save-draft"/);
    assert.match(html, /id="btn-load-draft"/);
    assert.match(html, /id="counter-approved"/);
    assert.match(html, /id="counter-rejected"/);
    assert.match(html, /id="counter-skipped"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('generateApproveHtml writes empty-state HTML when no pending rows', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml([], TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /No pending changes/);
    assert.match(html, /class="brand"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
