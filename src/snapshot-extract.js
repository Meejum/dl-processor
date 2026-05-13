// src/snapshot-extract.js
//
// Picker helpers for selecting "winning" transactions from a unit's
// dld_transaction set, plus extractUnitFields() — a convenience join
// that returns the operational AUDIT_FIELDS for one unit in one DLD
// snapshot. Consumed by both compare.js (MISMATCH detection) and
// compare-drift.js (DLD snapshot drift detection).
//
// The four picker functions are extracted verbatim from src/compare.js.

const { BANK_PREFIX_RE } = require('./common');

const MARKET_PRICE_TX = new Set([
  'Complete Delayed Sell', 'Sell - Pre registration', 'Sale', 'Delayed Sell'
]);

const PURCHASE_TX_TYPES = new Set([
  ...MARKET_PRICE_TX, 'Grant', 'Lease to Own Registration'
]);

function pickLatestOfTypes(dldTxs, typeSet) {
  const hits = dldTxs.filter(t => typeSet.has(t.tx_type));
  if (hits.length === 0) return null;
  hits.sort((a, b) => {
    const da = a.tx_date_iso || '';
    const db = b.tx_date_iso || '';
    return db.localeCompare(da);
  });
  const top = hits[0];
  const sameDate = hits.filter(t => (t.tx_date_iso || '') === (top.tx_date_iso || ''));
  const withName = sameDate.find(t => t.party_name && !BANK_PREFIX_RE.test(t.party_name));
  return withName || top;
}

function pickLatestPurchase(dldTxs) {
  return pickLatestOfTypes(dldTxs, PURCHASE_TX_TYPES);
}

function pickLatestMarketPrice(dldTxs) {
  return pickLatestOfTypes(dldTxs, MARKET_PRICE_TX);
}

function findLatestNonBankParty(dldTxs) {
  if (!dldTxs || !dldTxs.length) return null;
  const sorted = dldTxs.slice().sort((a, b) => (b.tx_date_iso || '').localeCompare(a.tx_date_iso || ''));
  for (const t of sorted) {
    if (t.party_name && !BANK_PREFIX_RE.test(t.party_name)) return t.party_name;
  }
  return null;
}

// Returns the operational AUDIT_FIELDS for one unit in one DLD snapshot:
// { buyer_name, purchase_price_aed, area_sqm, status, procedure_number }.
// status + procedure_number live only on the SF side (sf_booking), so they
// are returned as null here — the Task 3 diff-by-field loop uses that to
// know to skip those fields for the DLD-vs-DLD drift comparison.
function extractUnitFields(db, snapshotId, projectId, unitNumberNorm) {
  const unit = db.prepare(`
    SELECT unit_id, net_area
    FROM dld_unit
    WHERE snapshot_id = ? AND project_id = ? AND unit_number_norm = ?
  `).get(snapshotId, projectId, unitNumberNorm);
  if (!unit) return null;

  const txs = db.prepare(`
    SELECT party_name, tx_type, tx_date, tx_date_iso, amount_aed
    FROM dld_transaction
    WHERE unit_id = ?
  `).all(unit.unit_id);

  const buyer  = findLatestNonBankParty(txs);
  const sale   = pickLatestPurchase(txs);

  return {
    buyer_name:         buyer || null,
    purchase_price_aed: sale ? sale.amount_aed : null,
    area_sqm:           unit.net_area != null ? Number(unit.net_area) : null,
    status:             null,
    procedure_number:   null
  };
}

module.exports = {
  pickLatestOfTypes,
  pickLatestPurchase,
  pickLatestMarketPrice,
  findLatestNonBankParty,
  extractUnitFields,
  MARKET_PRICE_TX,
  PURCHASE_TX_TYPES
};
