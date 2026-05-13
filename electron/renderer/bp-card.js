// electron/renderer/bp-card.js
//
// Native renderer-DOM component for a single Business Process card.
// v2.0 Task 14 — composed into a list by Task 15's Review Pending page.
//
// API:
//   renderBpCard(container, bp, onAction)
//     container — HTMLElement to mount the card into (the card root replaces
//                  whatever was in `container`).
//     bp        — BP object from listBps(): { bp_id, project_id, project_name,
//                  unit_number_norm, tower_name, label, state, sfContext, rows }
//     onAction  — async-aware callback invoked when the user takes any action.
//                  Signature: ({ type, bpId, payload }) => void | Promise<void>
//                  Types:
//                    'approve-bp'      payload: { overrides: {[change_id]: value} }
//                    'reject-bp'
//                    'acknowledge-bp'
//                    'expand-toggle'   payload: { expanded: boolean }
//                    'open-in-sf'      payload: { bookingRecordId }
//                    'approve-row'     payload: { changeId, override }
//                    'reject-row'      payload: { changeId }
//                    'teach-alias'     payload: { changeId, scope }
//
// Discipline: this module is PURE DOM. It must never call window.dlp.* — the
// caller (Task 15) wires onAction to IPC. Keeps the component reusable and
// trivial to unit-test in isolation later if needed.

