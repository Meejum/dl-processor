const crypto = require('node:crypto');
const { writeAuditLog, auditSourceFor } = require('../audit-log');
const { upsertMasterField, FIELD_TO_COLUMNS } = require('../master-data');
const { isTier2 } = require('../tier2');

const CHUNK_SIZE = 50;

// Internal: process a single pending_change row inside an already-open
// transaction. Throws on any failure so the surrounding transaction rolls
// back the whole chunk. Returns true if the row was actually decided here,
// false if it was already decided or missing (so the caller can count it
// as "failed" instead of throwing).
function processOne(db, rowId, action, batchId, justification) {
  const row = db.prepare('SELECT * FROM pending_change WHERE change_id = ?').get(rowId);
  if (!row) return false;
  if (row.decision !== 'pending') return false;

  // Tier-2 check on the fly (pending_change has no tier2 column today).
  // isTier2 only returns true for magnitude-based fields (price, area);
  // buyer/status/procedure are never tier-2.
  const tier2 = isTier2(row.field_name, row.old_value, row.proposed_value);

  // Build user_note: batch=<UUID>, plus justification when supplied
  // (justification is only attached to approve; bulkReject doesn't pass one).
  let userNote = 'batch=' + batchId;
  if (justification) userNote += '; tier2: ' + justification;

  if (action === 'approve') {
    // Mirror applyDecision: write through to master_data with 'dld_approved'
    // provenance, then flip the pending_change decision.
    upsertMasterField(
      db, row.project_id, row.unit_number_norm, row.field_name,
      row.proposed_value, 'dld_approved'
    );
    db.prepare(
      `UPDATE pending_change
         SET decision = 'approved', decided_at = datetime('now'), decided_by = 'bulk'
       WHERE change_id = ?`
    ).run(rowId);
  } else {
    // reject: decision flip only, no master_data write.
    db.prepare(
      `UPDATE pending_change
         SET decision = 'rejected', decided_at = datetime('now'), decided_by = 'bulk'
       WHERE change_id = ?`
    ).run(rowId);
  }

  writeAuditLog(db, {
    projectId: row.project_id,
    unitNumberNorm: row.unit_number_norm,
    tableName: 'master_data',
    field: row.field_name,
    oldValue: row.old_value,
    newValue: action === 'approve' ? row.proposed_value : null,
    action: action,
    source: auditSourceFor.bulk(),
    changeId: rowId,
    userNote: userNote,
    tier2: tier2
  });
  return true;
}

function runBulk(db, rowIds, action, justification) {
  const batchId = crypto.randomUUID();
  const failed = [];
  let applied = 0;

  for (let i = 0; i < rowIds.length; i += CHUNK_SIZE) {
    const chunk = rowIds.slice(i, i + CHUNK_SIZE);
    // Track per-row "decided here?" outcomes so we can attribute already-
    // decided / missing rows as failed without rolling back the chunk.
    const perRowDecided = new Array(chunk.length).fill(false);
    try {
      const tx = db.transaction(() => {
        for (let j = 0; j < chunk.length; j++) {
          perRowDecided[j] = processOne(db, chunk[j], action, batchId, justification);
        }
      });
      tx();
      for (let j = 0; j < chunk.length; j++) {
        if (perRowDecided[j]) applied += 1;
        else failed.push(chunk[j]);
      }
    } catch (_err) {
      // Whole chunk rolled back — mark every id in this chunk as failed.
      for (const id of chunk) failed.push(id);
    }
  }

  return { batchId, applied, failed, total: rowIds.length };
}

function bulkApprove(db, rowIds, justification) {
  return runBulk(db, rowIds, 'approve', justification || null);
}

function bulkReject(db, rowIds) {
  return runBulk(db, rowIds, 'reject', null);
}

module.exports = { bulkApprove, bulkReject };
