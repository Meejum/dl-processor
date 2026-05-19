// v2.3 — `shouldAutoApprove` is now a thin wrapper around the shared rule
// engine (`src/rule-engine.js`). It runs the engine with a single built-in
// rule (R-1000 in spirit — the tolerance-based numeric auto-approve that
// shipped in v2.0). Keeping the export name + signature means every
// caller in `src/pending-change.js` and every test in
// `test/pending-change-auto-approve.test.js` + `test/auto-approve.test.js`
// works unchanged — the wrapper preserves the original boolean contract.
//
// The seeded DB-side R-1000 (migration 009) is a separate alias-match rule
// that fires inside the drift pipeline via the loader; this in-process
// R-1000 wrapper is the numeric-tolerance equivalent that fires inside
// `queueMasterDiffs`. Both feed the same engine for consistency.
//
// Config-file loading (`loadAutoApproveConfig`) stays untouched.

const fs = require('fs');
const path = require('path');
const { evaluate } = require('./rule-engine');

const DEFAULTS = { price_tolerance_pct: 0.5, area_tolerance_pct: 0.5 };
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'auto-approve.json');

function loadAutoApproveConfig(configPath) {
  const p = configPath || DEFAULT_CONFIG_PATH;
  if (!fs.existsSync(p)) return { ...DEFAULTS };
  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('auto-approve config is not valid JSON: ' + e.message); }
  for (const key of ['price_tolerance_pct', 'area_tolerance_pct']) {
    const v = parsed[key];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) {
      throw new Error('auto-approve config: ' + key + ' must be a non-negative number, got: ' + JSON.stringify(v));
    }
  }
  return {
    price_tolerance_pct: parsed.price_tolerance_pct,
    area_tolerance_pct:  parsed.area_tolerance_pct
  };
}

// Build the in-process R-1000-equivalent tolerance rule. Engine matches
// when ALL clauses hold:
//   field          = <field>
//   source         = 'dld_approved'    (sticky-staff guard)
//   delta_pct      <= <tolPct>
// The candidate change object below provides those exact fields.
function buildR1000(field, tolPct) {
  return {
    id: 1000,
    priority: 1000,
    enabled: true,
    when: { op: 'and', clauses: [
      { field: 'field',     operator: '=',  value: field },
      { field: 'source',    operator: '=',  value: 'dld_approved' },
      { field: 'delta_pct', operator: '<=', value: tolPct }
    ]},
    then: { action: 'auto_approve', note: 'numeric tolerance match' }
  };
}

function shouldAutoApprove(field, oldValue, newValue, currentMasterSource, config) {
  // Identity guards — these can be expressed as engine clauses too, but
  // keeping them here means the engine never sees malformed numeric inputs
  // (which would just yield NaN comparisons and always-false matches).
  if (field !== 'purchase_price_aed' && field !== 'area_sqm') return false;
  if (oldValue == null || newValue == null) return false;
  const oldNum = Number(oldValue);
  const newNum = Number(newValue);
  if (!isFinite(oldNum) || !isFinite(newNum)) return false;
  if (oldNum === 0) return false;
  const tolPct = field === 'purchase_price_aed'
    ? config.price_tolerance_pct
    : config.area_tolerance_pct;
  const deltaPct = Math.abs((newNum - oldNum) / oldNum) * 100;

  // Build a rule-engine-shaped change and delegate. The engine's
  // FIELD_ALLOWLIST already covers `field`, `source`, and `delta_pct`.
  const change = {
    field,
    source: currentMasterSource,   // 'dld_approved' allows; 'staff' blocks
    delta_pct: deltaPct
  };
  const decision = evaluate(change, {}, [buildR1000(field, tolPct)]);
  return decision.action === 'auto_approve';
}

module.exports = { loadAutoApproveConfig, shouldAutoApprove, DEFAULTS };
