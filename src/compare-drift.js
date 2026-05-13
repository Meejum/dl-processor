const { writeAuditLog } = require('./audit-log');
const { extractUnitFields } = require('./snapshot-extract');
const { AUDIT_FIELDS } = require('./audit-fields');

// SF column → master_data audit field
const SF_FIELD_MAP = {
  buyer_name:         'applicant_name',
  purchase_price_aed: 'purchase_price',
  status:             'status',
  procedure_number:   'procedure_number'
};

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function stringify(v) {
  return v == null ? null : String(v);
}

/**
 * Detect drift between consecutive snapshots and emit SF_DRIFT (or DLD_DRIFT)
 * pending_change rows + auto_apply audit_log entries.
 *
 * @param {Database} db
 * @param {number} projectId
 * @param {number} currentSnapshotId  the just-imported snapshot id
 * @param {'dld'|'sf'} source
 */
function detectDrift(db, projectId, currentSnapshotId, source) {
  if (source === 'dld') {
    return detectDldDrift(db, projectId, currentSnapshotId);
  }
  if (source !== 'sf') {
    throw new Error('detectDrift: source must be "dld" or "sf"');
  }

  // Look up the project's name — sf_booking.sub_project is matched against it.
  const proj = db.prepare(
    'SELECT project_name FROM dld_project WHERE project_id = ?'
  ).get(projectId);
  if (!proj) return;
  const subProject = proj.project_name;

  // Find the most-recent prior sf_snapshot that has at least one booking row
  // for this sub_project.
  const prev = db.prepare(`
    SELECT MAX(s.sf_snapshot_id) AS prev_id
    FROM sf_snapshot s
    JOIN sf_booking b ON b.sf_snapshot_id = s.sf_snapshot_id
    WHERE b.sub_project = ? AND s.sf_snapshot_id < ?
  `).get(subProject, currentSnapshotId);
  if (!prev || !prev.prev_id) return;  // first-ever SF snapshot for this project
  const prevSnapshotId = prev.prev_id;

  const currentRows = db.prepare(`
    SELECT unit_norm, applicant_name, purchase_price, status, procedure_number
    FROM sf_booking
    WHERE sf_snapshot_id = ? AND sub_project = ?
  `).all(currentSnapshotId, subProject);

  const prevByUnit = new Map(
    db.prepare(`
      SELECT unit_norm, applicant_name, purchase_price, status, procedure_number
      FROM sf_booking
      WHERE sf_snapshot_id = ? AND sub_project = ?
    `).all(prevSnapshotId, subProject).map(r => [r.unit_norm, r])
  );

  const insertPending = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value,
       change_type, decision, decided_at, source_snapshot_id)
    VALUES (?, ?, ?, ?, ?, 'SF_DRIFT', 'auto_applied', datetime('now'), NULL)
  `);
  // Idempotency guard: the same (project, unit, field) auto_applied SF_DRIFT
  // row with the same (old, new) values is treated as "already recorded".
  // source_snapshot_id is left NULL for SF drift, so we key on the value pair.
  const existsCheck = db.prepare(`
    SELECT 1 FROM pending_change
    WHERE project_id = ? AND unit_number_norm = ? AND field_name = ?
      AND change_type = 'SF_DRIFT' AND decision = 'auto_applied'
      AND IFNULL(old_value, '') = IFNULL(?, '')
      AND IFNULL(proposed_value, '') = IFNULL(?, '')
  `);

  const apply = db.transaction(() => {
    for (const cur of currentRows) {
      const prevRow = prevByUnit.get(cur.unit_norm);
      if (!prevRow) continue;  // brand-new unit — no prior row to diff against
      for (const [auditField, sfCol] of Object.entries(SF_FIELD_MAP)) {
        const oldVal = prevRow[sfCol];
        const newVal = cur[sfCol];
        if (sameValue(oldVal, newVal)) continue;
        const oldStr = stringify(oldVal);
        const newStr = stringify(newVal);
        if (existsCheck.get(projectId, cur.unit_norm, auditField, oldStr, newStr)) continue;
        const info = insertPending.run(projectId, cur.unit_norm, auditField, oldStr, newStr);
        writeAuditLog(db, {
          projectId,
          unitNumberNorm: cur.unit_norm,
          tableName: 'master_data',
          field: auditField,
          oldValue: oldStr,
          newValue: newStr,
          action: 'auto_apply',
          source: 'compare',
          changeId: info.lastInsertRowid
        });
      }
    }
  });
  apply();
}

/**
 * DLD-side drift detection. Compares the operational AUDIT_FIELDS for every
 * unit in the current dld_snapshot against the previous dld_snapshot for the
 * same project. Any field whose value changed emits a DLD_DRIFT pending_change
 * row + auto_apply audit_log entry (source='compare'). Mirrors the SF logic.
 *
 * Notes:
 * - status + procedure_number are SF-side only — extractUnitFields returns
 *   null for them on the DLD side, so null↔null pairs are skipped here.
 * - Idempotency: a re-run over the same snapshot pair must NOT duplicate rows.
 */
function detectDldDrift(db, projectId, currentSnapshotId) {
  const prev = db.prepare(`
    SELECT snapshot_id FROM dld_snapshot
    WHERE project_id = ? AND snapshot_id < ?
    ORDER BY snapshot_date DESC, snapshot_id DESC
    LIMIT 1
  `).get(projectId, currentSnapshotId);
  if (!prev || !prev.snapshot_id) return;  // first-ever snapshot — no drift to compute
  const prevSnapshotId = prev.snapshot_id;

  const units = db.prepare(`
    SELECT DISTINCT unit_number_norm FROM dld_unit
    WHERE snapshot_id = ? AND project_id = ?
  `).all(currentSnapshotId, projectId);

  const insertPending = db.prepare(`
    INSERT INTO pending_change
      (project_id, unit_number_norm, field_name, old_value, proposed_value,
       change_type, decision, decided_at, source_snapshot_id)
    VALUES (?, ?, ?, ?, ?, 'DLD_DRIFT', 'auto_applied', datetime('now'), ?)
  `);
  // Idempotency guard: a DLD_DRIFT auto_applied row with the same
  // (project, unit, field, old, new) tuple is already-recorded.
  const existsCheck = db.prepare(`
    SELECT 1 FROM pending_change
    WHERE project_id = ? AND unit_number_norm = ? AND field_name = ?
      AND change_type = 'DLD_DRIFT' AND decision = 'auto_applied'
      AND IFNULL(old_value, '') = IFNULL(?, '')
      AND IFNULL(proposed_value, '') = IFNULL(?, '')
  `);

  const apply = db.transaction(() => {
    for (const { unit_number_norm: unit } of units) {
      if (unit == null) continue;
      const curFields  = extractUnitFields(db, currentSnapshotId, projectId, unit);
      const prevFields = extractUnitFields(db, prevSnapshotId,    projectId, unit);
      if (!curFields || !prevFields) continue;  // brand-new (or vanished) unit — no diff
      for (const field of AUDIT_FIELDS) {
        const oldVal = prevFields[field];
        const newVal = curFields[field];
        // status + procedure_number are null↔null on DLD side — skip
        if (oldVal == null && newVal == null) continue;
        if (String(oldVal ?? '') === String(newVal ?? '')) continue;
        const oldStr = oldVal == null ? null : String(oldVal);
        const newStr = newVal == null ? null : String(newVal);
        if (existsCheck.get(projectId, unit, field, oldStr, newStr)) continue;
        const info = insertPending.run(projectId, unit, field, oldStr, newStr, currentSnapshotId);
        writeAuditLog(db, {
          projectId,
          unitNumberNorm: unit,
          tableName: 'master_data',
          field,
          oldValue: oldStr,
          newValue: newStr,
          action: 'auto_apply',
          source: 'compare',
          changeId: info.lastInsertRowid
        });
      }
    }
  });
  apply();
}

module.exports = { detectDrift };
