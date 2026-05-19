// v2.3 rule engine — pure logic, no DB, no IO. Evaluates a candidate
// pending_change against a list of automation rules per spec § 3.2 and
// § 4.2-4.4. Two-pass evaluation per candidate:
//
//   Pass 1: accumulate anomalies from every enabled rule whose action is
//           'flag_anomaly' and whose WHEN matches. Max severity wins;
//           reasons accumulate in priority order. Anomaly rules never
//           short-circuit.
//   Pass 2: scan enabled rules in priority order for the first match
//           whose action is NOT 'flag_anomaly'. That action wins.
//
// FIELD_ALLOWLIST — closed set of fields any WHEN clause may reference.
// Anything else throws. Same with operators.

const FIELD_ALLOWLIST = new Set([
  'change_type', 'field', 'delta_pct', 'delta_abs', 'alias_exists',
  'bp_type', 'sf_state', 'project_id', 'project_name',
  'tier2', 'source', 'unit_number_norm', 'procedure_number'
]);

const OPERATORS = {
  '=':  (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>':  (a, b) => a > b,
  '<':  (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  'in': (a, list) => Array.isArray(list) && list.includes(a),
  'regex': (a, pattern) => {
    let re;
    try { re = new RegExp(pattern); }
    catch (err) { throw new Error(`invalid regex /${pattern}/: ${err.message}`); }
    return re.test(String(a));
  }
};

function evaluateLeaf(clause, change, ctx) {
  const { field, operator, value } = clause;
  if (!FIELD_ALLOWLIST.has(field)) {
    throw new Error(`field "${field}" not in allowlist`);
  }
  const op = OPERATORS[operator];
  if (!op) {
    throw new Error(`unknown operator "${operator}"`);
  }
  const fieldValue = change[field];
  return !!op(fieldValue, value);
}

const MAX_NESTING_DEPTH = 3;

function evaluatePredicate(pred, change, ctx, depth = 0) {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`predicate nesting depth ${depth} exceeds max ${MAX_NESTING_DEPTH}`);
  }
  // Leaf clause (no op/clauses wrapper)
  if (pred.op === undefined) {
    return evaluateLeaf(pred, change, ctx);
  }
  const { op, clauses } = pred;
  if (!Array.isArray(clauses) || clauses.length === 0) {
    throw new Error(`predicate "${op}" must have a non-empty clauses array`);
  }
  if (op === 'and') {
    for (const c of clauses) {
      if (!evaluatePredicate(c, change, ctx, depth + 1)) return false;
    }
    return true;
  }
  if (op === 'or') {
    for (const c of clauses) {
      if (evaluatePredicate(c, change, ctx, depth + 1)) return true;
    }
    return false;
  }
  throw new Error(`unknown predicate op "${op}"`);
}

const TERMINAL_ACTIONS = new Set(['auto_approve', 'auto_reject', 'auto_acknowledge_bp', 'skip']);
const SEVERITY_RANK = { warn: 1, high: 2 };

// Two-pass evaluation per spec § 3.2.
// Pass 1: every enabled flag_anomaly rule whose WHEN matches contributes
//         a reason. Reasons accumulate in array (priority) order; max
//         severity wins.
// Pass 2: scan enabled rules in array order for the first match whose
//         action is NOT 'flag_anomaly'. That action + rule wins.
//
// Caller (rule-loader) is responsible for passing rules already sorted
// by priority. The engine iterates in array order.
function evaluate(change, ctx, rules) {
  const reasons = [];
  let maxSeverity = null;

  // Pass 1: anomalies
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.then.action !== 'flag_anomaly') continue;
    let matched = false;
    try { matched = evaluatePredicate(r.when, change, ctx); }
    catch (_err) { continue; } // malformed rule — silently skip; loader handles disable+log
    if (!matched) continue;
    const sev = r.then.anomaly_severity || 'warn';
    reasons.push({
      rule_id: r.id,
      code: r.then.code || r.then.action,
      severity: sev,
      detail: r.then.note || null
    });
    if (maxSeverity === null || (SEVERITY_RANK[sev] || 0) > (SEVERITY_RANK[maxSeverity] || 0)) {
      maxSeverity = sev;
    }
  }

  // Pass 2: terminal action
  let action = null;
  let rule_id = null;
  let note = null;
  for (const r of rules) {
    if (!r.enabled) continue;
    if (!TERMINAL_ACTIONS.has(r.then.action)) continue;
    let matched = false;
    try { matched = evaluatePredicate(r.when, change, ctx); }
    catch (_err) { continue; }
    if (matched) {
      action = r.then.action;
      rule_id = r.id;
      note = r.then.note || null;
      break;
    }
  }

  const anomaly = reasons.length > 0
    ? { severity: maxSeverity, reasons }
    : null;

  return { action, rule_id, anomaly, note };
}

module.exports = {
  FIELD_ALLOWLIST,
  OPERATORS,
  MAX_NESTING_DEPTH,
  TERMINAL_ACTIONS,
  SEVERITY_RANK,
  evaluateLeaf,
  evaluatePredicate,
  evaluate
};
