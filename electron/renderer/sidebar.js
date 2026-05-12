// Wires sidebar buttons to dlp.runCommand. Disables all buttons while one is
// running so we don't accidentally interleave two commands' log output.

const PROJECT_FILTERED_COMMANDS = new Set(['compare', 'diff', 'review-pending']);

function initSidebar({ logPanel, onCommandDone, getProjectFilter = () => null }) {
  // Buttons that actually run a CLI command go through run(); the
  // data-action buttons (open-dashboard, reveal-output, db-export,
  // db-import) are handled in app.js but share the same disable set
  // so the user can't fire a backup mid-pipeline.
  const buttons = Array.from(document.querySelectorAll('.cmd-btn[data-cmd]'));
  const allButtons = Array.from(document.querySelectorAll('.cmd-btn'));

  // Multi-file picker filter map keyed by data-pick-multi attribute.
  const MULTI_PICK_FILTERS = {
    dld: [
      { name: 'DLD reports (.xps, .csv)', extensions: ['xps', 'csv'] },
      { name: 'All files',                extensions: ['*'] }
    ],
    sf: [
      { name: 'Salesforce export (.xlsx)', extensions: ['xlsx'] },
      { name: 'All files',                 extensions: ['*'] }
    ]
  };

  async function run(btn) {
    const cmd = btn.getAttribute('data-cmd');
    const label = btn.getAttribute('data-label') || cmd;
    const needsFile = btn.getAttribute('data-needs-file') === 'true';
    const pickMulti = btn.getAttribute('data-pick-multi');

    let args = [];
    const projectFilter = getProjectFilter && getProjectFilter();
    if (PROJECT_FILTERED_COMMANDS.has(cmd) && projectFilter) {
      args = [projectFilter];
    }
    if (pickMulti && MULTI_PICK_FILTERS[pickMulti]) {
      // Open native file picker with multi-selection. User can pick files
      // from anywhere on the system; filenames can be anything — the CLI
      // takes absolute paths.
      const picked = await window.dlp.pickOpenMulti({
        title: 'Choose ' + (pickMulti === 'dld' ? 'DLD' : 'Salesforce') + ' file(s)',
        filters: MULTI_PICK_FILTERS[pickMulti]
      });
      if (!picked || picked.length === 0) {
        logPanel.appendInfo('cancelled — no file picked');
        return;
      }
      args = picked;       // each path becomes a positional CLI arg
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
    for (const b of allButtons) {
      b.disabled = running;
      b.classList.toggle('is-running', running && b === activeBtn);
    }
  }

  for (const b of buttons) {
    b.addEventListener('click', () => run(b));
  }

  // Expose so app.js can also toggle the disable state for its
  // non-CLI data-action buttons (db-export, db-import, etc.).
  return { setRunning };
}

window.__initSidebar = initSidebar;
