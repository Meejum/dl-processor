# Master Data + Approval Queue — Design

**Date:** 2026-05-05
**Author:** Ali Alghumlasi (with Claude)
**Status:** Approved for spec; awaiting implementation plan.
**Branch:** `feat/master-data-approval` (off `master`).

---

## Problem

DLD-Processor today has two parallel "what we believe to be true" tables: `manual_override` (one row per `(project, unit)` with `actual_buyer` + `notes`) and `manual_area` (one row per `(project, unit)` with `area_sqm`). Both are point-fix tables — staff edits go straight in with no approval, no history, no field-level provenance. When a new DLD snapshot arrives with a different buyer or area, the system overwrites silently or doesn't update at all (depending on field). There is no way to:

- Review what DLD has proposed before it lands.
- Track every field's last-known canonical value with its source ("staff entered this" vs "DLD said so and we approved").
- Audit who made which decision when.
- Reject a DLD-proposed change and have the rejection persist (so it doesn't re-prompt next month).

This spec adds a single canonical `master_data` table per `(project, unit)` and an approval queue (`pending_change` table) for DLD-driven updates. Compare reads `master_data` when present, falls back to DLD's latest snapshot when not. Existing `manual_override` / `manual_area` data migrates in on first run; the legacy tables stay physically in the schema (frozen, read-only) for audit / rollback.

## Goals

1. **Single canonical source per `(project, unit)`** for the operational fields that drive daily decisions: buyer, price, status, procedure number, area.
2. **Approval gate** between DLD's proposed values and master_data updates. CSV round-trip workflow mirrors the existing `area-template` / `apply-areas` pattern.
3. **Full audit trail** via persistent `pending_change` rows (every approval and rejection visible historically).
4. **Sticky rejection** — a rejected proposal doesn't re-queue on the next snapshot if DLD still proposes the same value.
5. **Re-proposal on shift** — if DLD proposes a *different* value next snapshot, that's a new pending row (the old rejection doesn't suppress it).

## Non-Goals

- **No buyers as a first-class entity.** `master_data.buyer_name` stays a string (deferred to Sub-system 3, separate spec).
- **No four-way HTML report split.** Existing compare HTML and dashboard get updated; no new report types (deferred to Sub-system 4).
- **No SF-side approval queue.** SF discrepancies stay in compare HTML / audit-tasks. Only DLD imports trigger pending changes.
- **No multi-user auth.** `decided_by` is hardcoded `'ali'` for now.
- **No HTML approval UI.** CSV round-trip only.
- **No auto-approve threshold.** Every detected diff queues (after sticky-reject check). Adding a "auto-approve trivial price diffs" knob is a future config flag.
- **Legacy tables not dropped.** `manual_override` / `manual_area` stay physically in the schema, frozen and read-only. Drop in a follow-up migration after 3-6 months of confidence.
- **No master_data export.** No CSV/JSON dump of the full master_data table — existing compare CSV already shows the canonical values per row.
- **No separate master_data_history table.** Audit trail is the persistent `pending_change` rows.

---

## Decisions Locked

| # | Decision | Rationale |
|---|---|---|
| Q1 | master_data scope = buyer + price + status + procedure + area (5 fields, Q1-B). | Drives the daily decisions (BUYER_MISMATCH, PRICE_UP/DOWN). DLD's snapshot tables already store everything else. |
| Q2 | Only DLD imports trigger pending changes (Q2-A). | DLD is the source of truth per the parked vision. SF discrepancies are reportable, not approval-gated. |
| Q3 | master_data REPLACES manual_override + manual_area (Q3-A). | Single source of truth is much simpler to reason about. Migration is small and idempotent. |
| Q4 | One pending_change row per (unit, field) change (Q4-A). | Allows fine-grained approve/reject. UI can group by unit visually. |
| Q5 | CSV round-trip approval workflow (Q5-B). | Mirrors area-template / apply-areas. Excel-friendly. Audit artifact is the filled CSV. |
| Q6 | Hybrid compare lookup: master_data when present, DLD's latest when not (Q6-C). | Bootstrap works; pending changes appear as a distinct chip. |
| Q7 | pending_change rows persist forever; sticky reject; re-propose on value shift (Q7-A + iii). | Single-table audit trail. Stops noise on sticky rejections, recreates queue when DLD's proposal actually shifts. |
| Approach 1 | WIDE master_data schema. | Field set is small and stable. Types stay honest. Adding a 6th field later is a known migration. |

