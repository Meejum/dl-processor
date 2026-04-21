const path = require('path');
const XLSX = require('xlsx');
const { sha256OfFile } = require('./db');

const HEADER_ROW_INDEX = 9;
const DATA_START_INDEX = 10;

const SF_COLS = {
  BP_NAME: 1,
  SUB_PROJECT: 3,
  UNIT: 4,
  BOOKING_NAME: 5,
  PROJECT: 6,
  TOWER_NAME: 7,
  APPLICANT_NAME: 8,
  PURCHASE_PRICE: 9,
  DLD_AMOUNT: 10,
  BP_CREATED_DATE: 12,
  PRE_REG_STATUS: 13,
  CURRENT_STEP_NAME: 14,
  STATUS: 15,
  RM_PROCESS_STATUS: 16,
  DLD_PROCESS_STATUS: 17,
  TOTAL_DLD_PAID: 23,
  DLD_SHORTFALL: 24,
  DLD_BALANCE: 25,
  BOOKING_RECORD_ID: 28,
  END_DATE: 29,
  PRE_REG_COMPLETION_DATE: 30,
  PROCEDURE_NUMBER: 31,
  PAYMENT_REFERENCE_NUMBER: 32,
  PAYMENT_DATE: 33
};

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
  const titleRow = aoa[1] || [];
  const timeRow  = aoa[2] || [];
  const generatedAt = cellOrNull(timeRow.find(v => typeof v === 'string' && /As of/i.test(v)));
  const rows = [];
  for (let i = DATA_START_INDEX; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const bpName = cellOrNull(r[SF_COLS.BP_NAME]);
    const unit   = cellOrNull(r[SF_COLS.UNIT]);
    if (!bpName && !unit) continue;
    rows.push({
      bpName:               bpName,
      subProject:           cellOrNull(r[SF_COLS.SUB_PROJECT]),
      unit:                 unit,
      bookingName:          cellOrNull(r[SF_COLS.BOOKING_NAME]),
      project:              cellOrNull(r[SF_COLS.PROJECT]),
      towerName:            cellOrNull(r[SF_COLS.TOWER_NAME]),
      applicantName:        cellOrNull(r[SF_COLS.APPLICANT_NAME]),
      purchasePrice:        asNumberOrNull(r[SF_COLS.PURCHASE_PRICE]),
      dldAmount:            asNumberOrNull(r[SF_COLS.DLD_AMOUNT]),
      bpCreatedDate:        cellOrNull(r[SF_COLS.BP_CREATED_DATE]),
      preRegStatus:         cellOrNull(r[SF_COLS.PRE_REG_STATUS]),
      currentStepName:      cellOrNull(r[SF_COLS.CURRENT_STEP_NAME]),
      status:               cellOrNull(r[SF_COLS.STATUS]),
      rmProcessStatus:      cellOrNull(r[SF_COLS.RM_PROCESS_STATUS]),
      dldProcessStatus:     cellOrNull(r[SF_COLS.DLD_PROCESS_STATUS]),
      totalDldPaid:         asNumberOrNull(r[SF_COLS.TOTAL_DLD_PAID]),
      dldShortfall:         asNumberOrNull(r[SF_COLS.DLD_SHORTFALL]),
      dldBalance:           asNumberOrNull(r[SF_COLS.DLD_BALANCE]),
      bookingRecordId:      cellOrNull(r[SF_COLS.BOOKING_RECORD_ID]),
      endDate:              cellOrNull(r[SF_COLS.END_DATE]),
      preRegCompletionDate: cellOrNull(r[SF_COLS.PRE_REG_COMPLETION_DATE]),
      procedureNumber:      cellOrNull(r[SF_COLS.PROCEDURE_NUMBER]),
      paymentReferenceNumber: cellOrNull(r[SF_COLS.PAYMENT_REFERENCE_NUMBER]),
      paymentDate:          cellOrNull(r[SF_COLS.PAYMENT_DATE])
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

module.exports = { readSfWorkbook, importSfSnapshot, SF_COLS };
