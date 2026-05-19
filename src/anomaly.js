// v2.3 built-in anomaly predicates. Pure functions — no DB, no IO.
// Reachable both as rule engine conditions (R-1001..R-1003 + future)
// and as a fast-path scanner that the renderer can run on already-loaded
// rows for live filtering. Strict > thresholds (matches v2.1 tier-2 pattern).
//
// Per spec § 5.2, each predicate has a focused contract:
//   - priceJump:        field=purchase_price AND delta_pct > 25
//   - areaJump:         field=area_sqm       AND delta_pct > 10
//   - novelProcedure:   field=procedure_number AND !seenInTrailingMonths(value, 6)
//   - lateBuyerChange:  field=buyer_name      AND bp_state == 'completed'

function priceJump(change) {
  return change && change.field === 'purchase_price' && change.delta_pct > 25;
}

function areaJump(change) {
  return change && change.field === 'area_sqm' && change.delta_pct > 10;
}

function novelProcedure(change, ctx) {
  if (!change || change.field !== 'procedure_number') return false;
  if (!ctx || typeof ctx.seenInTrailingMonths !== 'function') return false;
  return !ctx.seenInTrailingMonths(change.new_value, 6);
}

function lateBuyerChange(change) {
  return change && change.field === 'buyer_name' && change.bp_state === 'completed';
}

module.exports = {
  priceJump,
  areaJump,
  novelProcedure,
  lateBuyerChange
};
