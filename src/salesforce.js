const path = require('path');
const XLSX = require('xlsx');
const { sha256OfFile } = require('./db');

// Map each field → regex patterns for header-name matching. First-match wins.
// Headers are normalized via hnorm before matching: lowercase, single spaces.
const SF_FIELD_HEADERS = [
  { field: 'bpName',                 patterns: [/^business\s*process:?\s*business\s*process\s*name/i, /^bp\s*name$/i, /^business\s*process(?:\s*name)?$/i] },
  { field: 'subProject',             patterns: [/^(?:booking:?\s*)?sub[\s_-]*project$/i] },
  { field: 'unit',                   patterns: [/^unit$/i] },
  { field: 'bookingName',            patterns: [/^(?:booking:?\s*)?booking\s*name$/i] },
  { field: 'project',                patterns: [/^project$/i] },
  { field: 'towerName',              patterns: [/^(?:booking:?\s*)?tower\s*name$/i, /^tower$/i] },
  { field: 'applicantName',          patterns: [/^(?:booking:?\s*)?primary\s*applicant\s*name$/i, /^applicant\s*name$/i] },
  { field: 'purchasePrice',          patterns: [/^(?:booking:?\s*)?purchase\s*price$/i] },
  { field: 'dldAmount',              patterns: [/^(?:booking:?\s*)?dld\s*amount$/i] },
  { field: 'bpCreatedDate',          patterns: [/^business\s*process:?\s*created\s*date$/i, /^bp\s*created\s*date$/i] },
  { field: 'preRegStatus',           patterns: [/^(?:booking:?\s*)?pre-?\s*registration$/i, /^pre-?reg\s*status$/i] },
  { field: 'currentStepName',        patterns: [/^current\s*step\s*name$/i] },
  { field: 'status',                 patterns: [/^status$/i] },
  { field: 'rmProcessStatus',        patterns: [/^rm\s*process\s*status$/i] },
  { field: 'dldProcessStatus',       patterns: [/^dld\s*process\s*status$/i] },
  { field: 'totalDldPaid',           patterns: [/^(?:booking:?\s*)?total\s*dld(?:\s*amt|\s*amount)?\s*paid?$/i, /^total\s*dld\s*paid$/i] },
  { field: 'dldShortfall',           patterns: [/^(?:booking:?\s*)?shortfall/i, /^dld\s*shortfall$/i] },
  { field: 'dldBalance',             patterns: [/^dld\s*balance$/i] },
  { field: 'bookingRecordId',        patterns: [/^(?:booking:?\s*)?record\s*id$/i, /^booking\s*record\s*id$/i] },
  { field: 'endDate',                patterns: [/^end\s*date$/i] },
  { field: 'preRegCompletionDate',   patterns: [/^(?:booking:?\s*)?date\s*of\s*pre-?\s*reg(?:istration)?$/i, /^pre-?reg\s*completion\s*date$/i] },
  { field: 'procedureNumber',        patterns: [/^procedure\s*number$/i] },
  { field: 'paymentReferenceNumber', patterns: [/^payment\s*reference\s*number$/i] },
  { field: 'paymentDate',            patterns: [/^payment\s*date$/i] },
  { field: 'nationality',            patterns: [/^(?:booking:?\s*)?nationality$/i] },
  { field: 'applicantDetails',       patterns: [/^(?:booking:?\s*)?applicant\s*details$/i] },
  { field: 'applicant2Name',         patterns: [/^(?:booking:?\s*)?applicant\s*2\s*name$/i] },
  { field: 'applicant3Name',         patterns: [/^(?:booking:?\s*)?applicant\s*3\s*name$/i] },
  { field: 'applicant4Name',         patterns: [/^(?:booking:?\s*)?applicant\s*4\s*name$/i] },
  { field: 'docusignComplete',       patterns: [/^(?:booking:?\s*)?(?:applicant\s*)?docusign\s*complete$/i] }
];

function hnorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

function buildSfHeaderIndex(headerRow) {
  const idx = {};
  const used = new Set();
  for (let col = 0; col < (headerRow || []).length; col++) {
    const h = hnorm(headerRow[col]);
    if (!h) continue;
    for (const entry of SF_FIELD_HEADERS) {
      if (used.has(entry.field)) continue;
      if (entry.patterns.some(rx => rx.test(h))) {
        idx[entry.field] = col;
        used.add(entry.field);
        break;
      }
    }
  }
  // Collect every column that matches "Nationality" — SF reports sometimes have
  // it twice (one empty config artefact, one with real data).
  idx._natCols = [];
  for (let col = 0; col < (headerRow || []).length; col++) {
    if (/^(?:booking:?\s*)?nationality$/i.test(hnorm(headerRow[col]))) idx._natCols.push(col);
  }
  return idx;
}

function detectHeaderRow(aoa) {
  const maxScan = Math.min(13, aoa.length);
  let best = { row: -1, idx: {}, count: 0 };
  for (let i = 0; i < maxScan; i++) {
    const idx = buildSfHeaderIndex(aoa[i] || []);
    const count = Object.keys(idx).filter(k => k !== '_natCols').length;
    if (count > best.count) best = { row: i, idx, count };
  }
  return best;
}

function cellOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function readSfWorkbook(filePath) {
  const origErr = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === 'string' && /Bad uncompressed size/.test(msg)) return;
    return origErr(msg, ...rest);
  };
  let wb;
  try { wb = XLSX.readFile(filePath); }
  finally { console.error = origErr; }
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });

  const { row: headerRow, idx, count: mappedCount } = detectHeaderRow(aoa);
  if (headerRow < 0 || mappedCount < 6) {
    throw new Error('readSfWorkbook: could not find SF header row (need ≥6 known field headers). File: ' + path.basename(filePath));
  }

  let generatedAt = null;
  for (let i = 0; i < headerRow; i++) {
    const r = aoa[i] || [];
    for (const c of r) {
      if (typeof c === 'string' && /^as\s*of\b/i.test(c.trim())) { generatedAt = c.trim(); break; }
    }
    if (generatedAt) break;
  }

  const get = (r, f) => idx[f] != null ? r[idx[f]] : null;
  const getNat = (r) => {
    for (const c of (idx._natCols || [])) { const v = r[c]; if (v != null && v !== '') return v; }
    return null;
  };
  const rows = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(get(r, 'bpName'));
    const unit = cellOrNull(get(r, 'unit'));
    const bookingName = cellOrNull(get(r, 'bookingName'));
    if (!bpName && !unit && !bookingName) continue;
    rows.push({
      bpName,
      subProject:             cellOrNull(get(r, 'subProject')),
      unit,
      bookingName,
      project:                cellOrNull(get(r, 'project')),
      towerName:              cellOrNull(get(r, 'towerName')),
      applicantName:          cellOrNull(get(r, 'applicantName')),
      purchasePrice:          asNumberOrNull(get(r, 'purchasePrice')),
      dldAmount:              asNumberOrNull(get(r, 'dldAmount')),
      bpCreatedDate:          cellOrNull(get(r, 'bpCreatedDate')),
      preRegStatus:           cellOrNull(get(r, 'preRegStatus')),
      currentStepName:        cellOrNull(get(r, 'currentStepName')),
      status:                 cellOrNull(get(r, 'status')),
      rmProcessStatus:        cellOrNull(get(r, 'rmProcessStatus')),
      dldProcessStatus:       cellOrNull(get(r, 'dldProcessStatus')),
      totalDldPaid:           asNumberOrNull(get(r, 'totalDldPaid')),
      dldShortfall:           asNumberOrNull(get(r, 'dldShortfall')),
      dldBalance:             asNumberOrNull(get(r, 'dldBalance')),
      bookingRecordId:        cellOrNull(get(r, 'bookingRecordId')),
      endDate:                cellOrNull(get(r, 'endDate')),
      preRegCompletionDate:   cellOrNull(get(r, 'preRegCompletionDate')),
      procedureNumber:        cellOrNull(get(r, 'procedureNumber')),
      paymentReferenceNumber: cellOrNull(get(r, 'paymentReferenceNumber')),
      paymentDate:            cellOrNull(get(r, 'paymentDate')),
      nationality:            cellOrNull(getNat(r)),
      applicantDetails:       cellOrNull(get(r, 'applicantDetails')),
      applicant2Name:         cellOrNull(get(r, 'applicant2Name')),
      applicant3Name:         cellOrNull(get(r, 'applicant3Name')),
      applicant4Name:         cellOrNull(get(r, 'applicant4Name')),
      docusignComplete:       cellOrNull(get(r, 'docusignComplete'))
    });
  }
  return { generatedAt, rows, _meta: { headerRow, mappedFields: mappedCount } };
}

