const fs = require('fs');
const path = require('path');
const { expectedSfUnit, applyUnitTransforms } = require('./project-mapping');
const { getOverridesMapForProject } = require('./overrides');
const { BANK_PREFIX_RE } = require('./common');

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
    usedOverride: false
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

  let nameState;
  if (!dldBuyer || !haveSfName) nameState = 'unknown';
  else nameState = namesOverlap(dldBuyer, sfRow.applicant_name) ? 'match' : 'mismatch';

  const priceMeaningful = delta.pct != null && Math.abs(delta.pct) > 1;
  const reasons = [];

  if (nameState === 'mismatch') {
    if (priceMeaningful) reasons.push('buyer ' + priceTag(delta));
    else                 reasons.push('buyer');
    if (usedOverride) reasons.push('override');
    return { status: 'BUYER_MISMATCH', reasons, priceDelta: delta, nameState, usedOverride };
  }

  if (priceMeaningful) {
    reasons.push(priceTag(delta));
    if (usedOverride) reasons.push('override');
    const status = delta.direction === 'up' ? 'PRICE_UP' : 'PRICE_DOWN';
    return { status, reasons, priceDelta: delta, nameState, usedOverride };
  }

  if (usedOverride) return { status: 'MATCH', reasons: ['override'], priceDelta: delta, nameState, usedOverride };
  return { status: 'MATCH', reasons: [], priceDelta: delta, nameState, usedOverride };
}

