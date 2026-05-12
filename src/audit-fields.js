// The fields v1.1 considers audit-worthy. Matches the existing
// pending_change.field_name CHECK constraint and the operational columns
// on master_data exactly. Any change here MUST be paired with a migration
// that widens both CHECK constraints.
const AUDIT_FIELDS = Object.freeze([
  'buyer_name',
  'purchase_price_aed',
  'status',
  'procedure_number',
  'area_sqm'
]);

// Maps an AUDIT_FIELD to its provenance/decided_at column names on master_data.
const MASTER_DATA_PROVENANCE = Object.freeze({
  buyer_name:         { source: 'buyer_source',     decidedAt: 'buyer_decided_at' },
  purchase_price_aed: { source: 'price_source',     decidedAt: 'price_decided_at' },
  status:             { source: 'status_source',    decidedAt: 'status_decided_at' },
  procedure_number:   { source: 'procedure_source', decidedAt: 'procedure_decided_at' },
  area_sqm:           { source: 'area_source',      decidedAt: 'area_decided_at' }
});

module.exports = { AUDIT_FIELDS, MASTER_DATA_PROVENANCE };
