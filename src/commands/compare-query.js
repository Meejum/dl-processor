const { compareProject, summarize } = require('../compare');
const { listProjects } = require('./projects');

// One row per project. Heavy — calls compareProject() per project on every
// invocation. Dashboard mount is the primary caller. The spec (§ 10 risks)
// documents that we will profile after Phase 1 and add a lightweight
// summarize-only path if measured cost is unacceptable.
function getProjectsSummary(db) {
  const rows = [];
  for (const p of listProjects(db)) {
    if (p.project_id == null) {
      rows.push({
        project_id:    null,
        project_name:  p.project_name,
        source:        p.source,
        status:        'sf-only',
        total:         0,
        counts:        {},
        pending_count: 0,
        last_dld_at:   null,
        last_sf_at:    null
      });
      continue;
    }
    const result = compareProject(db, p.project_id);
    const counts = summarize(result.rows || []);
    const pending = db.prepare(
      `SELECT COUNT(*) AS n FROM pending_change
       WHERE project_id = ? AND decision = 'pending'`
    ).get(p.project_id).n;
    const dldSnap = db.prepare(
      `SELECT imported_at FROM dld_snapshot WHERE project_id = ?
       ORDER BY imported_at DESC LIMIT 1`
    ).get(p.project_id);
    const sfSnap = db.prepare(
      `SELECT imported_at FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`
    ).get();
    rows.push({
      project_id:    p.project_id,
      project_name:  p.project_name,
      source:        p.source,
      status:        result.status,
      total:         (result.rows || []).length,
      counts,
      pending_count: pending,
      last_dld_at:   dldSnap ? dldSnap.imported_at : null,
      last_sf_at:    sfSnap  ? sfSnap.imported_at  : null
    });
  }
  return rows;
}

// Full compare result for one project. Returns JSON-safe data ready for
// the renderer. Same shape compareProject() already returns plus a
// pre-computed counts object so the renderer doesn't need to re-import
// summarize().
function getProjectCompare(db, projectId) {
  const result = compareProject(db, projectId);
  return {
    project:        result.project,
    status:         result.status,
    rows:           result.rows || [],
    counts:         summarize(result.rows || []),
    dldSnapshotId:  result.dldSnapshotId || null,
    sfSnapshotId:   result.sfSnapshotId  || null
  };
}

module.exports = { getProjectsSummary, getProjectCompare };
