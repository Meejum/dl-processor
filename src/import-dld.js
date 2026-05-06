const path = require('path');
const { normalizeUnitNumber } = require('./common');
const { toIsoDate, sha256OfFile } = require('./db');
const { queueMasterDiffs } = require('./pending-change');

function upsertProject(db, project) {
  const existing = db.prepare('SELECT project_id FROM dld_project WHERE project_name = ?').get(project.projectName);
  if (existing) {
    db.prepare(`
      UPDATE dld_project
      SET developer = @developer,
          project_value_aed = @projectValueAED,
          start_date = @startDate,
          end_date = @endDate,
          total_investors = @totalInvestors,
          last_imported_at = datetime('now')
      WHERE project_id = @projectId
    `).run({
      projectId: existing.project_id,
      developer: project.developer,
      projectValueAED: project.projectValueAED,
      startDate: project.startDate,
      endDate: project.endDate,
      totalInvestors: project.totalInvestors
    });
    return existing.project_id;
  }
  const info = db.prepare(`
    INSERT INTO dld_project (project_name, developer, project_value_aed, start_date, end_date, total_investors, last_imported_at)
    VALUES (@projectName, @developer, @projectValueAED, @startDate, @endDate, @totalInvestors, datetime('now'))
  `).run({
    projectName: project.projectName,
    developer: project.developer,
    projectValueAED: project.projectValueAED,
    startDate: project.startDate,
    endDate: project.endDate,
    totalInvestors: project.totalInvestors
  });
  return info.lastInsertRowid;
}

function createSnapshot(db, projectId, sourceFormat, sourceFile, sourceSha) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = db.prepare(`
    SELECT snapshot_id FROM dld_snapshot
    WHERE project_id = ? AND snapshot_date = ? AND source_format = ?
  `).get(projectId, today, sourceFormat);

  if (existing) {
    db.prepare('DELETE FROM dld_snapshot WHERE snapshot_id = ?').run(existing.snapshot_id);
  }

  const info = db.prepare(`
    INSERT INTO dld_snapshot (project_id, source_format, source_file, source_sha256, snapshot_date)
    VALUES (@projectId, @sourceFormat, @sourceFile, @sourceSha, @today)
  `).run({ projectId, sourceFormat, sourceFile, sourceSha, today });
  return info.lastInsertRowid;
}

function importDldSnapshot({ db, data, sourceFormat, sourceFile }) {
  const sourceSha = sha256OfFile(sourceFile);

  const insertBuilding = db.prepare(`
    INSERT INTO dld_building (snapshot_id, dld_id, name, type)
    VALUES (?, ?, ?, ?)
  `);
  const insertUnit = db.prepare(`
    INSERT INTO dld_unit (snapshot_id, building_id, project_id, dld_unit_id, unit_number, unit_number_norm, floor, rooms, unit_type, net_area, common_area, page_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTx = db.prepare(`
    INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed, amount_raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBreakdown = db.prepare(`
    INSERT OR REPLACE INTO dld_breakdown (snapshot_id, tx_type, property_count)
    VALUES (?, ?, ?)
  `);
  const updateSnapshotTotals = db.prepare(`
    UPDATE dld_snapshot SET total_units = ?, total_tx = ? WHERE snapshot_id = ?
  `);

  const run = db.transaction(() => {
    const projectId = upsertProject(db, data.project);
    const snapshotId = createSnapshot(db, projectId, sourceFormat, path.basename(sourceFile), sourceSha);

    let totalUnits = 0;
    let totalTx = 0;

    for (const b of data.buildings) {
      const bInfo = insertBuilding.run(snapshotId, b.id, b.name, b.type);
      const buildingId = bInfo.lastInsertRowid;
      for (const u of b.units) {
        const unitNorm = normalizeUnitNumber(u.unitNumber);
        const uInfo = insertUnit.run(
          snapshotId, buildingId, projectId,
          u.unitId, u.unitNumber, unitNorm, u.floor,
          u.rooms, u.unitType, u.netArea, u.commonArea,
          u.pageNum
        );
        const unitId = uInfo.lastInsertRowid;
        totalUnits++;
        for (const t of u.transactions || []) {
          insertTx.run(
            unitId, snapshotId, projectId,
            t.partyName || null, t.ftShare, t.shareUnit || null,
            t.type, t.date, toIsoDate(t.date),
            t.amountAED, t.amountRaw || null
          );
          totalTx++;
        }
      }
    }

    if (data.project && data.project.transactionBreakdown) {
      for (const [k, v] of Object.entries(data.project.transactionBreakdown)) {
        insertBreakdown.run(snapshotId, k, v);
      }
    }

    updateSnapshotTotals.run(totalUnits, totalTx, snapshotId);
    return { projectId, snapshotId, totalUnits, totalTx };
  });

  const result = run();
  const queueResult = queueMasterDiffs(db, result.snapshotId);
  result.queuedDiffs = queueResult.queued;
  result.seededMaster = queueResult.seeded;
  return result;
}

module.exports = { importDldSnapshot };