---

## Architecture

Two new tables. Two new pure helpers. Two new CLI subcommands. Two new menu entries. Migration runs idempotently from `migrateSchema()` on first DB open.

### Files Touched

| File | Change |
|---|---|
| `db/schema.sql` | Add `master_data`, `pending_change` tables + 3 indexes. |
| `src/db.js migrateSchema` | Create both tables; one-shot copy from `manual_override`/`manual_area` into `master_data` (idempotent via NOT EXISTS guard). |
| `src/master-data.js` | **New.** Pure helpers: `getMasterRow(db, pid, unitNorm)`, `upsertMasterField(db, pid, unitNorm, field, value, source)`, `seedMasterFromDld(db, pid, unitNorm, dldFields)`. |
| `src/pending-change.js` | **New.** Pure helpers: `queueMasterDiffs(db, snapshotId)`, `listPending(db, projectFilter)`, `applyDecision(db, changeId, decision, notes)`, `proposalAlreadyRejected(db, pid, unitNorm, field, value)`. |
| `src/import-dld.js` | After `importDldSnapshot`, call `queueMasterDiffs(db, snapshotId)`. |
| `src/compare.js` | Read `master_data` when present; fall back to DLD's latest. Surface pending changes as `pending_changes` field on result rows + new `PENDING` flag in `match_flags`. |
| `src/dashboard.js` | New `Pending` column (per-project count). Footer total. |
| `index.js` | New subcommands `review-pending` and `apply-pending`. Update `usage()`. Hook `queueMasterDiffs` after every `importDldSnapshot` in the full pipeline. |
| `src/menu.js` | Rename `[5] Manual Overrides` → `[5] Master Data (staff edits)`. Keep its TUI, write through `upsertMasterField`. Add `[V] Review pending changes` and `[B] Apply pending decisions`. |
| `src/overrides.js` | `getOverridesMapForProject` reads from `master_data` instead of `manual_override`. |
| `src/area-template.js` | `apply-areas` writes to `master_data.area_sqm` with `source='staff'` instead of `manual_area`. CSV format unchanged. |
| `test/master-data.test.js` | **New.** ~10 cases covering helpers + bootstrap. |
| `test/pending-change.test.js` | **New.** ~12 cases covering queue/apply/reject behavior. |
| `test/compare-with-master.test.js` | **New.** ~5 cases for the hybrid compare lookup + PENDING flag. |
| `test/master-data-migration.test.js` | **New.** Migration from manual_override/manual_area. |

**Estimated footprint:** ~600-800 LOC of new code, ~200 LOC of refactors in compare/overrides/area-template. ~30 new tests.

### DB Schema (additions)

```sql
-- master_data: one row per (project, unit). Wide. Single source of truth
-- once seeded. Compare reads from here when a row exists.
CREATE TABLE IF NOT EXISTS master_data (
  master_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm     TEXT NOT NULL,
  -- Operational fields (Q1-B locked set):
  buyer_name           TEXT,
  purchase_price_aed   REAL,
  status               TEXT,
  procedure_number     TEXT,
  area_sqm             REAL,
  -- Per-field provenance:
  buyer_source         TEXT CHECK (buyer_source         IN ('staff','dld_approved')),
  price_source         TEXT CHECK (price_source         IN ('staff','dld_approved')),
  status_source        TEXT CHECK (status_source        IN ('staff','dld_approved')),
  procedure_source     TEXT CHECK (procedure_source     IN ('staff','dld_approved')),
  area_source          TEXT CHECK (area_source          IN ('staff','dld_approved')),
  -- Per-field decision timestamps:
  buyer_decided_at     TEXT,
  price_decided_at     TEXT,
  status_decided_at    TEXT,
  procedure_decided_at TEXT,
  area_decided_at      TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, unit_number_norm)
);

-- pending_change: tall. One row per (unit, field) proposed change.
-- Persists forever. decision flips pending → approved/rejected.
CREATE TABLE IF NOT EXISTS pending_change (
  change_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm     TEXT NOT NULL,
  field_name           TEXT NOT NULL CHECK (field_name IN
    ('buyer_name','purchase_price_aed','status','procedure_number','area_sqm')),
  old_value            TEXT,
  proposed_value       TEXT,
  source_snapshot_id   INTEGER REFERENCES dld_snapshot ON DELETE SET NULL,
  decision             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (decision IN ('pending','approved','rejected')),
  decision_notes       TEXT,
  proposed_at          TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at           TEXT,
  decided_by           TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_proj_unit ON pending_change(project_id, unit_number_norm);
CREATE INDEX IF NOT EXISTS idx_pending_decision  ON pending_change(decision);
CREATE INDEX IF NOT EXISTS idx_master_proj_unit  ON master_data(project_id, unit_number_norm);
```

