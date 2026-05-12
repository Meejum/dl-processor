const { openDb } = require('./shared');
const { writeAuditLog } = require('../audit-log');
const { MASTER_DATA_PROVENANCE } = require('../audit-fields');
const { normalizeName } = require('../normalize-name');

function listPending(db, { tab = 'needs_review', projectId = null, typeFilter = null } = {}) {
  const where = [];
  const params = [];
  if (tab === 'needs_review') where.push("decision = 'pending'");
  else                        where.push("decision = 'auto_applied'");
  if (projectId) { where.push("project_id = ?"); params.push(projectId); }
  if (typeFilter) { where.push("change_type = ?"); params.push(typeFilter); }
  const sql = `
    SELECT pc.change_id, pc.project_id, dp.project_name, pc.unit_number_norm,
           pc.field_name, pc.old_value, pc.proposed_value, pc.override_value,
           pc.change_type, pc.decision, pc.decided_at, pc.proposed_at
    FROM pending_change pc
    JOIN dld_project dp ON dp.project_id = pc.project_id
    WHERE ${where.join(' AND ')}
    ORDER BY pc.project_id, pc.unit_number_norm, pc.field_name
  `;
  return db.prepare(sql).all(...params);
}

function applyToMasterData(db, projectId, unitNumberNorm, fieldName, value) {
  const prov = MASTER_DATA_PROVENANCE[fieldName];
  if (!prov) throw new Error('unknown field: ' + fieldName);
  const sql = `
    UPDATE master_data
    SET ${fieldName} = ?, ${prov.source} = 'dld_approved', ${prov.decidedAt} = datetime('now'),
        updated_at = datetime('now')
    WHERE project_id = ? AND unit_number_norm = ?
  `;
  db.prepare(sql).run(value, projectId, unitNumberNorm);
}

function approvePending(db, changeId, override = null) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM pending_change WHERE change_id = ?").get(changeId);
    if (!row) throw new Error('pending_change not found: ' + changeId);
    const finalValue = override == null ? row.proposed_value : String(override);
    applyToMasterData(db, row.project_id, row.unit_number_norm, row.field_name, finalValue);
    db.prepare(`
      UPDATE pending_change
      SET decision = 'approved', decided_at = datetime('now'), override_value = ?
      WHERE change_id = ?
    `).run(override == null ? null : String(override), changeId);
    writeAuditLog(db, {
      projectId: row.project_id, unitNumberNorm: row.unit_number_norm,
      tableName: 'master_data', field: row.field_name,
      oldValue: row.old_value, newValue: finalValue,
      action: override == null ? 'approve' : 'override',
      source: 'review_pending', changeId
    });
  });
  tx();
}

function rejectPending(db, changeId) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM pending_change WHERE change_id = ?").get(changeId);
    if (!row) throw new Error('pending_change not found: ' + changeId);
    db.prepare("UPDATE pending_change SET decision = 'rejected', decided_at = datetime('now') WHERE change_id = ?").run(changeId);
    writeAuditLog(db, {
      projectId: row.project_id, unitNumberNorm: row.unit_number_norm,
      tableName: 'master_data', field: row.field_name,
      oldValue: row.old_value, newValue: null,
      action: 'reject', source: 'review_pending', changeId
    });
  });
  tx();
}

function teachAliasAndApprove(db, changeId, { scope = 'project' } = {}) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT * FROM pending_change WHERE change_id = ?").get(changeId);
    if (!row) throw new Error('pending_change not found: ' + changeId);
    if (row.field_name !== 'buyer_name') throw new Error('teach-alias only for buyer_name rows');

    const variantNorm   = normalizeName(row.proposed_value);
    const canonicalNorm = normalizeName(row.old_value);
    const display       = row.old_value;

    const aliasProjectId = scope === 'global' ? null : row.project_id;
    db.prepare(`
      INSERT INTO buyer_alias (project_id, variant, canonical, display, created_by)
      VALUES (?, ?, ?, ?, 'user')
      ON CONFLICT(project_id, variant) DO UPDATE SET canonical = excluded.canonical, display = excluded.display
    `).run(aliasProjectId, variantNorm, canonicalNorm, display);

    writeAuditLog(db, {
      projectId: row.project_id, unitNumberNorm: null,
      tableName: 'buyer_alias', field: 'variant',
      oldValue: null, newValue: variantNorm + ' → ' + canonicalNorm,
      action: 'learn_alias', source: 'review_pending', changeId
    });

    // Find every other pending buyer_name row in this project whose normalized
    // forms now resolve to MATCH. Approve them (keeping their existing master_data).
    const sibs = db.prepare(`
      SELECT change_id, old_value, proposed_value
      FROM pending_change
      WHERE project_id = ? AND field_name = 'buyer_name' AND decision = 'pending'
    `).all(row.project_id);
    for (const s of sibs) {
      const sv = normalizeName(s.proposed_value);
      const sc = normalizeName(s.old_value);
      if (sv === variantNorm && sc === canonicalNorm) {
        // For sibling auto-approve we keep the existing master_data value (treat
        // the alias as absorbing the diff). Approve action = 'approve' (no override).
        approvePending(db, s.change_id);
      }
    }
  });
  tx();
}

// New cmdReviewPending no longer writes HTML+CSV — it just exits with a hint
// to use the Electron Review Pending page.
function cmdReviewPending() {
  console.log('  Review Pending now opens inline in the desktop app.');
  console.log('  Run from the DL-Processor app sidebar: 5. Review pending');
}

module.exports = {
  cmdReviewPending,
  listPending, approvePending, rejectPending, teachAliasAndApprove
};
