#!/usr/bin/env node
// Tiny test runner that invokes Electron in Node mode so the bundled Node 18
// runtime (NODE_MODULE_VERSION 119) matches the on-disk better-sqlite3 binary
// built for Electron 28. Avoids the Node 24 (NODE_MODULE_VERSION 137) ABI
// mismatch that would otherwise hit every test that opens the DB.
//
// Forwards any CLI args (e.g. --test-name-pattern, --test-only) to Node's
// built-in test runner.

const { spawn } = require('child_process');
const path = require('path');

const electronPath = require('electron');   // exports the absolute path
const childEnv = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' });

// Pass the test/ directory rather than a glob — Node's test runner recurses
// and picks up *.test.js automatically. Globs require shell expansion which
// Electron's Node 18 doesn't do.
const args = ['--test', ...process.argv.slice(2), 'test'];

const child = spawn(electronPath, args, {
  env: childEnv,
  stdio: 'inherit',
  shell: false
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('failed to spawn electron for tests:', err.message);
  process.exit(1);
});
