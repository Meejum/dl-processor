# Spec Checklist

Must pass before a spec graduates to writing-plans. Used by the spec author at self-review AND by `superpowers:code-reviewer` if dispatched.

## Infrastructure Audit

- [ ] Every required infra item has a row in the audit table.
- [ ] Every `✓` row has a `file:line` citation (not "yes exists" or "file.js:?").
- [ ] Every `✗` row has an explicit decision: "sub-task in scope" OR "descope" (no "TBD," no "check later").
- [ ] Every concept named in the spec body that depends on infra appears in the audit table (no infra mentioned in prose but missing from audit).

## Hot Files & Branch Coordination

- [ ] Predicted file footprint listed.
- [ ] Hot functions named, not just files.
- [ ] List cross-checked against the exploration report's in-flight branch overlap section.
- [ ] For every overlap, an explicit merge-order decision is recorded.

## Realism Check

- [ ] Three concrete failure scenarios documented.
- [ ] Each scenario has a one-sentence mitigation.
- [ ] At least one scenario cites an entry from `docs/superpowers/planning-mistakes-log.md`.

## Prior-art

- [ ] Exploration report exists at `docs/superpowers/explorations/YYYY-MM-DD-<topic>-exploration.md` and is committed.
- [ ] Up to 3 prior specs/notes referenced.
- [ ] Planning-mistakes log greps run; keywords searched are listed; any hits addressed in the spec body.

## Scope

- [ ] Spec covers one cohesive feature, OR bundling justified inline (cite shared architecture).
- [ ] Every feature in the spec has a way to be tested or otherwise verified.
- [ ] Non-goals section explicit.

## Rejection conditions

If any of the above is missing or vague, return the spec to the author with the failing items listed. Do not approve a spec with placeholder content — placeholders are how planning mistakes survive into implementation.