function compareProject(db, projectId, cachedConfig) {
  const project = db.prepare('SELECT * FROM dld_project WHERE project_id=?').get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  if (!project.sf_sub_project || !project.sf_unit_prefix) {
    return { project, status: 'no-mapping', rows: [] };
  }

  const dldSnap = getLatestSnapshotForProject(db, projectId);
  if (!dldSnap) return { project, status: 'no-dld-snapshot', rows: [] };
  const sfSnap  = getLatestSfSnapshot(db);
  if (!sfSnap)  return { project, status: 'no-sf-snapshot', rows: [] };

  // Use pre-loaded config if passed in; otherwise load from disk (backwards compat)
  const overrides = cachedConfig
    ? (cachedConfig.overrides || {})
    : (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'project-mapping.json'), 'utf8')).overrides || {});
  const transforms = overrides[project.project_name]?.unitTransforms || [];

  const dldUnits = getUnitsForSnapshot(db, dldSnap.snapshot_id);
  const sfBookings = getSfBookingsForSub(db, sfSnap.sf_snapshot_id, project.sf_sub_project);
  const sfByUnit = new Map();
  for (const b of sfBookings) {
    if (b.unit_norm) sfByUnit.set(b.unit_norm, b);
  }
  const overrideMap = getOverridesMapForProject(db, projectId);

  const rows = [];
  const matchedSfUnits = new Set();

  for (const u of dldUnits) {
    const expected = expectedSfUnit(u.unit_number_norm, {
      sf_unit_prefix: project.sf_unit_prefix,
      unitTransforms: transforms
    });
    const sfRow = expected ? sfByUnit.get(expected) : null;
    const dldTxs = getTxForUnit(db, u.unit_id);
    const purchase = pickLatestPurchase(dldTxs) || dldTxs[dldTxs.length - 1] || {};
    const latestTx = dldTxs[dldTxs.length - 1] || {};
    const overrideBuyer = overrideMap.get(u.unit_number_norm) || null;
    const cls = classifyMatch(u, dldTxs, sfRow, overrideBuyer);
    if (sfRow) matchedSfUnits.add(sfRow.unit_norm);

    rows.push({
      dld_project:              project.project_name,
      sf_sub_project:           project.sf_sub_project,
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
      match_reasons:            cls.reasons.join('; ')
    });
  }

  for (const b of sfBookings) {
    if (!matchedSfUnits.has(b.unit_norm)) {
      rows.push({
        dld_project:         project.project_name,
        sf_sub_project:      project.sf_sub_project,
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
        match_status:        'SF_ONLY',
        match_reasons:       'no DLD'
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
<title>${escHtml(project.project_name)} — DLD vs SF</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:20px 24px;background:#0b0f14;color:#e6e6e6}
  h1{margin:0 0 4px;color:#fff;font-size:22px;letter-spacing:.3px}
  .meta{color:#888;margin-bottom:14px;font-size:12px}
  .meta b{color:#ccc}
  .controls{display:flex;gap:10px;margin:12px 0 14px;align-items:center;flex-wrap:wrap}
  .search{background:#0f141b;color:#fff;border:1px solid #222;padding:8px 12px;border-radius:6px;min-width:320px;font:inherit;outline:none}
  .search:focus{border-color:#3ea1ff;box-shadow:0 0 0 2px rgba(62,161,255,.18)}
  .chip{padding:6px 12px;border-radius:20px;font-weight:600;cursor:pointer;border:2px solid transparent;transition:filter .15s,opacity .15s;user-select:none;font-size:12px}
  .chip:hover{filter:brightness(1.25)}
  .chip.off{opacity:.28;filter:grayscale(.4)}
  .chip.ok{background:#0d3a1d;color:#4ce38e}
  .chip.up{background:#0f3a2f;color:#5cf0aa}
  .chip.down{background:#3a0f1a;color:#ff7fa6}
  .chip.warn{background:#3a2a0d;color:#ffcc55}
  .chip.dld{background:#0d2d3a;color:#5ad4ff}
  .chip.sf{background:#2d0d3a;color:#d88eff}
  .count{color:#888;margin-left:auto;font-variant-numeric:tabular-nums;font-size:12px}
  .count b{color:#fff}
  .btn-reset{background:#11161d;color:#aaa;border:1px solid #222;padding:6px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:12px}
  .btn-reset:hover{color:#fff;border-color:#333}
  .table-wrap{overflow-x:auto;border:1px solid #1b2028;border-radius:8px;background:#0d1218}
  table{width:100%;border-collapse:collapse;font-size:12px;min-width:1400px}
  thead th{background:#11161d;color:#aaa;font-weight:600;text-align:left;padding:8px 10px;border-bottom:2px solid #1f252e;cursor:pointer;position:sticky;top:0;user-select:none;white-space:nowrap}
  thead th:hover{color:#fff;background:#151b24}
  thead th.sort-asc::after{content:"  ↑";color:#4ce38e}
  thead th.sort-desc::after{content:"  ↓";color:#ffcc55}
  thead th[data-align="num"]{text-align:right}
  tbody td{padding:6px 10px;border-bottom:1px solid #1a1f27;vertical-align:top;white-space:nowrap}
  tbody td.num{text-align:right;font-variant-numeric:tabular-nums}
  tbody td.up{color:#4ce38e;font-weight:600}
  tbody td.down{color:#ff6b88;font-weight:600}
  tbody td.flat{color:#666}
  tbody td.warn-days{color:#ffcc55;font-weight:600}
  tbody tr.ok td{background:rgba(76,227,142,.04)}
  tbody tr.up td{background:rgba(92,240,170,.06)}
  tbody tr.down td{background:rgba(255,127,166,.06)}
  tbody tr.warn td{background:rgba(255,204,85,.05)}
  tbody tr.dld td{background:rgba(90,212,255,.05)}
  tbody tr.sf td{background:rgba(216,142,255,.05)}
  tbody tr:hover td{background:#151b24 !important}
  tbody tr.hidden{display:none}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .badge.ok{background:#0d3a1d;color:#4ce38e}
  .badge.up{background:#0f3a2f;color:#5cf0aa}
  .badge.down{background:#3a0f1a;color:#ff7fa6}
  .badge.warn{background:#3a2a0d;color:#ffcc55}
  .badge.dld{background:#0d2d3a;color:#5ad4ff}
  .badge.sf{background:#2d0d3a;color:#d88eff}
  .empty{color:#666;padding:24px;text-align:center}
  footer{margin-top:14px;color:#555;font-size:11px;text-align:right}
  code{background:#11161d;color:#bcd;padding:1px 5px;border-radius:3px;font-size:11px}
</style>
</head>
<body>
<h1>${escHtml(project.project_name)}</h1>
<div class="meta">
  Salesforce sub-project: <b>${escHtml(project.sf_sub_project || '-')}</b>
  &nbsp;·&nbsp; Unit prefix: <b>${escHtml(project.sf_unit_prefix || '-')}-</b>
  &nbsp;·&nbsp; ${total.toLocaleString()} units compared
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
<div class="table-wrap">
<table id="tbl">
<thead><tr>${headHtml}</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div>
<footer>generated ${escHtml(generatedAt)} · click column headers to sort · click status chips to toggle · Δ% = (DLD − SF) / SF</footer>
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

module.exports = { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks, namesOverlap };
