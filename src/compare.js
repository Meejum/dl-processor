const fs = require('fs');
const path = require('path');
const { expectedSfUnit, applyUnitTransforms } = require('./project-mapping');
const { getOverridesMapForProject } = require('./overrides');
const { BANK_PREFIX_RE } = require('./common');
const { SOBHA_STYLE_CSS, brandBar } = require('./html-styles');

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(','));
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

function getLatestSnapshotForProject(db, projectId) {
  return db.prepare(`
    SELECT * FROM dld_snapshot
    WHERE project_id = ?
    ORDER BY imported_at DESC
    LIMIT 1
  `).get(projectId);
}

function getLatestSfSnapshot(db) {
  return db.prepare(`SELECT * FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`).get();
}

function getUnitsForSnapshot(db, snapshotId) {
  return db.prepare(`
    SELECT u.*, b.name AS building_name, b.type AS building_type
    FROM dld_unit u
    LEFT JOIN dld_building b ON b.building_id = u.building_id
    WHERE u.snapshot_id = ?
    ORDER BY CAST(u.unit_number AS INTEGER), u.unit_number
  `).all(snapshotId);
}

function getTxForUnit(db, unitId) {
  return db.prepare(`SELECT * FROM dld_transaction WHERE unit_id = ? ORDER BY tx_id`).all(unitId);
}

function getSfBookingsForSub(db, sfSnapshotId, subProject) {
  return db.prepare(`
    SELECT * FROM sf_booking
    WHERE sf_snapshot_id = ? AND sub_project = ?
  `).all(sfSnapshotId, subProject);
}

const MARKET_PRICE_TX = new Set([
  'Complete Delayed Sell', 'Sell - Pre registration', 'Sale', 'Delayed Sell'
]);

const PURCHASE_TX_TYPES = new Set([
  ...MARKET_PRICE_TX, 'Grant', 'Lease to Own Registration'
]);

function pickLatestOfTypes(dldTxs, typeSet) {
  const hits = dldTxs.filter(t => typeSet.has(t.tx_type));
  if (hits.length === 0) return null;
  hits.sort((a, b) => {
    const da = a.tx_date_iso || '';
    const db = b.tx_date_iso || '';
    return db.localeCompare(da);
  });
  const top = hits[0];
  const sameDate = hits.filter(t => (t.tx_date_iso || '') === (top.tx_date_iso || ''));
  const withName = sameDate.find(t => t.party_name && !BANK_PREFIX_RE.test(t.party_name));
  return withName || top;
}

function pickLatestPurchase(dldTxs) {
  return pickLatestOfTypes(dldTxs, PURCHASE_TX_TYPES);
}

function pickLatestMarketPrice(dldTxs) {
  return pickLatestOfTypes(dldTxs, MARKET_PRICE_TX);
}

function findLatestNonBankParty(dldTxs) {
  if (!dldTxs || !dldTxs.length) return null;
  const sorted = dldTxs.slice().sort((a, b) => (b.tx_date_iso || '').localeCompare(a.tx_date_iso || ''));
  for (const t of sorted) {
    if (t.party_name && !BANK_PREFIX_RE.test(t.party_name)) return t.party_name;
  }
  return null;
}

const GENERIC_COMMERCIAL_TOKENS = new Set([
  'INVESTMENT','INVESTMENTS','HOLDING','HOLDINGS','TRADING','PROPERTIES','PROPERTY',
  'REAL','ESTATE','DEVELOPMENT','DEVELOPERS','GENERAL','GROUP','COMPANY','CO',
  'INTERNATIONAL','GLOBAL','BUSINESS','SERVICES','MANAGEMENT','CORPORATION'
]);

function plotNormalizeName(s) {
  if (!s) return '';
  return String(s).toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plotTokenJaccard(aKey, bKey) {
  const a = new Set(aKey.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w)));
  const b = new Set(bKey.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w)));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / new Set([...a, ...b]).size;
}

// Stopwords removed before token comparison. Includes English titles and
// Arabic naming particles that frequently appear across unrelated names
// and must not be treated as a matching signal.
const NAME_STOPWORDS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR',
  'BIN', 'BINT', 'IBN', 'AL', 'EL', 'ABU', 'UMM', 'UM'
]);

