const { openDb } = require('./shared');

// Pure query — returns rows that include both DLD-imported and SF-only
// projects. Exported separately so it's testable without process.stdout.
function listProjects(db) {
  return db.prepare(`
    SELECT project_name,
           CASE
             WHEN in_dld = 1 AND in_sf = 1 THEN 'DLD+SF'
             WHEN in_dld = 1               THEN 'DLD only'
             ELSE                                'SF only'
           END AS source
    FROM (
      SELECT
        project_name,
        MAX(in_dld) AS in_dld,
        MAX(in_sf)  AS in_sf
      FROM (
        SELECT project_name, 1 AS in_dld, 0 AS in_sf
        FROM dld_project
        WHERE project_name IS NOT NULL

        UNION ALL

        SELECT DISTINCT sub_project AS project_name, 0 AS in_dld, 1 AS in_sf
        FROM sf_booking
        WHERE sub_project IS NOT NULL
      )
      GROUP BY project_name
    )
    ORDER BY project_name
  `).all();
}

function cmdProjects(opts) {
  const json = opts && (opts.json === true || (Array.isArray(opts) && opts.includes('--json')));
  const db = openDb();
  try {
    const rows = listProjects(db);
    if (json) { process.stdout.write(JSON.stringify(rows) + '\n'); return; }
    if (rows.length === 0) { console.log('  no projects imported yet'); return; }
    console.log('  ' + 'PROJECT'.padEnd(35) + 'SOURCE'.padEnd(12));
    for (const r of rows) {
      console.log('  ' + (r.project_name || '').padEnd(35) + (r.source || '').padEnd(12));
    }
  } finally { db.close(); }
}

module.exports = { cmdProjects, listProjects };
