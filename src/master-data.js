const FIELD_TO_COLUMNS = {
  buyer_name:         { value: 'buyer_name',         source: 'buyer_source',     decided: 'buyer_decided_at' },
  purchase_price_aed: { value: 'purchase_price_aed', source: 'price_source',     decided: 'price_decided_at' },
  status:             { value: 'status',             source: 'status_source',    decided: 'status_decided_at' },
  procedure_number:   { value: 'procedure_number',   source: 'procedure_source', decided: 'procedure_decided_at' },
  area_sqm:           { value: 'area_sqm',           source: 'area_source',      decided: 'area_decided_at' }
};

function getMasterRow(db, projectId, unitNumberNorm) {
  return db.prepare(
    'SELECT * FROM master_data WHERE project_id = ? AND unit_number_norm = ?'
  ).get(projectId, unitNumberNorm) || null;
}

function upsertMasterField(db, projectId, unitNumberNorm, fieldName, value, source) {
  const cols = FIELD_TO_COLUMNS[fieldName];
  if (!cols) throw new Error('unknown master_data field: ' + fieldName);
  if (source !== 'staff' && source !== 'dld_approved') {
    throw new Error('source must be "staff" or "dld_approved", got: ' + source);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const existing = getMasterRow(db, projectId, unitNumberNorm);
  if (existing) {
    db.prepare(
      `UPDATE master_data
         SET ${cols.value}   = ?,
             ${cols.source}  = ?,
             ${cols.decided} = ?,
             updated_at      = ?
       WHERE project_id = ? AND unit_number_norm = ?`
    ).run(value, source, now, now, projectId, unitNumberNorm);
  } else {
    db.prepare(
      `INSERT INTO master_data
         (project_id, unit_number_norm, ${cols.value}, ${cols.source}, ${cols.decided}, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(projectId, unitNumberNorm, value, source, now, now, now);
  }
}

function seedMasterFromDld(db, projectId, unitNumberNorm, dldFields) {
  // No-op when a row already exists. Bootstrap path: first DLD snapshot for a
  // unit creates master_data with source='dld_approved' (no approval needed
  // because there's no prior canonical to disagree with).
  if (getMasterRow(db, projectId, unitNumberNorm)) return false;
  for (const [field, value] of Object.entries(dldFields)) {
    if (value == null) continue;
    if (!FIELD_TO_COLUMNS[field]) continue;
    upsertMasterField(db, projectId, unitNumberNorm, field, value, 'dld_approved');
  }
  return true;
}

module.exports = { getMasterRow, upsertMasterField, seedMasterFromDld, FIELD_TO_COLUMNS };