// Transliteration normalization map: variants → canonical form.
// Applied per-token after stopword removal, before set comparison.
const TRANSLIT_MAP = {
  MOHAMMAD:  'MOHAMMED',
  MUHAMMED:  'MOHAMMED',
  MUHAMMAD:  'MOHAMMED',
  MOHAMAD:   'MOHAMMED',
  MOHAMED:   'MOHAMMED',
  EBRAHIM:   'IBRAHIM',
  KHALED:    'KHALID',
  YUSUF:     'YOUSEF',
  YOUSIF:    'YOUSEF',
  YOUSSEF:   'YOUSEF',
  FATHIMA:   'FATIMA',
  FATHIMAH:  'FATIMA',
  AHMAD:     'AHMED',
  HUSSAIN:   'HUSSEIN',
  HUSAIN:    'HUSSEIN',
  HASAN:     'HASSAN',
  UMAR:      'OMAR'
};

function tokenizeName(s) {
  if (!s) return new Set();
  const upper = String(s).toUpperCase()
    .replace(/^(MR|MRS|MS|MISS|DR)\.?\s+/, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!upper) return new Set();
  const tokens = new Set();
  for (const w of upper.split(' ')) {
    if (w.length <= 2) continue;
    if (NAME_STOPWORDS.has(w)) continue;
    tokens.add(TRANSLIT_MAP[w] || w);
  }
  return tokens;
}

function isSubsetOf(small, big) {
  for (const x of small) if (!big.has(x)) return false;
  return small.size > 0;
}

function namesOverlap(a, b) {
  const A = tokenizeName(a);
  const B = tokenizeName(b);
  if (A.size === 0 || B.size === 0) return false;
  return isSubsetOf(A, B) || isSubsetOf(B, A);
}

const SF_APPLICANT_FIELDS = [
  'applicant_name',
  'applicant_2_name',
  'applicant_3_name',
  'applicant_4_name',
  'applicant_details'
];

function findMatchingApplicant(dldBuyer, sfRow) {
  if (!dldBuyer) return null;
  for (const f of SF_APPLICANT_FIELDS) {
    const v = sfRow ? sfRow[f] : null;
    if (!v) continue;
    if (namesOverlap(dldBuyer, v)) return f;
  }
  return null;
}

function computePriceDelta(dldPrice, sfPrice) {
  if (dldPrice == null || sfPrice == null) return { diff: null, pct: null, direction: null };
  const diff = dldPrice - sfPrice;
  const pct  = sfPrice !== 0 ? (diff / sfPrice) * 100 : null;
  let direction = 'flat';
  if (pct != null && Math.abs(pct) >= 0.01) {
    direction = diff > 0 ? 'up' : 'down';
  }
  return { diff, pct, direction };
}

// Classify the area difference between DLD and the manually-recorded SF area.
// Returns { kind, diff, pct } where:
//   kind = 'none'  — insufficient data or difference below noise floor (< 0.5%)
//   kind = 'flag'  — difference is meaningful but below the per-project threshold
//   kind = 'hard'  — difference meets or exceeds the per-project threshold (AREA_MISMATCH)
// diff = dldArea - manualArea (sq m), pct = (diff / manualArea) * 100
function computeAreaSignal(dldArea, manualArea, thresholdPct) {
  if (dldArea == null || manualArea == null) return { kind: 'none', diff: null, pct: null };
  if (!(dldArea > 0) || !(manualArea > 0))   return { kind: 'none', diff: null, pct: null };
  const diff = dldArea - manualArea;
  const pct  = (diff / manualArea) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.5)          return { kind: 'none', diff, pct };
  if (absPct < thresholdPct) return { kind: 'flag', diff, pct };
  return { kind: 'hard', diff, pct };
}

function shortAed(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (Math.round(abs / 1e5) / 10) + 'M';
  if (abs >= 1e3) return Math.round(abs / 1e3) + 'k';
  return Math.round(abs).toString();
}

function priceTag(delta) {
  const sign = delta.direction === 'up' ? '+' : '-';
  const pct  = Math.abs(delta.pct).toFixed(2);
  const aed  = shortAed(delta.diff);
  return `${sign}${pct}% (${sign}${aed})`;
}

