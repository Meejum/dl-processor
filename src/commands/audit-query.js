// Pure query helpers for the v1.1 audit log + master_data history surface.
// Used by the electron IPC handlers (`dlp:audit:*`) and exercised directly
// by test/electron/audit-handlers.test.js — no electron imports here so the
// module stays test-friendly in plain Node.
const { AUDIT_FIELDS } = require('../audit-fields');

const SELECT_LIST = AUDIT_FIELDS.join(', ');

function unitHistory(db, { projectId, unitNumberNorm }) {
  const current = db.prepare(
    `SELECT ${SELECT_LIST}, buyer_source, price_source, status_source, procedure_source, area_source
     FROM master_data WHERE project_id = ? AND unit_number_norm = ?`
  ).get(projectId, unitNumberNorm) || null;
  const events = db.prepare(`
    SELECT audit_id, ts, table_name, field, old_value, new_value, action, source, change_id, user_note
    FROM audit_log
    WHERE project_id = ? AND unit_number_norm = ?
    ORDER BY ts DESC, audit_id DESC
  `).all(projectId, unitNumberNorm);
  return { current, events };
}

module.exports = { unitHistory };
