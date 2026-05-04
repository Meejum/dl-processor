const test = require('node:test');
const assert = require('node:assert/strict');
const { collectDldBuyers, collectSfApplicants, classifyMatchPublic } = require('../src/compare');

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

test('collectSfApplicants emits only populated slots, in canonical order', () => {
  const rows = collectSfApplicants({
    applicant_name:    'JOHN SMITH',
    applicant_2_name:  'JANE SMITH',
    applicant_3_name:  null,
    applicant_4_name:  'KIDS SMITH',
    applicant_details: 'GRANDMA SMITH'
  });
  assert.deepEqual(rows.map(r => r.role),
    ['primary', 'applicant_2', 'applicant_4', 'applicant_details']);
  assert.equal(rows[0].name, 'JOHN SMITH');
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.kind === 'applicant'));
});

test('collectSfApplicants returns one entry when only applicant_name populated (today\'s reality)', () => {
  const rows = collectSfApplicants({ applicant_name: 'JOHN SMITH' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'JOHN SMITH');
  assert.equal(rows[0].role, 'primary');
});

test('collectSfApplicants handles null booking', () => {
  assert.deepEqual(collectSfApplicants(null), []);
  assert.deepEqual(collectSfApplicants(undefined), []);
});

test('collectSfApplicants treats empty strings as missing slots', () => {
  const rows = collectSfApplicants({
    applicant_name:    'JOHN',
    applicant_2_name:  '',
    applicant_3_name:  '   ',
    applicant_4_name:  null,
  });
  assert.deepEqual(rows.map(r => r.name), ['JOHN']);
});

// ── classifyMatchPublic (Task 3) ─────────────────────────────────────────────

function classify({ dldParties, sfApplicants }) {
  const dldTxs = dldParties.map((name, i) => ({
    party_name: name,
    ft_share:   50,
    share_unit: 'F.T.',
    tx_type:    'Sell - Pre registration',
    tx_date:    '04/02/2024',
    tx_date_iso:'2024-02-04',
    amount_aed: 1000000 + i,
  }));
  const sfRow = {};
  if (sfApplicants[0]) sfRow.applicant_name    = sfApplicants[0];
  if (sfApplicants[1]) sfRow.applicant_2_name  = sfApplicants[1];
  if (sfApplicants[2]) sfRow.applicant_3_name  = sfApplicants[2];
  if (sfApplicants[3]) sfRow.applicant_4_name  = sfApplicants[3];
  if (sfApplicants[4]) sfRow.applicant_details = sfApplicants[4];
  // dldUnit only used for status fallthrough; not relevant to buyer match.
  return classifyMatchPublic({ unit_number: 'P-1' }, dldTxs, sfRow, null);
}

test('classifyMatch: clean primary-vs-primary match → MATCH, no flag', () => {
  const r = classify({ dldParties: ['ALICE'], sfApplicants: ['ALICE'] });
  assert.equal(r.status, 'MATCH');
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: DLD co-buyer matches SF primary → MATCH + A12', () => {
  const r = classify({ dldParties: ['ALICE', 'BOB'], sfApplicants: ['BOB'] });
  assert.equal(r.status, 'MATCH');
  assert.ok((r.flags || []).includes('A12'), 'expected A12 flag, got: ' + JSON.stringify(r.flags));
});

test('classifyMatch: no overlap anywhere → BUYER_MISMATCH', () => {
  const r = classify({ dldParties: ['ALICE', 'BOB'], sfApplicants: ['CAROL'] });
  assert.equal(r.status, 'BUYER_MISMATCH');
});

test('classifyMatch: bank entries do not satisfy the match', () => {
  const r = classify({
    dldParties: ['EMIRATES NBD MORTGAGES', 'ALICE'],
    sfApplicants: ['ALICE']
  });
  assert.equal(r.status, 'MATCH');
  // Bank is filtered, so primary becomes ALICE; clean match → no A12.
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: empty-name DLD entries do not satisfy the match', () => {
  const r = classify({
    dldParties: [null, 'ALICE'],
    sfApplicants: ['ALICE']
  });
  assert.equal(r.status, 'MATCH');
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: DLD primary matches SF co-applicant → MATCH + A12', () => {
  const r = classify({
    dldParties: ['ALICE'],
    sfApplicants: ['BOB', 'ALICE']  // ALICE is in applicant_2_name
  });
  assert.equal(r.status, 'MATCH');
  assert.ok((r.flags || []).includes('A12'));
});

test('classifyMatch: override is consulted when DLD has only banks (no natural buyer)', () => {
  // DLD has only a bank entry; override should kick in.
  const dldTxs = [{
    party_name: 'EMIRATES NBD MORTGAGES',
    ft_share:   50,
    share_unit: 'F.T.',
    tx_type:    'Mortgage Registration',
    tx_date:    '04/02/2024',
    tx_date_iso:'2024-02-04',
    amount_aed: 1000000,
  }];
  const sfRow = { applicant_name: 'ALICE' };
  const r = classifyMatchPublic({ unit_number: 'P-1' }, dldTxs, sfRow, 'ALICE');
  assert.equal(r.status, 'MATCH');
  assert.equal(r.usedOverride, true, 'override should fire when only banks present');
  assert.deepEqual(r.flags || [], []);
});

test('classifyMatch: override is NOT consulted when DLD has any non-bank party (new semantics)', () => {
  // DLD has a non-bank Mortgage-type party (the mortgagor). Pre-A12 logic would
  // have fallen back to override because pickLatestPurchase returns null for
  // mortgage txs. New logic uses the mortgagor name directly.
  const dldTxs = [{
    party_name: 'BOB MORTGAGOR',
    ft_share:   50,
    share_unit: 'F.T.',
    tx_type:    'Mortgage Registration',
    tx_date:    '04/02/2024',
    tx_date_iso:'2024-02-04',
    amount_aed: 1000000,
  }];
  const sfRow = { applicant_name: 'BOB MORTGAGOR' };
  const r = classifyMatchPublic({ unit_number: 'P-1' }, dldTxs, sfRow, 'WRONG OVERRIDE NAME');
  assert.equal(r.status, 'MATCH', 'should match BOB MORTGAGOR directly, ignoring override');
  assert.equal(r.usedOverride, false, 'override should not fire when natural party exists');
});

test('collectDldBuyers preserves input order for buyers with identical Sell-type and tx_date_iso', () => {
  const rows = collectDldBuyers([
    tx('FIRST_BUYER',  { txType: 'Sell - Pre registration', txDateIso: '2024-06-01' }),
    tx('SECOND_BUYER', { txType: 'Sell - Pre registration', txDateIso: '2024-06-01' }),
    tx('THIRD_BUYER',  { txType: 'Sell - Pre registration', txDateIso: '2024-06-01' }),
  ]);
  assert.deepEqual(rows.map(r => r.name), ['FIRST_BUYER', 'SECOND_BUYER', 'THIRD_BUYER']);
});
