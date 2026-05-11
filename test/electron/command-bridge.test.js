const test = require('node:test');
const assert = require('node:assert/strict');

test('command-bridge: registers a handler for each known command', () => {
  const handlers = {};
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake' });
  const expected = ['dlp:version',
    'dlp:cmd:all', 'dlp:cmd:parse', 'dlp:cmd:import-dld', 'dlp:cmd:import-sf',
    'dlp:cmd:compare', 'dlp:cmd:diff', 'dlp:cmd:projects', 'dlp:cmd:status',
    'dlp:cmd:review-pending', 'dlp:cmd:apply-pending'];
  for (const ch of expected) {
    assert.equal(typeof handlers[ch], 'function', 'missing handler: ' + ch);
  }
});

test('command-bridge: dlp:version returns app version from package.json', async () => {
  const handlers = {};
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake' });
  const v = await handlers['dlp:version']({ sender: { send: () => {} } });
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test('command-bridge: invoking a command streams console.log lines as dlp:log:line', async () => {
  const handlers = {};
  const sent = [];
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => { console.log('  hello from status'); }
  }});
  await handlers['dlp:cmd:status']({ sender: { send: (c, ...a) => sent.push([c, ...a]) } });
  const logLines = sent.filter(([c]) => c === 'dlp:log:line');
  assert.ok(logLines.length >= 1);
  assert.match(logLines[0][1].text, /hello from status/);
});

test('command-bridge: invoking a command resolves with dlp:command:done containing exitCode', async () => {
  const handlers = {};
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => {}
  }});
  const result = await handlers['dlp:cmd:status']({ sender: { send: () => {} } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'status');
});

test('command-bridge: a command that throws produces exitCode=1 and an error log line', async () => {
  const handlers = {};
  const sent = [];
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  createCommandBridge(fakeIpc, { dataFolder: 'C:/fake', commandsOverride: {
    'status': () => { throw new Error('boom'); }
  }});
  const result = await handlers['dlp:cmd:status']({ sender: { send: (c, ...a) => sent.push([c, ...a]) } });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /boom/);
  const errLines = sent.filter(([c, payload]) => c === 'dlp:log:line' && payload.level === 'error');
  assert.ok(errLines.length >= 1);
});

test('command-bridge: sets process.env.DLP_DATA_ROOT to the dataFolder before invoking', async () => {
  const handlers = {};
  const fakeIpc = { handle(channel, fn) { handlers[channel] = fn; } };
  const { createCommandBridge } = require('../../electron/command-bridge');
  let seen = null;
  createCommandBridge(fakeIpc, { dataFolder: 'C:/my/data', commandsOverride: {
    'status': () => { seen = process.env.DLP_DATA_ROOT; }
  }});
  const prev = process.env.DLP_DATA_ROOT;
  try { await handlers['dlp:cmd:status']({ sender: { send: () => {} } }); }
  finally { if (prev === undefined) delete process.env.DLP_DATA_ROOT; else process.env.DLP_DATA_ROOT = prev; }
  assert.equal(seen, 'C:/my/data');
});
