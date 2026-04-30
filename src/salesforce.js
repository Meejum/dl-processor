const path = require('path');
const XLSX = require('xlsx');
const { sha256OfFile } = require('./db');

const HEADER_ROW_INDEX = 9;
const DATA_START_INDEX = 10;

// Map SF_COLS key → expected header text in the workbook header row.
// Confirmed against DLD-ALL-2026-04-21 export. Whitespace is trimmed during lookup.
// If Salesforce reorders columns these stay correct; if Salesforce renames a header,
// resolveSfColumns throws on import with a clear list of which headers are missing.
const HEADER_LABELS = {
  BP_NAME:                  'Business Process: Business Process Name',
  SUB_PROJECT:              'Booking: Sub Project',
  UNIT:                     'Unit',
  BOOKING_NAME:             'Booking: Booking Name',
  PROJECT:                  'Project',
  TOWER_NAME:               'Booking: Tower Name',
  APPLICANT_NAME:           'Booking: Primary Applicant Name',
  PURCHASE_PRICE:           'Booking: Purchase Price',
  DLD_AMOUNT:               'Booking: DLD Amount',
  BP_CREATED_DATE:          'Business Process: Created Date',
  PRE_REG_STATUS:           'Booking: Pre-registration',
  CURRENT_STEP_NAME:        'Current Step Name',
  STATUS:                   'Status',
  RM_PROCESS_STATUS:        'RM Process Status',
  DLD_PROCESS_STATUS:       'DLD Process Status',
  TOTAL_DLD_PAID:           'Booking: Total DLD Amt Paid',
  DLD_SHORTFALL:            'Booking: Shortfall Amount for DLD',
  DLD_BALANCE:              'Booking: Total DLD Amt Balance',
  BOOKING_RECORD_ID:        'Booking: Record ID',
  END_DATE:                 'End Date',
  PRE_REG_COMPLETION_DATE:  'Booking: Date of Pre-registration Completion',
  PROCEDURE_NUMBER:         'Procedure Number',
  PAYMENT_REFERENCE_NUMBER: 'Payment Reference Number',
  PAYMENT_DATE:             'Payment Date'
};

const REQUIRED_HEADERS = Object.values(HEADER_LABELS);

function resolveSfColumns(headerRow) {
  if (!Array.isArray(headerRow)) {
    throw new Error('resolveSfColumns: header row must be an array');
  }
  const labelToIndex = new Map();
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i];
    if (cell == null) continue;
    const label = String(cell).trim();
    if (!label) continue;
    if (!labelToIndex.has(label)) labelToIndex.set(label, i);
  }
  const cols = {};
  const missing = [];
  for (const [key, label] of Object.entries(HEADER_LABELS)) {
    const idx = labelToIndex.get(label);
    if (idx == null) {
      missing.push(label);
    } else {
      cols[key] = idx;
      cols[label] = idx;
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `missing required Salesforce header(s): ${missing.map(s => '"' + s + '"').join(', ')}. ` +
      `Verify the workbook still has these columns at row ${HEADER_ROW_INDEX + 1}.`
    );
  }
  return cols;
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
  const headerRow = aoa[HEADER_ROW_INDEX] || [];
  const cols = resolveSfColumns(headerRow);
  const titleRow = aoa[1] || [];
  const timeRow  = aoa[2] || [];
  const generatedAt = cellOrNull(timeRow.find(v => typeof v === 'string' && /As of/i.test(v)));
  const rows = [];
  for (let i = DATA_START_INDEX; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(r[cols.BP_NAME]);
    const unit   = cellOrNull(r[cols.UNIT]);
    if (!bpName && !unit) continue;
    rows.push({
      bpName:               bpName,
      subProject:           cellOrNull(r[cols.SUB_PROJECT]),
      unit:                 unit,
      bookingName:          cellOrNull(r[cols.BOOKING_NAME]),
      project:              cellOrNull(r[cols.PROJECT]),
      towerName:            cellOrNull(r[cols.TOWER_NAME]),
      applicantName:        cellOrNull(r[cols.APPLICANT_NAME]),
      purchasePrice:        asNumberOrNull(r[cols.PURCHASE_PRICE]),
      dldAmount:            asNumberOrNull(r[cols.DLD_AMOUNT]),
      bpCreatedDate:        cellOrNull(r[cols.BP_CREATED_DATE]),
      preRegStatus:         cellOrNull(r[cols.PRE_REG_STATUS]),
      currentStepName:      cellOrNull(r[cols.CURRENT_STEP_NAME]),
      status:               cellOrNull(r[cols.STATUS]),
      rmProcessStatus:      cellOrNull(r[cols.RM_PROCESS_STATUS]),
      dldProcessStatus:     cellOrNull(r[cols.DLD_PROCESS_STATUS]),
      totalDldPaid:         asNumberOrNull(r[cols.TOTAL_DLD_PAID]),
      dldShortfall:         asNumberOrNull(r[cols.DLD_SHORTFALL]),
      dldBalance:           asNumberOrNull(r[cols.DLD_BALANCE]),
      bookingRecordId:      cellOrNull(r[cols.BOOKING_RECORD_ID]),
      endDate:              cellOrNull(r[cols.END_DATE]),
      preRegCompletionDate: cellOrNull(r[cols.PRE_REG_COMPLETION_DATE]),
      procedureNumber:      cellOrNull(r[cols.PROCEDURE_NUMBER]),
      paymentReferenceNumber: cellOrNull(r[cols.PAYMENT_REFERENCE_NUMBER]),
      paymentDate:          cellOrNull(r[cols.PAYMENT_DATE])
    });
  }
  return { generatedAt, rows };
}

function importSfSnapshot({ db, filePath }) {
  const { generatedAt, rows } = readSfWorkbook(filePath);
  const sourceSha = sha256OfFile(filePath);
  const sourceFile = path.basename(filePath);

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
      total_dld_paid, dld_shortfall, dld_balance, current_step_name, end_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    const snapInfo = insSnap.run(sourceFile, sourceSha, generatedAt, rows.length);
    const sid = snapInfo.lastInsertRowid;
    for (const r of rows) {
      const unitNorm = r.unit ? r.unit.trim().toUpperCase() : null;
      insBooking.run(
        sid, r.bpName, r.subProject, r.unit, unitNorm, r.bookingName, r.project,
        r.towerName, r.applicantName, r.purchasePrice, r.dldAmount, r.preRegStatus, r.status,
        r.rmProcessStatus, r.dldProcessStatus, r.bpCreatedDate, r.preRegCompletionDate,
        r.procedureNumber, r.paymentReferenceNumber, r.paymentDate, r.bookingRecordId,
        r.totalDldPaid, r.dldShortfall, r.dldBalance, r.currentStepName, r.endDate
      );
    }
    return { sfSnapshotId: sid, rowsInserted: rows.length, generatedAt };
  });
  return run();
}

module.exports = { readSfWorkbook, importSfSnapshot, resolveSfColumns, REQUIRED_HEADERS, HEADER_LABELS };