function readSfCsv(filePath) {
  const origErr = console.error;
  console.error = (msg, ...rest) => {
    if (typeof msg === 'string' && /Bad uncompressed size/.test(msg)) return;
    return origErr(msg, ...rest);
  };
  let wb;
  try { wb = XLSX.readFile(filePath, { type: 'file', raw: false }); }
  finally { console.error = origErr; }
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });

  const { row: headerRow, idx, count: mappedCount } = detectHeaderRow(aoa);
  if (headerRow < 0 || mappedCount < 6) {
    throw new Error('readSfCsv: could not find SF header row (need ≥6 known field headers). File: ' + path.basename(filePath));
  }

  const get = (r, f) => idx[f] != null ? r[idx[f]] : null;
  const getNat = (r) => {
    for (const c of (idx._natCols || [])) { const v = r[c]; if (v != null && v !== '') return v; }
    return null;
  };
  const rows = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(get(r, 'bpName'));
    const unit = cellOrNull(get(r, 'unit'));
    const bookingName = cellOrNull(get(r, 'bookingName'));
    if (!bpName && !unit && !bookingName) continue;
    rows.push({
      bpName,
      subProject:             cellOrNull(get(r, 'subProject')),
      unit,
      bookingName,
      project:                cellOrNull(get(r, 'project')),
      towerName:              cellOrNull(get(r, 'towerName')),
      applicantName:          cellOrNull(get(r, 'applicantName')),
      purchasePrice:          asNumberOrNull(get(r, 'purchasePrice')),
      dldAmount:              asNumberOrNull(get(r, 'dldAmount')),
      bpCreatedDate:          cellOrNull(get(r, 'bpCreatedDate')),
      preRegStatus:           cellOrNull(get(r, 'preRegStatus')),
      currentStepName:        cellOrNull(get(r, 'currentStepName')),
      status:                 cellOrNull(get(r, 'status')),
      rmProcessStatus:        cellOrNull(get(r, 'rmProcessStatus')),
      dldProcessStatus:       cellOrNull(get(r, 'dldProcessStatus')),
      totalDldPaid:           asNumberOrNull(get(r, 'totalDldPaid')),
      dldShortfall:           asNumberOrNull(get(r, 'dldShortfall')),
      dldBalance:             asNumberOrNull(get(r, 'dldBalance')),
      bookingRecordId:        cellOrNull(get(r, 'bookingRecordId')),
      endDate:                cellOrNull(get(r, 'endDate')),
      preRegCompletionDate:   cellOrNull(get(r, 'preRegCompletionDate')),
      procedureNumber:        cellOrNull(get(r, 'procedureNumber')),
      paymentReferenceNumber: cellOrNull(get(r, 'paymentReferenceNumber')),
      paymentDate:            cellOrNull(get(r, 'paymentDate')),
      nationality:            cellOrNull(getNat(r)),
      applicantDetails:       cellOrNull(get(r, 'applicantDetails')),
      applicant2Name:         cellOrNull(get(r, 'applicant2Name')),
      applicant3Name:         cellOrNull(get(r, 'applicant3Name')),
      applicant4Name:         cellOrNull(get(r, 'applicant4Name')),
      docusignComplete:       cellOrNull(get(r, 'docusignComplete'))
    });
  }
  return { generatedAt: null, rows, _meta: { headerRow, mappedFields: mappedCount } };
}

function importSfRows({ db, rows, generatedAt, sourceFile, sourceSha256 }) {
  // Dedup: if a snapshot with the same SHA already exists, return it without re-inserting.
  if (sourceSha256) {
    const existing = db.prepare('SELECT sf_snapshot_id FROM sf_snapshot WHERE source_sha256 = ?').get(sourceSha256);
    if (existing) {
      return { sfSnapshotId: existing.sf_snapshot_id, rowsInserted: 0, generatedAt: null, deduped: true };
    }
  }

  const insSnap = db.prepare(`
    INSERT INTO sf_snapshot (source_file, source_sha256, generated_at, total_rows)
    VALUES (?, ?, ?, ?)
  `);
  const insBooking = db.prepare(`
    INSERT INTO sf_booking (
      sf_snapshot_id, bp_name, sub_project, unit, unit_norm, booking_name, project,
      tower_name, applicant_name, purchase_price, dld_amount, pre_reg_status, status,
      rm_process_status, dld_process_status, bp_created_date, pre_reg_completion_date,
      procedure_number, payment_reference_number, payment_date, booking_record_id,
      total_dld_paid, dld_shortfall, dld_balance, current_step_name, end_date,
      nationality, applicant_details,
      applicant_2_name, applicant_3_name, applicant_4_name, docusign_complete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const snapInfo = insSnap.run(sourceFile, sourceSha256 || null, generatedAt || null, rows.length);
    const sid = snapInfo.lastInsertRowid;
    for (const r of rows) {
      const unitNorm = r.unit ? String(r.unit).trim().toUpperCase() : null;
      insBooking.run(
        sid, r.bpName, r.subProject, r.unit, unitNorm, r.bookingName, r.project,
        r.towerName, r.applicantName, r.purchasePrice, r.dldAmount, r.preRegStatus, r.status,
        r.rmProcessStatus, r.dldProcessStatus, r.bpCreatedDate, r.preRegCompletionDate,
        r.procedureNumber, r.paymentReferenceNumber, r.paymentDate, r.bookingRecordId,
        r.totalDldPaid, r.dldShortfall, r.dldBalance, r.currentStepName, r.endDate,
        r.nationality, r.applicantDetails,
        r.applicant2Name || null, r.applicant3Name || null, r.applicant4Name || null,
        r.docusignComplete || null
      );
    }
    return { sfSnapshotId: sid, rowsInserted: rows.length, generatedAt };
  });
  return run();
}

function importSfSnapshot({ db, filePath }) {
  const sha = sha256OfFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const { generatedAt, rows } = ext === '.csv' ? readSfCsv(filePath) : readSfWorkbook(filePath);
  return importSfRows({
    db, rows, generatedAt,
    sourceFile: path.basename(filePath),
    sourceSha256: sha
  });
}

module.exports = {
  readSfWorkbook,
  readSfCsv,
  importSfSnapshot,
  importSfRows,
  detectHeaderRow,
  buildSfHeaderIndex,
  SF_FIELD_HEADERS
};
