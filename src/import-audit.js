const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

function sha256OfFile(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normName(s) {
  let v = String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  v = v.replace(/\s+\d{1,5}$/, '').trim();
  return v;
}

function normNameStripSobha(s) {
  return normName(s).replace(/^sobha\s+/, '').trim();
}

function normUnit(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
}

function stripProjectPrefix(sfUnit, prefix) {
  if (!sfUnit) return '';
  const u = normUnit(sfUnit);
  if (!prefix) return u;
  const re = new RegExp('^' + prefix.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-', '');
  return u.replace(re, '');
}

function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  return n == null ? null : Math.trunc(n);
}

function asAuditFlag(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s === 'TRUE'  || s === 'YES' || s === 'Y') return 1;
    if (s === 'FALSE' || s === 'NO'  || s === 'N') return 0;
  }
  return null;
}

function inferProjectId(db, sheetName) {
  const bare = normName(sheetName);
  if (!bare) return { projectId: null, inferred: null };
  const all = db.prepare('SELECT project_id, project_name, sf_unit_prefix FROM dld_project').all();

  for (const p of all) {
    if (normName(p.project_name) === bare) return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
  }
  for (const p of all) {
    const np = normName(p.project_name);
    if (np.length >= 5 && bare.length >= 5 && (bare.includes(np) || np.includes(bare))) {
      return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
    }
  }
  const bareAlt = normNameStripSobha(sheetName);
  for (const p of all) {
    const npAlt = normNameStripSobha(p.project_name);
    if (npAlt.length >= 5 && bareAlt.length >= 5 && (bareAlt.includes(npAlt) || npAlt.includes(bareAlt))) {
      return { projectId: p.project_id, inferred: p.project_name, prefix: p.sf_unit_prefix };
    }
  }
  return { projectId: null, inferred: null, prefix: null };
}

function hnorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_MAP = [
  { field: 'sub_project',     patterns: [/^sub[\s_]*project$/] },
  { field: 'sf_unit',         patterns: [/^unit$/] },
  { field: 'sf_booking_name', patterns: [/^booking\s*name$/] },
  { field: 'sf_applicant',    patterns: [/^primary\s*applicant/, /^applicant\s*name$/] },
  { field: 'sf_price',        patterns: [/^purchase\s*price$/] },
  { field: 'dld_unit',        patterns: [/^dld\s*unit$/, /^oqood\s*unit$/, /^dld\s*plot\s*number$/, /^bu?ilding\s*number\s*in\s*dld$/] },
  { field: 'size',            patterns: [/^size$/, /^area$/] },
  { field: 'rooms',           patterns: [/^rooms?$/, /^bedrooms?$/, /^roons$/] },
  { field: 'details',         patterns: [/^all\s*details$/, /^details$/, /^lease\s*finance$/] },
  { field: 'name_match',      patterns: [/name\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^name\s*match\b/] },
  { field: 'price_match',     patterns: [/(?:purchase\s*)?price\s*(?:in\s*sf\s*)?compared\s*to\s*dld/, /^price\s*match\b/] },
  { field: 'count_customers', patterns: [/^count\s*of\s*customers?$/, /^customers?\s*count$/] },
  { field: 'procedure_type',  patterns: [/^procedure\s*type$/] }
];

const AUDIT_HEADER_PATTERNS = [
  /match\s*status$/,
  /^remarks?$/,
  /^notes?$/,
  /^status$/
];

