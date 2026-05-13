const { writeAuditLog } = require('../audit-log');
const { MASTER_DATA_PROVENANCE, REVERTABLE_ACTIONS } = require('../audit-fields');

// One-click Revert (Cmd-Z model). Restores master_data to the audit row's
// old_value and writes a new audit_log row with action='revert'. The hash
// chain + user attribution are filled in automatically by writeAuditLog.
//
// Only revertable when:
//   - the audit row exists
//   - action is in REVERTABLE_ACTIONS (approve / override / approve_bp / revert)
//   - table_name is 'master_data' (the only table we know how to undo here)
function revertAuditEntry(db, auditId) {
  const row = db.prepare('SELECT * FROM audit_log WHERE audit_id = ?').get(auditId);
  if (!row) throw new Error('audit row not found: audit_id=' + auditId);
  if (!REVERTABLE_ACTIONS.has(row.action)) {
    throw new Error("cannot revert action='" + row.action +
      "' — only approve/override/approve_bp/revert can be reverted");
  }
  if (row.table_name !== 'master_data') {
    throw new Error("cannot revert non-master_data row (table_name='" + row.table_name + "')");
  }
  const prov = MASTER_DATA_PROVENANCE[row.field];
  if (!prov) throw new Error('revert: unknown field=' + row.field);

  // Coerce old_value back to its native type for the UPDATE. master_data
  // stores numerics as REAL — audit_log stored the value as TEXT, so parse
  // back if it looks numeric. Strings stay strings.
  const restoredValue = parseRestoredValue(row.field, row.old_value);

  const tx = db.transaction(() => {
    // UPDATE master_data — mark as 'staff' source (the revert is a deliberate
    // human action), update decided_at to NOW.
    db.prepare(`
      UPDATE master_data
      SET ${row.field} = ?, ${prov.source} = 'staff', ${prov.decidedAt} = datetime('now'),
          updated_at = datetime('now')
      WHERE project_id = ? AND unit_number_norm = ?
    `).run(restoredValue, row.project_id, row.unit_number_norm);

    // Write the new revert audit_log entry. writeAuditLog itself
    // auto-fills user via currentUser() and chains the hash.
    writeAuditLog(db, {
      projectId:       row.project_id,
      unitNumberNorm:  row.unit_number_norm,
      tableName:       'master_data',
      field:           row.field,
      oldValue:        row.new_value,   // we're undoing this
      newValue:        row.old_value,   // restored to this
      action:          'revert',
      source:          'review_pending',
      changeId:        null,
      userNote:        'revert of audit_id=' + auditId
    });
  });
  tx();
}

function parseRestoredValue(field, oldValueText) {
  if (oldValueText == null) return null;
  // Numeric fields in master_data: purchase_price_aed, area_sqm
  if (field === 'purchase_price_aed' || field === 'area_sqm') {
    const n = Number(oldValueText);
    return Number.isFinite(n) ? n : null;
  }
  return oldValueText;
}

module.exports = { revertAuditEntry };
