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

module.exports = {
  sha256OfFile, normName, normNameStripSobha, normUnit, stripProjectPrefix,
  toNum, toInt, asAuditFlag, inferProjectId, hnorm, buildHeaderIndex,
  parseProjectSheet, HEADER_MAP, AUDIT_HEADER_PATTERNS
};
