const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../src/migrations');
const { resolveBuyerComparison } = require('../src/compare');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  runMigrations(db);
  return db;
}

test('exact match -> MATCH', () => {
  const db = freshDb();
  const r = resolveBuyerComparison(db, 1, 'Ali Alghumlasi', 'Ali Alghumlasi');
  assert.equal(r.status, 'MATCH');
});

test('case/whitespace differ -> MATCH via built-in normalize', () => {
  const db = freshDb();
  const r = resolveBuyerComparison(db, 1, 'ALI ALGHUMLASI', 'ali alghumlasi');
  assert.equal(r.status, 'MATCH');
});

test('Al- prefix differ -> MATCH via built-in transliteration', () => {
  const db = freshDb();
  const r = resolveBuyerComparison(db, 1, 'Ali Al-Ghumlasi', 'Ali Alghumlasi');
  assert.equal(r.status, 'MATCH');
});

test('Mohammad vs Mohamed -> MATCH via built-in transliteration', () => {
  const db = freshDb();
  const r = resolveBuyerComparison(db, 1, 'Mohammad Hassan', 'Mohamed Hassan');
  assert.equal(r.status, 'MATCH');
});

test('truly different -> BUYER_MISMATCH', () => {
  const db = freshDb();
  const r = resolveBuyerComparison(db, 1, 'Ali Alghumlasi', 'Aisha Khan');
  assert.equal(r.status, 'BUYER_MISMATCH');
});

test('learned project-scoped alias absorbs the diff -> MATCH', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'P')").run();
  db.prepare(`
    INSERT INTO buyer_alias (project_id, variant, canonical, display)
    VALUES (1, 'algumlasi', 'alghumlasi', 'Alghumlasi')
  `).run();
  const r = resolveBuyerComparison(db, 1, 'Ali Algumlasi', 'Ali Alghumlasi');
  assert.equal(r.status, 'MATCH');
});

test('alias only applies in its project', () => {
  const db = freshDb();
  db.prepare("INSERT INTO dld_project (project_id, project_name) VALUES (1, 'A'), (2, 'B')").run();
  db.prepare(`
    INSERT INTO buyer_alias (project_id, variant, canonical, display)
    VALUES (1, 'algumlasi', 'alghumlasi', 'X')
  `).run();
  const matched = resolveBuyerComparison(db, 1, 'Ali Algumlasi', 'Ali Alghumlasi');
  assert.equal(matched.status, 'MATCH');
  const notMatched = resolveBuyerComparison(db, 2, 'Ali Algumlasi', 'Ali Alghumlasi');
  assert.equal(notMatched.status, 'BUYER_MISMATCH');
});
