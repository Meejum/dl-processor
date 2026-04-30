const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const { Writable } = require('stream');
const { runAudit } = require('../src/audit-report');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  return db;
}

function captureStream() {
  const chunks = [];
  const w = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
  w.toString = () => Buffer.concat(chunks).toString('utf8');
  return w;
}

test('runAudit on empty DB prints headline and returns zero counts', () => {
  const db = setupDb();
  const out = captureStream();
  const result = runAudit({ db, out });
  const text = out.toString();
  assert.ok(text.includes('DL-PROCESSOR AUDIT'));
  assert.ok(text.includes('HEADLINE'));
  assert.equal(result.dldProjects, 0);
  assert.equal(result.sfBookings, 0);
});

test('runAudit reports DLD project count and SF booking count', () => {
  const db = setupDb();
  db.prepare('INSERT INTO dld_project (project_id, project_name) VALUES (1, ?)').run('Test Project');
  db.prepare("INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file) VALUES (1, 1, 'csv', 'test.csv')").run();
  db.prepare('INSERT INTO sf_snapshot (sf_snapshot_id, source_file) VALUES (1, ?)').run('test.xlsx');
  db.prepare(`INSERT INTO sf_booking (sf_snapshot_id, project, sub_project, unit, unit_norm, applicant_name) VALUES (1, 'P', 'S', 'U-1', 'U-1', 'X')`).run();

  const out = captureStream();
  const result = runAudit({ db, out });
  assert.equal(result.dldProjects, 1);
  assert.equal(result.sfBookings, 1);
  const text = out.toString();
  assert.ok(text.includes('1 projects'));
});