---

## Data Flows

### 1. DLD Import → pending_change

```
DLD CSV/XPS import
        │
        ▼
existing pipeline: parse → store dld_snapshot, dld_unit, dld_transaction
        │
        ▼
NEW step: queueMasterDiffs(db, snapshotId)
        │
        ├─► For each unit in this snapshot:
        │     1. Compute the "DLD-current" view of the operational fields:
        │        - buyer_name      = collectDldBuyers(txs)[0].name (the primary)
        │        - purchase_price  = pickLatestMarketPrice(txs).amount_aed
        │        - status          = derived from latest tx's tx_type
        │        - procedure_number= latest tx's procedure if available
        │        - area_sqm        = dld_unit.net_area
        │     2. Look up master_data row for (project_id, unit_number_norm).
        │     3. For each field where DLD value ≠ master value:
        │        a. Check pending_change for an existing row with decision='rejected'
        │           AND same (project, unit, field, proposed_value). If found → SKIP.
        │        b. Otherwise → INSERT new pending_change with decision='pending'.
        │     4. If no master row exists yet for this unit → seed master_data with
        │        DLD-current values, source='dld_approved', decided_at=NOW. (Bootstrap.)
        │
        ▼
done — pending changes are now visible to the next compare run
```

**Bootstrap auto-promotion** (step 4): first DLD snapshot that mentions a unit creates the master row directly. Otherwise the system would queue every field of every unit on first import — useless noise.

**Sticky rejection** (step 3a): per Q7-iii, if a rejected row with the same proposed_value exists, the new proposal is suppressed.

**Re-proposal on shift** (Q7-iii): different proposed value = new pending row.

**Idempotent**: re-importing the same snapshot is a no-op.

**Staff-source fields are still candidates for queueing.** If `master_data.buyer_source = 'staff'` and DLD says something different, that's a legitimate proposal that gets queued. Ali can reject if his override is still correct.

### 2. Approval (CSV round-trip)

**`node index.js review-pending [project-name]`**

Writes `output/csv/pending-changes.csv` with columns:

```
change_id, project_name, unit, field, old_value, proposed_value, source_snapshot_date, proposed_at, decision, notes
```

- `change_id` — pending_change PK. Round-trip integrity.
- `decision` — pre-filled `pending`. Ali edits to `approve` / `reject` / leaves as `pending` to defer.
- `notes` — free-text. Stored on apply.
- All rows where `pending_change.decision = 'pending'` are listed. Optional `[project-name]` filter.
- Rows sorted by project, then unit (numeric), then field.

Terminal output:
```
  pending changes:
    Sobha Hartland Waves: 12 (8 buyer, 4 price)
    310 Riverside Crescent: 5 (3 buyer, 2 procedure)
    ...
  TOTAL: 47 pending across 6 projects
  wrote: output/csv/pending-changes.csv
```

**`node index.js apply-pending [csv-path]`**

Reads the CSV (default path `output/csv/pending-changes.csv`). For each row:

```
if decision is 'approve':
  - update master_data.<field> = proposed_value, source='dld_approved', decided_at=NOW
  - update pending_change.decision='approved', decided_at=NOW, decided_by='ali', decision_notes=notes
if decision is 'reject':
  - master_data unchanged
  - update pending_change.decision='rejected', decided_at=NOW, decided_by='ali', decision_notes=notes
if decision is 'pending':
  - skip — row stays pending
if decision is anything else:
  - log warning, skip
if change_id not found in DB:
  - log warning, skip (possibly stale CSV)
```

Type coercion on apply:
- `purchase_price_aed`, `area_sqm` → `Number(value)`
- All others → string as-is

Terminal output:
```
  applied 38 approvals · 6 rejections · 3 deferred (still pending)
  master_data now has 421 canonical rows (was 408)
```

### 3. Compare flow (hybrid lookup + PENDING flag)

For each DLD unit in `compareProject`:

