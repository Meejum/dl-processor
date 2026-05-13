// Tab host: each tab is a pane inside the renderer DOM. The panes sit
// absolutely-positioned inside .tab-content; only the active one is
// display:block.
//
// Two pane modes supported as of v2.0:
//   - 'url'    : <iframe src="..."> — external HTML, e.g. the Dashboard.
//   - 'render' : <div class="tab-pane render-pane"> — caller's render(container)
//                function builds DOM directly into it. Scripts run in the
//                main renderer context (no window.parent.dlp indirection).
//
// 'srcdoc' mode (inline HTML string into an iframe) is DEPRECATED. It still
// works but logs a console.warn — Tasks 5/6 convert the last srcdoc callers
// (review-pending, history) to render mode. After those land, srcdoc support
// should be deleted entirely.
//
// For render-mode tabs the address bar / back / forward / reload buttons are
// hidden — there's no iframe contentWindow to navigate. For url-mode tabs
// the address bar works as before.
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
    '<div class="tab-strip-tabs"></div>' +
    '<button class="tab-new-btn" title="New tab">+</button>';
  host.appendChild(strip);

  const addressRow = document.createElement('div');
  addressRow.className = 'tab-address-row';
  addressRow.innerHTML =
    '<input class="tab-address" type="text" placeholder="Type a URL or file path and press Enter">' +
    '<button class="tab-address-go" title="Open">Go</button>';
  host.appendChild(addressRow);

  const navGroup = strip.querySelector('.tab-nav');

  const content = document.createElement('div');
  content.className = 'tab-content';
  host.appendChild(content);

  const tabsContainer = strip.querySelector('.tab-strip-tabs');
  const addressInput  = addressRow.querySelector('.tab-address');
  const addressGoBtn  = addressRow.querySelector('.tab-address-go');
  // id -> { tabEl, paneEl, title, mode }
  //   mode === 'url'    => paneEl is an <iframe>
  //   mode === 'render' => paneEl is a <div>
  const tabs = new Map();
  let nextTabId = 1;
  let activeTabId = null;

  function withActiveIframe(fn) {
    const t = tabs.get(activeTabId);
    if (!t || t.mode !== 'url') return;
    try { fn(t.paneEl); } catch (e) { console.warn('tab nav failed:', e); }
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

  // "+" opens a new blank tab focused on the address bar so the user can
  // type a URL like in any browser.
  strip.querySelector('.tab-new-btn').addEventListener('click', () => {
    open({ url: 'about:blank', title: 'New tab' });
    addressInput.value = '';
    addressInput.focus();
  });

  function normalizeAddress(input) {
    const v = (input || '').trim();
    if (!v) return null;
    if (/^[a-z]+:/i.test(v)) return v;            // already has a scheme
    // Treat a Windows-style path or anything starting with / as a local file.
    return 'file:///' + v.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  function go() {
    const url = normalizeAddress(addressInput.value);
    if (!url) return;
    const t = tabs.get(activeTabId);
    if (t && t.mode === 'url') { t.paneEl.src = url; }
    else                       { open({ url, title: url }); }
  }
  addressGoBtn.addEventListener('click', go);
  addressInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); go(); }
  });

  function open(opts) {
    const { url, srcdoc, render, title } = opts || {};
    const modeCount =
      (url    !== undefined && url    !== null ? 1 : 0) +
      (srcdoc !== undefined && srcdoc !== null ? 1 : 0) +
      (typeof render === 'function' ? 1 : 0);
    if (modeCount !== 1) {
      throw new Error('tabHost.open: exactly one of { url, srcdoc, render } must be provided');
    }

    const id = String(nextTabId++);

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = id;
    tabEl.innerHTML = '<span class="tab-title"></span><button class="tab-close" type="button">×</button>';
    tabEl.querySelector('.tab-title').textContent = title;
    tabEl.querySelector('.tab-title').addEventListener('click', () => activate(id));
    tabEl.querySelector('.tab-close').addEventListener('click', (ev) => { ev.stopPropagation(); close(id); });
    tabsContainer.appendChild(tabEl);

    let mode;
    let paneEl;

    if (typeof render === 'function') {
      mode = 'render';
      paneEl = document.createElement('div');
      paneEl.className = 'tab-pane render-pane';
      paneEl.dataset.tabId = id;
      content.appendChild(paneEl);
      // Synchronously hand the container to the caller. We do this BEFORE
      // activate() so any initial layout the caller performs runs against an
      // attached but hidden element (it becomes display:block via activate()).
      try {
        render(paneEl);
      } catch (e) {
        console.error('tabHost render() threw:', e);
      }
    } else {
      mode = 'url';
      const iframeEl = document.createElement('iframe');
      iframeEl.className = 'tab-iframe';
      iframeEl.dataset.tabId = id;
      if (srcdoc != null) {
        // DEPRECATED in v2.0 — Tasks 5/6 are converting the remaining
        // srcdoc callers (review-pending, history) to render mode. Until
        // that's done we keep the old behavior so the app still launches.
        console.warn(
          'tabHost: srcdoc mode is deprecated; use render mode instead. ' +
          'Title=' + JSON.stringify(title) + '\n' + new Error().stack
        );
        iframeEl.srcdoc = srcdoc;
      } else {
        iframeEl.src = url;
      }
      content.appendChild(iframeEl);
      paneEl = iframeEl;

      // Suppress Chromium's bottom-left "file:///..." link-hover preview AND
      // strip target="_blank" so links never escape to the OS default
      // browser. webSecurity:false lets us reach into the iframe. Also
      // refresh the address bar when this iframe loads if it's the active one.
      iframeEl.addEventListener('load', () => {
        try {
          if (id === activeTabId) syncAddress();
          const doc = iframeEl.contentDocument;
          if (!doc) return;
          for (const a of doc.querySelectorAll('a[href]')) {
            if (a.hasAttribute('target')) a.removeAttribute('target');
            const raw = a.getAttribute('href');
            if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
            // a.href is the FULLY-RESOLVED absolute URL computed against the
            // iframe's document — capture it BEFORE we replace the attribute,
            // otherwise relative URLs resolve against the parent renderer and
            // we hit ERR_FILE_NOT_FOUND for electron/renderer/compare/X.html
            // when the link meant output/compare/X.html.
            const resolved = a.href;
            a.setAttribute('data-href', raw);
            a.setAttribute('href', 'javascript:void(0)');
            a.addEventListener('click', (ev) => {
              ev.preventDefault();
              iframeEl.contentWindow.location.href = resolved;
            });
          }
        } catch (e) {
          console.warn('iframe link patch failed:', e);
        }
      });
    }

    tabs.set(id, { tabEl, paneEl, title, mode });
    activate(id);
    return { id, title, url: url || null, mode };
  }

  function activate(id) {
    activeTabId = id;
    for (const [otherId, t] of tabs.entries()) {
      const isActive = otherId === id;
      t.tabEl.classList.toggle('is-active', isActive);
      t.paneEl.classList.toggle('is-active', isActive);
    }
    updateChromeForActive();
    syncAddress();
  }

  // Show the address bar + back/forward/reload buttons only for url-mode
  // tabs. For render-mode tabs there's no iframe to navigate so we hide
  // them entirely.
  function updateChromeForActive() {
    const t = tabs.get(activeTabId);
    const showUrlChrome = !!t && t.mode === 'url';
    addressRow.style.display = showUrlChrome ? '' : 'none';
    if (navGroup) navGroup.style.visibility = showUrlChrome ? '' : 'hidden';
  }

  function syncAddress() {
    const t = tabs.get(activeTabId);
    if (!t || !addressInput) return;
    if (t.mode !== 'url') {
      if (document.activeElement !== addressInput) addressInput.value = '';
      return;
    }
    let href = '';
    try { href = t.paneEl.contentWindow.location.href; } catch { href = ''; }
    if (!href || href === 'about:blank') href = t.paneEl.getAttribute('src') || '';
    if (document.activeElement !== addressInput) addressInput.value = href;
  }

  function close(id) {
    const t = tabs.get(id);
    if (!t) return;
    t.tabEl.remove();
    t.paneEl.remove();
    tabs.delete(id);
    if (activeTabId === id) {
      activeTabId = null;
      const next = tabs.keys().next().value;
      if (next) activate(next);
      else      updateChromeForActive();
    }
  }

  return { open, activate, close };
}

window.__initTabHost = initTabHost;
