const { chainAppend } = require('./audit-hash');
const { currentUser } = require('./current-user');

const INSERT_SQL = `
  INSERT INTO audit_log
    (project_id, unit_number_norm, table_name, field,
     old_value, new_value, action, source, change_id, user_note,
     user, tier2)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function writeAuditLog(db, e) {
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

module.exports = { writeAuditLog };
