const { openDb } = require('./shared');

function cmdProjects(opts) {
  const json = opts && (opts.json === true || (Array.isArray(opts) && opts.includes('--json')));
  const db = openDb();
  try {
    const rows = db.prepare(`
      SELECT p.project_id, p.project_name, p.developer, p.sf_sub_project, p.sf_unit_prefix,
             (SELECT COUNT(*) FROM dld_snapshot s WHERE s.project_id = p.project_id) AS snapshot_count,
             (SELECT MAX(imported_at) FROM dld_snapshot s WHERE s.project_id = p.project_id) AS last_imported
      FROM dld_project p
      ORDER BY p.project_name
    `).all();
    if (json) { process.stdout.write(JSON.stringify(rows) + '\n'); return; }
    if (rows.length === 0) { console.log('  no projects imported yet'); return; }
    console.log('  ' + 'PROJECT'.padEnd(35) + 'SF SUB'.padEnd(20) + 'PFX'.padEnd(6) + 'SNAP'.padEnd(6) + 'LAST IMPORTED');
    for (const r of rows) {
      console.log('  '
        + (r.project_name || '').padEnd(35)
        + (r.sf_sub_project || '-').padEnd(20)
        + ((r.sf_unit_prefix || '-') + '-').padEnd(6)
        + String(r.snapshot_count || 0).padEnd(6)
        + (r.last_imported || '-')
      );
    }
  } finally { db.close(); }
}

module.exports = { cmdProjects };
