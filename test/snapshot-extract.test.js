const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/migrations');
const {
  pickLatestOfTypes,
  pickLatestPurchase,
  pickLatestMarketPrice,
  findLatestNonBankParty,
  extractUnitFields
} = require('../src/snapshot-extract');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

// --- pickLatestPurchase ---------------------------------------------------

test('pickLatestPurchase: returns latest Sale by tx_date_iso desc', () => {
  const txs = [
    { tx_type: 'Sale',          tx_date_iso: '2023-01-15', party_name: 'AHMED',  amount_aed: 1000 },
    { tx_type: 'Sale',          tx_date_iso: '2024-06-10', party_name: 'KHALID', amount_aed: 2000 },
    { tx_type: 'Mortgage',      tx_date_iso: '2025-01-01', party_name: 'EMIRATES NBD', amount_aed: 500 },
    { tx_type: 'Grant',         tx_date_iso: '2022-03-04', party_name: 'OLD',    amount_aed: 100 }
  ];
  const got = pickLatestPurchase(txs);
  assert.ok(got, 'should return a transaction');
  assert.equal(got.party_name, 'KHALID');
  assert.equal(got.tx_date_iso, '2024-06-10');
});

test('pickLatestPurchase: empty input returns null', () => {
  assert.equal(pickLatestPurchase([]), null);
});

// --- pickLatestMarketPrice -----------------------------------------------

test('pickLatestMarketPrice: returns latest market-price tx (Sell - Pre registration etc.)', () => {
  const txs = [
    { tx_type: 'Sell - Pre registration', tx_date_iso: '2024-03-01', party_name: 'BUYER1', amount_aed: 1_500_000 },
    { tx_type: 'Sale',                    tx_date_iso: '2025-02-02', party_name: 'BUYER2', amount_aed: 2_100_000 },
    { tx_type: 'Mortgage',                tx_date_iso: '2026-04-04', party_name: 'EMIRATES NBD', amount_aed: 700_000 },
    { tx_type: 'Grant',                   tx_date_iso: '2026-05-05', party_name: 'OTHER',  amount_aed: 0 }
  ];
  // Grant is in PURCHASE but NOT in MARKET; latest market should be the Sale on 2025-02-02
  const got = pickLatestMarketPrice(txs);
  assert.ok(got);
  assert.equal(got.party_name, 'BUYER2');
  assert.equal(got.amount_aed, 2_100_000);
});

test('pickLatestMarketPrice: empty input returns null', () => {
  assert.equal(pickLatestMarketPrice([]), null);
});

// --- findLatestNonBankParty ----------------------------------------------

test('findLatestNonBankParty: picks the last non-bank party_name, skipping bank prefixes', () => {
  const txs = [
    { tx_type: 'Sale',     tx_date_iso: '2022-01-01', party_name: 'OLD BUYER' },
    { tx_type: 'Sale',     tx_date_iso: '2024-06-01', party_name: 'AHMED ALGHUMLASI' },
    { tx_type: 'Mortgage', tx_date_iso: '2025-01-01', party_name: 'EMIRATES NBD' }
  ];
  // Sorted desc by tx_date_iso: EMIRATES NBD (bank, skip) → AHMED ALGHUMLASI
  assert.equal(findLatestNonBankParty(txs), 'AHMED ALGHUMLASI');
});

test('findLatestNonBankParty: all-bank input returns null', () => {
  const txs = [
    { tx_type: 'Mortgage', tx_date_iso: '2025-01-01', party_name: 'EMIRATES NBD' },
    { tx_type: 'Mortgage', tx_date_iso: '2024-01-01', party_name: 'HSBC BANK' }
  ];
  assert.equal(findLatestNonBankParty(txs), null);
});

// --- extractUnitFields ---------------------------------------------------

test('extractUnitFields: happy path joins dld_unit + dld_transaction → operational fields', () => {
  const db = freshDb();

  // Insert project, snapshot, building (optional), unit, transactions
  db.prepare(`
    INSERT INTO dld_project (project_id, project_name)
    VALUES (1, 'Test Project')
  `).run();

  db.prepare(`
    INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file, snapshot_date)
    VALUES (1, 1, 'csv', 'test.csv', '2026-05-01')
  `).run();

  db.prepare(`
    INSERT INTO dld_unit (unit_id, snapshot_id, project_id, unit_number, unit_number_norm, net_area)
    VALUES (10, 1, 1, '101', '101', 125.5)
  `).run();

  // Two purchase transactions: latest is the winner
  db.prepare(`
    INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, tx_type, tx_date, tx_date_iso, amount_aed)
    VALUES
      (10, 1, 1, 'OLD OWNER',    'Sale',                    '01/01/2023', '2023-01-01',  900000),
      (10, 1, 1, 'NEW OWNER',    'Sell - Pre registration', '15/03/2025', '2025-03-15', 1500000),
      (10, 1, 1, 'EMIRATES NBD', 'Mortgage',                '20/03/2025', '2025-03-20',  800000)
  `).run();

  const got = extractUnitFields(db, 1, 1, '101');
  assert.ok(got, 'should return an object');
  assert.equal(got.buyer_name,         'NEW OWNER');
  assert.equal(got.purchase_price_aed, 1500000);
  assert.equal(got.area_sqm,           125.5);
  assert.equal(got.status,             null);
  assert.equal(got.procedure_number,   null);
});

test('extractUnitFields: no matching unit_number_norm returns null', () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO dld_project (project_id, project_name)
    VALUES (1, 'Test Project')
  `).run();
  db.prepare(`
    INSERT INTO dld_snapshot (snapshot_id, project_id, source_format, source_file, snapshot_date)
    VALUES (1, 1, 'csv', 'test.csv', '2026-05-01')
  `).run();

  // No dld_unit row inserted — lookup must return null
  assert.equal(extractUnitFields(db, 1, 1, '999'), null);
});
