// classifyState(sfRow) — pure function returning the SF workflow state for
// one sf_booking row. Used by src/commands/review-bps.js (Task 12) to drive
// the state badge + banner + Approve-all gating on each Review Pending card.
//
// States:
//   READY        — Status=Completed AND dld_process_status≠'Submitted to DLD'.
//                   Card shows green badge, Approve all is enabled, standard
//                   review flow.
//   IN_PROGRESS  — Status=In Progress (or anything not explicitly Completed /
//                   Rejected). Yellow banner: "BP still running in SF — verify
//                   before approving." Approve all disabled; per-row Approve
//                   still allowed for careful manual review.
//   DLD_ISSUE    — dld_process_status='Submitted to DLD'. Orange banner: "DLD
//                   has issue with customer info — resolve in SF first."
//                   Approve all disabled.
//   REJECTED     — Status=Rejected. Red banner: "BP was rejected in SF —
//                   informational only." Approve all replaced with Acknowledge.
//   NO_SF_ROW    — sfRow is null/undefined (no matching sf_booking row for
//                   this unit). Gray badge: "No SF record found." Approve all
//                   enabled but with a double-confirm prompt.
//
// Conservative default: anything not explicitly Completed AND not Submitted
// to DLD falls through to IN_PROGRESS. Safer to warn than to silently approve
// when SF state is ambiguous.

function classifyState(sfRow) {
  if (!sfRow) return 'NO_SF_ROW';
  if (sfRow.status === 'Rejected') return 'REJECTED';
  if (sfRow.dld_process_status === 'Submitted to DLD') return 'DLD_ISSUE';
  if (sfRow.status === 'Completed') return 'READY';
  return 'IN_PROGRESS';
}

module.exports = { classifyState };
