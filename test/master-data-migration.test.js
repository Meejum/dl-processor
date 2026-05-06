const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  const info = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name);
  return info.lastInsertRowid;
}

test('migration: manual_override row → master_data row with buyer_source=staff', () => {
  const db = buildDb();
  // Pre-seed manual_override BEFORE re-running migration. We need to clear
  // master_data first because buildDb() already ran migrateSchema once.
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Alpha');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, notes, created_at, updated_at)
              VALUES (?, '101', 'ALICE', 'verified by Ali', '2026-01-01 10:00:00', '2026-01-02 11:00:00')`).run(pid);
  // Run migrateSchema again — should now seed from manual_override.
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.ok(row, 'expected master_data row');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.buyer_decided_at, '2026-01-02 11:00:00');
  assert.equal(row.notes, 'verified by Ali');
  assert.equal(row.area_sqm, null);
});

test('migration: manual_area row → master_data row with area_source=staff (no override)', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Beta');
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, source_note, entered_by, created_at, updated_at)
              VALUES (?, '202', 75.5, 'CRM update', 'ali', '2026-01-01 10:00:00', '2026-01-02 11:00:00')`).run(pid);
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '202');
  assert.ok(row);
  assert.equal(row.area_sqm, 75.5);
  assert.equal(row.area_source, 'staff');
  assert.equal(row.buyer_name, null);
});

test('migration: manual_override + manual_area for same unit → one master_data row with both fields', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Gamma');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, created_at, updated_at)
              VALUES (?, '303', 'BOB', '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, created_at, updated_at)
              VALUES (?, '303', 88.2, '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '303');
  assert.equal(row.buyer_name, 'BOB');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.area_sqm, 88.2);
  assert.equal(row.area_source, 'staff');
});

test('migration: idempotent — running migrateSchema twice does not duplicate rows', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Delta');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, created_at, updated_at)
              VALUES (?, '404', 'CAROL', '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  migrateSchema(db);
  migrateSchema(db);  // second run is a no-op
  const count = db.prepare('SELECT COUNT(*) AS n FROM master_data WHERE project_id=?').get(pid).n;
  assert.equal(count, 1);
});
