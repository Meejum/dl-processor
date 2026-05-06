const { getMasterRow, upsertMasterField, seedMasterFromDld, FIELD_TO_COLUMNS } = require('./master-data');
const { BANK_PREFIX_RE } = require('./common');

const TRACKED_FIELDS = ['buyer_name', 'purchase_price_aed', 'status', 'procedure_number', 'area_sqm'];

// Compute the "DLD-current view" of a unit's operational fields from the
// transactions and unit row.
function dldViewForUnit(db, unitId) {
  const unit = db.prepare('SELECT * FROM dld_unit WHERE unit_id = ?').get(unitId);
  if (!unit) return null;
  const txs = db.prepare(
    'SELECT * FROM dld_transaction WHERE unit_id = ? ORDER BY tx_date_iso DESC, tx_id DESC'
  ).all(unitId);
  // Buyer = primary non-bank, non-empty party from latest Sell-type transaction.
  const SELL_TYPES = new Set(['Sell - Pre registration', 'Sale', 'Delayed Sell', 'Complete Delayed Sell', 'Grant', 'Lease to Own Registration']);
  const sellTxs = txs.filter(t => SELL_TYPES.has(t.tx_type));
  const primarySell = sellTxs.find(t => t.party_name && !BANK_PREFIX_RE.test(t.party_name)) || sellTxs[0] || null;
  const buyerName = primarySell ? primarySell.party_name : null;
  // Price = latest Sell-type tx amount.
  const purchasePrice = primarySell ? primarySell.amount_aed : null;
  // Status = latest tx_type (full string, e.g. "Sell - Pre registration").
  const latest = txs[0] || null;
  const status = latest ? latest.tx_type : null;
  // Procedure number — DLD txs don't carry this column today; leave null.
  // (Field exists in SF; this is a forward-compatible slot.)
  const procedureNumber = null;
  // Area = unit's net_area.
  const areaSqm = unit.net_area;
  return {
    buyer_name: buyerName,
    purchase_price_aed: purchasePrice,
    status: status,
    procedure_number: procedureNumber,
    area_sqm: areaSqm
  };
}

function valuesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Numeric tolerance: 0.01 for both prices and areas (small enough for prices in whole AED).
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.01;
  }
  return String(a) === String(b);
}

function proposalAlreadyRejected(db, projectId, unitNumberNorm, fieldName, proposedValue) {
  const row = db.prepare(
    `SELECT 1 FROM pending_change
     WHERE project_id = ? AND unit_number_norm = ? AND field_name = ?
       AND proposed_value = ? AND decision = 'rejected'
     LIMIT 1`
  ).get(projectId, unitNumberNorm, fieldName, String(proposedValue));
  return !!row;
}

function alreadyHasPendingProposal(db, projectId, unitNumberNorm, fieldName, proposedValue) {
  const row = db.prepare(
    `SELECT 1 FROM pending_change
     WHERE project_id = ? AND unit_number_norm = ? AND field_name = ?
       AND proposed_value = ? AND decision = 'pending'
     LIMIT 1`
  ).get(projectId, unitNumberNorm, fieldName, String(proposedValue));
  return !!row;
}

