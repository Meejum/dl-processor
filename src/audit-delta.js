const fs = require('fs');
const path = require('path');
const { compareProject } = require('./compare');

const CATEGORY_LABEL = {
  AGREE_MATCH:    'Agree · match',
  AGREE_MISMATCH: 'Agree · mismatch',
  TOOL_SOLVED:    'Tool solved',
  TOOL_STRICTER:  'Tool flagged',
  MANUAL_ONLY:    'Manual only',
  DL_ONLY:        'Tool only',
  MANUAL_BLANK:   'Auditor blank'
};

const CATEGORY_CLASS = {
  AGREE_MATCH:    'ok',
  AGREE_MISMATCH: 'warn',
  TOOL_SOLVED:    'up',
  TOOL_STRICTER:  'down',
  MANUAL_ONLY:    'sf',
  DL_ONLY:        'dld',
  MANUAL_BLANK:   'flat'
};

function categorize(m, t) {
  if (m && !t) return 'MANUAL_ONLY';
  if (!m && t) return 'DL_ONLY';
  if (!m && !t) return 'MANUAL_BLANK';
  const manBlank = m.name_match == null && m.price_match == null;
  if (manBlank) return 'MANUAL_BLANK';
  const manYes = m.name_match === 1 && m.price_match === 1;
  const manNo  = m.name_match === 0 || m.price_match === 0;
  const toolMatch = t.match_status === 'MATCH';
  if (manYes && toolMatch)  return 'AGREE_MATCH';
  if (manNo  && !toolMatch) return 'AGREE_MISMATCH';
  if (manNo  && toolMatch)  return 'TOOL_SOLVED';
  if (manYes && !toolMatch) return 'TOOL_STRICTER';
  return 'AGREE_MATCH';
}

function up(s) { return s == null ? '' : String(s).toUpperCase().trim(); }

function makeDeltaRow(m, t) {
  return {
    unit_number_norm: (t && t.unit_number_norm) || (m && m.unit_number_norm) || null,
    sf_unit:          (m && m.sf_unit) || (t && t.sf_unit) || (t && t.expected_sf_unit) || null,
    dld_unit:         (t && t.dld_unit_number) || (m && m.dld_unit) || null,
    m_name_match:     m ? m.name_match  : null,
    m_price_match:    m ? m.price_match : null,
    m_sf_applicant:   m ? m.sf_applicant : null,
    m_sf_price:       m ? m.sf_price : null,
    m_details:        m ? m.details : null,
    m_procedure:      m ? m.procedure_type : null,
    m_booking_name:   m ? m.sf_booking_name : null,
    t_match_status:   t ? t.match_status : null,
    t_match_reasons:  t ? t.match_reasons : null,
    t_dld_buyer:      t ? t.dld_purchase_party : null,
    t_sf_applicant:   t ? t.sf_applicant : null,
    t_dld_price:      t ? t.dld_purchase_amount : null,
    t_sf_price:       t ? t.sf_purchase_price : null,
    t_price_diff_pct: t ? t.price_diff_pct : null,
    delta_category:   categorize(m, t)
  };
}

function buildProjectDelta(db, projectId, manualSnapshotId) {
  const toolResult = compareProject(db, projectId);
  if (toolResult.status !== 'ok') return { status: toolResult.status, rows: [] };

  const manualRows = db.prepare(`
    SELECT r.*
    FROM manual_audit_row r
    JOIN manual_audit_project p ON p.manual_audit_project_id = r.manual_audit_project_id
    WHERE p.manual_audit_snapshot_id = ? AND p.project_id = ?
  `).all(manualSnapshotId, projectId);

  const manualIdx = new Map();
  const addKey = (k, m) => { if (k && !manualIdx.has(k)) manualIdx.set(k, m); };
  for (const m of manualRows) {
    addKey(up(m.unit_number_norm), m);
    addKey(up(m.sf_unit), m);
    addKey(up(m.dld_unit), m);
  }

  const rows = [];
  const usedManual = new Set();

  for (const t of toolResult.rows) {
    const candidates = [
      up(t.unit_number_norm),
      up(t.expected_sf_unit),
      up(t.sf_unit),
      up(t.dld_unit_number)
    ].filter(Boolean);
    let m = null;
    for (const k of candidates) {
      const hit = manualIdx.get(k);
      if (hit) { m = hit; break; }
    }
    if (m) usedManual.add(m);
    rows.push(makeDeltaRow(m, t));
  }

  for (const m of manualRows) {
    if (!usedManual.has(m)) rows.push(makeDeltaRow(m, null));
  }

  return { status: 'ok', rows };
}

function summarize(rows) {
  const c = { AGREE_MATCH: 0, AGREE_MISMATCH: 0, TOOL_SOLVED: 0, TOOL_STRICTER: 0, MANUAL_ONLY: 0, DL_ONLY: 0, MANUAL_BLANK: 0 };
  for (const r of rows) c[r.delta_category] = (c[r.delta_category] || 0) + 1;
  return c;
}

module.exports = {
  categorize, buildProjectDelta, summarize, makeDeltaRow,
  CATEGORY_LABEL, CATEGORY_CLASS
};