(function () {

  // --------------- helpers ---------------

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(s, max) {
    if (s === null || s === undefined) return '';
    const str = String(s);
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString();
  }

  function fmtDate(v) {
    if (!v) return '';
    return String(v).slice(0, 10);
  }

  // Field-level pretty-printer used in header preview rows and expanded rows.
  function fmtFieldValue(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'purchase_price_aed') return fmtMoney(value);
    if (/_date$|date_/.test(field || '')) return fmtDate(value) || String(value);
    return String(value);
  }

  // Pick a row to preview in the header for a given field (collapsed view).
  function findRow(rows, fieldName) {
    if (!Array.isArray(rows)) return null;
    return rows.find(r => r && r.field_name === fieldName) || null;
  }

  function bannerForState(state) {
    switch (state) {
      case 'IN_PROGRESS':
        return { cls: 'bp-banner-warn',
                 text: '⚠ BP is still running in SF — verify completion before approving.' };
      case 'DLD_ISSUE':
        return { cls: 'bp-banner-dld',
                 text: '⚠ DLD has issue with customer info — resolve in SF first.' };
      case 'REJECTED':
        return { cls: 'bp-banner-reject',
                 text: '✗ BP was rejected in SF — pending changes are informational only.' };
      case 'NO_SF_ROW':
        return { cls: 'bp-banner-nosf',
                 text: '⚠ No SF record found for this unit — cannot verify BP state.' };
      default:
        return null;
    }
  }

  const STATE_CLASS = {
    READY:        'state-ready',
    IN_PROGRESS:  'state-in-progress',
    DLD_ISSUE:    'state-dld-issue',
    REJECTED:     'state-rejected',
    NO_SF_ROW:    'state-no-sf-row'
  };

  // --------------- card body builders ---------------

  function buildHeader(bp) {
    const sf = bp.sfContext || {};
    const unit = bp.unit_number_norm || '';
    const proj = bp.project_name || '';
    const tower = bp.tower_name ? ' ' + bp.tower_name : '';
    const dldRef = sf.procedure_number ? ' · DLD: ' + escapeHtml(sf.procedure_number) : '';
    const label = bp.label ? ' · ' + escapeHtml(bp.label) : '';
    const stateBadge =
      '<span class="bp-state-badge bp-state-' + escapeHtml(bp.state || 'NO_SF_ROW') + '">' +
      escapeHtml(bp.state || 'NO_SF_ROW') + '</span>';
    const titleLeft =
      '<span class="bp-title-unit">SOR-' + escapeHtml(unit) + '</span>' +
      ' · ' + escapeHtml(proj) + escapeHtml(tower) +
      dldRef + label;
    return (
      '<div class="bp-header">' +
        '<div class="bp-header-title">' + titleLeft + '</div>' +
        '<div class="bp-header-badges">' + stateBadge + '</div>' +
      '</div>'
    );
  }

  function buildFieldPreview(bp) {
    const rows = bp.rows || [];
    if (rows.length === 0) {
      return '<div class="bp-preview-empty">No pending field changes.</div>';
    }
    // Preview up to 3 prioritised fields; falls back to the first 3 rows.
    const priority = ['buyer_name', 'purchase_price_aed', 'procedure_number'];
    const seen = new Set();
    const preview = [];
    for (const f of priority) {
      const r = findRow(rows, f);
      if (r) { preview.push(r); seen.add(r.change_id); }
    }
    for (const r of rows) {
      if (preview.length >= 3) break;
      if (!seen.has(r.change_id)) { preview.push(r); seen.add(r.change_id); }
    }

    const labelMap = {
      buyer_name:         'Buyer',
      purchase_price_aed: 'Price',
      procedure_number:   'Procedure'
    };

    const parts = preview.map(r => {
      const lbl = labelMap[r.field_name] || r.field_name;
      const oldVal = fmtFieldValue(r.field_name, r.old_value);
      const newVal = fmtFieldValue(r.field_name, r.proposed_value);
      const oldShown = r.field_name === 'buyer_name' ? truncate(oldVal, 60) : oldVal;
      const newShown = r.field_name === 'buyer_name' ? truncate(newVal, 60) : newVal;
      return (
        '<div class="bp-preview-row">' +
          '<span class="bp-preview-label">' + escapeHtml(lbl) + ':</span>' +
          '<span class="bp-preview-old">' + escapeHtml(oldShown) + '</span>' +
          '<span class="bp-preview-arrow">→</span>' +
          '<span class="bp-preview-new">' + escapeHtml(newShown) + '</span>' +
        '</div>'
      );
    });
    const more = rows.length > preview.length
      ? '<div class="bp-preview-more">+' + (rows.length - preview.length) +
        ' more field' + (rows.length - preview.length === 1 ? '' : 's') + '</div>'
      : '';
    return '<div class="bp-preview">' + parts.join('') + more + '</div>';
  }

  function buildSfContextStrip(bp) {
    const sf = bp.sfContext;
    if (!sf) {
      return '<div class="bp-sfctx bp-sfctx-empty">No Salesforce row matched for this unit.</div>';
    }
    const created = fmtDate(sf.bp_created_date);
    const paid    = fmtDate(sf.payment_date);
    const lines = [];
    lines.push(
      '<div class="bp-sfctx-line">' +
        '<span class="bp-sfctx-k">BP:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.bp_name || '—') + '</span>' +
        ' · <span class="bp-sfctx-k">Status:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.status || '—') + '</span>' +
      '</div>'
    );
    lines.push(
      '<div class="bp-sfctx-line">' +
        '<span class="bp-sfctx-k">Step:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.current_step_name || '—') + '</span>' +
        ' · <span class="bp-sfctx-k">Assigned:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.current_step_assigned_name || '—') + '</span>' +
      '</div>'
    );
    lines.push(
      '<div class="bp-sfctx-line">' +
        '<span class="bp-sfctx-k">Pre-reg:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.pre_reg_status || '—') + '</span>' +
        ' · <span class="bp-sfctx-k">DLD Process:</span> <span class="bp-sfctx-v">' + escapeHtml(sf.dld_process_status || '—') + '</span>' +
      '</div>'
    );
    if (created || paid) {
      lines.push(
        '<div class="bp-sfctx-line">' +
          '<span class="bp-sfctx-k">Created:</span> <span class="bp-sfctx-v">' + escapeHtml(created || '—') + '</span>' +
          ' · <span class="bp-sfctx-k">Paid:</span> <span class="bp-sfctx-v">' + escapeHtml(paid || '—') + '</span>' +
        '</div>'
      );
    }
    if (sf.comments) {
      lines.push(
        '<div class="bp-sfctx-line bp-sfctx-comments">' +
          '<span class="bp-sfctx-k">Comments:</span> <span class="bp-sfctx-v">“' +
          escapeHtml(sf.comments) + '”</span>' +
        '</div>'
      );
    }
    return '<div class="bp-sfctx">' + lines.join('') + '</div>';
  }

  function buildActions(bp) {
    const sf = bp.sfContext || {};
    const state = bp.state || 'NO_SF_ROW';
    const hasBookingId = !!sf.booking_record_id;
    const buttons = [];

    if (state === 'REJECTED') {
      buttons.push(
        '<button class="bp-btn bp-btn-acknowledge" data-action="acknowledge-bp">Acknowledge</button>'
      );
    } else {
      const approveDisabled = (state === 'IN_PROGRESS' || state === 'DLD_ISSUE');
      const approveTitle = approveDisabled
        ? 'BP in progress — review individual fields after verifying in SF'
        : (state === 'NO_SF_ROW' ? 'No SF row — will prompt for confirmation' : 'Approve all pending changes');
      buttons.push(
        '<button class="bp-btn bp-btn-approve" data-action="approve-bp"' +
        (approveDisabled ? ' disabled' : '') +
        ' title="' + escapeHtml(approveTitle) + '">Approve all</button>'
      );
      buttons.push(
        '<button class="bp-btn bp-btn-reject" data-action="reject-bp">Reject all</button>'
      );
    }

    if (hasBookingId) {
      buttons.push(
        '<button class="bp-btn bp-btn-sf" data-action="open-in-sf">Open in SF →</button>'
      );
    } else {
      buttons.push(
        '<button class="bp-btn bp-btn-sf" disabled title="No booking record id">Open in SF →</button>'
      );
    }
    buttons.push(
      '<button class="bp-btn bp-btn-expand" data-action="expand-toggle">' +
        '<span class="bp-expand-label-collapsed">Expand</span>' +
        '<span class="bp-expand-label-expanded">Collapse</span>' +
      '</button>'
    );

    return '<div class="bp-actions">' + buttons.join('') + '</div>';
  }

  function buildRowsTable(bp) {
    const rows = bp.rows || [];
    const readOnly = (bp.state === 'REJECTED');
    if (rows.length === 0) {
      return '<div class="bp-rows-empty">No pending rows.</div>';
    }

    const trs = rows.map(r => {
      const fid = String(r.change_id);
      const oldVal = fmtFieldValue(r.field_name, r.old_value);
      const proposed = r.proposed_value === null || r.proposed_value === undefined
        ? '' : String(r.proposed_value);
      const isBuyerMismatch = (r.field_name === 'buyer_name') ||
        (r.alias_reason === 'BUYER_MISMATCH') ||
        (r.reason === 'BUYER_MISMATCH');
      const editInput = readOnly
        ? '<span class="bp-row-new-readonly">' + escapeHtml(proposed) + '</span>'
        : '<input class="bp-row-new" type="text" value="' + escapeHtml(proposed) +
          '" data-change-id="' + escapeHtml(fid) + '" data-original="' + escapeHtml(proposed) + '">';
      const decisionCell = r.decision && r.decision !== 'pending'
        ? '<td class="bp-row-decided">' + escapeHtml(r.decision) + '</td>'
        : (readOnly
            ? '<td class="bp-row-actions">—</td>'
            : '<td class="bp-row-actions">' +
                '<button class="bp-row-btn bp-row-approve" data-action="approve-row" data-change-id="' + escapeHtml(fid) + '" title="Approve this field">✓</button>' +
                '<button class="bp-row-btn bp-row-reject" data-action="reject-row" data-change-id="' + escapeHtml(fid) + '" title="Reject this field">✗</button>' +
                (isBuyerMismatch
                  ? '<button class="bp-row-btn bp-row-teach" data-action="teach-alias" data-change-id="' + escapeHtml(fid) + '" title="Teach as alias">🔗</button>'
                  : '') +
              '</td>');
      return (
        '<tr class="bp-row' + (r.decision && r.decision !== 'pending' ? ' is-resolved' : '') + '">' +
          '<td class="bp-row-field">' + escapeHtml(r.field_name) + '</td>' +
          '<td class="bp-row-old">' + escapeHtml(oldVal) + '</td>' +
          '<td class="bp-row-new-cell">' + editInput + '</td>' +
          decisionCell +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="bp-rows">' +
        '<table class="bp-rows-table">' +
          '<thead><tr>' +
            '<th>Field</th><th>Current</th><th>Proposed</th><th>Action</th>' +
          '</tr></thead>' +
          '<tbody>' + trs + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  // --------------- main entrypoint ---------------

  function renderBpCard(container, bp, onAction) {
    if (!container || !bp) return;
    const cb = typeof onAction === 'function' ? onAction : function () {};

    const stateCls = STATE_CLASS[bp.state] || STATE_CLASS.NO_SF_ROW;
    const banner = bannerForState(bp.state);

    container.innerHTML =
      '<article class="bp-card ' + stateCls + '" data-bp-id="' + escapeHtml(bp.bp_id || '') +
      '" data-state="' + escapeHtml(bp.state || '') + '" data-expanded="0">' +
        buildHeader(bp) +
        (banner ? '<div class="bp-banner ' + banner.cls + '">' + banner.text + '</div>' : '') +
        buildFieldPreview(bp) +
        buildSfContextStrip(bp) +
        buildActions(bp) +
        buildRowsTable(bp) +
      '</article>';

    const card = container.querySelector('.bp-card');
    if (!card) return;

    // Collect any per-row overrides (any input whose current value differs from
    // its original proposed_value) and bundle for approve-bp action.
    function collectOverrides() {
      const out = {};
      const inputs = card.querySelectorAll('input.bp-row-new');
      inputs.forEach(inp => {
        const cur = inp.value;
        const orig = inp.getAttribute('data-original') || '';
        if (cur !== orig) {
          const cid = inp.getAttribute('data-change-id');
          if (cid) out[cid] = cur;
        }
      });
      return out;
    }

    function currentRowOverride(cid) {
      const inp = card.querySelector('input.bp-row-new[data-change-id="' +
        cid.replace(/"/g, '\\"') + '"]');
      if (!inp) return null;
      const cur = inp.value;
      const orig = inp.getAttribute('data-original') || '';
      return (cur !== orig) ? cur : null;
    }

    function setExpanded(expanded) {
      card.dataset.expanded = expanded ? '1' : '0';
      card.classList.toggle('expanded', !!expanded);
    }

    card.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-action]');
      if (!btn || !card.contains(btn)) return;
      if (btn.disabled) return;
      const action = btn.getAttribute('data-action');
      const bpId = bp.bp_id;

      switch (action) {
        case 'expand-toggle': {
          const next = !(card.dataset.expanded === '1');
          setExpanded(next);
          try { cb({ type: 'expand-toggle', bpId: bpId, payload: { expanded: next } }); } catch (_) {}
          return;
        }
        case 'approve-bp': {
          if (bp.state === 'NO_SF_ROW') {
            const ok = window.confirm(
              'No Salesforce row matched for unit ' + (bp.unit_number_norm || '?') +
              '. Approve all pending changes anyway?'
            );
            if (!ok) return;
          }
          const overrides = collectOverrides();
          try { cb({ type: 'approve-bp', bpId: bpId, payload: { overrides: overrides } }); } catch (_) {}
          return;
        }
        case 'reject-bp': {
          try { cb({ type: 'reject-bp', bpId: bpId, payload: {} }); } catch (_) {}
          return;
        }
        case 'acknowledge-bp': {
          try { cb({ type: 'acknowledge-bp', bpId: bpId, payload: {} }); } catch (_) {}
          return;
        }
        case 'open-in-sf': {
          const bookingRecordId = (bp.sfContext && bp.sfContext.booking_record_id) || null;
          try { cb({ type: 'open-in-sf', bpId: bpId, payload: { bookingRecordId: bookingRecordId } }); } catch (_) {}
          return;
        }
        case 'approve-row': {
          const cid = btn.getAttribute('data-change-id');
          if (!cid) return;
          const override = currentRowOverride(cid);
          try { cb({ type: 'approve-row', bpId: bpId, payload: { changeId: cid, override: override } }); } catch (_) {}
          return;
        }
        case 'reject-row': {
          const cid = btn.getAttribute('data-change-id');
          if (!cid) return;
          try { cb({ type: 'reject-row', bpId: bpId, payload: { changeId: cid } }); } catch (_) {}
          return;
        }
        case 'teach-alias': {
          const cid = btn.getAttribute('data-change-id');
          if (!cid) return;
          try { cb({ type: 'teach-alias', bpId: bpId, payload: { changeId: cid, scope: 'unit' } }); } catch (_) {}
          return;
        }
      }
    });
  }

  window.__renderBpCard = renderBpCard;
})();
