const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrateSchema } = require('../src/db');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

test('runAuditDelta result HTML contains DLD # and SF # column headers', () => {
  const db = buildDb();
  const pid = db.prepare('INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix) VALUES (?, ?, ?)').run('TestProj', 'TestProj Sub', 'P').lastInsertRowid;
  const sid = db.prepare(`INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, total_units, total_tx) VALUES (?, 'csv', 'fake.csv', '2026-01-01', 1, 1)`).run(pid).lastInsertRowid;
  const uid = db.prepare(`INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area) VALUES (?, ?, '101', '101', 75)`).run(sid, pid).lastInsertRowid;
  db.prepare(`INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed) VALUES (?, ?, ?, 'ALICE', 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1000000)`).run(uid, sid, pid);
  const sfSid = db.prepare(`INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 1)`).run().lastInsertRowid;
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price) VALUES (?, 'TestProj Sub', 'P-101', 'P-101', 'ALICE', 1000000)`).run(sfSid);
  // Create a project_mapping so compareProject can find the SF link
  db.prepare(`INSERT OR IGNORE INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix) VALUES (?, 'TestProj Sub', 'P')`).run(pid);

  const masSid = db.prepare(`INSERT INTO manual_audit_snapshot (source_file, source_sha256, as_of_month) VALUES ('audit.xlsx', 'abc', '2026-01')`).run().lastInsertRowid;
  const mapSid = db.prepare(`INSERT INTO manual_audit_project (manual_audit_snapshot_id, sheet_name, project_id) VALUES (?, 'TestProj', ?)`).run(masSid, pid).lastInsertRowid;
  db.prepare(`INSERT INTO manual_audit_row (manual_audit_project_id, sub_project, sf_unit, unit_number_norm, sf_applicant, name_match, price_match) VALUES (?, 'TestProj Sub', 'P-101', '101', 'ALICE', 1, 1)`).run(mapSid);

  const { runAuditDelta } = require('../src/audit-delta');
  const tmpDir = path.join(__dirname, '..', 'tmp-audit-delta-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    runAuditDelta({ db, outDir: tmpDir });
    const htmlFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.html'));
    assert.ok(htmlFiles.length > 0, 'audit-delta HTML was written');
    const htmlContent = fs.readFileSync(path.join(tmpDir, htmlFiles[0]), 'utf8');
    assert.ok(htmlContent.includes('DLD #'), 'HTML contains DLD # column header');
    assert.ok(htmlContent.includes('SF #'),  'HTML contains SF # column header');
  } finally {
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  }
});
