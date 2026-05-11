// Wraps each cmd* function for invocation over IPC.
// For real commands: spawns `node index.js <cmd>` as a child process so the
// child's Node ABI matches the installed better-sqlite3 build. The child's
// stdout/stderr stream back to the renderer as 'dlp:log:line' events.
// For tests: `commandsOverride` injects fake fns that run in-process so the
// existing test suite stays green without spawning real subprocesses.

const path = require('path');
const cp = require('child_process');
const pkg = require('../package.json');

const KNOWN_COMMANDS = [
  'all', 'parse', 'import-dld', 'import-sf', 'compare', 'diff',
  'projects', 'status', 'review-pending', 'apply-pending'
];

// IPC channel names (renderer-facing) map to the CLI subcommand strings
// that `node index.js` expects. Some divergence: 'all' = no-args = full
// pipeline; 'import-dld' = 'import' (the CLI's name predates the renderer's).
const CLI_COMMAND = {
  'all':            null,   // empty argv triggers cmdAll()
  'parse':          'parse',
  'import-dld':     'import',
  'import-sf':      'import-sf',
  'compare':        'compare',
  'diff':           'diff',
  'projects':       'projects',
  'status':         'status',
  'review-pending': 'review-pending',
  'apply-pending':  'apply-pending'
};

// Map an args[] from the renderer into the CLI argv shape expected by index.js.
// Most commands take an optional first arg (filter or file path).
function commandToArgv(name, args) {
  args = args || [];
  switch (name) {
    case 'all':            return [];
    case 'parse':          return args;
    case 'import-dld':     return args;
    case 'import-sf':      return args;
    case 'compare':        return args[0] ? [args[0]] : [];
    case 'diff':           return args;
    case 'projects':       return [];
    case 'status':         return [];
    case 'review-pending': return args[0] ? [args[0]] : [];
    case 'apply-pending':  return args[0] ? [args[0]] : [];
    default: return args;
  }
}

let currentDataFolder = null;

function setDataFolder(folder) {
  currentDataFolder = folder;
}

// In-process runner used only by tests via commandsOverride. Real commands
// flow through runSpawn() instead so they pick up the system Node's ABI.
async function runOverride(fn, name, args, sender) {
  const stampedSend = (level, text) => sender.send('dlp:log:line', { level, text, ts: Date.now() });
  const origLog = console.log;
  const origErr = console.error;
  console.log   = (...a) => stampedSend('info',  a.map(String).join(' '));
  console.error = (...a) => stampedSend('error', a.map(String).join(' '));
  const prevRoot = process.env.DLP_DATA_ROOT;
  if (currentDataFolder) process.env.DLP_DATA_ROOT = currentDataFolder;
  try {
    await Promise.resolve(fn(args));
    return { command: name, exitCode: 0 };
  } catch (e) {
    stampedSend('error', e.message);
    return { command: name, exitCode: 1, error: e.message };
  } finally {
    console.log = origLog;
    console.error = origErr;
    if (prevRoot === undefined) delete process.env.DLP_DATA_ROOT;
    else process.env.DLP_DATA_ROOT = prevRoot;
  }
}

function runSpawn(name, args, sender) {
  const stampedSend = (level, text) => sender.send('dlp:log:line', { level, text, ts: Date.now() });
  const indexJs = path.join(__dirname, '..', 'index.js');
  const cliName = CLI_COMMAND[name];
  const argv = cliName
    ? [indexJs, cliName, ...commandToArgv(name, args)]
    : [indexJs, ...commandToArgv(name, args)];  // 'all' → no subcommand
  const env = Object.assign({}, process.env);
  if (currentDataFolder) env.DLP_DATA_ROOT = currentDataFolder;

  return new Promise((resolve) => {
    let child;
    try {
      // Use system `node` from PATH. Avoids Electron's bundled-Node ABI
      // (NODE_MODULE_VERSION 119) which doesn't match the installed
      // better-sqlite3 binary (NODE_MODULE_VERSION 137 for system Node 24).
      child = cp.spawn('node', argv, {
        env,
        cwd: path.join(__dirname, '..'),
        windowsHide: true
      });
    } catch (e) {
      stampedSend('error', 'failed to spawn node: ' + e.message);
      resolve({ command: name, exitCode: 1, error: e.message });
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    function flushLines(buf, level) {
      const lines = buf.split(/\r?\n/);
      const tail = lines.pop();
      for (const line of lines) stampedSend(level, line);
      return tail;
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      stdoutBuf = flushLines(stdoutBuf, 'info');
    });
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      stderrBuf = flushLines(stderrBuf, 'error');
    });
    child.on('error', (e) => {
      // ENOENT (node not on PATH) or similar. Surface to the renderer.
      stampedSend('error', 'spawn error: ' + e.message);
      resolve({ command: name, exitCode: 1, error: e.message });
    });
    child.on('close', (code) => {
      if (stdoutBuf) stampedSend('info',  stdoutBuf);
      if (stderrBuf) stampedSend('error', stderrBuf);
      resolve({ command: name, exitCode: code == null ? 1 : code });
    });
  });
}

function createCommandBridge(ipc, opts = {}) {
  if (opts.dataFolder) currentDataFolder = opts.dataFolder;
  const overrides = opts.commandsOverride || {};

  ipc.handle('dlp:version', () => pkg.version);

  for (const name of KNOWN_COMMANDS) {
    ipc.handle('dlp:cmd:' + name, async (event, args) => {
      if (overrides[name]) {
        return runOverride(overrides[name], name, args, event.sender);
      }
      return runSpawn(name, args, event.sender);
    });
  }
}

module.exports = { createCommandBridge, setDataFolder };
