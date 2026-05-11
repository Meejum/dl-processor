// Tab host: each tab is an <iframe> inside the renderer DOM. The iframes
// sit absolutely-positioned inside .tab-content; only the active one is
// display:block. No IPC bounds math — the CSS flex layout positions
// everything, so the tabs always align with the surrounding chrome.
function initTabHost() {
  const host = document.getElementById('tab-host');
  host.innerHTML = '';

  const strip = document.createElement('div');
  strip.className = 'tab-strip';
  strip.innerHTML =
    '<div class="tab-nav">' +
      '<button class="tab-nav-btn" data-nav="back"    title="Back">◀</button>' +
      '<button class="tab-nav-btn" data-nav="forward" title="Forward">▶</button>' +
      '<button class="tab-nav-btn" data-nav="reload"  title="Reload">↻</button>' +
    '</div>' +
    '<div class="tab-strip-tabs"></div>';
  host.appendChild(strip);

  const content = document.createElement('div');
  content.className = 'tab-content';
  host.appendChild(content);

  const tabsContainer = strip.querySelector('.tab-strip-tabs');
  const tabs = new Map();   // id -> { tabEl, iframeEl, title }
  let nextTabId = 1;
  let activeTabId = null;

  function withActiveIframe(fn) {
    const t = tabs.get(activeTabId);
    if (!t) return;
    try { fn(t.iframeEl); } catch (e) { console.warn('tab nav failed:', e); }
  }

  strip.querySelector('[data-nav="back"]').addEventListener('click', () => {
    withActiveIframe((f) => f.contentWindow.history.back());
  });
  strip.querySelector('[data-nav="forward"]').addEventListener('click', () => {
    withActiveIframe((f) => f.contentWindow.history.forward());
  });
  strip.querySelector('[data-nav="reload"]').addEventListener('click', () => {
    withActiveIframe((f) => f.contentWindow.location.reload());
  });

  function open({ url, srcdoc, title }) {
    const id = String(nextTabId++);

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = id;
    tabEl.innerHTML = '<span class="tab-title"></span><button class="tab-close" type="button">×</button>';
    tabEl.querySelector('.tab-title').textContent = title;
    tabEl.querySelector('.tab-title').addEventListener('click', () => activate(id));
    tabEl.querySelector('.tab-close').addEventListener('click', (ev) => { ev.stopPropagation(); close(id); });
    tabsContainer.appendChild(tabEl);

    const iframeEl = document.createElement('iframe');
    iframeEl.className = 'tab-iframe';
    iframeEl.dataset.tabId = id;
    if (srcdoc) iframeEl.srcdoc = srcdoc;
    else        iframeEl.src    = url;
    content.appendChild(iframeEl);

    // Suppress Chromium's bottom-left "file:///..." link-hover preview by
    // rewriting every <a href> in the loaded document to use an onclick
    // handler instead. webSecurity:false lets us reach into the iframe.
    iframeEl.addEventListener('load', () => {
      try {
        const doc = iframeEl.contentDocument;
        if (!doc) return;
        for (const a of doc.querySelectorAll('a[href]')) {
          const target = a.getAttribute('href');
          if (!target || target.startsWith('#') || target.startsWith('javascript:')) continue;
          a.setAttribute('data-href', target);
          a.setAttribute('href', 'javascript:void(0)');
          a.addEventListener('click', (ev) => {
            ev.preventDefault();
            iframeEl.contentWindow.location.href = target;
          });
        }
      } catch (e) {
        console.warn('iframe link patch failed:', e);
      }
    });

    tabs.set(id, { tabEl, iframeEl, title });
    activate(id);
    return { id, title, url: url || null };
  }

  function activate(id) {
    activeTabId = id;
    for (const [otherId, t] of tabs.entries()) {
      const isActive = otherId === id;
      t.tabEl.classList.toggle('is-active', isActive);
      t.iframeEl.classList.toggle('is-active', isActive);
    }
  }

  function close(id) {
    const t = tabs.get(id);
    if (!t) return;
    t.tabEl.remove();
    t.iframeEl.remove();
    tabs.delete(id);
    if (activeTabId === id) {
      activeTabId = null;
      const next = tabs.keys().next().value;
      if (next) activate(next);
    }
  }

  return { open, activate, close };
}

window.__initTabHost = initTabHost;
