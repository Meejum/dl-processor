function initTabHost() {
  const strip = document.createElement('div');
  strip.className = 'tab-strip';
  strip.innerHTML = '<div class="tab-strip-tabs"></div>';
  document.getElementById('tab-host').prepend(strip);
  const tabsContainer = strip.querySelector('.tab-strip-tabs');

  const tabs = new Map();

  async function open({ url, title }) {
    const result = await window.dlp.tabs.open({ url, title });
    addTab(result.id, result.title);
    return result.id;
  }

  function addTab(id, title) {
    const t = document.createElement('div');
    t.className = 'tab is-active';
    t.dataset.tabId = id;
    t.innerHTML = '<span class="tab-title"></span><button class="tab-close" type="button">×</button>';
    t.querySelector('.tab-title').textContent = title;
    t.querySelector('.tab-title').addEventListener('click', () => activate(id));
    t.querySelector('.tab-close').addEventListener('click', () => close(id));
    tabsContainer.appendChild(t);
    for (const [otherId, otherEl] of tabs.entries()) otherEl.classList.remove('is-active');
    tabs.set(id, t);
  }

  function activate(id) {
    window.dlp.tabs.activate(id);
    for (const [otherId, otherEl] of tabs.entries()) {
      otherEl.classList.toggle('is-active', otherId === id);
    }
  }

  function close(id) {
    window.dlp.tabs.close(id);
    const t = tabs.get(id);
    if (t) { t.remove(); tabs.delete(id); }
  }

  return { open, activate, close };
}

window.__initTabHost = initTabHost;
