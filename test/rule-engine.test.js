const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLeaf, FIELD_ALLOWLIST } = require('../src/rule-engine');

const ctx = { aliases: new Set() };
const baseChange = {
  change_type: 'BUYER_MISMATCH',
  field: 'buyer_name',
  delta_pct: 0,
  delta_abs: 0,
  alias_exists: false,
  bp_type: null,
  sf_state: null,
  project_id: 1,
  project_name: 'TEST',
  tier2: false,
  source: 'compare',
  unit_number_norm: 'A-101',
  procedure_number: 'P-1'
};

// ───── operators ─────

test('= operator matches', () => {
  assert.equal(evaluateLeaf({ field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }, baseChange, ctx), true);
});

test('= operator misses', () => {
  assert.equal(evaluateLeaf({ field: 'change_type', operator: '=', value: 'PRICE_UP' }, baseChange, ctx), false);
});

test('!= operator', () => {
  assert.equal(evaluateLeaf({ field: 'change_type', operator: '!=', value: 'PRICE_UP' }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'change_type', operator: '!=', value: 'BUYER_MISMATCH' }, baseChange, ctx), false);
});

test('> operator on number', () => {
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '>', value: -1 }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '>', value: 0 }, baseChange, ctx), false);  // strict
});

test('< operator on number', () => {
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '<', value: 1 }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '<', value: 0 }, baseChange, ctx), false);  // strict
});

test('>= operator on number', () => {
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '>=', value: 0 }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '>=', value: 1 }, baseChange, ctx), false);
});

test('<= operator on number', () => {
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '<=', value: 0 }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'delta_pct', operator: '<=', value: -1 }, baseChange, ctx), false);
});

test('in operator with array', () => {
  assert.equal(evaluateLeaf({ field: 'change_type', operator: 'in', value: ['BUYER_MISMATCH', 'PRICE_UP'] }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'change_type', operator: 'in', value: ['PRICE_UP'] }, baseChange, ctx), false);
});

test('regex operator on string field', () => {
  assert.equal(evaluateLeaf({ field: 'project_name', operator: 'regex', value: '^TE' }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'project_name', operator: 'regex', value: 'XYZ$' }, baseChange, ctx), false);
});

test('regex operator throws on invalid pattern', () => {
  assert.throws(
    () => evaluateLeaf({ field: 'project_name', operator: 'regex', value: '[unclosed' }, baseChange, ctx),
    /invalid regex/i
  );
});

// ───── boolean field ─────

test('boolean field equality', () => {
  assert.equal(evaluateLeaf({ field: 'alias_exists', operator: '=', value: false }, baseChange, ctx), true);
  assert.equal(evaluateLeaf({ field: 'tier2', operator: '=', value: false }, baseChange, ctx), true);
});

// ───── allowlist enforcement ─────

test('FIELD_ALLOWLIST contains the 13 fields from spec § 4.3', () => {
  const expected = [
    'change_type', 'field', 'delta_pct', 'delta_abs', 'alias_exists',
    'bp_type', 'sf_state', 'project_id', 'project_name',
    'tier2', 'source', 'unit_number_norm', 'procedure_number'
  ];
  assert.equal(FIELD_ALLOWLIST.size, expected.length);
  for (const f of expected) assert.ok(FIELD_ALLOWLIST.has(f), `${f} should be in allowlist`);
});

test('rejects unknown field', () => {
  assert.throws(
    () => evaluateLeaf({ field: 'not_a_field', operator: '=', value: 1 }, baseChange, ctx),
    /allowlist/i
  );
});

test('rejects unknown operator', () => {
  assert.throws(
    () => evaluateLeaf({ field: 'change_type', operator: '~~', value: 'x' }, baseChange, ctx),
    /operator/i
  );
});

// ───── AND/OR nesting (Task 2.2) ─────

const { evaluatePredicate } = require('../src/rule-engine');

