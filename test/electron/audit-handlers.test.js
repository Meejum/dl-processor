const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../../src/migrations');
const { unitHistory, globalHistory } = require('../../src/commands/audit-query');

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

test('globalHistory filters by date range', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, action, source, ts)
                          VALUES (1, '101', 'master_data', 'price', 'approve', 'review_pending', ?)`);
  ins.run('2026-01-01 10:00:00');
  ins.run('2026-05-01 10:00:00');
  const out = globalHistory(db, { fromTs: '2026-04-01 00:00:00' });
  assert.equal(out.length, 1);
});

test('globalHistory filters by project + action', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (2, 'B')").run();
  db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, action, source)
              VALUES (1, '101', 'master_data', 'price', 'approve', 'review_pending')`).run();
  db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, action, source)
              VALUES (2, '201', 'master_data', 'price', 'override', 'review_pending')`).run();
  assert.equal(globalHistory(db, { projectId: 1 }).length, 1);
  assert.equal(globalHistory(db, { action: 'override' }).length, 1);
});

test('globalHistory paginates', () => {
  const db = freshDb();
  for (let i = 0; i < 150; i++) {
    db.prepare(`INSERT INTO audit_log (project_id, unit_number_norm, table_name, field, action, source)
                VALUES (1, ?, 'master_data', 'price', 'approve', 'review_pending')`).run(String(i));
  }
  const p1 = globalHistory(db, { limit: 100, offset: 0 });
  const p2 = globalHistory(db, { limit: 100, offset: 100 });
  assert.equal(p1.length, 100);
  assert.equal(p2.length, 50);
});
