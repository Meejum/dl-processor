// Native buyer / applicant popup for the Project Compare table.
//
// The CLI HTML uses <details><summary> from src/buyer-cells.js. Inside a
// renderer-DOM table that breaks visually — the open <details> pushes the
// row height. v2.2 replaces it with a renderer-managed floating div anchored
// to a clickable chip. One popup open at a time; ESC and click-outside close.

(function () {
  let openEl = null;
  let openAnchor = null;
  let docClickBound = false;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '';
    return Math.round(Number(v)).toLocaleString();
  }

  function fmtArea(v) {
    if (v == null || isNaN(v)) return '';
    const n = Number(v);
    return (Math.round(n * 100) / 100).toFixed(2) + ' SQM';
  }

  function close() {
    if (openEl) { openEl.remove(); openEl = null; openAnchor = null; }
  }

  function ensureGlobalCloseHandlers() {
    if (docClickBound) return;
    document.addEventListener('click', (ev) => {
      if (!openEl) return;
      if (openEl.contains(ev.target)) return;
      if (openAnchor && openAnchor.contains(ev.target)) return;
      close();
    }, true);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && openEl) close();
    });
    docClickBound = true;
  }

  function renderDldBuyerLine(b) {
    const parts = [];
    const label = b.kind === 'bank'   ? '[bank] '
              : b.kind === 'seller' ? '[seller — name not captured] '
              : '';
    parts.push(label + escHtml(b.name || ''));
    if (b.areaSqm   != null) parts.push(fmtArea(b.areaSqm));
    if (b.amountAed != null) parts.push(fmtMoney(b.amountAed) + ' AED');
    if (b.txType)            parts.push(escHtml(b.txType));
    if (b.txSubtype)         parts.push(escHtml(b.txSubtype));
    if (b.date)              parts.push(escHtml(b.date));
    const cls = b.kind === 'bank' ? 'bank' : (b.kind === 'seller' ? 'seller' : '');
    return '<li class="' + cls + '">' + parts.filter(Boolean).join(' · ') + '</li>';
  }

  function renderSfApplicantLine(a) {
    return '<li>' + escHtml(a.name) + ' <small>(' + escHtml(a.role) + ')</small></li>';
  }

  function openPopup(anchor, listHtml) {
    close();
    ensureGlobalCloseHandlers();
    const pop = document.createElement('div');
    pop.className = 'buyer-popup';
    pop.innerHTML = listHtml;
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    // Default below the anchor; flip above when there isn't room.
    pop.style.left = Math.max(8, rect.left) + 'px';
    pop.style.top  = (rect.bottom + 4) + 'px';
    requestAnimationFrame(() => {
      const popRect = pop.getBoundingClientRect();
      if (popRect.bottom > window.innerHeight) {
        pop.style.top = Math.max(8, rect.top - popRect.height - 4) + 'px';
      }
      if (popRect.right > window.innerWidth) {
        pop.style.left = Math.max(8, window.innerWidth - popRect.width - 8) + 'px';
      }
    });
    openEl = pop;
    openAnchor = anchor;
  }

  // Public: build a <td> with a clickable chip that opens the popup.
  // kind: 'dld' | 'sf'. Items match the shape compareProject() returns
  // (dld_buyers / sf_applicants).
  function buildBuyerCell(kind, items) {
    const td = document.createElement('td');
    td.classList.add('buyer-cell', 'center');
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      td.textContent = kind === 'sf' ? '—' : '0';
      td.dataset.sortVal = '0';
      return td;
    }
    const count = kind === 'dld'
      ? list.filter(b => b.kind === 'buyer').length
      : list.length;
    td.dataset.sortVal = String(count);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'buyer-chip';
    chip.textContent = String(count);
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (openAnchor === chip) { close(); return; }
      const lines = kind === 'dld'
        ? list.map(renderDldBuyerLine).join('')
        : list.map(renderSfApplicantLine).join('');
      const cls = kind === 'dld' ? 'buyer-list' : 'applicant-list';
      openPopup(chip, '<ul class="' + cls + '">' + lines + '</ul>');
    });
    td.appendChild(chip);
    return td;
  }

  window.__compareCells = { buildBuyerCell, closePopup: close };
})();
