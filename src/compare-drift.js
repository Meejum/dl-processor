const { writeAuditLog } = require('./audit-log');

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
    // TODO(v1.2): implement DLD drift once compare.js extractor helpers
    // (pickLatestPurchase, findLatestNonBankParty, etc.) are factored into
    // a reusable module. For now this is a silent no-op so compare.js can
    // safely call detectDrift after every DLD import.
    return;
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

module.exports = { detectDrift };
