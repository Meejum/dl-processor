const fs = require('fs');
const path = require('path');

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeUnitsCsv(data, filePath) {
  const header = [
    'parent_id','parent_name','parent_type',
    'seq','unit_id','unit_number','unit_type','floor','rooms','net_area','common_area','tx_count'
  ];
  const lines = [header.join(',')];
  for (const b of data.buildings) {
    for (const u of b.units) {
      lines.push([
        b.id, b.name, b.type,
        u.seq, u.unitId, u.unitNumber, u.unitType, u.floor, u.rooms, u.netArea, u.commonArea,
        (u.transactions || []).length
      ].map(csvEscape).join(','));
    }
  }
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

function writeTransactionsCsv(data, filePath) {
  const header = [
    'parent_id','parent_name','parent_type',
    'unit_id','unit_number','unit_type','floor','net_area',
    'party_name','ft_share','transaction_type','date','amount_aed'
  ];
  const lines = [header.join(',')];
  for (const b of data.buildings) {
    for (const u of b.units) {
      if (!u.transactions || u.transactions.length === 0) {
        lines.push([
          b.id, b.name, b.type,
          u.unitId, u.unitNumber, u.unitType, u.floor, u.netArea,
          '', '', '', '', ''
        ].map(csvEscape).join(','));
        continue;
      }
      for (const t of u.transactions) {
        lines.push([
          b.id, b.name, b.type,
          u.unitId, u.unitNumber, u.unitType, u.floor, u.netArea,
          t.partyName, t.ftShare, t.type, t.date, t.amountAED
        ].map(csvEscape).join(','));
      }
    }
  }
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

function writeJson(data, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function safeName(s) {
  return String(s || 'project').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
}

module.exports = { writeUnitsCsv, writeTransactionsCsv, writeJson, safeName };
