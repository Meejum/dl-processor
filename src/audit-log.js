const INSERT_SQL = `
  INSERT INTO audit_log
    (project_id, unit_number_norm, table_name, field,
     old_value, new_value, action, source, change_id, user_note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function writeAuditLog(db, e) {
  return db.prepare(INSERT_SQL).run(
    e.projectId       ?? null,
    e.unitNumberNorm  ?? null,
    e.tableName,
    e.field,
    e.oldValue        ?? null,
    e.newValue        ?? null,
    e.action,
    e.source,
    e.changeId        ?? null,
    e.userNote        ?? null
  );
}

module.exports = { writeAuditLog };
