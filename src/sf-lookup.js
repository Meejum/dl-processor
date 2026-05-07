function lookupSfUnit(db, projectId, unitNumberNorm) {
  const mapping = db.prepare(
    `SELECT pm.*, p.sf_sub_project AS p_sub, p.sf_unit_prefix AS p_prefix, p.sf_project AS p_proj
     FROM project_mapping pm
     JOIN dld_project p ON p.project_id = pm.project_id
     WHERE pm.project_id = ?`
  ).get(projectId);
  if (!mapping) return null;

  const scope        = mapping.match_scope || 'sub_project';
  const sfSubProject = mapping.sf_sub_project || mapping.p_sub;
  const sfPrefix     = mapping.sf_unit_prefix != null ? mapping.sf_unit_prefix : mapping.p_prefix;
  const sfProject    = mapping.sf_project || mapping.p_proj || null;

  const snap = db.prepare('SELECT sf_snapshot_id FROM v_latest_sf_snapshot').get();
  if (!snap) return null;

  let row;
  if (scope === 'project' && sfProject) {
    row = db.prepare(
      `SELECT unit, applicant_name, purchase_price FROM sf_booking
       WHERE sf_snapshot_id = ? AND project = ? AND unit_norm = ?
       ORDER BY sf_booking_id DESC LIMIT 1`
    ).get(snap.sf_snapshot_id, sfProject, unitNumberNorm);
  } else if (sfSubProject) {
    const target = sfPrefix ? sfPrefix + '-' + unitNumberNorm : unitNumberNorm;
    row = db.prepare(
      `SELECT unit, applicant_name, purchase_price FROM sf_booking
       WHERE sf_snapshot_id = ? AND sub_project = ? AND unit_norm = ?
       ORDER BY sf_booking_id DESC LIMIT 1`
    ).get(snap.sf_snapshot_id, sfSubProject, target);
  }
  if (!row) return null;
  return {
    sf_unit:      row.unit,
    sf_applicant: row.applicant_name,
    sf_price:     row.purchase_price
  };
}

module.exports = { lookupSfUnit };
