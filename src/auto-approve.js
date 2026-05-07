const fs = require('fs');
const path = require('path');

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

function shouldAutoApprove(field, oldValue, newValue, currentMasterSource, config) {
  if (field !== 'purchase_price_aed' && field !== 'area_sqm') return false;
  if (currentMasterSource !== 'dld_approved') return false;
  if (oldValue == null || newValue == null) return false;
  const oldNum = Number(oldValue);
  const newNum = Number(newValue);
  if (!isFinite(oldNum) || !isFinite(newNum)) return false;
  if (oldNum === 0) return false;
  const tolPct = field === 'purchase_price_aed'
    ? config.price_tolerance_pct
    : config.area_tolerance_pct;
  const deltaPct = Math.abs((newNum - oldNum) / oldNum) * 100;
  return deltaPct <= tolPct;
}

module.exports = { loadAutoApproveConfig, shouldAutoApprove, DEFAULTS };
