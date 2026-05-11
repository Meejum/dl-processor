// Wraps each cmd* function for invocation over IPC.
// Captures console.log/error output during the call and ships it back to
// the renderer as 'dlp:log:line' events, then resolves with a final result.

const path = require('path');
const { cmdAll }           = require('../src/commands/all');
const { cmdParse }         = require('../src/commands/parse');
const { cmdImport }        = require('../src/commands/import-dld');
const { cmdImportSf }      = require('../src/commands/import-sf');
const { cmdCompare }       = require('../src/commands/compare');
const { cmdDiff }          = require('../src/commands/diff');
const { cmdProjects }      = require('../src/commands/projects');
const { cmdStatus }        = require('../src/commands/status');
const { cmdReviewPending } = require('../src/commands/review-pending');
const { cmdApplyPending }  = require('../src/commands/apply-pending');

const DEFAULT_COMMANDS = {
  'all':            (args) => cmdAll(),
  'parse':          (args) => cmdParse(args || []),
  'import-dld':     (args) => cmdImport(args || []),
  'import-sf':      (args) => cmdImportSf(args || []),
  'compare':        (args) => cmdCompare((args && args[0]) || null),
  'diff':           (args) => cmdDiff(args || []),
  'projects':       (args) => cmdProjects(),
  'status':         (args) => cmdStatus(),
  'review-pending': (args) => cmdReviewPending((args && args[0]) || null),
  'apply-pending':  (args) => cmdApplyPending((args && args[0]) || null)
};

let currentDataFolder = null;

function setDataFolder(folder) {
  currentDataFolder = folder;
}

function createCommandBridge(ipc, { dataFolder, commandsOverride } = {}) {
  if (dataFolder) currentDataFolder = dataFolder;
  const commands = commandsOverride
    ? Object.assign({}, DEFAULT_COMMANDS, commandsOverride)
    : DEFAULT_COMMANDS;

  ipc.handle('dlp:version', () => {
    const pkg = require('../package.json');
    return pkg.version;
  });

  for (const [name, fn] of Object.entries(commands)) {
    ipc.handle('dlp:cmd:' + name, async (event, args) => {
      const sender = event.sender;
      const stampedSend = (level, text) => {
        sender.send('dlp:log:line', { level, text, ts: Date.now() });
      };
      // Capture console.log/error during the command call.
      const origLog = console.log;
      const origErr = console.error;
      console.log   = (...a) => { stampedSend('info',  a.map(String).join(' ')); };
      console.error = (...a) => { stampedSend('error', a.map(String).join(' ')); };

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
    });
  }
}

module.exports = { createCommandBridge, setDataFolder };
