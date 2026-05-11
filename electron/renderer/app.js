(async function() {
  const needed = await window.dlp.firstRun.needed();

  if (needed) {
    document.getElementById('first-run-wizard').hidden = false;
    const defaultFolder = await window.dlp.firstRun.defaultFolder();
    document.getElementById('wizard-folder').value = defaultFolder;

    document.getElementById('wizard-pick').addEventListener('click', async () => {
      const picked = await window.dlp.firstRun.pickFolder();
      if (picked) document.getElementById('wizard-folder').value = picked;
    });

    const legacy = await window.dlp.firstRun.detectLegacy();
    if (legacy) {
      document.getElementById('wizard-legacy').hidden = false;
      document.getElementById('wizard-legacy-path').textContent = legacy.root;
    }

    document.getElementById('wizard-continue').addEventListener('click', async () => {
      const folder = document.getElementById('wizard-folder').value;
      const migrate = document.getElementById('wizard-migrate')?.checked;
      const migrateFrom = (legacy && migrate) ? legacy.root : null;
      const result = await window.dlp.firstRun.finalize({ folder, migrateFrom });
      document.getElementById('first-run-wizard').hidden = true;
      showAppShell(result.folder);
    });
  } else {
    // Reuse the saved dataFolder; main process sets it from the config.
    showAppShell(null);
  }

  function showAppShell(dataFolder) {
    document.getElementById('app-shell').hidden = false;
    if (dataFolder) document.getElementById('header-data-folder').textContent = dataFolder;
  }
})();
