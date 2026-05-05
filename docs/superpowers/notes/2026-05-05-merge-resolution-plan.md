# Merge Resolution Plan — A10/A11 + A12 Coexistence

**Date:** 2026-05-05
**Status:** Documented for the future merge of `feat/multi-applicant-and-area-matching` and `feat/multi-buyer-matching`.
**Related:** the deep review on 2026-05-05 (Phase 1, C2).

---

## The collision

`feat/multi-applicant-and-area-matching` and `feat/multi-buyer-matching` both modify the same regions of `src/compare.js` with **incompatible result-row field names** and two parallel implementations of the same conceptual SF-applicant walk.

| Concern | multi-applicant emits | multi-buyer emits |
|---|---|---|
| Flag list | `audit_flags` (pipe-joined string, e.g. `"A10\|A11"`) | `match_flags` (array, e.g. `["A12"]`) |
| Which SF slot matched | `matched_applicant_field` (string: `"applicant_2_name"`) | not emitted (consumed via cross-product) |
| Area cross-check | `manual_area_sqm`, `area_diff_pct`, `dld_net_area` | not emitted |
| Multi-buyer detail | not emitted | `dld_buyers` (array of `{name, areaSqm, amountAed, txType, txSubtype, date, dateIso, kind}`), `sf_applicants` (array of `{name, role, kind}`) |
| Status enum | adds `AREA_MISMATCH` to the existing `MATCH/BUYER_MISMATCH/PRICE_UP/PRICE_DOWN/DLD_ONLY/SF_ONLY` set | unchanged status enum |

Two different SF-applicant iterators implemented:
- `multi-applicant`: `SF_APPLICANT_FIELDS` array + `findMatchingApplicant(dldName, sfRow)` → returns the matched field name string
- `multi-buyer`: `collectSfApplicants(booking)` → returns structured array

These cannot both survive — they will diverge silently if both stay.

---

## The recommended resolution

**Standardize on `match_flags` as the single flag array.** Drop `audit_flags` (the pipe-joined string). Both A10 and A11 from the area-matching branch get pushed into `match_flags` as strings.

**Keep `matched_applicant_field`** alongside `match_flags`. It's a different signal (which slot matched) and adds value for audit trail.

**Collapse to one SF-applicant helper.** `collectSfApplicants(booking)` from the multi-buyer branch is the richer return shape and should be the canonical one. Add a one-line helper that wraps it for A10's use case:
```javascript
function findMatchingApplicantSlot(dldName, booking) {
  const slots = collectSfApplicants(booking);
  const hit = slots.find(s => namesOverlap(dldName, s.name));
  return hit ? hit.role : null;
}
```
This delivers A10's `matched_applicant_field` semantics on top of the multi-buyer helper. One implementation, two consumers.

**Status enum gains `AREA_MISMATCH`** from multi-applicant. The `STATUS_PRIORITY` map gains the entry. The dashboard adds an AREA column. No conflict here — purely additive.

**Result row shape after merge:**
```javascript
{
  // ... existing scalar fields ...
  match_status: cls.status,
  match_reasons: (cls.reasons || []).join('; '),
  match_flags: cls.flags || [],          // array, includes A10/A11/A12
  matched_applicant_field: cls.matchedApplicantField || null,  // from A10 path
  manual_area_sqm: cls.manualAreaSqm || null,    // from A11 path
  area_diff_pct: cls.areaDiffPct || null,        // from A11 path
  dld_buyers: collectDldBuyers(dldTxs),
  sf_applicants: collectSfApplicants(sfRow)
}
```

---

## How the merge actually goes

Recommended order:
1. **Merge `feat/dld-diff-polish` to master.** It's independent of the compare/match work. Already MERGE-AS-IS approved.
2. **Merge `feat/multi-applicant-and-area-matching` to master.** Brings A10, A11, AREA_MISMATCH, `manual_area`, `audit_flags` (string), `findMatchingApplicant`, `matched_applicant_field`.
3. **Rebase `feat/multi-buyer-matching` on the merged master.** Conflicts in:
   - `src/compare.js classifyMatch` — replace `audit_flags` (string) with `match_flags` (array). `flags.push('A10')`, `flags.push('A11')` instead of `auditFlags.push('A10')` etc.
   - `src/compare.js compareProject` row push — keep both `match_flags` and `matched_applicant_field` (don't drop the latter — it's still useful).
   - `src/compare.js` exports — drop `findMatchingApplicant` and `SF_APPLICANT_FIELDS`; keep `collectSfApplicants`. Add `findMatchingApplicantSlot` if A10 still emits the slot.
   - `db/schema.sql` and the manual_area logic — both unchanged, no conflict.
4. **Test:** every existing test from both branches must still pass (118 from multi-applicant + 124 from multi-buyer ≈ 240+ total post-merge).

The dashboard and audit HTML may need a small follow-up to surface the merged signals (AREA chip, A10/A11/A12 chips). The dashboard already has placeholder columns for A10/A11/A12 — they will populate naturally once the merge completes.

---

## Why this resolution

`match_flags` as an array is more correct semantically (a flag set, not a single string). Stringifying for CSV is a one-line `flags.join('|')` at the writer; deserialising back to an array is trivial. The other direction (`audit_flags` as a string) makes flag membership tests awkward (string contains check, with all the gotchas).

`collectSfApplicants` returns objects with `name` + `role` + `kind`. A10 only needs `role`. The wrapper helper above gets it without a second iteration of the slot list.

`AREA_MISMATCH` as a new status, not a new flag, is preserved because the area-matching branch made that call deliberately and the status carries different audit semantics than a flag.