function classifyMatch(dldUnit, dldTxs, sfRow, overrideBuyer) {
  if (!sfRow) return {
    status: 'DLD_ONLY',
    reasons: ['no SF'],
    priceDelta: { diff: null, pct: null, direction: null },
    nameState: 'none',
    usedOverride: false,
    matchedApplicantField: null
  };

  const purchase    = pickLatestPurchase(dldTxs);
  const marketPrice = pickLatestMarketPrice(dldTxs);
  const dldPrice    = marketPrice ? marketPrice.amount_aed : null;
  const sfPrice     = sfRow.purchase_price;
  const delta       = computePriceDelta(dldPrice, sfPrice);

  const haveSfName  = !!sfRow.applicant_name;
  const naturalBuyer = purchase && purchase.party_name && !BANK_PREFIX_RE.test(purchase.party_name) ? purchase.party_name : null;
  const dldBuyer = naturalBuyer || overrideBuyer || null;
  const usedOverride = !naturalBuyer && !!overrideBuyer;

  let nameState, matchedApplicantField = null;
  if (!dldBuyer || !haveSfName) {
    nameState = 'unknown';
  } else {
    matchedApplicantField = findMatchingApplicant(dldBuyer, sfRow);
    nameState = matchedApplicantField ? 'match' : 'mismatch';
  }

  const priceMeaningful = delta.pct != null && Math.abs(delta.pct) > 1;
  const reasons = [];

  if (nameState === 'mismatch') {
    if (priceMeaningful) reasons.push('buyer ' + priceTag(delta));
    else                 reasons.push('buyer');
    if (usedOverride) reasons.push('override');
    return { status: 'BUYER_MISMATCH', reasons, priceDelta: delta, nameState, usedOverride, matchedApplicantField: null };
  }

  if (priceMeaningful) {
    reasons.push(priceTag(delta));
    if (usedOverride) reasons.push('override');
    const status = delta.direction === 'up' ? 'PRICE_UP' : 'PRICE_DOWN';
    return { status, reasons, priceDelta: delta, nameState, usedOverride, matchedApplicantField };
  }

  if (usedOverride) return { status: 'MATCH', reasons: ['override'], priceDelta: delta, nameState, usedOverride, matchedApplicantField };
  return { status: 'MATCH', reasons: [], priceDelta: delta, nameState, usedOverride, matchedApplicantField };
}

