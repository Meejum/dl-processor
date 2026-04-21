const { groupRows } = require('./extractor');

const COLS = {
  seq:        { min: 0,   max: 80 },
  unitId:     { min: 80,  max: 160 },
  unitNumber: { min: 160, max: 240 },
  unitType:   { min: 240, max: 330 },
  floor:      { min: 330, max: 395 },
  rooms:      { min: 395, max: 450 },
  netArea:    { min: 450, max: 540 },
  commonArea: { min: 540, max: 640 },
  txLabel:    { min: 640, max: 795 },
  dash1:      { min: 795, max: 805 },
  txDate:     { min: 805, max: 873 },
  dash2:      { min: 873, max: 883 },
  txAmount:   { min: 883, max: 10000 }
};

function pick(row, colKey) {
  const col = COLS[colKey];
  const hits = row.items.filter(i => i.x >= col.min && i.x < col.max);
  return hits.map(h => h.t).join('').trim();
}

function asNumber(s) {
  if (s == null || s === '' || s === '-') return null;
  const v = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

function rowText(row) {
  return row.items.map(i => i.t).join(' ').trim().replace(/\s+/g, ' ');
}

function isDecorationRow(row) {
  const txt = rowText(row);
  if (/^PROJECT INQUIRY$/.test(txt)) return true;
  if (/\b\d+\s+of\s+\d+$/.test(txt) && row.items.some(i => /\d{1,2}\/\d{1,2}\/\d{4}/.test(i.t))) return true;
  if (/^P\s*R\s*O\s*J\s*E\s*C\s*T/.test(txt) && /(I N F O R M A T I O N|B U I L D I N G S|S U M M A R Y)/.test(txt)) return true;
  return false;
}

function isColumnHeaderRow(row) {
  const txt = row.items.map(i => i.t).join(' ');
  return /Unit Id/.test(txt) && /Unit Number/.test(txt) && /Floor/.test(txt);
}

function detectParentHeader(row) {
  const get = (xMin, xMax) => row.items.filter(i => i.x >= xMin && i.x < xMax).map(i => i.t).join('').trim();
  const idLabel = get(0, 70);
  const nameLabel = get(160, 260);
  const typeLabel = get(440, 500);
  if (idLabel === 'ID:' && /Property Name:/.test(nameLabel) && /Type:/.test(typeLabel)) {
    return {
      id:   get(70, 160),
      name: get(260, 440),
      type: get(500, 640)
    };
  }
  return null;
}

function isUnitRow(row) {
  const seq = pick(row, 'seq');
  const id  = pick(row, 'unitId');
  return /^\d+$/.test(seq) && /^\d+$/.test(id);
}

function stripAedLeak(name) {
  return name.replace(/^AED\s*/, '').trim();
}

const SHARE_RE = /^(.*?)\(\s*([-\d.]+)\s*(F\.T\.|SQ\.M\.?)\s*\)\s*$/;

function parsePartyText(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(SHARE_RE);
  if (!m) return { name: stripAedLeak(trimmed), ftShare: null, shareUnit: null, raw };
  return {
    name: stripAedLeak(m[1].trim()),
    ftShare: asNumber(m[2]),
    shareUnit: m[3].trim(),
    raw
  };
}

function parseAmountText(raw) {
  if (!raw) return { amount: null, nameOverflow: '', inlineParty: null };
  let m = raw.match(/^\s*([\d.,]+)\s*AED\s*(.*)$/);
  if (!m) {
    const bareNum = raw.match(/^\s*([\d.,]+)\s*$/);
    if (bareNum) return { amount: asNumber(bareNum[1]), nameOverflow: '', inlineParty: null };
    return { amount: null, nameOverflow: '', inlineParty: null, raw };
  }
  const leftover = m[2].trim();
  const ftMatch  = leftover.match(/^(.*?)\(\s*([-\d.]+)\s*F\.T\.\)\s*$/);
  if (ftMatch) {
    return {
      amount: asNumber(m[1]),
      nameOverflow: '',
      inlineParty: { name: stripAedLeak(ftMatch[1].trim()), ftShare: asNumber(ftMatch[2]) }
    };
  }
  return { amount: asNumber(m[1]), nameOverflow: leftover, inlineParty: null };
}

function parseUnitRow(row) {
  return {
    seq:        asNumber(pick(row, 'seq')),
    unitId:     pick(row, 'unitId'),
    unitNumber: pick(row, 'unitNumber'),
    unitType:   pick(row, 'unitType'),
    floor:      pick(row, 'floor'),
    rooms:      asNumber(pick(row, 'rooms')),
    netArea:    asNumber(pick(row, 'netArea')),
    commonArea: pick(row, 'commonArea') === '-' ? null : asNumber(pick(row, 'commonArea')),
    transactions: [],
    _pendingParty: parsePartyText(pick(row, 'txLabel')) || null
  };
}

function extractTxDetail(row) {
  const hasLeftCol = row.items.some(i => i.x < 640);
  if (hasLeftCol) return null;

  let dateItem   = null;
  let amountItem = null;
  for (const it of row.items) {
    const t = it.t.trim();
    if (!t) continue;
    if (!dateItem && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) dateItem = it;
    if (!amountItem && /^\s*[\d.,]+\s*AED/.test(t)) amountItem = it;
  }
  if (!amountItem) {
    const bareNum = row.items.find(i => i.x >= 880 && /^[\d.,]+$/.test(i.t.trim()));
    if (bareNum) amountItem = bareNum;
  }
  if (!dateItem && !amountItem) return null;

  const cutoffX = dateItem ? dateItem.x - 5 :
                  (amountItem ? amountItem.x - 5 : Infinity);

  const labelItems = row.items
    .filter(it => it.x < cutoffX)
    .sort((a, b) => a.x - b.x)
    .slice();
  while (labelItems.length && labelItems[labelItems.length - 1].t.trim() === '-') {
    labelItems.pop();
  }
  const type = labelItems
    .map(it => it.t.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    type,
    date: dateItem ? dateItem.t.trim() : null,
    amountRaw: amountItem ? amountItem.t.trim() : ''
  };
}

function isTransactionDetailRow(row) {
  return extractTxDetail(row) != null;
}

function isPartyOnlyRow(row) {
  const leftCols = row.items.filter(i => i.x < 640);
  if (leftCols.length > 0) return false;
  const txLabel = pick(row, 'txLabel');
  return /\(\s*[-\d.]+\s*(F\.T\.|SQ\.M\.?)\s*\)/.test(txLabel);
}

function parseProject(pages) {
  const project = parseProjectSummary(pages[0]);

  const buildings = [];
  const buildingsById = new Map();
  let currentParent = null;
  let currentUnit = null;
  let pendingNameOverflow = '';

  for (const page of pages) {
    const rows = groupRows(page.glyphs);
    for (const row of rows) {
      row.pageNum = page.pageNum;

      if (isDecorationRow(row)) continue;
      if (isColumnHeaderRow(row)) continue;

      const parent = detectParentHeader(row);
      if (parent) {
        currentParent = parent;
        if (!buildingsById.has(parent.id)) {
          const b = { ...parent, units: [] };
          buildingsById.set(parent.id, b);
          buildings.push(b);
        }
        currentUnit = null;
        pendingNameOverflow = '';
        continue;
      }

      if (isUnitRow(row)) {
        currentUnit = parseUnitRow(row);
        currentUnit.pageNum = page.pageNum;
        if (currentParent) {
          currentUnit.parentId = currentParent.id;
          currentUnit.parentName = currentParent.name;
          currentUnit.parentType = currentParent.type;
          buildingsById.get(currentParent.id).units.push(currentUnit);
        }
        pendingNameOverflow = '';
        continue;
      }

      if (!currentUnit) continue;

      const txDetail = extractTxDetail(row);
      if (txDetail) {
        const amt = parseAmountText(txDetail.amountRaw);
        let partyName = '';
        let partyFt = null;
        if (currentUnit._pendingParty) {
          partyName = currentUnit._pendingParty.name;
          partyFt   = currentUnit._pendingParty.ftShare;
          currentUnit._pendingParty = null;
        }
        currentUnit.transactions.push({
          partyName,
          ftShare: partyFt,
          type:    txDetail.type,
          date:    txDetail.date || null,
          amountAED: amt.amount,
          amountRaw: txDetail.amountRaw
        });

        if (amt.inlineParty) {
          currentUnit._pendingParty = amt.inlineParty;
          pendingNameOverflow = '';
        } else {
          pendingNameOverflow = amt.nameOverflow || '';
        }
        continue;
      }

      if (isPartyOnlyRow(row)) {
        const txt = pick(row, 'txLabel');
        const party = parsePartyText(txt);
        if (party) {
          if (pendingNameOverflow) {
            party.name = (pendingNameOverflow + ' ' + party.name).trim();
            pendingNameOverflow = '';
          }
          currentUnit._pendingParty = party;
        }
        continue;
      }
    }
  }

  for (const b of buildings) {
    for (const u of b.units) {
      if (u._pendingParty && u.transactions.length === 0) {
        u.transactions.push({
          partyName: u._pendingParty.name,
          ftShare: u._pendingParty.ftShare,
          shareUnit: u._pendingParty.shareUnit,
          type: 'Owner (no transaction)',
          date: null,
          amountAED: null,
          amountRaw: ''
        });
      }
      delete u._pendingParty;
    }
  }

  return { project, buildings };
}

function parseProjectSummary(page) {
  const rows = groupRows(page.glyphs);

  const findValueRightOf = (label) => {
    for (const row of rows) {
      const idx = row.items.findIndex(i => i.t.trim() === label);
      if (idx === -1) continue;
      const next = row.items[idx + 1];
      return next ? next.t.trim() : null;
    }
    return null;
  };

  const meta = {
    projectName:       findValueRightOf('Project Name'),
    developer:         findValueRightOf('Developer Name'),
    projectValueAED:   asNumber(findValueRightOf('Project Value')),
    startDate:         findValueRightOf('Start Date'),
    endDate:           findValueRightOf('End Date'),
    progress:          findValueRightOf('Progress'),
    totalInvestors:    null,
    totalTransactions: null,
    transactionBreakdown: {}
  };

  for (const row of rows) {
    const rowItems = row.items;
    const joined = rowItems.map(i => i.t).join('').trim();
    const mBreak = joined.match(/^Number of properties that are on (.+?):\s*(\d+)\s*$/);
    if (mBreak) {
      meta.transactionBreakdown[mBreak[1].trim()] = parseInt(mBreak[2], 10);
      continue;
    }
    const idxTotal = rowItems.findIndex(i => /^Total\s*:\s*$/.test(i.t));
    if (idxTotal !== -1) {
      const next = rowItems[idxTotal + 1];
      if (next) meta.totalTransactions = asNumber(next.t);
    }
    const idxInv = rowItems.findIndex(i => /Total Investors in Project/.test(i.t));
    if (idxInv !== -1) {
      const next = rowItems[idxInv + 1];
      if (next) meta.totalInvestors = asNumber(next.t);
    }
  }

  return meta;
}

module.exports = { parseProject };
