// src/audit-hash.js — v2.1 cryptographic chain on audit_log.
//
// Three exports:
//   canonicalize(row)             — stable JSON serialization of an audit_log row
//   computeRowHash(prevHash, row) — SHA-256 of (prevHash || canonicalize(row))
//   chainAppend(db, newRowId)     — after INSERT, compute + UPDATE prev_hash + row_hash
//
// Plus GENESIS_PREV_HASH constant ('0' x 64) for the first row in the chain.
//
// Foundation for v2.1 audit hardening. Migration 008 (Task 4) will backfill
// hashes for existing rows using canonicalize + computeRowHash. writeAuditLog
// (Task 5) will call chainAppend after every new INSERT.

const crypto = require('crypto');

const GENESIS_PREV_HASH = '0'.repeat(64);

// Stable order — DO NOT use Object.keys(row).sort(); explicit list so future
// column additions are deliberate (new columns need to be added here AND in
// migration N for the chain to remain consistent).
//
// Explicitly excludes prev_hash and row_hash themselves (a row can't hash
// itself recursively).
function canonicalize(row) {
  return JSON.stringify({
    audit_id:         row.audit_id,
    ts:               row.ts,
    project_id:       row.project_id,
    unit_number_norm: row.unit_number_norm,
    table_name:       row.table_name,
    field:            row.field,
    old_value:        row.old_value,
    new_value:        row.new_value,
    action:           row.action,
    source:           row.source,
    change_id:        row.change_id,
    user_note:        row.user_note,
    user:             row.user,
    tier2:            row.tier2
  });
}

function computeRowHash(prevHash, row) {
  const p = prevHash || GENESIS_PREV_HASH;
  const input = p + canonicalize(row);
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Called immediately AFTER `INSERT INTO audit_log` to compute + UPDATE the
// new row's prev_hash + row_hash. Caller passes audit_id from
// info.lastInsertRowid.
//
// The `audit_id < ?` comparison works for forward-only chaining because
// audit_id is AUTOINCREMENT (monotonic). Fallback to GENESIS_PREV_HASH
// handles the very first audit_log entry where no prior row exists.
function chainAppend(db, newRowId) {
  const row = db.prepare('SELECT * FROM audit_log WHERE audit_id = ?').get(newRowId);
  if (!row) throw new Error('chainAppend: audit_id not found: ' + newRowId);

  const prior = db.prepare(`
    SELECT row_hash FROM audit_log
    WHERE audit_id < ? AND row_hash IS NOT NULL
    ORDER BY audit_id DESC LIMIT 1
  `).get(newRowId);
  const prevHash = prior ? prior.row_hash : GENESIS_PREV_HASH;

  const rowHash = computeRowHash(prevHash, row);
  db.prepare('UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE audit_id = ?')
    .run(prevHash, rowHash, newRowId);

  return { prevHash, rowHash };
}

module.exports = { canonicalize, computeRowHash, chainAppend, GENESIS_PREV_HASH };
