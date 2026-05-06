const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const {
  getMasterRow,
  upsertMasterField,
  seedMasterFromDld
} = require('../src/master-data');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  return db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name).lastInsertRowid;
}

test('getMasterRow returns null when no row exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  assert.equal(getMasterRow(db, pid, '999'), null);
});

test('upsertMasterField creates new row when none exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.ok(row.buyer_decided_at);
  assert.equal(row.purchase_price_aed, null);
  assert.equal(row.area_sqm, null);
});

test('upsertMasterField updates only the targeted field; others untouched', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  upsertMasterField(db, pid, '101', 'purchase_price_aed', 1500000, 'dld_approved');
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.purchase_price_aed, 1500000);
  assert.equal(row.price_source, 'dld_approved');
});

test('seedMasterFromDld populates all fields with source=dld_approved on a fresh unit', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  seedMasterFromDld(db, pid, '101', {
    buyer_name: 'ALICE',
    purchase_price_aed: 1500000,
    status: 'Sell - Pre registration',
    procedure_number: '12345/2024',
    area_sqm: 75.5
  });
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.purchase_price_aed, 1500000);
  assert.equal(row.area_sqm, 75.5);
  assert.equal(row.buyer_source, 'dld_approved');
  assert.equal(row.price_source, 'dld_approved');
  assert.equal(row.area_source, 'dld_approved');
});

test('seedMasterFromDld is a no-op when row already exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  seedMasterFromDld(db, pid, '101', { buyer_name: 'BOB', purchase_price_aed: 9999 });
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE', 'staff value should be preserved');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.purchase_price_aed, null, 'no fields should be added by no-op seed');
});