test('AND: all clauses true → true', () => {
  const p = { op: 'and', clauses: [
    { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
    { field: 'delta_pct', operator: '=', value: 0 }
  ]};
  assert.equal(evaluatePredicate(p, baseChange, ctx), true);
});

test('AND: one clause false → false', () => {
  const p = { op: 'and', clauses: [
    { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
    { field: 'delta_pct', operator: '>', value: 99 }
  ]};
  assert.equal(evaluatePredicate(p, baseChange, ctx), false);
});

test('OR: any clause true → true', () => {
  const p = { op: 'or', clauses: [
    { field: 'change_type', operator: '=', value: 'PRICE_UP' },
    { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }
  ]};
  assert.equal(evaluatePredicate(p, baseChange, ctx), true);
});

test('OR: all clauses false → false', () => {
  const p = { op: 'or', clauses: [
    { field: 'change_type', operator: '=', value: 'PRICE_UP' },
    { field: 'change_type', operator: '=', value: 'PRICE_DOWN' }
  ]};
  assert.equal(evaluatePredicate(p, baseChange, ctx), false);
});

test('nesting depth 3 works', () => {
  const p = { op: 'and', clauses: [
    { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
    { op: 'or', clauses: [
      { field: 'tier2', operator: '=', value: true },
      { op: 'and', clauses: [
        { field: 'delta_pct', operator: '<', value: 5 },
        { field: 'alias_exists', operator: '=', value: false }
      ]}
    ]}
  ]};
  assert.equal(evaluatePredicate(p, baseChange, ctx), true);
});

test('nesting depth 4 rejected', () => {
  let p = { op: 'and', clauses: [{ field: 'tier2', operator: '=', value: false }] };
  for (let i = 0; i < 4; i++) p = { op: 'and', clauses: [p] };
  assert.throws(() => evaluatePredicate(p, baseChange, ctx), /depth/i);
});

test('leaf clause inside predicate position', () => {
  // Single-leaf predicate (no op/clauses wrapper) is valid as input to evaluatePredicate
  const p = { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' };
  assert.equal(evaluatePredicate(p, baseChange, ctx), true);
});

// ───── two-pass evaluate (Task 2.3) ─────

const { evaluate } = require('../src/rule-engine');

function rule(id, priority, when, then, opts = {}) {
  return {
    id,
    priority,
    enabled: opts.enabled !== false,
    when,
    then
  };
}

test('evaluate: terminal action wins (first match by priority order)', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }, { action: 'auto_approve' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }, { action: 'auto_reject' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'auto_approve');
  assert.equal(d.rule_id, 1);
  assert.equal(d.anomaly, null);
});

test('evaluate: rules already sorted by priority (caller responsibility)', () => {
  // The loader returns sorted rules; the engine assumes priority order in the array.
  const rules = [
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }, { action: 'auto_reject' }),
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' }, { action: 'auto_approve' })
  ];
  // Engine iterates in array order — first match wins regardless of priority field
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'auto_reject');
  assert.equal(d.rule_id, 2);
});

test('evaluate: flag_anomaly never short-circuits; max severity wins; reasons accumulate', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'warn' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'high' }),
    rule(3, 3, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'auto_approve');
  assert.equal(d.rule_id, 3);
  assert.ok(d.anomaly, 'anomaly should accumulate');
  assert.equal(d.anomaly.severity, 'high');
  assert.equal(d.anomaly.reasons.length, 2);
  // Reasons preserved in priority order (1 then 2)
  assert.deepEqual(d.anomaly.reasons.map(r => r.rule_id), [1, 2]);
});

test('evaluate: anomaly without terminal match → action null but anomaly populated', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'warn' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, null);
  assert.equal(d.rule_id, null);
  assert.equal(d.anomaly.severity, 'warn');
  assert.equal(d.anomaly.reasons.length, 1);
});

test('evaluate: no rules → null everywhere', () => {
  const d = evaluate(baseChange, ctx, []);
  assert.equal(d.action, null);
  assert.equal(d.rule_id, null);
  assert.equal(d.anomaly, null);
});

test('evaluate: disabled rules are skipped (both passes)', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'high' }, { enabled: false }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve' }, { enabled: false })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, null);
  assert.equal(d.anomaly, null);
});

test('evaluate: note from then carries through', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve', note: 'alias match, sub-threshold' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.note, 'alias match, sub-threshold');
});

// ───── edge cases (Task 2.4) ─────

test('evaluate: auto_acknowledge_bp on non-BP row falls through to next rule', () => {
  // Non-BP rows have bp_type=null; the auto_acknowledge_bp rule's WHEN
  // requires a specific bp_type, so it won't match on a non-BP row.
  // The next rule wins.
  const rules = [
    rule(1, 1,
      { op: 'and', clauses: [
        { field: 'bp_type', operator: '=', value: 'REGISTRATION' },
        { field: 'sf_state', operator: '=', value: 'cancelled' }
      ]},
      { action: 'auto_acknowledge_bp' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve' })
  ];
  const d = evaluate(baseChange, ctx, rules); // bp_type=null in baseChange
  assert.equal(d.action, 'auto_approve');
  assert.equal(d.rule_id, 2);
});

test('evaluate: malformed rule (bad operator) silently skipped, others still evaluate', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '~bad~', value: 'x' },
      { action: 'auto_reject' }),  // throws inside predicate → skipped
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'auto_approve');
  assert.equal(d.rule_id, 2);
});

test('evaluate: malformed anomaly rule silently skipped', () => {
  const rules = [
    rule(1, 1, { field: 'not_a_field', operator: '=', value: 'x' },
      { action: 'flag_anomaly', anomaly_severity: 'high' }),  // throws on allowlist → skipped
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'warn' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.anomaly.severity, 'warn');
  assert.equal(d.anomaly.reasons.length, 1);
  assert.equal(d.anomaly.reasons[0].rule_id, 2);
});

test('evaluate: skip action wins like other terminal actions', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'skip' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_approve' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'skip');
  assert.equal(d.rule_id, 1);
});

test('evaluate: anomaly accumulates even when terminal=skip', () => {
  const rules = [
    rule(1, 1, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'flag_anomaly', anomaly_severity: 'high' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'skip' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'skip');
  assert.equal(d.anomaly.severity, 'high');
});

test('evaluate: regex compile failure in a rule is silently skipped (loader will disable)', () => {
  const rules = [
    rule(1, 1, { field: 'project_name', operator: 'regex', value: '[unclosed' },
      { action: 'auto_approve' }),
    rule(2, 2, { field: 'change_type', operator: '=', value: 'BUYER_MISMATCH' },
      { action: 'auto_reject' })
  ];
  const d = evaluate(baseChange, ctx, rules);
  assert.equal(d.action, 'auto_reject');
  assert.equal(d.rule_id, 2);
});
