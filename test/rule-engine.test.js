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
