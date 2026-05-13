// Per the v2.1 spec — pure function used by both the renderer (to know
// when to show the justification modal) AND the backend (defense-in-depth
// re-check in approvePending).
//
// thresholds is a plain object: { tier2_price_pct, tier2_price_abs, tier2_area_pct }
// All three are numbers; missing/falsy values are treated as "no threshold"
// (i.e., never tier-2 on that dimension).

const DEFAULT_THRESHOLDS = Object.freeze({
  tier2_price_pct: 10,      // 10% price change
  tier2_price_abs: 50000,   // 50,000 AED absolute
  tier2_area_pct:  5        // 5% area change
});

function isTier2(field, oldValue, newValue, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  if (field === 'purchase_price_aed') {
    const oldN = Number(oldValue);
    const newN = Number(newValue);
    if (!Number.isFinite(oldN) || !Number.isFinite(newN)) return false;
    const absDelta = Math.abs(newN - oldN);
    const pctDelta = oldN === 0 ? Infinity : Math.abs((newN - oldN) / oldN) * 100;
    if (t.tier2_price_pct && pctDelta > t.tier2_price_pct) return true;
    if (t.tier2_price_abs && absDelta > t.tier2_price_abs) return true;
    return false;
  }
  if (field === 'area_sqm') {
    const oldN = Number(oldValue);
    const newN = Number(newValue);
    if (!Number.isFinite(oldN) || !Number.isFinite(newN)) return false;
    const pctDelta = oldN === 0 ? Infinity : Math.abs((newN - oldN) / oldN) * 100;
    if (t.tier2_area_pct && pctDelta > t.tier2_area_pct) return true;
    return false;
  }
  // Other AUDIT_FIELDS (buyer_name, status, procedure_number) are NEVER tier-2
  // — they're not magnitude-based.
  return false;
}

module.exports = { isTier2, DEFAULT_THRESHOLDS };
