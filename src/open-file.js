const { spawn } = require('child_process');

function openFile(absolutePath) {
  const p = process.platform;
  let child;
  if (p === 'win32') {
    child = spawn('cmd', ['/c', 'start', '""', absolutePath], { detached: true, stdio: 'ignore', shell: false });
  } else if (p === 'darwin') {
    child = spawn('open', [absolutePath], { detached: true, stdio: 'ignore' });
  } else if (p === 'linux') {
    child = spawn('xdg-open', [absolutePath], { detached: true, stdio: 'ignore' });
  } else {
    throw new Error('openFile: unsupported platform: ' + p);
  }
  child.unref();
}

module.exports = { openFile };
