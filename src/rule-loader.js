// v2.3 rule loader — reads automation_rule rows from the DB, validates the
// JSON shape against the same allowlists used by the engine
// (src/rule-engine.js), and returns an array ready for
// ruleEngine.evaluate(change, ctx, rules).
//
// Validation failure path (per spec § 4.5):
//   1. UPDATE automation_rule SET enabled=0 WHERE id=?
//   2. writeAuditLog(...) with source='rule_fired', action='auto_apply',
//      and user_note='disabled: <error message>'
//   3. Skip the offending rule from the returned array.
//
// Validation covers:
//   - JSON.parse of when_json / then_json
//   - Predicate shape (recursive): each leaf must use a field in
//     FIELD_ALLOWLIST and an operator in OPERATORS; nesting depth must not
//     exceed MAX_NESTING_DEPTH; group ops must be 'and' | 'or' with a
//     non-empty clauses array.
//   - Then shape: action ∈ VALID_ACTIONS; flag_anomaly requires
//     anomaly_severity ∈ { 'warn', 'high' }.

const {
  FIELD_ALLOWLIST,
  OPERATORS,
  MAX_NESTING_DEPTH
} = require('./rule-engine');
const { writeAuditLog } = require('./audit-log');

const VALID_ACTIONS = new Set([
  'auto_approve', 'auto_reject', 'flag_anomaly',
  'auto_acknowledge_bp', 'skip'
]);
const VALID_SEVERITIES = new Set(['warn', 'high']);

/**
 * Recursively validates a predicate (WHEN clause). Throws Error on the
 * first problem with a message the loader records into audit_log.user_note.
 *
 * @param {object} pred  predicate or leaf clause
 * @param {number} [depth=0]
 */
function validatePredicate(pred, depth = 0) {
  if (pred == null || typeof pred !== 'object') {
    throw new Error('predicate must be an object');
  }
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`predicate nesting depth ${depth} exceeds max ${MAX_NESTING_DEPTH}`);
  }
  // Group node (op + clauses)
  if (pred.op !== undefined) {
    if (pred.op !== 'and' && pred.op !== 'or') {
      throw new Error(`unknown predicate op "${pred.op}"`);
    }
    if (!Array.isArray(pred.clauses) || pred.clauses.length === 0) {
      throw new Error(`predicate "${pred.op}" must have a non-empty clauses array`);
    }
    for (const c of pred.clauses) validatePredicate(c, depth + 1);
    return;
  }
  // Leaf clause (field + operator + value)
  const { field, operator } = pred;
  if (typeof field !== 'string' || !FIELD_ALLOWLIST.has(field)) {
    throw new Error(`field "${field}" not in allowlist`);
  }
  if (typeof operator !== 'string' || !Object.prototype.hasOwnProperty.call(OPERATORS, operator)) {
    throw new Error(`unknown operator "${operator}"`);
  }
  if (!('value' in pred)) {
    throw new Error('leaf clause missing value');
  }
  // Pre-compile regex so a bad pattern fails at load (not at evaluation).
  if (operator === 'regex') {
    try { new RegExp(pred.value); }
    catch (err) { throw new Error(`invalid regex /${pred.value}/: ${err.message}`); }
  }
}

/**
 * Validates the THEN action shape.
 * @param {object} then
 */
function validateThen(then) {
  if (then == null || typeof then !== 'object') {
    throw new Error('then must be an object');
  }
  if (!VALID_ACTIONS.has(then.action)) {
    throw new Error(`then.action "${then.action}" not in ${[...VALID_ACTIONS].join('|')}`);
  }
  if (then.action === 'flag_anomaly') {
    if (!VALID_SEVERITIES.has(then.anomaly_severity)) {
      throw new Error(`flag_anomaly requires anomaly_severity in {warn,high}, got ${JSON.stringify(then.anomaly_severity)}`);
    }
  }
}

// Disable a rule and emit an audit_log row recording why. Best-effort — we
// don't want a bad rule to abort the whole load.
function disableRule(db, id, errMessage) {
  try {
    db.prepare('UPDATE automation_rule SET enabled=0 WHERE id=?').run(id);
  } catch (_e) { /* ignore: best-effort */ }
  try {
    writeAuditLog(db, {
      tableName: 'automation_rule',
      field: 'enabled',
      oldValue: '1',
      newValue: '0',
      action: 'auto_apply',
      source: 'rule_fired',
      userNote: `disabled: ${errMessage}`
    });
  } catch (_e) { /* ignore: best-effort */ }
}

/**
 * Loads + validates enabled automation rules from the DB.
 *
 * Returns an array of `{ id, priority, enabled, when, then }` already sorted
 * by `priority` ASC (lower priority value wins per spec § 3.2). Rows whose
 * JSON or shape is invalid get disabled (enabled=0) and audit-logged, then
 * are skipped from the returned array so the engine never sees them.
 *
 * @param {Database} db
 * @returns {Array<{id:number, priority:number, enabled:boolean, when:object, then:object}>}
 */
function loadRules(db) {
  const rows = db.prepare(
    'SELECT id, name, enabled, priority, when_json, then_json FROM automation_rule WHERE enabled=1 ORDER BY priority ASC, id ASC'
  ).all();
  const loaded = [];
  for (const r of rows) {
    let when, then;
    try {
      try { when = JSON.parse(r.when_json); }
      catch (err) { throw new Error(`when_json parse error: ${err.message}`); }
      try { then = JSON.parse(r.then_json); }
      catch (err) { throw new Error(`then_json parse error: ${err.message}`); }
      validatePredicate(when);
      validateThen(then);
    } catch (err) {
      disableRule(db, r.id, err.message);
      continue;
    }
    loaded.push({
      id: r.id,
      priority: r.priority,
      enabled: true,
      when,
      then
    });
  }
  return loaded;
}

module.exports = {
  loadRules,
  validatePredicate,
  validateThen,
  VALID_ACTIONS,
  VALID_SEVERITIES
};
