const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const { getProjectsSummary, getProjectCompare } = require('../src/commands/compare-query');

const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'schema.sql'),
  'utf8'
);

function freshDb() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-cq-'));
  const db = new Database(path.join(tmp, 'test.db'));
  // Apply schema before migrations (same order as openDb in src/db.js)
  runMigrations(db);
  db.exec(SCHEMA_SQL);
  return { db, tmp };
}

function seedProject(db, { projectName = 'TestProj', subProject = 'TP', prefix = 'TP-' } = {}) {
  const info = db.prepare(`
    INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix)
    VALUES (?, ?, ?)
  `).run(projectName, subProject, prefix);
  return info.lastInsertRowid;
}

// Note: dld_snapshot requires source_format (NOT NULL CHECK 'xps'|'csv')
function seedSnapshots(db, projectId, { dldAt = '2026-05-12 10:00:00', sfAt = '2026-05-12 11:00:00' } = {}) {
  const dldSnap = db.prepare(`
    INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, imported_at)
    VALUES (?, 'xps', 'fake.xps', '2026-05-12', ?)
  `).run(projectId, dldAt).lastInsertRowid;
  const sfSnap = db.prepare(`
    INSERT INTO sf_snapshot (imported_at, source_file)
    VALUES (?, 'fake.xlsx')
  `).run(sfAt).lastInsertRowid;
  return { dldSnap, sfSnap };
}

test('getProjectsSummary: one row per project from listProjects', () => {
  const { db, tmp } = freshDb();
  try {
    seedProject(db, { projectName: 'Alpha' });
    seedProject(db, { projectName: 'Beta' });
    const rows = getProjectsSummary(db);
    const names = rows.map(r => r.project_name).sort();
    assert.deepEqual(names, ['Alpha', 'Beta']);
    for (const r of rows) {
      assert.ok('counts'        in r);
      assert.ok('total'         in r);
      assert.ok('pending_count' in r);
      assert.ok('source'        in r);
    }
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getProjectsSummary: SF-only project has null project_id and status sf-only', () => {
  const { db, tmp } = freshDb();
  try {
    seedProject(db, { projectName: 'WithDld' });
    const sfSnap = db.prepare(`
      INSERT INTO sf_snapshot (imported_at, source_file) VALUES ('2026-05-12 11:00:00','fake.xlsx')
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO sf_booking (sf_snapshot_id, booking_name, sub_project, unit, unit_norm, applicant_name, purchase_price, status)
      VALUES (?, 'BK-1', 'SfOnlyProj', 'X-1', 'X-1', 'Buyer', 1000000, 'OK')
    `).run(sfSnap);
    const rows = getProjectsSummary(db);
    const sfOnly = rows.find(r => r.project_name === 'SfOnlyProj');
    assert.ok(sfOnly, 'expected SfOnlyProj in summary');
    assert.equal(sfOnly.project_id, null);
    assert.equal(sfOnly.status, 'sf-only');
    assert.equal(sfOnly.total, 0);
    assert.equal(sfOnly.pending_count, 0);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getProjectsSummary: project with no DLD snapshot returns status no-dld-snapshot', () => {
  const { db, tmp } = freshDb();
  try {
    seedProject(db, { projectName: 'NoSnap' });
    const rows = getProjectsSummary(db);
    const r = rows.find(x => x.project_name === 'NoSnap');
    assert.ok(r);
    assert.equal(r.status, 'no-dld-snapshot');
    assert.equal(r.total, 0);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('getProjectsSummary: pending_count comes from pending_change WHERE decision=pending', () => {
  const { db, tmp } = freshDb();
  try {
    const pid = seedProject(db, { projectName: 'PendingProj' });
    // Schema uses old_value / proposed_value (not current_value / current_text)
    db.prepare(`
      INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, source_snapshot_id)
      VALUES (?, '101', 'buyer_name', 'Old', 'New', 'pending', NULL),
             (?, '102', 'buyer_name', 'X',   'Y',   'approved', NULL),
             (?, '103', 'buyer_name', 'A',   'B',   'pending',  NULL)
    `).run(pid, pid, pid);
    const r = getProjectsSummary(db).find(x => x.project_name === 'PendingProj');
    assert.equal(r.pending_count, 2);
  } finally {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
