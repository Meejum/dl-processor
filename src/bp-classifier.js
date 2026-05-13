// classifyBp(fieldSet) — pure function returning the BP label for a set of
// changed AUDIT_FIELDS on a single unit in a single compare run.
//
// Used by src/commands/review-bps.js (Task 12) to label each BP card on the
// Review Pending page. First-match-wins; the order below matters.
//
// Field set is a Set<string> of AUDIT_FIELDS that differ between current
// master_data and the proposed values for one unit.

function classifyBp(fieldSet) {
  if (!fieldSet || typeof fieldSet.has !== 'function') return 'Multi-field update';
  const size = fieldSet.size;
  if (size === 0) return 'Multi-field update';   // shouldn't happen — defensive

  // Resale / new registration: buyer + price + procedure together (status
  // optional). Three of the operational fields changing at once is the
  // classic resale signal Ali identified during v1.1 smoke testing.
  if (fieldSet.has('buyer_name') &&
      fieldSet.has('purchase_price_aed') &&
      fieldSet.has('procedure_number')) return 'Resale';

  // Single-field labels
  if (size === 1) {
    if (fieldSet.has('buyer_name'))         return 'Buyer correction';
    if (fieldSet.has('purchase_price_aed')) return 'Price amendment';
    if (fieldSet.has('status'))             return 'Status update';
    if (fieldSet.has('procedure_number'))   return 'Procedure update';
    if (fieldSet.has('area_sqm'))           return 'Area correction';
  }

  return 'Multi-field update';
}

module.exports = { classifyBp };