function queueMasterDiffs(db, snapshotId) {
  const snap = db.prepare('SELECT * FROM dld_snapshot WHERE snapshot_id = ?').get(snapshotId);
  if (!snap) return { queued: 0, seeded: 0 };
  const projectId = snap.project_id;
  const units = db.prepare('SELECT * FROM dld_unit WHERE snapshot_id = ?').all(snapshotId);
  let queued = 0;
  let seeded = 0;
  const work = db.transaction(() => {
    for (const u of units) {
      // Skip units with no normalizable unit number (DLD report summary rows,
      // unparseable plot identifiers, etc.). master_data has a NOT NULL constraint
      // on unit_number_norm so we'd crash on insert. These units have no
      // canonical identity to track at the master-data layer.
      if (!u.unit_number_norm) continue;
      const dldView = dldViewForUnit(db, u.unit_id);
      if (!dldView) continue;
      const master = getMasterRow(db, projectId, u.unit_number_norm);
      if (!master) {
        // Bootstrap: first time seeing this unit.
        seedMasterFromDld(db, projectId, u.unit_number_norm, dldView);
        seeded += 1;
        continue;
      }
      for (const field of TRACKED_FIELDS) {
        const dldValue = dldView[field];
        const masterValue = master[field];
        if (valuesEqual(dldValue, masterValue)) continue;
        if (dldValue == null) continue;  // don't queue "DLD has no value"
        if (masterValue == null) {
          // Per-field bootstrap: master_data row exists for this unit but THIS specific
          // field was never established (typical case: pre-migration manual_override
          // seeded buyer_name only, leaving area/price/status/procedure null). The first
          // observation of a previously-null field gets silently approved as
          // 'dld_approved' rather than queueing a pending row. Rationale: a null master
          // field has no prior canonical to disagree with, so DLD wins by default. This
          // mirrors the unit-level bootstrap path (seedMasterFromDld) at a finer grain.
          // Documented deviation from plan §queueMasterDiffs (which only had the
          // dldValue==null guard); see review feedback I1, 2026-05-06.
          upsertMasterField(db, projectId, u.unit_number_norm, field, dldValue, 'dld_approved');
          continue;
        }
        const proposedStr = String(dldValue);
        if (proposalAlreadyRejected(db, projectId, u.unit_number_norm, field, proposedStr)) continue;
        if (alreadyHasPendingProposal(db, projectId, u.unit_number_norm, field, proposedStr)) continue;
        db.prepare(
          `INSERT INTO pending_change
             (project_id, unit_number_norm, field_name, old_value, proposed_value, source_snapshot_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          projectId,
          u.unit_number_norm,
          field,
          masterValue == null ? null : String(masterValue),
          proposedStr,
          snapshotId
        );
        queued += 1;
      }
    }
  });
  work();
  return { queued, seeded };
}

function listPending(db, projectFilter) {
  let sql = `
    SELECT pc.*, p.project_name
    FROM pending_change pc
    JOIN dld_project p ON p.project_id = pc.project_id
    WHERE pc.decision = 'pending'
  `;
  const params = [];
  if (projectFilter) {
    sql += ' AND p.project_name = ?';
    params.push(projectFilter);
  }
  sql += ' ORDER BY p.project_name, pc.unit_number_norm, pc.field_name';
  return db.prepare(sql).all(...params);
}

function applyDecision(db, changeId, decision, notes) {
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id = ?').get(changeId);
  if (!pc) throw new Error('change_id ' + changeId + ' not found');
  if (pc.decision !== 'pending') throw new Error('change_id ' + changeId + ' already decided: ' + pc.decision);
  if (decision !== 'approve' && decision !== 'reject') {
    throw new Error('decision must be "approve" or "reject", got: ' + decision);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const work = db.transaction(() => {
    if (decision === 'approve') {
      // Coerce proposed_value to the right type before applying.
      let value = pc.proposed_value;
      if (pc.field_name === 'purchase_price_aed' || pc.field_name === 'area_sqm') {
        value = value == null ? null : Number(value);
      }
      upsertMasterField(db, pc.project_id, pc.unit_number_norm, pc.field_name, value, 'dld_approved');
      db.prepare(
        `UPDATE pending_change
         SET decision = 'approved', decided_at = ?, decided_by = 'ali', decision_notes = ?
         WHERE change_id = ?`
      ).run(now, notes || '', changeId);
    } else {
      db.prepare(
        `UPDATE pending_change
         SET decision = 'rejected', decided_at = ?, decided_by = 'ali', decision_notes = ?
         WHERE change_id = ?`
      ).run(now, notes || '', changeId);
    }
  });
  work();
}

module.exports = {
  queueMasterDiffs,
  listPending,
  applyDecision,
  proposalAlreadyRejected,
  dldViewForUnit,
  TRACKED_FIELDS
};
