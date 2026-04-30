const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { categorize, buildProjectDelta, summarize } = require('../src/audit-delta');

test('categorize returns AGREE_MATCH when manual TRUE/TRUE and tool MATCH', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, { match_status: 'MATCH' }), 'AGREE_MATCH');
});

test('categorize returns AGREE_MISMATCH when manual has any FALSE and tool not MATCH', () => {
  assert.equal(categorize({ name_match: 0, price_match: 1 }, { match_status: 'BUYER_MISMATCH' }), 'AGREE_MISMATCH');
  assert.equal(categorize({ name_match: 1, price_match: 0 }, { match_status: 'PRICE_UP' }), 'AGREE_MISMATCH');
});

test('categorize returns TOOL_SOLVED when manual FALSE but tool MATCH', () => {
  assert.equal(categorize({ name_match: 0, price_match: 1 }, { match_status: 'MATCH' }), 'TOOL_SOLVED');
});

test('categorize returns TOOL_STRICTER when manual TRUE/TRUE but tool not MATCH', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, { match_status: 'BUYER_MISMATCH' }), 'TOOL_STRICTER');
});

test('categorize returns MANUAL_ONLY when only manual side present', () => {
  assert.equal(categorize({ name_match: 1, price_match: 1 }, null), 'MANUAL_ONLY');
});

test('categorize returns DL_ONLY when only tool side present', () => {
  assert.equal(categorize(null, { match_status: 'MATCH' }), 'DL_ONLY');
});

test('categorize returns MANUAL_BLANK when manual flags are both null', () => {
  assert.equal(categorize({ name_match: null, price_match: null }, { match_status: 'MATCH' }), 'MANUAL_BLANK');
});

test('summarize counts categories', () => {
  const rows = [
    { delta_category: 'AGREE_MATCH' },
    { delta_category: 'AGREE_MATCH' },
    { delta_category: 'TOOL_STRICTER' },
    { delta_category: 'DL_ONLY' }
  ];
  const c = summarize(rows);
  assert.equal(c.AGREE_MATCH, 2);
  assert.equal(c.TOOL_STRICTER, 1);
  assert.equal(c.DL_ONLY, 1);
  assert.equal(c.MANUAL_ONLY, 0);
});

test('buildProjectDelta joins tool and manual rows by unit identifier', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'P')").run();
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sub', 'X', 'Proj', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 't.csv')").run();
  db.prepare("INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, 'sf.xlsx')").run();
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Proj', 'Sub', 'X-101', 'X-101', 'JOHN DOE', 1000000)`).run();
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm) VALUES (1, 1, 1, '101', '101')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 1, 'Sale', '2026-01-01', 'JOHN DOE', 1000000)`).run();

  db.prepare(`INSERT INTO manual_audit_snapshot (manual_audit_snapshot_id, source_file, source_sha256, as_of_month, total_rows) VALUES (1, 'audit.xlsx', 'abc123', '2026-04', 1)`).run();
  db.prepare(`INSERT INTO manual_audit_project (manual_audit_project_id, manual_audit_snapshot_id, sheet_name, project_id, row_count) VALUES (1, 1, 'P', 1, 1)`).run();
  db.prepare(`INSERT INTO manual_audit_row (manual_audit_project_id, sf_unit, unit_number_norm, dld_unit, sf_applicant, sf_price, name_match, price_match) VALUES (1, 'X-101', '101', '101', 'JOHN DOE', 1000000, 1, 1)`).run();

  const d = buildProjectDelta(db, 1, 1);
  assert.equal(d.status, 'ok');
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].delta_category, 'AGREE_MATCH');
});
