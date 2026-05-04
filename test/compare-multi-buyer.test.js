const test = require('node:test');
const assert = require('node:assert/strict');
const { collectDldBuyers } = require('../src/compare');

function tx(partyName, opts = {}) {
  return {
    party_name: partyName,
    ft_share:   opts.ftShare   != null ? opts.ftShare   : 50,
    share_unit: opts.shareUnit || 'F.T.',
    tx_type:    opts.txType    || 'Sell - Pre registration',
    tx_date:    opts.txDate    || '04/02/2024',
    tx_date_iso: opts.txDateIso || '2024-02-04',
    amount_aed: opts.amountAed != null ? opts.amountAed : 1612613,
  };
}

test('collectDldBuyers returns one entry per transaction with split tx_type', () => {
  const rows = collectDldBuyers([
    tx('AHMAD MUJTABA MURTAZA', { ftShare: 34.68 }),
    tx('AHMAD MUSADIQ MURTAZA', { ftShare: 34.68 }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'AHMAD MUJTABA MURTAZA');
  assert.equal(rows[0].areaSqm, 34.68);
  assert.equal(rows[0].amountAed, 1612613);
  assert.equal(rows[0].txType, 'Sell');
  assert.equal(rows[0].txSubtype, 'Pre registration');
  assert.equal(rows[0].date, '04/02/2024');
  assert.equal(rows[0].kind, 'buyer');
});

test('collectDldBuyers labels banks via BANK_PREFIX_RE and empty-names as sellers', () => {
  const rows = collectDldBuyers([
    tx('EMIRATES NBD MORTGAGES'),
    tx('AHMAD'),
    tx(null, { ftShare: 78.56 }),
  ]);
  const byName = Object.fromEntries(rows.map(r => [r.name || '(null)', r.kind]));
  assert.equal(byName['EMIRATES NBD MORTGAGES'], 'bank');
  assert.equal(byName['AHMAD'], 'buyer');
  assert.equal(byName['(null)'], 'seller');
});

test('collectDldBuyers orders buyer entries before banks before sellers', () => {
  const rows = collectDldBuyers([
    tx(null),                           // seller
    tx('EMIRATES NBD MORTGAGES'),       // bank
    tx('AHMAD'),                        // buyer
  ]);
  assert.deepEqual(rows.map(r => r.kind), ['buyer', 'bank', 'seller']);
});

test('collectDldBuyers handles empty input', () => {
  assert.deepEqual(collectDldBuyers([]), []);
  assert.deepEqual(collectDldBuyers(null), []);
  assert.deepEqual(collectDldBuyers(undefined), []);
});

test('collectDldBuyers splits "Sell - Pre registration" into txType and txSubtype', () => {
  const [r] = collectDldBuyers([tx('A', { txType: 'Sell - Pre registration' })]);
  assert.equal(r.txType, 'Sell');
  assert.equal(r.txSubtype, 'Pre registration');
});

test('collectDldBuyers handles tx_type with no " - " separator', () => {
  const [r] = collectDldBuyers([tx('A', { txType: 'Owner (no transaction)' })]);
  assert.equal(r.txType, 'Owner (no transaction)');
  assert.equal(r.txSubtype, '');
});

test('collectDldBuyers places latest Sell-type buyer at index [0]', () => {
  const rows = collectDldBuyers([
    tx('OLDER',   { txType: 'Sell - Pre registration', txDateIso: '2024-01-01' }),
    tx('LATEST',  { txType: 'Sell - Pre registration', txDateIso: '2024-12-31' }),
    tx('MIDDLE',  { txType: 'Sell - Pre registration', txDateIso: '2024-06-15' }),
  ]);
  assert.equal(rows[0].name, 'LATEST');
  assert.equal(rows[0].kind, 'buyer');
});

test('collectDldBuyers prefers Sell-type buyers over Owner entries at [0]', () => {
  const rows = collectDldBuyers([
    tx('OWNER',   { txType: 'Owner (no transaction)', txDateIso: null }),
    tx('SELLER',  { txType: 'Sell - Pre registration', txDateIso: '2024-06-01' }),
  ]);
  assert.equal(rows[0].name, 'SELLER');
});

test('collectDldBuyers exposes dateIso on each entry', () => {
  const [r] = collectDldBuyers([tx('A', { txDateIso: '2024-02-04' })]);
  assert.equal(r.dateIso, '2024-02-04');
});
