const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { asNumber, stripAedLeak } = require('../common');

const COL = {
  PROJECT_VALUE_CAPTION: 0,
  PROJECT_VALUE:         1,
  START_DATE_CAPTION:    2,
  START_DATE:            3,
  END_DATE_CAPTION:      4,
  END_DATE:              5,
  PROGRESS_CAPTION:      6,
  PROGRESS:              7,
  DEVELOPER_CAPTION:     8,
  DEVELOPER_NAME:        9,
  PROJECT_NAME_CAPTION: 10,
  PROJECT_NAME:         11,
  SECTION_INFO_HEADER:  12,
  SECTION_BUILDINGS:    13,
  PARENT_NAME:          14,
  PARENT_NAME_CAPTION:  15,
  PARENT_TYPE_CAPTION:  16,
  PARENT_TYPE:          17,
  SPACER_A:             18,
  PARENT_ID_CAPTION:    19,
  PARENT_ID:            20,
  UNIT_NUMBER:          30,
  FLOOR:                31,
  ROOMS:                32,
  NET_AREA:             33,
  UNIT_TYPE:            34,
  HTML_TX_TEXT:         35,
  COMMON_AREA:          36,
  UNIT_ID:              37,
  SEQ:                  38,
  SECTION_SUMMARY:      39,
  TOTAL_TX:             40,
  TOTAL_TX_LABEL:       41,
  TOTAL_PROPERTIES_LABEL: 42,
  TOTAL_PROJECT_PROPERTIES: 43,
  TOTAL_INVESTORS_LABEL: 44,
  TOTAL_INVESTORS:      45,
  ROT_TX_LABEL:         46,
  ROT_TX_COUNT:         47,
  TOTAL_PROPS:          48,
  ROT_BUILDINGS_LABEL:  51,
  ROT_BUILDINGS_VALUE:  52
};

const SHARE_MARKER_RE = /\(\s*([-\d.]+)\s*(F\.T\.|SQ\.M\.?)\s*\)/g;
const TX_TAIL_RE      = /^\s*(.*?)\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*([\d.,]+)\s*AED/;

function parseHtmlTextBox1(raw) {
  const result = [];
  if (!raw) return result;
  const s = String(raw);

  SHARE_MARKER_RE.lastIndex = 0;
  const markers = [];
  let m;
  while ((m = SHARE_MARKER_RE.exec(s)) !== null) {
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      share: asNumber(m[1]),
      unit: m[2].trim()
    });
  }
  if (markers.length === 0) return result;

  let cursor = 0;
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i];
    const nameRaw = s.substring(cursor, mk.start).trim();
    const nextStart = i + 1 < markers.length ? markers[i + 1].start : s.length;
    const segment = s.substring(mk.end, nextStart);
    const txMatch = segment.match(TX_TAIL_RE);

    const entry = {
      partyName: stripAedLeak(nameRaw),
      ftShare: mk.share,
      shareUnit: mk.unit
    };

    if (txMatch) {
      entry.type       = txMatch[1].trim().replace(/\s+/g, ' ');
      entry.date       = txMatch[2];
      entry.amountAED  = asNumber(txMatch[3]);
      entry.amountRaw  = `${txMatch[3].trim()} AED`;
      cursor = mk.end + txMatch[0].length;
    } else {
      entry.type       = 'Owner (no transaction)';
      entry.date       = null;
      entry.amountAED  = null;
      entry.amountRaw  = '';
      cursor = mk.end;
    }
    result.push(entry);
  }
  return result;
}

function cellOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function parseCommonArea(raw) {
  const s = cellOrNull(raw);
  if (s == null) return null;
  if (s === '-' || s === '-1') return null;
  return asNumber(s);
}

function parseDldCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parse(content, { relax_quotes: true, relax_column_count: true });
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const dataRows = rows.slice(1);

  const first = dataRows[0];
  const project = {
    projectName:     cellOrNull(first[COL.PROJECT_NAME]),
    developer:       cellOrNull(first[COL.DEVELOPER_NAME]),
    projectValueAED: asNumber(first[COL.PROJECT_VALUE]),
    startDate:       cellOrNull(first[COL.START_DATE]),
    endDate:         cellOrNull(first[COL.END_DATE]),
    progress:        cellOrNull(first[COL.PROGRESS]),
    totalInvestors:  asNumber(first[COL.TOTAL_INVESTORS]),
    totalTransactions: asNumber(first[COL.TOTAL_TX]),
    totalProjectProperties: asNumber(first[COL.TOTAL_PROJECT_PROPERTIES]),
    totalProperties: asNumber(first[COL.TOTAL_PROPS]),
    transactionBreakdown: {}
  };

  for (const r of dataRows) {
    const label = cellOrNull(r[COL.ROT_TX_LABEL]);
    const count = asNumber(r[COL.ROT_TX_COUNT]);
    if (label && count != null) {
      const m = label.match(/^Number of properties that are on (.+?):\s*$/);
      if (m) project.transactionBreakdown[m[1].trim()] = count;
    }
  }

  const buildingsById = new Map();
  const buildings = [];
  let lineNum = 0;

  for (const r of dataRows) {
    lineNum++;
    const parentId   = cellOrNull(r[COL.PARENT_ID]);
    const parentName = cellOrNull(r[COL.PARENT_NAME]);
    const parentType = cellOrNull(r[COL.PARENT_TYPE]);
    if (!parentId) continue;

    let b = buildingsById.get(parentId);
    if (!b) {
      b = { id: parentId, name: parentName, type: parentType, units: [] };
      buildingsById.set(parentId, b);
      buildings.push(b);
    }

    const unit = {
      seq:        asNumber(r[COL.SEQ]),
      unitId:     cellOrNull(r[COL.UNIT_ID]),
      unitNumber: cellOrNull(r[COL.UNIT_NUMBER]),
      unitType:   cellOrNull(r[COL.UNIT_TYPE]),
      floor:      cellOrNull(r[COL.FLOOR]),
      rooms:      asNumber(r[COL.ROOMS]),
      netArea:    asNumber(r[COL.NET_AREA]),
      commonArea: parseCommonArea(r[COL.COMMON_AREA]),
      pageNum:    null,
      parentId:   b.id,
      parentName: b.name,
      parentType: b.type,
      transactions: parseHtmlTextBox1(r[COL.HTML_TX_TEXT])
    };
    b.units.push(unit);
  }

  return { project, buildings };
}

module.exports = { parseDldCsv, parseHtmlTextBox1 };
