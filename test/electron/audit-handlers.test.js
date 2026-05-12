const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../../src/migrations');
const { unitHistory } = require('../../src/commands/audit-query');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'A')").run();
  db.prepare(`INSERT INTO master_data (project_id, unit_number_norm, buyer_name, purchase_price_aed, buyer_source, price_source)
              VALUES (1, '101', 'Ali Alghumlasi', 1500000, 'staff', 'dld_approved')`).run();
  return db;
}

test('unitHistory returns current master_data + chronological events', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, old_value, new_value, action, source)
              VALUES (1, '101', 'master_data', 'purchase_price_aed', '1485000', '1500000', 'override', 'review_pending')`).run();
  const out = unitHistory(db, { projectId: 1, unitNumberNorm: '101' });
  assert.ok(out.current);
  assert.equal(out.current.buyer_name, 'Ali Alghumlasi');
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].action, 'override');
});

test('unitHistory returns events newest first', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, old_value, new_value, action, source, ts)
                          VALUES (1, '101', 'master_data', 'buyer_name', 'A', 'B', 'approve', 'review_pending', ?)`);
  ins.run('2026-01-01 10:00:00');
  ins.run('2026-05-01 10:00:00');
  ins.run('2026-03-01 10:00:00');
  const out = unitHistory(db, { projectId: 1, unitNumberNorm: '101' });
  const tss = out.events.map(e => e.ts);
  const sorted = [...tss].sort().reverse();
  assert.deepEqual(tss, sorted);
});

test('unitHistory returns current=null when master_data has no row', () => {
  const db = freshDb();
  const out = unitHistory(db, { projectId: 1, unitNumberNorm: '999' });
  assert.equal(out.current, null);
  assert.deepEqual(out.events, []);
});