```js
const master = db.prepare(`
  SELECT * FROM master_data
  WHERE project_id = ? AND unit_number_norm = ?
`).get(projectId, u.unit_number_norm);

const dldBuyersAll = collectDldBuyers(dldTxs).filter(b => b.kind === 'buyer');
const dldNamesForMatch = dldBuyersAll.map(b => b.name).filter(Boolean);

// Hybrid: master if exists, else DLD's latest
const canonicalBuyer = master?.buyer_name ?? dldNamesForMatch[0] ?? null;
const canonicalPrice = master?.purchase_price_aed ?? marketPrice?.amount_aed ?? null;
// ... same for status, procedure_number, area
```

The ANY-MATCH cross-product still runs against `dldNamesForMatch` (preserves A12 semantics). The **declared canonical buyer** for the result row is from master when available.

For each unit, look up open pending changes:

```js
const pendingForUnit = db.prepare(`
  SELECT field_name, proposed_value FROM pending_change
  WHERE project_id = ? AND unit_number_norm = ? AND decision = 'pending'
`).all(projectId, u.unit_number_norm);
```

Add to each result row:
- `pending_changes: pendingForUnit` (array of `{field_name, proposed_value}`)
- `match_flags`: append `'PENDING'` when `pendingForUnit.length > 0`

Compare HTML: new `Pending` column (clickable to expand list of pending fields). Compare HTML chips: new `PENDING` chip alongside existing match_status chips.

Dashboard: new `Pending` column (per-project count). Footer total.

Audit-tasks CSV: when pending changes exist for a unit, the audit-task generator includes a hint reason `'review pending: N fields'`.

---

## Migration

Runs idempotently from `migrateSchema()` in `src/db.js`. Only when `master_data` is empty (`SELECT COUNT(*) FROM master_data` = 0).

```sql
-- Step 1: tables already created via CREATE TABLE IF NOT EXISTS earlier in migrateSchema.

-- Step 2: seed master_data from manual_override (NOT EXISTS guard for safety).
INSERT INTO master_data (
  project_id, unit_number_norm, buyer_name,
  buyer_source, buyer_decided_at, notes, created_at, updated_at
)
SELECT
  o.project_id, o.unit_number_norm, o.actual_buyer,
  'staff', o.updated_at, COALESCE(o.notes, ''),
  o.created_at, o.updated_at
FROM manual_override o
WHERE NOT EXISTS (
  SELECT 1 FROM master_data m
  WHERE m.project_id = o.project_id AND m.unit_number_norm = o.unit_number_norm
);

-- Step 3a: merge area into existing master_data rows (UPDATE).
UPDATE master_data
SET area_sqm = (
      SELECT a.area_sqm FROM manual_area a
      WHERE a.project_id = master_data.project_id
        AND a.unit_number_norm = master_data.unit_number_norm
    ),
    area_source = 'staff',
    area_decided_at = (
      SELECT a.updated_at FROM manual_area a
      WHERE a.project_id = master_data.project_id
        AND a.unit_number_norm = master_data.unit_number_norm
    ),
    updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM manual_area a
  WHERE a.project_id = master_data.project_id
    AND a.unit_number_norm = master_data.unit_number_norm
);

-- Step 3b: insert area-only rows for units that have area but no override.
INSERT INTO master_data (
  project_id, unit_number_norm, area_sqm,
  area_source, area_decided_at, notes, created_at, updated_at
)
SELECT
  a.project_id, a.unit_number_norm, a.area_sqm,
  'staff', a.updated_at, COALESCE(a.source_note, ''),
  a.created_at, a.updated_at
FROM manual_area a
WHERE NOT EXISTS (
  SELECT 1 FROM master_data m
  WHERE m.project_id = a.project_id AND m.unit_number_norm = a.unit_number_norm
);
```

**Migration safety:**

- Only runs when `master_data` is empty. Repeated runs are no-ops.
- A backup of the SQLite DB is recommended before the first run; documented in the spec as a release note.
- Test (`test/master-data-migration.test.js`): build a DB with `manual_override` and `manual_area` rows, run `migrateSchema`, assert master_data has the expected rows with `source='staff'`.

**`manual_override` and `manual_area` tables remain in the schema** after migration. Frozen and read-only (the menu entries that wrote to them are removed; CLI commands that wrote to them now write to master_data). They stay for audit/rollback. Drop in a follow-up migration after 3-6 months of confidence — tracked in `docs/superpowers/notes/2026-05-05-deferred-follow-ups.md` as a new DEF item.

