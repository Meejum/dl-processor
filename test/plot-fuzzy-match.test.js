const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { compareProject } = require('../src/compare');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

test('plot project — DLD unit numbers do not align with SF, matched by buyer+price', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'JOHN SMITH', 5000000)`).run();
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 1, 'Sale', '2026-01-01', 'JOHN SMITH', 5000000)`).run();

  const result = compareProject(db, 1);
  const matches = result.rows.filter(r => r.match_status === 'MATCH');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].sf_applicant, 'JOHN SMITH');
  assert.ok(matches[0].match_reasons.includes('plot match'));
});

test('plot match rejects when buyer name is too generic', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'GENERAL INVESTMENTS GROUP HOLDINGS', 5000000)`).run();
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 1, 'Sale', '2026-01-01', 'INTERNATIONAL HOLDINGS COMPANY GROUP', 5000000)`).run();

  const result = compareProject(db, 1);
  assert.equal(result.rows.filter(r => r.match_status === 'MATCH').length, 0);
});

test('plot match rejects when price differs by more than 5%', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Sobha Reserve');
  db.prepare(`INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source) VALUES (1, 'Sobha Reserve', '', 'Sobha Reserve', 'sub_project', 'override')`).run();
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');

  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (1, 'Sobha Reserve', 'Sobha Reserve', 'V-42', 'V-42', 'JOHN SMITH', 5000000)`).run();
  db.prepare(`INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, unit_type) VALUES (1, 1, 1, '9999', '9999', 'Land')`).run();
  db.prepare(`INSERT INTO dld_transaction (snapshot_id, unit_id, project_id, tx_type, tx_date_iso, party_name, amount_aed) VALUES (1, 1, 1, 'Sale', '2026-01-01', 'JOHN SMITH', 6000000)`).run();

  const result = compareProject(db, 1);
  assert.equal(result.rows.filter(r => r.match_status === 'MATCH').length, 0);
});
