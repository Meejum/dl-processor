// Automation rules editor — v2.3 Phase 9.
//
// Native renderer-DOM page rendered into a tab-host render-mode pane.
// Follows the v2.2 pattern from dashboard-page.js. Exposes
// window.__renderAutomationPage(container).
//
// Scope: DESCOPE FALLBACK per spec § 4.6 Realism Check #3 — the WHEN/THEN
// predicates are edited as raw JSON in a textarea instead of a clause-builder
// with dropdowns + AND/OR chips. Backend validation errors surface inline.
//
// Uses IPC: window.dlp.rules.{list,create,update,remove}. Built-in rules show
// a 🔒 badge and only the `enabled` toggle is wired (Edit/Delete are
// disabled per backend rule in src/commands/rules.js).

(function () {

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const DEFAULT_WHEN = '{\n  "op": "and",\n  "clauses": []\n}';
  const DEFAULT_THEN = '{\n  "action": "auto_approve"\n}';

  function renderAutomationPage(container) {
    container.classList.add('automation-page');
    container.innerHTML = [
      '<div class="ap-head">',
      '  <h2>🤖 Automation rules</h2>',
      '  <span class="ap-totals"></span>',
      '  <span class="spacer" style="flex:1"></span>',
      '  <button class="ap-new-btn" type="button">+ New rule</button>',
      '</div>',
      '<div class="ap-status"></div>',
      '<div class="ap-list"></div>',
      '<div class="ap-modal-host"></div>'
    ].join('');

    const totalsEl = container.querySelector('.ap-totals');
    const statusEl = container.querySelector('.ap-status');
    const listEl   = container.querySelector('.ap-list');
    const newBtn   = container.querySelector('.ap-new-btn');
    const modalHostEl = container.querySelector('.ap-modal-host');

    async function load() {
      statusEl.textContent = 'Loading…';
      statusEl.classList.remove('is-error');
      listEl.innerHTML = '';
      let rules = [];
      try {
        rules = await window.dlp.rules.list();
      } catch (e) {
        statusEl.textContent = 'Failed to load rules: ' + (e && e.message ? e.message : e);
        statusEl.classList.add('is-error');
        return;
      }
      statusEl.textContent = '';
      const builtinN = rules.filter(r => r.builtin).length;
      const userN = rules.length - builtinN;
      totalsEl.innerHTML =
        '<b>' + rules.length + '</b> rules · ' +
        '<b>' + builtinN + '</b> built-in · ' +
        '<b>' + userN + '</b> user';
      for (const r of rules) listEl.appendChild(renderRow(r));
    }

    function renderRow(rule) {
      const row = document.createElement('div');
      row.className = 'ap-row';
      if (rule.builtin) row.classList.add('is-builtin');
      if (!rule.enabled) row.classList.add('is-disabled');

      // Toggle
      const toggleCell = document.createElement('div');
      toggleCell.className = 'ap-cell ap-cell-toggle';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = !!rule.enabled;
      toggle.title = rule.enabled ? 'Disable rule' : 'Enable rule';
      toggle.addEventListener('change', async (ev) => {
        toggle.disabled = true;
        try {
          await window.dlp.rules.update(rule.id, { enabled: ev.target.checked });
          await load();
        } catch (e) {
          alert('Could not toggle rule: ' + (e && e.message ? e.message : e));
          toggle.checked = !ev.target.checked;
        } finally {
          toggle.disabled = false;
        }
      });
      toggleCell.appendChild(toggle);
      row.appendChild(toggleCell);

      // Name + badge
      const nameCell = document.createElement('div');
      nameCell.className = 'ap-cell ap-cell-name';
      nameCell.innerHTML =
        '<span class="ap-name">' + escHtml(rule.name) + '</span>' +
        (rule.builtin ? ' <span class="ap-badge ap-badge-builtin" title="Built-in rule">🔒 built-in</span>' : '');
      row.appendChild(nameCell);

      // Priority
      const prioCell = document.createElement('div');
      prioCell.className = 'ap-cell ap-cell-priority';
      prioCell.innerHTML = '<span class="ap-mute">prio</span> ' + escHtml(rule.priority);
      row.appendChild(prioCell);

      // Counts
      const countsCell = document.createElement('div');
      countsCell.className = 'ap-cell ap-cell-counts';
      countsCell.innerHTML =
        '<span title="Applied count">▶ ' + (rule.applied_count || 0) + '</span> ' +
        '<span title="Revert count" class="ap-mute">↩ ' + (rule.revert_count || 0) + '</span>';
      row.appendChild(countsCell);

      // Actions
      const actionsCell = document.createElement('div');
      actionsCell.className = 'ap-cell ap-cell-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ap-btn ap-btn-edit';
      editBtn.textContent = 'Edit';
      editBtn.disabled = !!rule.builtin;
      if (rule.builtin) editBtn.title = 'Built-in rules cannot be edited (only the enabled toggle).';
      editBtn.addEventListener('click', () => openModal({ mode: 'edit', rule }));
      actionsCell.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ap-btn ap-btn-delete';
      delBtn.textContent = 'Delete';
      delBtn.disabled = !!rule.builtin;
      if (rule.builtin) delBtn.title = 'Built-in rules cannot be deleted; disable instead.';
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete rule "' + rule.name + '"? This cannot be undone.')) return;
        try {
          await window.dlp.rules.remove(rule.id);
          await load();
        } catch (e) {
          alert('Could not delete rule: ' + (e && e.message ? e.message : e));
        }
      });
      actionsCell.appendChild(delBtn);
      row.appendChild(actionsCell);

      return row;
    }

    function openModal(opts) {
      const { mode, rule } = opts || {};
      const isEdit = mode === 'edit';
      const initialName = isEdit ? rule.name : '';
      const initialPriority = isEdit ? rule.priority : 100;
      const initialWhen = isEdit
        ? JSON.stringify(rule.when, null, 2)
        : DEFAULT_WHEN;
      const initialThen = isEdit
        ? JSON.stringify(rule.then, null, 2)
        : DEFAULT_THEN;

      modalHostEl.innerHTML = [
        '<div class="ap-modal" role="dialog" aria-modal="true">',
        '  <div class="ap-modal-card">',
        '    <header class="ap-modal-head">',
        '      <h3>' + (isEdit ? 'Edit rule' : 'New rule') + '</h3>',
        '      <button class="ap-modal-close" type="button" aria-label="Close">×</button>',
        '    </header>',
        '    <div class="ap-modal-error" hidden></div>',
        '    <div class="ap-modal-body">',
        '      <label class="ap-field">',
        '        <span class="ap-field-label">Name</span>',
        '        <input class="ap-input ap-input-name" type="text" value="' + escHtml(initialName) + '" placeholder="rule name">',
        '      </label>',
        '      <label class="ap-field">',
        '        <span class="ap-field-label">Priority <span class="ap-mute">(1–999; lower fires first)</span></span>',
        '        <input class="ap-input ap-input-priority" type="number" min="1" max="999" value="' + escHtml(initialPriority) + '">',
        '      </label>',
        '      <label class="ap-field">',
        '        <span class="ap-field-label">WHEN <span class="ap-mute">(predicate JSON)</span></span>',
        '        <textarea class="ap-textarea ap-input-when" spellcheck="false" rows="12"></textarea>',
        '      </label>',
        '      <label class="ap-field">',
        '        <span class="ap-field-label">THEN <span class="ap-mute">(action JSON)</span></span>',
        '        <textarea class="ap-textarea ap-input-then" spellcheck="false" rows="6"></textarea>',
        '      </label>',
        '    </div>',
        '    <footer class="ap-modal-actions">',
        '      <button class="ap-btn ap-btn-cancel" type="button">Cancel</button>',
        '      <button class="ap-btn ap-btn-save ap-btn-primary" type="button">Save</button>',
        '    </footer>',
        '  </div>',
        '</div>'
      ].join('');

      const overlayEl   = modalHostEl.querySelector('.ap-modal');
      const errEl       = modalHostEl.querySelector('.ap-modal-error');
      const nameEl      = modalHostEl.querySelector('.ap-input-name');
      const priorityEl  = modalHostEl.querySelector('.ap-input-priority');
      const whenEl      = modalHostEl.querySelector('.ap-input-when');
      const thenEl      = modalHostEl.querySelector('.ap-input-then');
      const cancelBtn   = modalHostEl.querySelector('.ap-btn-cancel');
      const closeBtn    = modalHostEl.querySelector('.ap-modal-close');
      const saveBtn     = modalHostEl.querySelector('.ap-btn-save');

      // Set textarea values via .value (not innerHTML) so JSON braces aren't
      // re-parsed and indent is preserved.
      whenEl.value = initialWhen;
      thenEl.value = initialThen;

      function showError(msg) {
        errEl.hidden = false;
        errEl.textContent = msg;
      }
      function clearError() {
        errEl.hidden = true;
        errEl.textContent = '';
      }
      function closeModal() {
        modalHostEl.innerHTML = '';
      }

      cancelBtn.addEventListener('click', closeModal);
      closeBtn.addEventListener('click', closeModal);
      overlayEl.addEventListener('click', (ev) => {
        if (ev.target === overlayEl) closeModal();
      });

      saveBtn.addEventListener('click', async () => {
        clearError();
        const name = nameEl.value.trim();
        const priority = parseInt(priorityEl.value, 10);
        if (!name) { showError('Name is required.'); return; }
        if (!Number.isFinite(priority)) { showError('Priority must be a number.'); return; }

        let whenObj, thenObj;
        try { whenObj = JSON.parse(whenEl.value); }
        catch (e) { showError('WHEN is not valid JSON: ' + e.message); return; }
        try { thenObj = JSON.parse(thenEl.value); }
        catch (e) { showError('THEN is not valid JSON: ' + e.message); return; }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
          if (isEdit) {
            await window.dlp.rules.update(rule.id, {
              name, priority, when: whenObj, then: thenObj
            });
          } else {
            await window.dlp.rules.create({
              name, priority, when: whenObj, then: thenObj, enabled: true
            });
          }
          closeModal();
          await load();
        } catch (e) {
          // Backend validation errors surface here. Keep form open + values
          // intact so the user can fix and retry.
          showError(e && e.message ? e.message : String(e));
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });

      nameEl.focus();
    }

    newBtn.addEventListener('click', () => openModal({ mode: 'new' }));
    load();
  }

  window.__renderAutomationPage = renderAutomationPage;
})();
