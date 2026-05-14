function initTopBar({ getDataFolder, getProjectFilter, setProjectFilter, openSettings }) {
  const sel = document.getElementById('project-selector');
  const dfLabel = document.getElementById('header-data-folder');
  const settingsBtn = document.getElementById('btn-settings');

  let cachedProjects = [];

  async function refreshProjects() {
    sel.innerHTML = '<option value="">All projects</option>';
    try {
      const projects = await window.dlp.projects.list();
      cachedProjects = projects;
      for (const p of projects) {
        const opt = document.createElement('option');
        opt.value = p.project_name;
        opt.textContent = p.project_name;
        sel.appendChild(opt);
      }
      const filter = getProjectFilter();
      if (filter) sel.value = filter;
    } catch (e) {
      console.error('[top-bar] refreshProjects failed:', e);
    }
  }

  function getProjectIdFor(name) {
    if (!name) return null;
    const hit = cachedProjects.find(p => p.project_name === name);
    return hit ? (hit.project_id || null) : null;
  }

  sel.addEventListener('change', () => setProjectFilter(sel.value || null));
  settingsBtn.addEventListener('click', openSettings);

  function refreshDataFolder() {
    const df = getDataFolder();
    dfLabel.textContent = df || '';
    dfLabel.title = df ? 'Click to open folder' : '';
    dfLabel.style.cursor = df ? 'pointer' : '';
  }

  dfLabel.addEventListener('click', () => {
    const df = getDataFolder();
    if (df && window.dlp.shell && window.dlp.shell.showInFolder) {
      window.dlp.shell.showInFolder(df);
    }
  });

  return { refreshProjects, refreshDataFolder, getProjectIdFor };
}

window.__initTopBar = initTopBar;
