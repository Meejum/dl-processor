// Resolves a normalized variant to its canonical form using buyer_alias.
// Project-scoped rows beat global (project_id IS NULL) rows. Returns null
// when no alias exists or inputs are missing.

function lookupAlias(db, projectId, variantNorm) {
  if (!projectId || !variantNorm) return null;
  // ORDER BY project_id IS NULL gives project-scoped rows first (FALSE < TRUE)
  const row = db.prepare(`
    SELECT canonical
    FROM buyer_alias
    WHERE variant = ? AND (project_id = ? OR project_id IS NULL)
    ORDER BY (project_id IS NULL) ASC
    LIMIT 1
  `).get(variantNorm, projectId);
  return row ? row.canonical : null;
}

module.exports = { lookupAlias };
