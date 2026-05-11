// Wires sidebar buttons to dlp.runCommand. Disables all buttons while one is
// running so we don't accidentally interleave two commands' log output.

function initSidebar({ logPanel, onCommandDone }) {
  const buttons = Array.from(document.querySelectorAll('.cmd-btn'));

  async function run(btn) {
    const cmd = btn.getAttribute('data-cmd');
    const label = btn.getAttribute('data-label') || cmd;
    const needsFile = btn.getAttribute('data-needs-file') === 'true';

    let args = [];
    if (needsFile) {
      // Apply-pending: ask main to open a file picker. Implementation lands
      // in Task 8 (window.dlp.pickCsv). For now, just run without an arg —
      // apply-pending defaults to its own configured path.
      args = [];
    }

    setRunning(true, btn);
    logPanel.appendInfo('— running: ' + label + ' —');
    try {
      const result = await window.dlp.runCommand(cmd, args);
      logPanel.appendInfo('— done: ' + label + ' (exit ' + result.exitCode + ') —');
      if (onCommandDone) onCommandDone(result);
    } catch (e) {
      logPanel.appendError('error running ' + cmd + ': ' + (e && e.message ? e.message : e));
    } finally {
      setRunning(false, btn);
    }
  }

  function setRunning(running, activeBtn) {
    for (const b of buttons) {
      b.disabled = running;
      b.classList.toggle('is-running', running && b === activeBtn);
    }
  }

  for (const b of buttons) {
    b.addEventListener('click', () => run(b));
  }
}

window.__initSidebar = initSidebar;
