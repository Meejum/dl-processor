function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '';
  return Math.round(Number(v)).toLocaleString();
}

function fmtArea(v) {
  if (v == null || isNaN(v)) return '';
  // Display always says SQM regardless of source share_unit ('F.T.' or 'SQ.M.').
  // The raw share_unit value is preserved in dld_transaction.share_unit for audit.
  const n = Number(v);
  return (Math.round(n * 100) / 100).toFixed(2) + ' SQM';
}

function renderDldBuyerLi(b) {
  const cls = b.kind === 'bank' ? ' class="bank"' : (b.kind === 'seller' ? ' class="seller"' : '');
  const label = b.kind === 'bank'   ? '[bank] ' :
                b.kind === 'seller' ? '[seller — name not captured] ' : '';
  const parts = [];
  parts.push(label + escHtml(b.name || ''));
  if (b.areaSqm != null)   parts.push(fmtArea(b.areaSqm));
  if (b.amountAed != null) parts.push(fmtMoney(b.amountAed) + ' AED');
  if (b.txType)            parts.push(escHtml(b.txType));
  if (b.txSubtype)         parts.push(escHtml(b.txSubtype));
  if (b.date)              parts.push(escHtml(b.date));
  return '<li' + cls + '>' + parts.filter(Boolean).join(' · ') + '</li>';
}

function renderDldBuyersCell(buyers) {
  const list = Array.isArray(buyers) ? buyers : [];
  const buyerCount = list.filter(b => b.kind === 'buyer').length;
  if (list.length === 0) return '<td data-sort-val="0">0</td>';
  const items = list.map(renderDldBuyerLi).join('');
  return '<td data-sort-val="' + buyerCount + '">' +
    '<details><summary>' + buyerCount + '</summary>' +
    '<ul class="buyer-list">' + items + '</ul></details></td>';
}

function renderSfApplicantLi(a) {
  return '<li>' + escHtml(a.name) + ' <small>(' + escHtml(a.role) + ')</small></li>';
}

function renderSfApplicantsCell(applicants) {
  const list = Array.isArray(applicants) ? applicants : [];
  if (list.length === 0) return '<td data-sort-val="0">—</td>';
  const items = list.map(renderSfApplicantLi).join('');
  return '<td data-sort-val="' + list.length + '">' +
    '<details><summary>' + list.length + '</summary>' +
    '<ul class="applicant-list">' + items + '</ul></details></td>';
}

const BUYER_CELLS_CSS = `
  .buyer-list, .applicant-list { margin: 4px 0 0; padding-left: 18px; font-size: 11px; }
  .buyer-list li, .applicant-list li { list-style: none; margin: 2px 0; }
  .buyer-list li.bank, .buyer-list li.seller { color: #666; font-style: italic; }
  details > summary { cursor: pointer; user-select: none; }
  details[open] > summary { font-weight: 600; }
`;

module.exports = { renderDldBuyersCell, renderSfApplicantsCell, BUYER_CELLS_CSS };
