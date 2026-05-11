// Wires sidebar buttons to dlp.runCommand. Disables all buttons while one is
// running so we don't accidentally interleave two commands' log output.

const PROJECT_FILTERED_COMMANDS = new Set(['compare', 'diff', 'review-pending']);

function initSidebar({ logPanel, onCommandDone, getProjectFilter = () => null }) {
  // Only buttons that actually run a CLI command (i.e. have data-cmd) —
  // the data-action buttons (open-dashboard, reveal-output) are handled
  // directly in app.js.
  const buttons = Array.from(document.querySelectorAll('.cmd-btn[data-cmd]'));

  async function run(btn) {
    const cmd = btn.getAttribute('data-cmd');
    const label = btn.getAttribute('data-label') || cmd;
    const needsFile = btn.getAttribute('data-needs-file') === 'true';

    let args = [];
    const projectFilter = getProjectFilter && getProjectFilter();
    if (PROJECT_FILTERED_COMMANDS.has(cmd) && projectFilter) {
      args = [projectFilter];
    }
    if (needsFile) {
      const csvPath = await window.dlp.pickCsv({
        title: 'Choose decisions CSV'
      });
      if (!csvPath) {
        logPanel.appendInfo('cancelled — no file picked');
        return;
      }
      args = [csvPath];   // file picker arg OVERRIDES any project filter
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