function compareProject(db, projectId, cachedConfig) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id=?').get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const mappingRow   = db.prepare('SELECT * FROM project_mapping WHERE project_id=?').get(projectId) || {};
  const scope        = mappingRow.match_scope    || 'sub_project';
  const sfSubProject = mappingRow.sf_sub_project || project.sf_sub_project;
  const sfProject    = mappingRow.sf_project     || null;
  const sfPrefix     = mappingRow.sf_unit_prefix != null ? mappingRow.sf_unit_prefix : project.sf_unit_prefix;

  const overridesData = cachedConfig
    ? (cachedConfig.overrides || {})
    : (function () {
        try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'project-mapping.json'), 'utf8')).overrides || {}; }
        catch (_) { return {}; }
      })();
  const ov = overridesData[project.project_name] || {};
  const transforms          = Array.isArray(ov.unitTransforms) ? ov.unitTransforms : [];
  const buildingTransforms  = ov.buildingTransforms || null;
  const hasBuildingTransforms = !!buildingTransforms && Object.keys(buildingTransforms).length > 0;
  const hasUnitTransforms     = transforms.length > 0;

  if (sfPrefix == null && !hasBuildingTransforms && !hasUnitTransforms) {
    return { project, status: 'no-mapping', rows: [] };
  }
  if (scope === 'sub_project' && !sfSubProject) return { project, status: 'no-mapping', rows: [] };
  if (scope === 'project'     && !sfProject)    return { project, status: 'no-mapping', rows: [] };

  const dldSnap = getLatestSnapshotForProject(db, projectId);
  if (!dldSnap) return { project, status: 'no-dld-snapshot', rows: [] };
  const sfSnap  = getLatestSfSnapshot(db);
  if (!sfSnap)  return { project, status: 'no-sf-snapshot', rows: [] };

  const dldUnits = getUnitsForSnapshot(db, dldSnap.snapshot_id);
  let sfBookings;
  if (scope === 'project') {
    sfBookings = db.prepare(`SELECT * FROM sf_booking WHERE sf_snapshot_id=? AND project=?`)
      .all(sfSnap.sf_snapshot_id, sfProject);
  } else {
    sfBookings = getSfBookingsForSub(db, sfSnap.sf_snapshot_id, sfSubProject);
  }
  const sfByUnit = new Map();
  for (const b of sfBookings) {
    if (b.unit_norm) sfByUnit.set(b.unit_norm, b);
  }

  const landShare = dldUnits.length
    ? dldUnits.filter(u => (u.unit_type === 'Land' || u.building_name === 'Land')).length / dldUnits.length
    : 0;
  const bareMapping = (sfPrefix === '' && !hasUnitTransforms && !hasBuildingTransforms);
  const isPlotProject = landShare >= 0.3 || (bareMapping && landShare >= 0.05);

  const sfByBuyer = new Map();
  if (isPlotProject) {
    const addTokens = (key, b) => {
      if (!key) return;
      for (const tok of new Set(key.split(' ').filter(w => w.length > 2))) {
        if (!sfByBuyer.has(tok)) sfByBuyer.set(tok, []);
        sfByBuyer.get(tok).push(b);
      }
    };
    for (const b of sfBookings) {
      addTokens(plotNormalizeName(b.applicant_name), b);
      if (b.applicant_2_name)  addTokens(plotNormalizeName(b.applicant_2_name),  b);
      if (b.applicant_3_name)  addTokens(plotNormalizeName(b.applicant_3_name),  b);
      if (b.applicant_4_name)  addTokens(plotNormalizeName(b.applicant_4_name),  b);
      if (b.applicant_details) addTokens(plotNormalizeName(b.applicant_details), b);
    }
  }

  function findSfByBuyerPrice(buyer, dldPrice, alreadyMatchedSet) {
    if (!buyer) return null;
    const key = plotNormalizeName(buyer);
    if (!key) return null;
    const keyTokens = key.split(' ').filter(w => w.length > 2 && !GENERIC_COMMERCIAL_TOKENS.has(w));
    if (keyTokens.length === 0) return null;
    const candidates = new Map();
    for (const tok of new Set(keyTokens)) {
      const list = sfByBuyer.get(tok) || [];
      for (const b of list) candidates.set(b.sf_booking_id, b);
    }
    if (candidates.size === 0) return null;
    let best = null, bestScore = -Infinity;
    for (const b of candidates.values()) {
      if (alreadyMatchedSet.has(b.unit_norm)) continue;
      const sfKeys = [
        plotNormalizeName(b.applicant_name),
        b.applicant_2_name  ? plotNormalizeName(b.applicant_2_name)  : null,
        b.applicant_3_name  ? plotNormalizeName(b.applicant_3_name)  : null,
        b.applicant_4_name  ? plotNormalizeName(b.applicant_4_name)  : null,
        b.applicant_details ? plotNormalizeName(b.applicant_details) : null
      ].filter(Boolean);
      let bestJac = 0, matched = false;
      for (const sfKey of sfKeys) {
        const jac = plotTokenJaccard(key, sfKey);
        if (jac >= 0.5 || key === sfKey) { matched = true; if (jac > bestJac) bestJac = jac; }
      }
      if (!matched) continue;
      const priceDiff = (dldPrice != null && b.purchase_price)
        ? Math.abs((b.purchase_price - dldPrice) / b.purchase_price) : 1;
      if (priceDiff > 0.05) continue;
      const score = bestJac * 2 + (1 - Math.min(priceDiff, 1));
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  const overrideMap = getOverridesMapForProject(db, projectId);
  const rows = [];
  const matchedSfUnits = new Set();

  for (const u of dldUnits) {
    const expected = expectedSfUnit(u.unit_number_norm, {
      sf_unit_prefix:    sfPrefix,
      unitTransforms:    transforms,
      buildingTransforms: buildingTransforms
    }, u.building_name);
    let sfRow = expected ? sfByUnit.get(expected) : null;
    const dldTxs = getTxForUnit(db, u.unit_id);
    const purchase = pickLatestPurchase(dldTxs) || dldTxs[dldTxs.length - 1] || {};
    const latestTx = dldTxs[dldTxs.length - 1] || {};

    let matchedViaBuyer = false;
    if (!sfRow && isPlotProject) {
      const realBuyer = purchase && purchase.party_name && !BANK_PREFIX_RE.test(purchase.party_name)
        ? purchase.party_name
        : findLatestNonBankParty(dldTxs);
      if (realBuyer) {
        const marketPrice = pickLatestMarketPrice(dldTxs);
        const fb = findSfByBuyerPrice(realBuyer, marketPrice ? marketPrice.amount_aed : null, matchedSfUnits);
        if (fb) { sfRow = fb; matchedViaBuyer = true; }
      }
    }

    const overrideBuyer = overrideMap.get(u.unit_number_norm) || null;
    const cls = classifyMatch(u, dldTxs, sfRow, overrideBuyer);
    if (matchedViaBuyer) cls.reasons = (cls.reasons || []).concat(['plot match']);
    if (sfRow) matchedSfUnits.add(sfRow.unit_norm);

    // A10: matched via a co-applicant slot (non-primary). Only fires when nameState === 'match'.
    let auditFlags = [];
    if (cls.matchedApplicantField && cls.matchedApplicantField !== 'applicant_name') {
      auditFlags.push('A10');
      cls.reasons = (cls.reasons || []).concat(['co-applicant:' + cls.matchedApplicantField]);
    }

    rows.push({
      dld_project:              project.project_name,
      sf_sub_project:           sfSubProject || sfProject || '(' + scope + ')',
      dld_unit_number:          u.unit_number,
      expected_sf_unit:         expected,
      sf_unit:                  sfRow?.unit || null,
      dld_unit_id:              u.dld_unit_id,
      dld_unit_type:            u.unit_type,
      dld_building:             u.building_name,
      dld_net_area:             u.net_area,
      dld_tx_count:             dldTxs.length,
      dld_purchase_type:        purchase.tx_type || null,
      dld_purchase_date:        purchase.tx_date || null,
      dld_purchase_date_iso:    purchase.tx_date_iso || null,
      dld_purchase_amount:      purchase.amount_aed || null,
      dld_purchase_party:       purchase.party_name || null,
      price_diff_aed:           cls.priceDelta.diff != null ? Math.round(cls.priceDelta.diff) : null,
      price_diff_pct:           cls.priceDelta.pct != null ? +cls.priceDelta.pct.toFixed(2) : null,
      price_direction:          cls.priceDelta.direction,
      dld_last_tx_type:         latestTx.tx_type || null,
      dld_last_tx_date:         latestTx.tx_date || null,
      dld_last_amount_aed:      latestTx.amount_aed || null,
      dld_last_party:           latestTx.party_name || null,
      sf_applicant:             sfRow?.applicant_name || null,
      sf_purchase_price:        sfRow?.purchase_price || null,
      sf_dld_amount:            sfRow?.dld_amount || null,
      sf_status:                sfRow?.status || null,
      sf_pre_reg_status:        sfRow?.pre_reg_status || null,
      sf_procedure_number:      sfRow?.procedure_number || null,
      sf_booking_name:          sfRow?.booking_name || null,
      match_status:             cls.status,
      match_reasons:            (cls.reasons || []).join('; '),
      audit_flags:              auditFlags.join('|'),
      matched_applicant_field:  cls.matchedApplicantField || null
    });
  }

  for (const b of sfBookings) {
    if (!matchedSfUnits.has(b.unit_norm)) {
      rows.push({
        dld_project:         project.project_name,
        sf_sub_project:      sfSubProject || sfProject || '(' + scope + ')',
        dld_unit_number:     null,
        expected_sf_unit:    b.unit_norm,
        sf_unit:             b.unit,
        dld_unit_id:         null,
        dld_unit_type:       null,
        dld_building:        null,
        dld_net_area:        null,
        dld_tx_count:        0,
        dld_purchase_type:   null,
        dld_purchase_date:   null,
        dld_purchase_amount: null,
        dld_purchase_party:  null,
        price_diff_aed:      null,
        price_diff_pct:      null,
        price_direction:     null,
        dld_last_tx_type:    null,
        dld_last_tx_date:    null,
        dld_last_amount_aed: null,
        dld_last_party:      null,
        sf_applicant:        b.applicant_name,
        sf_purchase_price:   b.purchase_price,
        sf_dld_amount:       b.dld_amount,
        sf_status:           b.status,
        sf_pre_reg_status:   b.pre_reg_status,
        sf_procedure_number: b.procedure_number,
        sf_booking_name:     b.booking_name,
        match_status:            'SF_ONLY',
        match_reasons:           'no DLD',
        audit_flags:             '',
        matched_applicant_field: null
      });
    }
  }

  // Sort rows by status priority, then numeric unit number within each group
  const STATUS_PRIORITY = {
    BUYER_MISMATCH: 0,
    DLD_ONLY:       1,
    SF_ONLY:        2,
    PRICE_DOWN:     3,
    PRICE_UP:       4,
    MATCH:          5
  };
  rows.sort((a, b) => {
    const pd = (STATUS_PRIORITY[a.match_status] ?? 9) - (STATUS_PRIORITY[b.match_status] ?? 9);
    if (pd !== 0) return pd;
    return (a.dld_unit_number || '').localeCompare(b.dld_unit_number || '', undefined, { numeric: true });
  });

  return { project, status: 'ok', rows, dldSnapshotId: dldSnap.snapshot_id, sfSnapshotId: sfSnap.sf_snapshot_id };
}

const STATUS_ORDER = ['MATCH', 'PRICE_UP', 'PRICE_DOWN', 'BUYER_MISMATCH', 'DLD_ONLY', 'SF_ONLY'];

function summarize(rows) {
  const counts = {};
  for (const s of STATUS_ORDER) counts[s] = 0;
  for (const r of rows) counts[r.match_status] = (counts[r.match_status] || 0) + 1;
  return counts;
}

function writeCompareCsv(outPath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(outPath, '', 'utf8');
    return;
  }
  const header = Object.keys(rows[0]);
  writeCsv(outPath, header, rows);
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null) return '';
  return Math.round(v).toLocaleString();
}

