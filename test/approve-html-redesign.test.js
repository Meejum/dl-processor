const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateApproveHtml } = require('../src/approve-html');

function tmpHtml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-html-redesign-'));
  return { dir, file: path.join(dir, 'approve-pending.html') };
}

const TOLS = { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };

const FOUR_SECTION_ROWS = [
  // Buyer (Hartland II)
  { change_id: 10, project_name: 'Hartland II', unit_number_norm: 'A-101', field_name: 'buyer_name',
    old_value: 'Smith', proposed_value: 'Smyth', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
    sf_unit: 'A-101', sf_applicant: 'Smith', sf_price: 1000000, current_buyer: 'Smith' },
  // Buyer (Sky Tower)
  { change_id: 11, project_name: 'Sky Tower', unit_number_norm: 'B-1', field_name: 'buyer_name',
    old_value: 'Bob', proposed_value: 'Robert', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
    sf_unit: 'B-1', sf_applicant: 'Bob', sf_price: 2000000, current_buyer: 'Bob' },
  // Price (Hartland II)
  { change_id: 20, project_name: 'Hartland II', unit_number_norm: 'A-101', field_name: 'purchase_price_aed',
    old_value: '1000000', proposed_value: '1004000', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
    sf_unit: 'A-101', sf_applicant: 'Smith', sf_price: 1000000, current_buyer: 'Smith' },
  // Area (Sky Tower)
  { change_id: 30, project_name: 'Sky Tower', unit_number_norm: 'B-1', field_name: 'area_sqm',
    old_value: '75', proposed_value: '75.4', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
    sf_unit: 'B-1', sf_applicant: 'Bob', sf_price: 2000000, current_buyer: 'Bob' },
  // Status (Hartland II) — Other section
  { change_id: 40, project_name: 'Hartland II', unit_number_norm: 'A-102', field_name: 'status',
    old_value: 'Sell - Pre registration', proposed_value: 'Sell', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
    sf_unit: 'A-102', sf_applicant: 'Khan', sf_price: 3000000, current_buyer: 'Khan' }
];

test('redesign: renders 4 section headers with correct counts', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(FOUR_SECTION_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /Buyer\s*—\s*2 pending/);
    assert.match(html, /Price\s*—\s*1 pending/);
    assert.match(html, /Area\s*—\s*1 pending/);
    assert.match(html, /Other\s*—\s*1 pending/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redesign: project group headers appear inside each section', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(FOUR_SECTION_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /class="group-header"[^>]*>\s*Hartland II\s*—\s*1\s*pending/);
    assert.match(html, /class="group-header"[^>]*>\s*Sky Tower\s*—\s*1\s*pending/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redesign: SF unit column populated when match exists', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(FOUR_SECTION_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /data-sf-unit="A-101"/);
    assert.match(html, /data-sf-unit="B-1"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redesign: [DLD only] badge appears when sf_unit is null', () => {
  const { dir, file } = tmpHtml();
  try {
    const dldOnly = [{
      change_id: 99, project_name: 'Orphan', unit_number_norm: 'X-1', field_name: 'buyer_name',
      old_value: 'Old', proposed_value: 'New', source_snapshot_date: '2026-04-30', proposed_at: '2026-04-30',
      sf_unit: null, sf_applicant: null, sf_price: null, current_buyer: 'Old'
    }];
    generateApproveHtml(dldOnly, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /\[DLD only\]/);
    assert.match(html, /X-1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redesign: editable proposed-input pre-filled with proposed_value and data-original attribute', () => {
  const { dir, file } = tmpHtml();
  try {
    generateApproveHtml(FOUR_SECTION_ROWS, TOLS, file);
    const html = fs.readFileSync(file, 'utf8');
    // Buyer row → text input pre-filled with 'Smyth'.
    assert.match(html, /<input[^>]+class="proposed-input"[^>]+type="text"[^>]+data-original="Smyth"[^>]+value="Smyth"/);
    // Price row → number input pre-filled with '1004000'.
    assert.match(html, /<input[^>]+class="proposed-input"[^>]+type="number"[^>]+data-original="1004000"[^>]+value="1004000"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
