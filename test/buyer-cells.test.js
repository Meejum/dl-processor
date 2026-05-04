const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS } = require('../src/buyer-cells');

test('renderDldBuyersCell with empty array returns simple <td>0</td>', () => {
  assert.equal(renderDldBuyersCell([]), '<td data-sort-val="0">0</td>');
});

test('renderDldBuyersCell with three buyers shows count 3 and three <li>', () => {
  const html = renderDldBuyersCell([
    { name: 'AHMAD MUJTABA MURTAZA', areaSqm: 34.68, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
    { name: 'AHMAD MUSADIQ MURTAZA', areaSqm: 34.68, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
    { name: 'AHMAD MUSADIQ MURTAZA', areaSqm: 69.36, amountAed: 1612613, txType: 'Sell', txSubtype: 'Pre registration', date: '04/02/2024', kind: 'buyer' },
  ]);
  assert.match(html, /<summary>3<\/summary>/);
  const liCount = (html.match(/<li/g) || []).length;
  assert.equal(liCount, 3);
  assert.match(html, /AHMAD MUJTABA MURTAZA/);
  assert.match(html, /34\.68 SQM/);
  assert.match(html, /1,612,613 AED/);
  assert.match(html, /Sell/);
  assert.match(html, /Pre registration/);
  assert.match(html, /04\/02\/2024/);
});

test('renderDldBuyersCell counts only buyers; bank/seller appear in dropdown labeled', () => {
  const html = renderDldBuyersCell([
    { name: 'AHMAD',                  areaSqm: 50,    amountAed: 1000000, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
    { name: 'EMIRATES NBD MORTGAGES', areaSqm: 50,    amountAed: 1000000, txType: 'Mortgage', txSubtype: '', date: '', kind: 'bank' },
    { name: null,                     areaSqm: 78.56, amountAed: 1000000, txType: 'Sell', txSubtype: '', date: '', kind: 'seller' },
  ]);
  assert.match(html, /<summary>1<\/summary>/, 'count should be 1 (buyer-only)');
  assert.match(html, /\[bank\]/);
  assert.match(html, /\[seller — name not captured\]/);
  const liCount = (html.match(/<li/g) || []).length;
  assert.equal(liCount, 3);
});

test('renderDldBuyersCell relabels F.T. value as SQM regardless of source unit', () => {
  const html = renderDldBuyersCell([
    { name: 'A', areaSqm: 34.68, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' }
  ]);
  assert.match(html, /34\.68 SQM/);
  assert.doesNotMatch(html, /F\.T\./);
});

test('renderDldBuyersCell sets data-sort-val to the buyer count for numeric sort', () => {
  const html = renderDldBuyersCell([
    { name: 'A', areaSqm: 50, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
    { name: 'B', areaSqm: 50, amountAed: 100, txType: 'Sell', txSubtype: '', date: '', kind: 'buyer' },
  ]);
  assert.match(html, /data-sort-val="2"/);
});

test('renderSfApplicantsCell with one applicant shows count 1 with (primary) role', () => {
  const html = renderSfApplicantsCell([
    { name: 'JOHN SMITH', role: 'primary', kind: 'applicant' }
  ]);
  assert.match(html, /<summary>1<\/summary>/);
  assert.match(html, /JOHN SMITH/);
  assert.match(html, /\(primary\)/);
});

test('renderSfApplicantsCell with three populated slots shows correct role labels', () => {
  const html = renderSfApplicantsCell([
    { name: 'JOHN',  role: 'primary',     kind: 'applicant' },
    { name: 'JANE',  role: 'applicant_2', kind: 'applicant' },
    { name: 'KIDS',  role: 'applicant_3', kind: 'applicant' },
  ]);
  assert.match(html, /<summary>3<\/summary>/);
  assert.match(html, /\(primary\)/);
  assert.match(html, /\(applicant_2\)/);
  assert.match(html, /\(applicant_3\)/);
});

test('renderSfApplicantsCell with empty array returns dash placeholder', () => {
  assert.equal(renderSfApplicantsCell([]), '<td data-sort-val="0">—</td>');
});

test('BUYER_CELLS_CSS exports a non-empty CSS string', () => {
  assert.equal(typeof BUYER_CELLS_CSS, 'string');
  assert.ok(BUYER_CELLS_CSS.length > 0);
  assert.match(BUYER_CELLS_CSS, /\.buyer-list/);
  assert.match(BUYER_CELLS_CSS, /\.applicant-list/);
});