function buildHeaderIndex(headerRow) {
  const idx = {};
  const auditCols = [];
  const unknownCols = [];
  const used = new Set();

  for (let col = 0; col < headerRow.length; col++) {
    const h = hnorm(headerRow[col]);
    if (!h) continue;

    let matched = false;
    for (const entry of HEADER_MAP) {
      if (used.has(entry.field)) continue;
      if (idx[entry.field] != null) continue;
      if (entry.patterns.some(rx => rx.test(h))) {
        idx[entry.field] = col;
        used.add(entry.field);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (AUDIT_HEADER_PATTERNS.some(rx => rx.test(h))) {
      auditCols.push({ col, header: headerRow[col] });
    } else {
      unknownCols.push({ col, header: headerRow[col] });
    }
  }
  return { idx, auditCols, unknownCols };
}

function parseProjectSheet(ws) {
  if (!ws) return { rows: [], headerDiagnostic: null };
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (raw.length < 2) return { rows: [], headerDiagnostic: null };

  let headerRowIdx = 1;
  let { idx } = buildHeaderIndex(raw[1] || []);
  if (idx.sf_unit == null && idx.sub_project == null) {
    const alt = buildHeaderIndex(raw[0] || []);
    if (alt.idx.sf_unit != null || alt.idx.sub_project != null) {
      headerRowIdx = 0;
      idx = alt.idx;
    }
  }
  const { idx: finalIdx, auditCols, unknownCols } = buildHeaderIndex(raw[headerRowIdx] || []);

  const rows = [];
  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const sfUnit  = finalIdx.sf_unit  != null ? r[finalIdx.sf_unit]  : null;
    const dldUnit = finalIdx.dld_unit != null ? r[finalIdx.dld_unit] : null;
    if (!sfUnit && !dldUnit) continue;

    rows.push({
      sub_project:     finalIdx.sub_project     != null ? r[finalIdx.sub_project]                    : null,
      sf_unit:         sfUnit,
      sf_booking_name: finalIdx.sf_booking_name != null ? r[finalIdx.sf_booking_name]                : null,
      sf_applicant:    finalIdx.sf_applicant    != null ? r[finalIdx.sf_applicant]                   : null,
      sf_price:        finalIdx.sf_price        != null ? toNum(r[finalIdx.sf_price])                : null,
      dld_unit:        dldUnit == null ? null : String(dldUnit),
      size:            finalIdx.size            != null ? toNum(r[finalIdx.size])                    : null,
      rooms:           finalIdx.rooms           != null ? r[finalIdx.rooms]                          : null,
      details:         finalIdx.details         != null && r[finalIdx.details] != null ? String(r[finalIdx.details]) : null,
      name_match:      finalIdx.name_match      != null ? asAuditFlag(r[finalIdx.name_match])        : null,
      price_match:     finalIdx.price_match     != null ? asAuditFlag(r[finalIdx.price_match])       : null,
      count_customers: finalIdx.count_customers != null ? toInt(r[finalIdx.count_customers])         : null,
      procedure_type:  finalIdx.procedure_type  != null ? r[finalIdx.procedure_type]                 : null
    });
  }

  return {
    rows,
    headerDiagnostic: {
      headerRow: raw[headerRowIdx],
      mapped: finalIdx,
      droppedAudit: auditCols,
      droppedUnknown: unknownCols
    }
  };
}

function defaultLastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function summarizeAuditFlags(rows) {
  let nameFalse = 0, priceFalse = 0, bothTrue = 0, blank = 0;
  for (const r of rows) {
    const nm = r.name_match, pm = r.price_match;
    if (nm == null && pm == null) blank++;
    if (nm === 0) nameFalse++;
    if (pm === 0) priceFalse++;
    if (nm === 1 && pm === 1) bothTrue++;
  }
  return { name_false_count: nameFalse, price_false_count: priceFalse, both_true_count: bothTrue, blank_count: blank };
}

function importAuditWorkbook({ db, filePath, asOfMonth, note, replace }) {
  if (!fs.existsSync(filePath)) throw new Error('file not found: ' + filePath);
  const sha = sha256OfFile(filePath);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const props = wb.Props || {};
  const workbookModifiedAt = props.ModifiedDate ? new Date(props.ModifiedDate).toISOString() : null;
  const workbookModifiedBy = props.LastAuthor || null;
  const month = asOfMonth || defaultLastMonth();

  const existing = db.prepare('SELECT manual_audit_snapshot_id FROM manual_audit_snapshot WHERE as_of_month = ? AND source_sha256 = ?')
    .get(month, sha);
  if (existing) {
    if (!replace) {
      return { status: 'duplicate', manualAuditSnapshotId: existing.manual_audit_snapshot_id, asOfMonth: month };
    }
    db.prepare('DELETE FROM manual_audit_snapshot WHERE manual_audit_snapshot_id = ?').run(existing.manual_audit_snapshot_id);
  }

  const projectResults = [];
  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'Report') continue;
    const ws = wb.Sheets[sheetName];
    const { rows, headerDiagnostic } = parseProjectSheet(ws);
    projectResults.push({
      sheetName, rows, headerDiagnostic,
      counts: { row_count: rows.length, ...summarizeAuditFlags(rows) }
    });
  }

  const totalRows = projectResults.reduce((n, p) => n + p.rows.length, 0);

  const insertSnapshot = db.prepare(`
    INSERT INTO manual_audit_snapshot (source_file, source_sha256, as_of_month, workbook_modified_at, workbook_modified_by, total_rows, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProject = db.prepare(`
    INSERT INTO manual_audit_project (manual_audit_snapshot_id, sheet_name, project_name_inferred, project_id, auditor, row_count, name_false_count, price_false_count, both_true_count, blank_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRow = db.prepare(`
    INSERT INTO manual_audit_row (manual_audit_project_id, sub_project, sf_unit, unit_number_norm, sf_booking_name, sf_applicant, sf_price, dld_unit, size, rooms, details, name_match, price_match, count_customers, procedure_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const summary = { inserted: 0, projects: 0, matchedProjects: 0, unmatchedProjects: 0 };

  const tx = db.transaction(() => {
    const snapRes = insertSnapshot.run(path.basename(filePath), sha, month, workbookModifiedAt, workbookModifiedBy, totalRows, note || null);
    const snapId = snapRes.lastInsertRowid;

    for (const pr of projectResults) {
      const { projectId, inferred, prefix } = inferProjectId(db, pr.sheetName);
      pr.projectId = projectId;
      pr.projectName = inferred;

      const pres = insertProject.run(snapId, pr.sheetName, inferred, projectId, null,
        pr.counts.row_count, pr.counts.name_false_count, pr.counts.price_false_count,
        pr.counts.both_true_count, pr.counts.blank_count);
      const pid = pres.lastInsertRowid;

      summary.projects++;
      if (projectId) summary.matchedProjects++; else summary.unmatchedProjects++;

      for (const r of pr.rows) {
        const unitNorm = stripProjectPrefix(r.sf_unit, prefix);
        insertRow.run(pid, r.sub_project || null, r.sf_unit ? String(r.sf_unit) : null, unitNorm,
          r.sf_booking_name || null, r.sf_applicant || null, r.sf_price, r.dld_unit, r.size, r.rooms || null,
          r.details, r.name_match, r.price_match, r.count_customers, r.procedure_type || null);
        summary.inserted++;
      }
    }

    return snapId;
  });

  const snapshotId = tx();

  return {
    status: 'ok',
    manualAuditSnapshotId: snapshotId,
    asOfMonth: month,
    workbookModifiedAt,
    workbookModifiedBy,
    ...summary,
    projectResults
  };
}

module.exports = {
  sha256OfFile, normName, normNameStripSobha, normUnit, stripProjectPrefix,
  toNum, toInt, asAuditFlag, inferProjectId, hnorm, buildHeaderIndex,
  parseProjectSheet, HEADER_MAP, AUDIT_HEADER_PATTERNS,
  importAuditWorkbook, summarizeAuditFlags
};
