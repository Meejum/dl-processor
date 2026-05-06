const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildProjectStat, writeDashboardHtml } = require('../src/dashboard');

test('buildProjectStat with ok result returns expected shape', () => {
  const project = { project_name: 'A' };
  const result = {
    status: 'ok',
    rows: [
      { match_status: 'MATCH', match_flags: ['A12'] },
      { match_status: 'MATCH', match_flags: [] },
      { match_status: 'BUYER_MISMATCH', match_flags: [] }
    ]
  };
  const stat = buildProjectStat(project, result, 5, 2);
  assert.equal(stat.name, 'A');
  assert.equal(stat.matchCount, 2);
  assert.equal(stat.buyerCount, 1);
  assert.equal(stat.auditCount, 5);
  assert.equal(stat.pendingCount, 2);
  assert.equal(stat.a12, 1);
  assert.equal(stat.hasCompare, true);
});

test('buildProjectStat with non-ok result returns null counts', () => {
  const project = { project_name: 'B' };
  const result = { status: 'no-mapping' };
  const stat = buildProjectStat(project, result, null, null);
  assert.equal(stat.hasCompare, false);
  assert.equal(stat.matchCount, null);
  assert.equal(stat.status, 'no-mapping');
});

test('buildProjectStat counts A10/A11/A12 flags from match_flags arrays', () => {
  const project = { project_name: 'C' };
  const result = {
    status: 'ok',
    rows: [
      { match_status: 'MATCH', match_flags: ['A10'] },
      { match_status: 'MATCH', match_flags: ['A11', 'A12'] },
      { match_status: 'MATCH', match_flags: ['A12'] }
    ]
  };
  const stat = buildProjectStat(project, result, 0, 0);
  assert.equal(stat.a10, 1);
  assert.equal(stat.a11, 1);
  assert.equal(stat.a12, 2);
});

test('writeDashboardHtml writes a file with Sobha brand markers', () => {
  const tmp = path.join(__dirname, '..', 'tmp-dash-' + Date.now() + '.html');
  try {
    writeDashboardHtml(tmp, [
      { name: 'A', base: 'A', status: 'ok', matchCount: 10, buyerCount: 2, auditCount: 5, pendingCount: 0, a10: 0, a11: 0, a12: 0, hasCompare: true }
    ]);
    const content = fs.readFileSync(tmp, 'utf8');
    assert.ok(content.includes('SOBHA REALTY'), 'has Sobha brand bar');
    assert.ok(content.includes('Reconciliation Dashboard'), 'has dashboard title');
    assert.ok(content.includes('Pending'), 'has Pending column header');
    assert.ok(content.includes('A12'), 'has A12 column header');
    assert.ok(content.includes('href="compare/A.compare.html"'), 'has link to compare HTML');
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});

test('writeDashboardHtml renders skipped projects with badge', () => {
  const tmp = path.join(__dirname, '..', 'tmp-dash-skipped-' + Date.now() + '.html');
  try {
    writeDashboardHtml(tmp, [
      { name: 'B', base: 'B', status: 'no-mapping', matchCount: null, buyerCount: null, auditCount: null, pendingCount: null, a10: null, a11: null, a12: null, hasCompare: false }
    ]);
    const content = fs.readFileSync(tmp, 'utf8');
    assert.ok(content.includes('no-mapping'), 'shows the skip status');
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
});
