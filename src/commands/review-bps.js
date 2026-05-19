// review-bps.js — BP-level grouping backend for the v2.0 Review Pending UI.
//
// A "BP" (Booking Property) groups every pending_change row for one unit in
// one compare run. UI shows one card per BP; staff approve/reject/acknowledge
// the whole BP at once. This module is purely backend — it wraps the
// row-level helpers in src/commands/review-pending.js with grouping and
// per-group atomicity.
//
// Synthetic bp_id format: `<source_snapshot_id|NULL>_<project_id>_<unit_number_norm>`
// parseBpId() round-trips it. Unit numbers may contain underscores, so the
// parser uses positional split on the FIRST two underscores only.

const { approvePending, rejectPending } = require('./review-pending');
const { writeAuditLog }  = require('../audit-log');
const { classifyBp }     = require('../bp-classifier');
const { classifyState }  = require('../sf-state');

// ─────────────────────────────────────────────────────────────────────
// listBps(db, opts) — query + group + classify + post-group filter
// ─────────────────────────────────────────────────────────────────────
function listBps(db, opts = {}) {
  const {
    tab = 'needs_review', projectId, sfState, bpType, assignedTo,
    procedureNumber, fromTs, toTs, search
  } = opts;

  const where = [];
  const params = [];
  if (tab === 'needs_review') where.push("pc.decision = 'pending'");
  else                        where.push("pc.decision = 'auto_applied'");
  if (projectId) { where.push('pc.project_id = ?'); params.push(projectId); }
  if (fromTs)    { where.push('pc.proposed_at >= ?'); params.push(fromTs); }
  if (toTs)      { where.push('pc.proposed_at <= ?'); params.push(toTs); }

  const rows = db.prepare(`
    SELECT
      pc.change_id, pc.project_id, dp.project_name, pc.unit_number_norm,
      pc.field_name, pc.old_value, pc.proposed_value, pc.override_value,
      pc.change_type, pc.decision, pc.source_snapshot_id, pc.proposed_at, pc.decided_at,
      pc.anomaly
    FROM pending_change pc
    JOIN dld_project dp ON dp.project_id = pc.project_id
    WHERE ${where.join(' AND ')}
    ORDER BY pc.source_snapshot_id DESC, pc.project_id, pc.unit_number_norm, pc.field_name
  `).all(...params);

  // Group by (source_snapshot_id, project_id, unit_number_norm).
  const groups = new Map();
  for (const r of rows) {
    const snapKey = r.source_snapshot_id == null ? 'NULL' : String(r.source_snapshot_id);
    const key = `${snapKey}_${r.project_id}_${r.unit_number_norm}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        project_id: r.project_id,
        project_name: r.project_name,
        unit_number_norm: r.unit_number_norm,
        source_snapshot_id: r.source_snapshot_id,
        rows: []
      });
    }
    groups.get(key).rows.push(r);
  }

  const fetchSf = db.prepare(`
    SELECT b.bp_name, b.sub_project, b.unit_norm, b.tower_name, b.applicant_name,
           b.purchase_price, b.pre_reg_status, b.status, b.rm_process_status,
           b.dld_process_status, b.bp_created_date, b.procedure_number,
           b.payment_date, b.booking_record_id, b.current_step_name,
           b.current_step_assigned_name, b.comments
    FROM sf_booking b
    JOIN sf_snapshot s ON s.sf_snapshot_id = b.sf_snapshot_id
    WHERE b.sub_project = ? AND b.unit_norm = ?
    ORDER BY s.sf_snapshot_id DESC
    LIMIT 1
  `);

  const out = [];
  for (const group of groups.values()) {
    const sfContext = fetchSf.get(group.project_name, group.unit_number_norm) || null;
    const fieldSet  = new Set(group.rows.map(r => r.field_name));
    const label     = classifyBp(fieldSet);
    const state     = classifyState(sfContext);

    // Post-group filters.
    if (sfState  && state !== sfState) continue;
    if (bpType   && label !== bpType)  continue;
    if (assignedTo &&
        (!sfContext || sfContext.current_step_assigned_name !== assignedTo)) continue;
    if (procedureNumber &&
        (!sfContext || sfContext.procedure_number !== procedureNumber)) continue;
    if (search) {
      const hay = JSON.stringify({
        unit: group.unit_number_norm,
        project: group.project_name,
        comments: sfContext && sfContext.comments,
        rows: group.rows
      }).toLowerCase();
      if (!hay.includes(String(search).toLowerCase())) continue;
    }

    out.push({
      bp_id: group.key,
      project_id: group.project_id,
      project_name: group.project_name,
      unit_number_norm: group.unit_number_norm,
      tower_name: sfContext ? sfContext.tower_name : null,
      label,
      state,
      sfContext,
      rows: group.rows
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// parseBpId — `<source_snapshot_id|NULL>_<project_id>_<unit_number_norm>`
// Unit numbers may contain underscores; only the first two are delimiters.
// ─────────────────────────────────────────────────────────────────────
function parseBpId(bpId) {
  if (typeof bpId !== 'string' || bpId.length === 0) return null;
  const firstUnderscore  = bpId.indexOf('_');
  if (firstUnderscore < 0) return null;
  const secondUnderscore = bpId.indexOf('_', firstUnderscore + 1);
  if (secondUnderscore < 0) return null;
  const snapPart = bpId.slice(0, firstUnderscore);
  const projPart = bpId.slice(firstUnderscore + 1, secondUnderscore);
  const unitPart = bpId.slice(secondUnderscore + 1);
  if (unitPart.length === 0) return null;
  const source_snapshot_id = snapPart === 'NULL' ? null : parseInt(snapPart, 10);
  if (snapPart !== 'NULL' && Number.isNaN(source_snapshot_id)) return null;
  const project_id = parseInt(projPart, 10);
  if (Number.isNaN(project_id)) return null;
  // Reject if projPart had non-digit junk like "xyz" → parseInt('xyz') = NaN.
  // Also reject "1abc" since parseInt would silently parse to 1 — require
  // the whole part to be digits.
  if (!/^-?\d+$/.test(projPart)) return null;
  return { source_snapshot_id, project_id, unit_number_norm: unitPart };
}

// ─────────────────────────────────────────────────────────────────────
// Internal: find pending rows belonging to a parsed BP.
// ─────────────────────────────────────────────────────────────────────
function pendingRowsForBp(db, parts) {
  const { source_snapshot_id, project_id, unit_number_norm } = parts;
  return db.prepare(`
    SELECT change_id, field_name FROM pending_change
    WHERE project_id = ? AND unit_number_norm = ? AND decision = 'pending'
      AND ((source_snapshot_id IS NULL AND ? IS NULL) OR source_snapshot_id = ?)
  `).all(project_id, unit_number_norm, source_snapshot_id, source_snapshot_id);
}

function pluralFields(n) {
  return `${n} field${n === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────────────────────────────
// approveBp — atomic: approvePending(each row) + umbrella audit
// ─────────────────────────────────────────────────────────────────────
function approveBp(db, bpId, overrides = {}, opts = {}) {
  const parts = parseBpId(bpId);
  if (!parts) throw new Error('approveBp: malformed bpId: ' + bpId);
  const { userNote = null, thresholds = null } = opts || {};
  const tx = db.transaction(() => {
    const rows = pendingRowsForBp(db, parts);
    if (rows.length === 0) throw new Error('approveBp: no pending rows for ' + bpId);
    for (const r of rows) {
      const override = Object.prototype.hasOwnProperty.call(overrides, r.change_id)
        ? overrides[r.change_id]
        : null;
      // Pass userNote + thresholds through so each per-row audit_log entry
      // gets tier2/user_note set per the backend re-check.
      approvePending(db, r.change_id, override, { userNote, thresholds });
    }
    writeAuditLog(db, {
      projectId: parts.project_id,
      unitNumberNorm: parts.unit_number_norm,
      tableName: 'master_data',
      field: '<bp>',
      oldValue: null,
      newValue: bpId,
      action: 'approve_bp',
      source: 'review_pending',
      changeId: null,
      userNote: userNote
        ? `Approve all (${pluralFields(rows.length)}) — ${userNote}`
        : `Approve all (${pluralFields(rows.length)})`
    });
  });
  tx();
}

// ─────────────────────────────────────────────────────────────────────
// rejectBp — atomic: rejectPending(each row) + umbrella audit
// ─────────────────────────────────────────────────────────────────────
function rejectBp(db, bpId) {
  rejectOrAcknowledge(db, bpId, 'reject_bp', 'Reject all');
}

// ─────────────────────────────────────────────────────────────────────
// acknowledgeBp — same DB effect as reject, distinct audit action.
// Used for REJECTED-state BPs where staff want a paper trail that they
// saw and dismissed the (informational) DLD diff.
// ─────────────────────────────────────────────────────────────────────
function acknowledgeBp(db, bpId) {
  rejectOrAcknowledge(db, bpId, 'acknowledge_bp', 'Acknowledge');
}

function rejectOrAcknowledge(db, bpId, action, verb) {
  const parts = parseBpId(bpId);
  if (!parts) throw new Error(`${action}: malformed bpId: ` + bpId);
  const tx = db.transaction(() => {
    const rows = pendingRowsForBp(db, parts);
    if (rows.length === 0) throw new Error(`${action}: no pending rows for ` + bpId);
    for (const r of rows) {
      rejectPending(db, r.change_id);
    }
    writeAuditLog(db, {
      projectId: parts.project_id,
      unitNumberNorm: parts.unit_number_norm,
      tableName: 'master_data',
      field: '<bp>',
      oldValue: null,
      newValue: bpId,
      action,
      source: 'review_pending',
      changeId: null,
      userNote: `${verb} (${pluralFields(rows.length)})`
    });
  });
  tx();
}

module.exports = { listBps, approveBp, rejectBp, acknowledgeBp, parseBpId };
