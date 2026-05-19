const { chainAppend } = require('./audit-hash');
const { currentUser } = require('./current-user');

const INSERT_SQL = `
  INSERT INTO audit_log
    (project_id, unit_number_norm, table_name, field,
     old_value, new_value, action, source, change_id, user_note,
     user, tier2)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Application-layer enforcement for audit_log.source. SQLite CHECK can't
// use LIKE/GLOB, so rule firings + bulk ops use enum tokens (rule_fired,
// bulk_op) and carry their detail (rule_id, batch_uuid) in user_note.
// Pattern validation lives here so misuse fails fast with a clearer
// message than a CHECK constraint violation.
const VALID_AUDIT_SOURCES = new Set([
  'review_pending', 'import_dld', 'import_sf', 'apply_pending',
  'compare', 'rule_fired', 'bulk_op'
]);

function validateAuditSource(s) {
  return typeof s === 'string' && VALID_AUDIT_SOURCES.has(s);
}

// CHECK-safe enum tokens. Detail (rule_id / batch_uuid) belongs in user_note.
const auditSourceFor = {
  rule: () => 'rule_fired',
  bulk: () => 'bulk_op',
};

function writeAuditLog(db, e) {
  if (!validateAuditSource(e.source)) {
    throw new Error(`invalid audit_log.source: ${JSON.stringify(e.source)} (allowed: ${[...VALID_AUDIT_SOURCES].join(', ')})`);
  }
  const userValue = (e.user != null) ? e.user : currentUser();
  const tier2Value = e.tier2 ? 1 : 0;

  const tx = db.transaction(() => {
    const info = db.prepare(INSERT_SQL).run(
      e.projectId       ?? null,
      e.unitNumberNorm  ?? null,
      e.tableName,
      e.field,
      e.oldValue        ?? null,
      e.newValue        ?? null,
      e.action,
      e.source,
      e.changeId        ?? null,
      e.userNote        ?? null,
      userValue,
      tier2Value
    );
    chainAppend(db, info.lastInsertRowid);
    return info;
  });
  return tx();
}

module.exports = {
  writeAuditLog,
  validateAuditSource,
  auditSourceFor,
  VALID_AUDIT_SOURCES
};