---

## Testing

### `test/master-data.test.js` (~10 cases)

1. `getMasterRow` returns null when no row exists.
2. `upsertMasterField` creates a new row when none exists with `created_at = updated_at`.
3. `upsertMasterField` updates only the targeted field + its source/decided_at on an existing row (other fields untouched).
4. `seedMasterFromDld` populates all 5 fields with `source='dld_approved'` for a fresh unit.
5. `seedMasterFromDld` is a no-op when row already exists.
6. Migration: pre-populated `manual_override` rows yield `master_data` rows with `buyer_source='staff'`.
7. Migration: pre-populated `manual_area` rows merge into existing master_data via UPDATE when row exists, INSERT when not.
8. Migration is idempotent — running `migrateSchema()` twice doesn't duplicate.
9. Bootstrap: a fresh DLD snapshot for an unknown unit creates master_data automatically (no pending_change).
10. Hybrid lookup: when master_data exists, compareProject uses master values; when absent, falls back to DLD's latest.

### `test/pending-change.test.js` (~12 cases)

11. `queueMasterDiffs` creates pending rows for each field where DLD differs from master.
12. `queueMasterDiffs` skips fields that match master.
13. `queueMasterDiffs` does NOT queue when no master row exists (bootstrap path handles it).
14. `proposalAlreadyRejected` returns true for a (unit, field, value) with a rejected pending row.
15. `queueMasterDiffs` skips queueing when proposal matches a rejected one (Q7-iii sticky reject).
16. `queueMasterDiffs` re-queues when proposed_value differs from a previously-rejected value (Q7-iii re-propose on shift).
17. `applyDecision('approve')` updates master_data, sets pending_change.decision='approved' + decided_at + decided_by.
18. `applyDecision('reject')` does NOT update master_data, sets pending_change.decision='rejected' + decided_at + notes.
19. `applyDecision` on a non-existent change_id returns an error result.
20. `applyDecision` on an already-decided row throws (idempotency check).
21. `listPending` returns only `decision='pending'` rows by default.
22. `listPending` with project filter returns only rows for that project.

### `test/compare-with-master.test.js` (~5 cases)

23. compareProject uses master_data.buyer_name when set, ignoring DLD's primary.
24. compareProject falls back to DLD's primary when master_data has no row.
25. compareProject result row includes `pending_changes` array (empty by default, populated when pending exists).
26. compareProject emits `PENDING` flag in match_flags when unit has open pending changes.
27. SF matching uses canonical buyer (master if exists, DLD's primary otherwise).

### Manual smoke test (post-implementation)

Run `node index.js` against the real DB. Confirm: master_data populates from manual_override + manual_area on first run; subsequent imports queue diffs; `review-pending` writes a sane CSV; editing the CSV with a few approves/rejects + `apply-pending` applies them; compare HTML shows the new Pending column with correct counts; dashboard total matches.

**Total new tests: ~27** on top of master's 162 = **~190 tests** post-implementation.

---

## Estimated Footprint

- `db/schema.sql`: ~50 LOC (two tables + indexes)
- `src/db.js`: ~30 LOC (migration steps in `migrateSchema`)
- `src/master-data.js`: ~150 LOC (new file)
- `src/pending-change.js`: ~200 LOC (new file)
- `src/import-dld.js`: ~5 LOC (one new call)
- `src/compare.js`: ~80 LOC modified (hybrid lookup + PENDING flag + pending_changes on result row)
- `src/dashboard.js`: ~30 LOC (Pending column)
- `index.js`: ~150 LOC (cmdReviewPending + cmdApplyPending + usage update)
- `src/menu.js`: ~50 LOC modified (rename [5], add [V] and [B])
- `src/overrides.js`: ~20 LOC modified (read from master_data)
- `src/area-template.js`: ~30 LOC modified (write to master_data)
- Tests: ~600 LOC across 4 new files

Roughly **~1,400 LOC of new + modified code**, **~600 LOC of tests**, single PR after merge sequence completes. Estimated 3-5 days of focused work.

---

## Open Questions

None remaining at brainstorm close (2026-05-05). All scope, behavior, schema, and UX decisions confirmed.

When implementation resumes, the next step is `superpowers:writing-plans` against this spec.
