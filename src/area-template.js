const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { expectedSfUnit } = require('./project-mapping');
const { pickLatestPurchase, findLatestNonBankParty } = require('./compare');
const { normalizeUnitNumber, BANK_PREFIX_RE } = require('./common');

const TEMPLATE_HEADER = [
  'project',
  'unit_number',
  'dld_unit_id',
  'dld_buyer',
  'dld_unit_type',
  'sf_unit',
  'sf_applicant',
  'dld_net_area',
  'area_sqm',
  'source_note'
];

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function generateAreaTemplate({ db, projectFilter, outPath }) {
  const projects = db.prepare(
    projectFilter
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project ORDER BY project_name`
  ).all(...(projectFilter ? [projectFilter] : []));
  if (projects.length === 0) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, TEMPLATE_HEADER.join(',') + '\r\n', 'utf8');
    return { rowCount: 0, projects: 0, outPath };
  }

  // Load project-mapping.json once for transform-aware sf_unit calculation
  const configPath = path.join(__dirname, '..', 'config', 'project-mapping.json');
  let cachedConfig = {};
  try { cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) {}
  const configOverrides = cachedConfig.overrides || {};

  const lines = [TEMPLATE_HEADER.join(',')];
  let rowCount = 0;

  for (const p of projects) {
    const snap = db.prepare(`SELECT * FROM dld_snapshot WHERE project_id = ? ORDER BY imported_at DESC LIMIT 1`).get(p.project_id);
    if (!snap) continue;
    const units = db.prepare(`SELECT * FROM dld_unit WHERE snapshot_id = ? ORDER BY CAST(unit_number AS INTEGER), unit_number`).all(snap.snapshot_id);
    const areaMap = new Map(
      db.prepare(`SELECT unit_number_norm, area_sqm, source_note FROM manual_area WHERE project_id = ?`)
        .all(p.project_id)
        .map(r => [r.unit_number_norm, r])
    );

    // Load the project-level mapping row so we have sf_unit_prefix from the DB
    const mappingRow = db.prepare(`SELECT * FROM project_mapping WHERE project_id = ?`).get(p.project_id) || {};
    const sfPrefix = mappingRow.sf_unit_prefix != null ? mappingRow.sf_unit_prefix : (p.sf_unit_prefix != null ? p.sf_unit_prefix : null);

    // Load unitTransforms + buildingTransforms from config (same logic as compareProject)
    const ov = configOverrides[p.project_name] || {};
    const unitTransforms     = Array.isArray(ov.unitTransforms) ? ov.unitTransforms : [];
    const buildingTransforms = ov.buildingTransforms || null;

    // Determine the sf_sub_project to use (prefer mapping row)
    const sfSubProject = mappingRow.sf_sub_project || p.sf_sub_project || null;

    let sfByUnitNorm = new Map();
    if (sfSubProject) {
      const sfBookings = db.prepare(`
        SELECT b.unit_norm, b.unit, b.applicant_name
        FROM sf_booking b
        JOIN sf_snapshot s ON s.sf_snapshot_id = b.sf_snapshot_id
        WHERE s.imported_at = (SELECT MAX(imported_at) FROM sf_snapshot)
          AND b.sub_project = ?
      `).all(sfSubProject);
      sfByUnitNorm = new Map(sfBookings.map(b => [b.unit_norm, b]));
    }

    // Prepare statement for fetching all transactions per unit (for buyer lookup)
    const txStmt = db.prepare(`SELECT * FROM dld_transaction WHERE unit_id = ? ORDER BY tx_id`);

    for (const u of units) {
      // Fix 4: use pickLatestPurchase + findLatestNonBankParty to avoid bank-party misidentification
      const dldTxs = txStmt.all(u.unit_id);
      const purchase = pickLatestPurchase(dldTxs);
      const naturalBuyer = purchase && purchase.party_name && !BANK_PREFIX_RE.test(purchase.party_name)
        ? purchase.party_name
        : findLatestNonBankParty(dldTxs);
      const dldBuyer = naturalBuyer || '';

      // Fix 3: use mapping-aware expectedSfUnit (handles unitTransforms + buildingTransforms)
      const sfUnitKey = expectedSfUnit(u.unit_number_norm, {
        sf_unit_prefix:     sfPrefix,
        unitTransforms,
        buildingTransforms
      }, u.building_name);
      const sfRow = sfUnitKey ? (sfByUnitNorm.get(sfUnitKey) || null) : null;
      const ma = areaMap.get(u.unit_number_norm) || {};
      const row = [
        p.project_name,
        u.unit_number || '',
        u.dld_unit_id || '',
        dldBuyer,
        u.unit_type || '',
        sfRow ? sfRow.unit : '',
        sfRow ? (sfRow.applicant_name || '') : '',
        u.net_area != null ? u.net_area : '',
        ma.area_sqm != null ? ma.area_sqm : '',
        ma.source_note || ''
      ];
      lines.push(row.map(csvEscape).join(','));
      rowCount++;
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
  return { rowCount, projects: projects.length, outPath };
}

function applyAreaTemplate({ db, csvPath }) {
  const buf = fs.readFileSync(csvPath, 'utf8');
  const records = parse(buf, { columns: true, skip_empty_lines: true, trim: true });
  const projCache = new Map();
  function getProject(name) {
    if (projCache.has(name)) return projCache.get(name);
    const row = db.prepare(`SELECT project_id FROM dld_project WHERE project_name = ?`).get(name);
    projCache.set(name, row || null);
    return row || null;
  }
  const upsert = db.prepare(`
    INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, source_note, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, unit_number_norm) DO UPDATE SET
      area_sqm    = excluded.area_sqm,
      source_note = excluded.source_note,
      updated_at  = datetime('now')
  `);
  let applied = 0, skipped = 0;
  const warnings = [];
  const tx = db.transaction(() => {
    for (const r of records) {
      const projName = (r.project || '').trim();
      const unit = (r.unit_number || '').trim();
      const areaRaw = (r.area_sqm == null ? '' : String(r.area_sqm)).trim();
      if (!projName || !unit || !areaRaw) { skipped++; continue; }
      const proj = getProject(projName);
      if (!proj) { skipped++; warnings.push('unknown project: ' + projName); continue; }
      const area = Number(areaRaw);
      if (!Number.isFinite(area) || area <= 0) { skipped++; continue; }
      const note = (r.source_note || '').trim() || null;
      // Fix 5: normalizeUnitNumber matches the same normalisation applied during DLD import
      upsert.run(proj.project_id, normalizeUnitNumber(unit), area, note);
      applied++;
    }
  });
  tx();
  return { applied, skipped, warnings };
}

module.exports = { generateAreaTemplate, applyAreaTemplate, TEMPLATE_HEADER };
