const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyState } = require('../src/sf-state');

test('classifyState: null/undefined → NO_SF_ROW', () => {
  assert.equal(classifyState(null), 'NO_SF_ROW');
  assert.equal(classifyState(undefined), 'NO_SF_ROW');
});

test('classifyState: Status=Completed + no DLD issue → READY', () => {
  assert.equal(classifyState({ status: 'Completed', dld_process_status: 'Complete' }), 'READY');
  assert.equal(classifyState({ status: 'Completed', dld_process_status: null }),       'READY');
});

test('classifyState: Status=Rejected → REJECTED (takes precedence over other fields)', () => {
  assert.equal(classifyState({ status: 'Rejected', dld_process_status: 'Submitted to DLD' }), 'REJECTED');
  assert.equal(classifyState({ status: 'Rejected', dld_process_status: 'Complete' }),         'REJECTED');
});

test('classifyState: dld_process_status=Submitted to DLD → DLD_ISSUE (when not Rejected)', () => {
  assert.equal(classifyState({ status: 'In Progress', dld_process_status: 'Submitted to DLD' }), 'DLD_ISSUE');
  assert.equal(classifyState({ status: 'Completed',  dld_process_status: 'Submitted to DLD' }), 'DLD_ISSUE');
});

test('classifyState: Status=In Progress without DLD issue → IN_PROGRESS', () => {
  assert.equal(classifyState({ status: 'In Progress', dld_process_status: 'Complete' }), 'IN_PROGRESS');
  assert.equal(classifyState({ status: 'In Progress', dld_process_status: null }),       'IN_PROGRESS');
});

test('classifyState: unknown / unrecognized status → IN_PROGRESS (conservative default)', () => {
  assert.equal(classifyState({ status: 'Some Future SF Value', dld_process_status: 'Complete' }), 'IN_PROGRESS');
  assert.equal(classifyState({ status: null, dld_process_status: null }),                          'IN_PROGRESS');
  assert.equal(classifyState({}),                                                                  'IN_PROGRESS');
});
