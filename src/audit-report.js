function runAudit({ db, out = process.stdout }) {
  const println = (s = '') => out.write(s + '\n');
  const bar = '═'.repeat(75);

  const sfSnap  = db.prepare('SELECT * FROM sf_snapshot ORDER BY sf_snapshot_id DESC LIMIT 1').get();
  const dldProj = db.prepare('SELECT COUNT(*) n FROM dld_project').get().n;
  const dldUnitRow = (function () {
    try {
      return db.prepare(`
        SELECT COUNT(*) n FROM dld_unit u
        WHERE u.snapshot_id IN (
          SELECT MAX(snapshot_id) FROM dld_snapshot GROUP BY project_id
        )
      `).get();
    } catch (_) { return { n: 0 }; }
  })();
  const dldUnit = dldUnitRow.n;
  const sfRows = sfSnap
    ? db.prepare('SELECT COUNT(*) n FROM sf_booking WHERE sf_snapshot_id = ?').get(sfSnap.sf_snapshot_id).n
    : 0;

  const mappedCount = db.prepare(`
    SELECT COUNT(*) n FROM project_mapping
    WHERE (sf_sub_project IS NOT NULL AND sf_sub_project != '')
       OR (match_scope = 'project' AND sf_project IS NOT NULL)
  `).get().n;
  const unmappedCount = Math.max(0, dldProj - mappedCount);

  println(bar);
  println('  DL-PROCESSOR AUDIT  /  ' + new Date().toISOString().slice(0, 19).replace('T', ' '));
  println(bar);
  println('');
  println('▸ CURRENT SNAPSHOTS');
  println('  DLD DB:                ' + dldProj + ' projects · ' + dldUnit.toLocaleString() + ' units (latest snapshots)');
  if (sfSnap) {
    println('  SF snapshot:           #' + sfSnap.sf_snapshot_id + ' — ' + sfSnap.source_file);
    println('  SF rows:               ' + sfRows.toLocaleString() + ' bookings');
  } else {
    println('  SF snapshot:           (none yet — run import-sf)');
  }
  println('');

  println('▸ MAPPING COVERAGE');
  println('  mapped projects:       ' + mappedCount + ' / ' + dldProj);
  println('  unmapped projects:     ' + unmappedCount + '  (compare will skip these)');
  println('');

  const projectRows = db.prepare(`
    SELECT p.project_name, p.project_id,
           pm.sf_sub_project, pm.sf_project, pm.match_scope, pm.source
    FROM dld_project p
    LEFT JOIN project_mapping pm ON pm.project_id = p.project_id
    ORDER BY p.project_name
  `).all();
  if (projectRows.length > 0) {
    println('▸ PER-PROJECT MAPPING');
    println('  ' + 'project'.padEnd(45) + '  scope         source     SF target');
    println('  ' + '-'.repeat(73));
    for (const p of projectRows) {
      const target = p.match_scope === 'project'
        ? (p.sf_project || '(none)')
        : (p.sf_sub_project || '(none)');
      const scope = (p.match_scope || 'sub_project').padEnd(13);
      const source = (p.source || '(unmapped)').padEnd(10);
      println('  ' + p.project_name.padEnd(45).slice(0, 45) + '  ' + scope + ' ' + source + ' ' + target);
    }
    println('');
  }

  const allSf = db.prepare('SELECT COUNT(*) n FROM sf_snapshot').get().n;
  if (allSf > 3) {
    println('▸ SF SNAPSHOT HISTORY');
    println('  ' + allSf + ' SF snapshots on disk — older ones are dead weight. compare/diff use the latest.');
    println('');
  }

  println(bar);
  println('  HEADLINE');
  println(bar);
  println('  DLD projects in DB:              ' + dldProj);
  println('  DLD units (latest snapshots):    ' + dldUnit.toLocaleString());
  println('  SF bookings (latest snapshot):   ' + sfRows.toLocaleString());
  println('  Mapped projects:                 ' + mappedCount + ' / ' + dldProj);
  println('');

  return {
    dldProjects:      dldProj,
    dldUnits:         dldUnit,
    sfBookings:       sfRows,
    mappedProjects:   mappedCount,
    unmappedProjects: unmappedCount
  };
}

module.exports = { runAudit };
