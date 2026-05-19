const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

test('better-sqlite3 supports SAVEPOINT + ROLLBACK TO via exec()', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER);');
  db.exec("INSERT INTO t VALUES (1, 100);");

  db.exec('SAVEPOINT sp1');
  db.exec("UPDATE t SET v = 999 WHERE id = 1");
  assert.equal(db.prepare('SELECT v FROM t WHERE id=1').get().v, 999);
  db.exec('ROLLBACK TO sp1');
  db.exec('RELEASE sp1');
  assert.equal(db.prepare('SELECT v FROM t WHERE id=1').get().v, 100, 'rollback should restore');

  db.close();
});