function fmtPct(v) {
  if (v == null) return '';
  const sign = v > 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

function writeCompareHtml(outPath, project, rows, counts) {
  const total = rows.length;
  const pct   = n => total ? ((n * 100) / total).toFixed(1) + '%' : '0%';
  const statusClass = {
    MATCH:          'ok',
    PRICE_UP:       'up',
    PRICE_DOWN:     'down',
    BUYER_MISMATCH: 'warn',
    DLD_ONLY:       'dld',
    SF_ONLY:        'sf'
  };
  const statusLabel = {
    MATCH:          'MATCH',
    PRICE_UP:       'PRICE ↑',
    PRICE_DOWN:     'PRICE ↓',
    BUYER_MISMATCH: 'BUYER MISMATCH',
    DLD_ONLY:       'DLD-only',
    SF_ONLY:        'SF-only'
  };

  const columns = [
    { key: 'dld_unit_number',     label: 'DLD Unit',        align: 'left'  },
    { key: 'expected_sf_unit',    label: 'Expected SF Unit', align: 'left' },
    { key: 'sf_unit',             label: 'SF Unit (actual)', align: 'left' },
    { key: 'dld_unit_type',       label: 'Type',             align: 'left' },
    { key: 'dld_net_area',        label: 'SQM',              align: 'num'  },
    { key: 'dld_purchase_type',   label: 'DLD Tx',           align: 'left' },
    { key: 'dld_purchase_date',   label: 'DLD Date',         align: 'left' },
    { key: 'days_outstanding',    label: 'Days',             align: 'num'  },
    { key: 'dld_purchase_amount', label: 'DLD Price',        align: 'num'  },
    { key: 'dld_purchase_party',  label: 'DLD Buyer',        align: 'left' },
    { key: 'sf_applicant',        label: 'SF Applicant',     align: 'left' },
    { key: 'sf_purchase_price',   label: 'SF Price',         align: 'num'  },
    { key: 'price_diff_pct',      label: 'Δ %',              align: 'num'  },
    { key: 'price_diff_aed',      label: 'Δ AED',            align: 'num'  },
    { key: 'sf_status',           label: 'SF Status',        align: 'left' },
    { key: 'match_status',        label: 'Match',            align: 'left' },
    { key: 'match_reasons',       label: 'Reason',           align: 'left' }
  ];

  // Pre-compute days_outstanding for each row (non-MATCH rows only)
  const nowMs = Date.now();
  for (const r of rows) {
    if (r.match_status !== 'MATCH' && r.dld_purchase_date_iso) {
      const ms = new Date(r.dld_purchase_date_iso).getTime();
      r.days_outstanding = isNaN(ms) ? null : Math.floor((nowMs - ms) / 86400000);
    } else {
      r.days_outstanding = null;
    }
  }

  const renderCell = (col, r) => {
    const raw = r[col.key];
    let html  = escHtml(raw);
    let sortVal = raw == null ? '' : String(raw);
    const cls  = [];
    if (col.align === 'num') cls.push('num');

    if (col.key === 'dld_purchase_amount' || col.key === 'sf_purchase_price') {
      html = raw == null ? '' : fmtMoney(raw);
      sortVal = raw == null ? '-Infinity' : String(raw);
    } else if (col.key === 'price_diff_pct') {
      sortVal = raw == null ? '-999999' : String(raw);
      if (raw == null || Math.abs(raw) < 0.01) { html = ''; cls.push('flat'); }
      else {
        html = fmtPct(raw);
        cls.push(raw > 0 ? 'up' : 'down');
      }
    } else if (col.key === 'price_diff_aed') {
      sortVal = raw == null ? '-Infinity' : String(raw);
      if (raw == null || Math.abs(raw) < 1) { html = ''; }
      else {
        const sign = raw > 0 ? '+' : '-';
        html = sign + fmtMoney(Math.abs(raw));
        cls.push(raw > 0 ? 'up' : 'down');
      }
    } else if (col.key === 'match_status') {
      html = `<span class="badge ${statusClass[raw] || ''}">${escHtml(statusLabel[raw] || raw)}</span>`;
    } else if (col.key === 'dld_purchase_date') {
      if (raw) {
        const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        sortVal = m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : String(raw);
      }
    } else if (col.key === 'days_outstanding') {
      // Numeric days since DLD purchase; blank for MATCH rows
      sortVal = raw == null ? '99999' : String(raw);
      if (raw == null) { html = ''; }
      else {
        html = String(raw);
        // Colour-code: red >180d, amber >90d, else normal
        if (raw > 180) cls.push('down');
        else if (raw > 90) cls.push('warn-days');
      }
    } else if (col.key === 'dld_net_area') {
      // SQM — display with up to 2 decimals, trim trailing zeros
      sortVal = raw == null ? '-1' : String(raw);
      if (raw == null) { html = ''; }
      else {
        const n = +raw;
        html = isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '';
      }
    }
    return `<td class="${cls.join(' ')}" data-sort-val="${escHtml(sortVal)}">${html}</td>`;
  };

  const renderRow = r => {
    const searchText = columns.map(c => r[c.key] == null ? '' : String(r[c.key])).join(' ').toLowerCase();
    return `<tr class="${statusClass[r.match_status] || ''}" data-status="${escHtml(r.match_status)}" data-search="${escHtml(searchText)}">` +
      columns.map(c => renderCell(c, r)).join('') +
      '</tr>';
  };

  const headHtml = columns
    .map((c, i) => `<th data-col="${i}" data-align="${c.align}">${escHtml(c.label)}</th>`)
    .join('');

  const bodyHtml = rows.map(renderRow).join('\n');

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escHtml(project.project_name)} — DLD vs SF · Sobha Realty</title>
<style>${SOBHA_STYLE_CSS}</style>
</head>
<body>
${brandBar(generatedAt)}
<div class="page">
<div class="title-row"><h1>${escHtml(project.project_name)}</h1></div>
<div class="meta">
  Salesforce sub-project: <b>${escHtml(project.sf_sub_project || '-')}</b>
  <span class="sep">·</span> Unit prefix: <b>${escHtml(project.sf_unit_prefix ? project.sf_unit_prefix + '-' : '-')}</b>
  <span class="sep">·</span> <b>${total.toLocaleString()}</b> units compared
</div>
<div class="controls">
  <input class="search" id="q" placeholder="Filter: unit, buyer, status, any text…" autocomplete="off">
  <span class="chip ok off" data-status="MATCH">MATCH ${counts.MATCH || 0} (${pct(counts.MATCH || 0)})</span>
  <span class="chip up"   data-status="PRICE_UP">PRICE ↑ ${counts.PRICE_UP || 0} (${pct(counts.PRICE_UP || 0)})</span>
  <span class="chip down" data-status="PRICE_DOWN">PRICE ↓ ${counts.PRICE_DOWN || 0} (${pct(counts.PRICE_DOWN || 0)})</span>
  <span class="chip warn" data-status="BUYER_MISMATCH">BUYER ${counts.BUYER_MISMATCH || 0} (${pct(counts.BUYER_MISMATCH || 0)})</span>
  <span class="chip dld"  data-status="DLD_ONLY">DLD-only ${counts.DLD_ONLY || 0} (${pct(counts.DLD_ONLY || 0)})</span>
  <span class="chip sf"   data-status="SF_ONLY">SF-only ${counts.SF_ONLY || 0} (${pct(counts.SF_ONLY || 0)})</span>
  <button class="btn-reset" id="reset">Reset</button>
  <span class="count" id="count">— rows</span>
</div>
<div class="table-wrap"><div class="table-scroll">
<table id="tbl">
<thead><tr>${headHtml}</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div></div>
<footer>generated ${escHtml(generatedAt)} · click column headers to sort · click status chips to toggle · Δ% = (DLD − SF) / SF<span class="sig">Sobha Realty · Registration / DLD</span></footer>
</div>
<script>
(function(){
  const tbl     = document.getElementById('tbl');
  const tbody   = tbl.querySelector('tbody');
  const q       = document.getElementById('q');
  const chips   = [...document.querySelectorAll('.chip')];
  const headers = [...tbl.querySelectorAll('thead th')];
  const countEl = document.getElementById('count');
  const reset   = document.getElementById('reset');
  const rows    = [...tbody.querySelectorAll('tr')];
  // MATCH is off by default — registrars want to see issues first
  const active  = new Set(chips.filter(c => !c.classList.contains('off')).map(c => c.dataset.status));
  let sortCol = null, sortDir = 1;

  function applyFilter(){
    const needle = q.value.trim().toLowerCase();
    let visible = 0;
    for (const tr of rows) {
      const statusOn = active.has(tr.dataset.status);
      const searchOn = !needle || tr.dataset.search.indexOf(needle) !== -1;
      const show = statusOn && searchOn;
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    }
    countEl.innerHTML = '<b>' + visible.toLocaleString() + '</b> / ' + rows.length.toLocaleString() + ' rows';
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const s = chip.dataset.status;
      if (active.has(s)) { active.delete(s); chip.classList.add('off'); }
      else               { active.add(s);    chip.classList.remove('off'); }
      applyFilter();
    });
  });

  q.addEventListener('input', applyFilter);

  reset.addEventListener('click', () => {
    q.value = '';
    for (const c of chips) { active.add(c.dataset.status); c.classList.remove('off'); }
    sortCol = null; sortDir = 1;
    headers.forEach(h => h.classList.remove('sort-asc','sort-desc'));
    for (const r of rows) tbody.appendChild(r); /* restore original order */
    applyFilter();
  });

  headers.forEach((th, i) => {
    th.addEventListener('click', () => {
      if (sortCol === i) sortDir = -sortDir;
      else { sortCol = i; sortDir = 1; }
      headers.forEach(h => h.classList.remove('sort-asc','sort-desc'));
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
      const sorted = rows.slice().sort((a, b) => {
        const av = a.children[i].dataset.sortVal || a.children[i].textContent;
        const bv = b.children[i].dataset.sortVal || b.children[i].textContent;
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn) && isFinite(an) && isFinite(bn)) return (an - bn) * sortDir;
        return av.localeCompare(bv, undefined, {numeric:true}) * sortDir;
      });
      for (const r of sorted) tbody.appendChild(r);
    });
  });

  applyFilter();
})();
</script>
</body>
</html>`;
  fs.writeFileSync(outPath, html, 'utf8');
}

function writeAuditTasks(outPath, project, rows) {
  const tasks = [];
  let n = 1;
  for (const r of rows) {
    if (r.match_status === 'MATCH') continue;
    let action, priority;
    switch (r.match_status) {
      case 'PRICE_UP':
        priority = 'low';
        action = `Update SF price for ${r.expected_sf_unit}: ${r.match_reasons} (buyer OK, resale at higher price)`;
        break;
      case 'PRICE_DOWN':
        priority = 'medium';
        action = `Investigate price drop for ${r.expected_sf_unit}: ${r.match_reasons}`;
        break;
      case 'BUYER_MISMATCH':
        priority = 'high';
        action = `Reconcile ${r.expected_sf_unit}: ${r.match_reasons}`;
        break;
      case 'DLD_ONLY':
        priority = 'high';
        action = `Add SF booking for ${r.expected_sf_unit} (DLD unit ${r.dld_unit_number}, ${r.dld_purchase_type || r.dld_last_tx_type}, ${r.dld_purchase_amount || r.dld_last_amount_aed} AED)`;
        break;
      case 'SF_ONLY':
        priority = 'high';
        action = `Verify SF booking ${r.sf_booking_name} / unit ${r.sf_unit} — not found in DLD snapshot`;
        break;
      default:
        priority = 'medium';
        action = `Review ${r.expected_sf_unit}: ${r.match_reasons}`;
    }
    tasks.push({
      n: n++,
      priority,
      project: project.project_name,
      unit: r.expected_sf_unit || r.sf_unit,
      status: r.match_status,
      action
    });
  }
  const priOrder = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => priOrder[a.priority] - priOrder[b.priority]);
  tasks.forEach((t, i) => t.n = i + 1);
  const header = ['n', 'priority', 'project', 'unit', 'status', 'action'];
  writeCsv(outPath, header, tasks);
  return tasks;
}

module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap, findMatchingApplicant, SF_APPLICANT_FIELDS, computeAreaSignal };
