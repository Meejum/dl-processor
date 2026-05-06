const { BANK_PATTERNS, BANK_SQL_CONDITIONS } = require('./common');

const BANK_SQL_NOT_CONDITIONS = BANK_PATTERNS
  .map(p => p === 'BANK'
    ? `t2.party_name NOT LIKE '%BANK%'`
    : `t2.party_name NOT LIKE '${p.trimEnd()}%'`)
  .join('\n          AND ');

function listBankOnlyUnits(db, projectId) {
  return db.prepare(`
    WITH latest AS (
      SELECT snapshot_id FROM dld_snapshot WHERE project_id = ?
      ORDER BY imported_at DESC LIMIT 1
    ),
    last_tx AS (
      SELECT t.*,
             ROW_NUMBER() OVER (PARTITION BY t.unit_id ORDER BY t.tx_date_iso DESC, t.tx_id DESC) AS rn
      FROM dld_transaction t
      WHERE t.snapshot_id = (SELECT snapshot_id FROM latest)
    )
    SELECT u.unit_id, u.unit_number, u.unit_number_norm, u.unit_type, u.dld_unit_id,
           b.name AS building_name,
           lt.tx_type   AS last_tx_type,
           lt.tx_date   AS last_tx_date,
           lt.amount_aed AS last_amount,
           lt.party_name AS last_party,
           md.buyer_name AS override_buyer,
           md.notes      AS override_notes,
           md.updated_at AS override_updated
    FROM dld_unit u
    JOIN latest ls ON ls.snapshot_id = u.snapshot_id
    LEFT JOIN dld_building b ON b.building_id = u.building_id
    LEFT JOIN last_tx lt ON lt.unit_id = u.unit_id AND lt.rn = 1
    LEFT JOIN master_data md ON md.project_id = u.project_id AND md.unit_number_norm = u.unit_number_norm
    WHERE u.project_id = ?
      AND lt.party_name IS NOT NULL
      AND (
        ${BANK_SQL_CONDITIONS}
      )
      AND NOT EXISTS (
        SELECT 1 FROM dld_transaction t2
        WHERE t2.unit_id = u.unit_id
          AND t2.party_name IS NOT NULL
          AND t2.party_name <> ''
          AND ${BANK_SQL_NOT_CONDITIONS}
      )
    ORDER BY u.unit_number
  `).all(projectId, projectId);
}

function getOverridesMapForProject(db, projectId) {
  const rows = db.prepare(`
    SELECT unit_number_norm, buyer_name
    FROM master_data
    WHERE project_id = ? AND buyer_name IS NOT NULL
  `).all(projectId);
  const map = new Map();
  for (const r of rows) map.set(r.unit_number_norm, r.buyer_name);
  return map;
}

module.exports = {
  listBankOnlyUnits,
  getOverridesMapForProject
};
