// Imported as a namespace (not destructured) so tests can stub cp.spawn.
const cp = require('child_process');

function openFile(absolutePath) {
  const p = process.platform;
  let child;
  if (p === 'win32') {
    // Use windowsVerbatimArguments so Node doesn't double-escape; build the cmd /c line
    // manually with proper quoting so paths containing special chars (& | ^ ( ) %) work.
    const quoted = '"' + absolutePath.replace(/"/g, '\\"') + '"';
    child = cp.spawn('cmd', ['/s', '/c', 'start "" ' + quoted], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsVerbatimArguments: true
    });
  } else if (p === 'darwin') {
    child = cp.spawn('open', [absolutePath], { detached: true, stdio: 'ignore' });
  } else if (p === 'linux') {
    child = cp.spawn('xdg-open', [absolutePath], { detached: true, stdio: 'ignore' });
  } else {
    throw new Error('openFile: unsupported platform: ' + p);
  }
  child.unref();
}

module.exports = { openFile };
