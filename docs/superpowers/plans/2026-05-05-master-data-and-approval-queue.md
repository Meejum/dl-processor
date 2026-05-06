# Master Data + Approval Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single canonical `master_data` table per `(project, unit)` for the operational fields (buyer, price, status, procedure_number, area), plus a `pending_change` approval queue for DLD-driven updates that flows through a CSV round-trip approval workflow before master_data is updated.

**Architecture:** Two new tables (one wide for master, one tall for pending changes). Two pure helper modules. Migration absorbs existing manual_override + manual_area into master_data on first DB open. Compare reads master when present, falls back to DLD's latest. Pending changes surface as a `PENDING` chip in compare HTML and a per-project Pending column on the dashboard.

**Tech Stack:** Node.js (no transpiler), `better-sqlite3`, `node:test` + `node:assert/strict`. CSV via existing `csvEscape` in `src/compare.js`. Tests build `:memory:` databases via `migrateSchema()` from `src/db.js`.

**Spec:** `docs/superpowers/specs/2026-05-05-master-data-and-approval-queue-design.md` (commit `788b246`).

**Branch:** `feat/master-data-approval` (off `master` at `6f83cf0`). Master has all three feature branches (A10/A11, dld-diff-polish, multi-buyer/A12) plus 8 polish fixes already merged. 162 tests pass.

---

## File Map

- **Modify:** `db/schema.sql` — add `master_data` and `pending_change` tables + 3 indexes.
- **Modify:** `src/db.js migrateSchema` — create both tables in step 6+7, run one-shot migration from manual_override / manual_area into master_data (idempotent).
- **Create:** `src/master-data.js` — pure helpers `getMasterRow`, `upsertMasterField`, `seedMasterFromDld`.
- **Create:** `src/pending-change.js` — pure helpers `queueMasterDiffs`, `listPending`, `applyDecision`, `proposalAlreadyRejected`.
- **Modify:** `src/import-dld.js` — call `queueMasterDiffs(db, snapshotId)` after the snapshot is committed.
- **Modify:** `src/overrides.js` — `getOverridesMapForProject` reads from `master_data` instead of `manual_override`.
- **Modify:** `src/area-template.js` — `applyAreaTemplate` writes to `master_data.area_sqm` (source='staff') instead of `manual_area`.
- **Modify:** `src/compare.js` — hybrid lookup (master_data when present, DLD's latest when not), `PENDING` flag in `match_flags`, `pending_changes` array on result rows.
- **Modify:** `src/dashboard.js` — add `Pending` column with per-project count + footer total.
- **Modify:** `index.js` — new subcommands `cmdReviewPending` and `cmdApplyPending`. Update `usage()`. Hook `queueMasterDiffs` after `importDldSnapshot` calls (already covered by Task 5's modification to `src/import-dld.js`).
- **Modify:** `src/menu.js` — rename `[5] Manual Overrides` → `[5] Master Data (staff edits)` and write through `upsertMasterField`. Add `[V] Review pending changes` and `[B] Apply pending decisions`.
- **Create:** `test/master-data-migration.test.js` — migration of manual_override/manual_area into master_data.
- **Create:** `test/master-data.test.js` — `getMasterRow`, `upsertMasterField`, `seedMasterFromDld` plus bootstrap behavior.
- **Create:** `test/pending-change.test.js` — `queueMasterDiffs`, `listPending`, `applyDecision`, `proposalAlreadyRejected` including sticky-reject and re-propose-on-shift.
- **Create:** `test/compare-with-master.test.js` — hybrid lookup + PENDING flag in `compareProject`.

---

## Pre-flight (Task 0)

- [ ] **Step 0.1: Verify branch and clean tree**

Run:
```
cd C:/projects/DL-Processor
git branch --show-current
git status --short
```
Expected: `feat/master-data-approval` and no uncommitted changes (only the spec at `788b246` is on this branch).

- [ ] **Step 0.2: Capture baseline test count**

Run: `npm test`
Expected: 162 tests pass. Each task adds tests; baseline must keep passing throughout.

---

## Task 1: Add `master_data` and `pending_change` tables to `db/schema.sql`

Schema additions only. No migration logic yet (Task 2 handles migration). No tests needed for schema-creation alone — `test/schema-migration.test.js`'s existing "all expected columns" test will exercise the new tables once migration exists in Task 2.

**Files:**
- Modify: `db/schema.sql`

- [ ] **Step 1.1: Append the two tables to `db/schema.sql`**

Locate the end of `db/schema.sql` (after the last existing table, just before any final view definitions). Insert these two tables and three indexes:

```sql

-- ─────────────────────────────────────────────────────────────────────
-- master_data: one row per (project, unit). Wide. Single source of truth
-- once seeded. Compare reads from here when a row exists, falls back to
-- DLD's latest snapshot when not.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_data (
  master_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
  unit_number_norm     TEXT NOT NULL,
  -- Operational fields:
  buyer_name           TEXT,
  purchase_price_aed   REAL,
  status               TEXT,
  procedure_number     TEXT,
  area_sqm             REAL,
  -- Per-field provenance ('staff' = direct staff edit, 'dld_approved' = DLD proposal that was approved):
  buyer_source         TEXT CHECK (buyer_source         IN ('staff','dld_approved')),
  price_source         TEXT CHECK (price_source         IN ('staff','dld_approved')),
  status_source        TEXT CHECK (status_source        IN ('staff','dld_approved')),
  procedure_source     TEXT CHECK (procedure_source     IN ('staff','dld_approved')),
  area_source          TEXT CHECK (area_source          IN ('staff','dld_approved')),
  -- Per-field decision timestamps (when the value was last set/approved):
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

CREATE INDEX IF NOT EXISTS idx_master_proj_unit ON master_data(project_id, unit_number_norm);

-- ─────────────────────────────────────────────────────────────────────
-- pending_change: tall. One row per (unit, field) DLD-proposed change.
-- Persists forever (audit trail). decision flips pending → approved/rejected.
-- ─────────────────────────────────────────────────────────────────────
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
```

- [ ] **Step 1.2: Run the existing schema test to confirm tables load on a fresh DB**

Run: `npm test` (the suite includes `test/schema-migration.test.js` which calls `openDb` on a temp path and asserts column sets).

Expected: 162 tests still pass. The new tables won't be tested individually yet — that's Task 2's job — but they must not break the existing migration path.

- [ ] **Step 1.3: Commit**

```
git add db/schema.sql
git commit -m "feat(schema): add master_data and pending_change tables"
```

---

## Task 2: Migrate manual_override + manual_area into master_data

Idempotent migration runs from `migrateSchema()`. Only seeds master_data when it's empty, so re-running is a no-op.

**Files:**
- Modify: `src/db.js migrateSchema`
- Create: `test/master-data-migration.test.js`

- [ ] **Step 2.1: Create `test/master-data-migration.test.js` with 4 failing tests**

Create the file:
```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  const info = db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name);
  return info.lastInsertRowid;
}

test('migration: manual_override row → master_data row with buyer_source=staff', () => {
  const db = buildDb();
  // Pre-seed manual_override BEFORE re-running migration. We need to clear
  // master_data first because buildDb() already ran migrateSchema once.
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Alpha');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, notes, created_at, updated_at)
              VALUES (?, '101', 'ALICE', 'verified by Ali', '2026-01-01 10:00:00', '2026-01-02 11:00:00')`).run(pid);
  // Run migrateSchema again — should now seed from manual_override.
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.ok(row, 'expected master_data row');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.buyer_decided_at, '2026-01-02 11:00:00');
  assert.equal(row.notes, 'verified by Ali');
  assert.equal(row.area_sqm, null);
});

test('migration: manual_area row → master_data row with area_source=staff (no override)', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Beta');
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, source_note, entered_by, created_at, updated_at)
              VALUES (?, '202', 75.5, 'CRM update', 'ali', '2026-01-01 10:00:00', '2026-01-02 11:00:00')`).run(pid);
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '202');
  assert.ok(row);
  assert.equal(row.area_sqm, 75.5);
  assert.equal(row.area_source, 'staff');
  assert.equal(row.buyer_name, null);
});

test('migration: manual_override + manual_area for same unit → one master_data row with both fields', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Gamma');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, created_at, updated_at)
              VALUES (?, '303', 'BOB', '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  db.prepare(`INSERT INTO manual_area (project_id, unit_number_norm, area_sqm, created_at, updated_at)
              VALUES (?, '303', 88.2, '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  migrateSchema(db);
  const row = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '303');
  assert.equal(row.buyer_name, 'BOB');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.area_sqm, 88.2);
  assert.equal(row.area_source, 'staff');
});

test('migration: idempotent — running migrateSchema twice does not duplicate rows', () => {
  const db = buildDb();
  db.exec('DELETE FROM master_data');
  const pid = insertProject(db, 'Delta');
  db.prepare(`INSERT INTO manual_override (project_id, unit_number_norm, actual_buyer, created_at, updated_at)
              VALUES (?, '404', 'CAROL', '2026-01-01 10:00:00', '2026-01-01 10:00:00')`).run(pid);
  migrateSchema(db);
  migrateSchema(db);  // second run is a no-op
  const count = db.prepare('SELECT COUNT(*) AS n FROM master_data WHERE project_id=?').get(pid).n;
  assert.equal(count, 1);
});
```

- [ ] **Step 2.2: Run and verify failure**

Run: `node --test test/master-data-migration.test.js`
Expected: all 4 tests FAIL — migration logic doesn't exist yet.

- [ ] **Step 2.3: Add migration steps to `migrateSchema` in `src/db.js`**

In `src/db.js`, locate the existing `migrateSchema(db)` function. After the existing block 5 (`area_threshold_pct` column add at the end of the function), append:

```javascript
  // 6. Master-data + approval-queue migration (run only when master_data is empty).
  //    Tables themselves are created by db/schema.sql via CREATE TABLE IF NOT EXISTS.
  //    See docs/superpowers/specs/2026-05-05-master-data-and-approval-queue-design.md.
  const masterCount = db.prepare('SELECT COUNT(*) AS n FROM master_data').get().n;
  if (masterCount === 0) {
    db.exec(`
      BEGIN TRANSACTION;

      -- 6a. Seed master_data from manual_override.
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

      -- 6b. UPDATE area on existing master_data rows that already have a manual_override entry.
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

      -- 6c. INSERT new master_data rows for manual_area entries that have no override.
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

      COMMIT;
    `);
  }
}
```

(Note: there should be only ONE closing `}` for `migrateSchema` — make sure this block is added BEFORE that closing brace.)

- [ ] **Step 2.4: Run and verify the new tests pass**

Run: `node --test test/master-data-migration.test.js`
Expected: 4 tests PASS.

- [ ] **Step 2.5: Run the full suite**

Run: `npm test`
Expected: 166 tests pass (162 + 4).

- [ ] **Step 2.6: Commit**

```
git add src/db.js test/master-data-migration.test.js
git commit -m "feat(db): migrate manual_override + manual_area into master_data on first run"
```

---

## Task 3: `src/master-data.js` pure helpers

Three pure helpers to read/write master_data. Used by ingestion (Task 5), apply-pending (Task 10), staff-edit menu (Task 12).

**Files:**
- Create: `src/master-data.js`
- Create: `test/master-data.test.js`

- [ ] **Step 3.1: Create `test/master-data.test.js` with 5 failing tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const {
  getMasterRow,
  upsertMasterField,
  seedMasterFromDld
} = require('../src/master-data');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  return db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name).lastInsertRowid;
}

test('getMasterRow returns null when no row exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  assert.equal(getMasterRow(db, pid, '999'), null);
});

test('upsertMasterField creates new row when none exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.ok(row.buyer_decided_at);
  assert.equal(row.purchase_price_aed, null);
  assert.equal(row.area_sqm, null);
});

test('upsertMasterField updates only the targeted field; others untouched', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  upsertMasterField(db, pid, '101', 'purchase_price_aed', 1500000, 'dld_approved');
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.purchase_price_aed, 1500000);
  assert.equal(row.price_source, 'dld_approved');
  // Decision timestamps are independent:
  assert.notEqual(row.buyer_decided_at, row.price_decided_at);
});

test('seedMasterFromDld populates all fields with source=dld_approved on a fresh unit', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  seedMasterFromDld(db, pid, '101', {
    buyer_name: 'ALICE',
    purchase_price_aed: 1500000,
    status: 'Sell - Pre registration',
    procedure_number: '12345/2024',
    area_sqm: 75.5
  });
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE');
  assert.equal(row.purchase_price_aed, 1500000);
  assert.equal(row.area_sqm, 75.5);
  assert.equal(row.buyer_source, 'dld_approved');
  assert.equal(row.price_source, 'dld_approved');
  assert.equal(row.area_source, 'dld_approved');
});

test('seedMasterFromDld is a no-op when row already exists', () => {
  const db = buildDb();
  const pid = insertProject(db, 'X');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  seedMasterFromDld(db, pid, '101', { buyer_name: 'BOB', purchase_price_aed: 9999 });
  const row = getMasterRow(db, pid, '101');
  assert.equal(row.buyer_name, 'ALICE', 'staff value should be preserved');
  assert.equal(row.buyer_source, 'staff');
  assert.equal(row.purchase_price_aed, null, 'no fields should be added by no-op seed');
});
```

- [ ] **Step 3.2: Run and verify failure**

Run: `node --test test/master-data.test.js`
Expected: 5 tests FAIL — `Cannot find module '../src/master-data'`.

- [ ] **Step 3.3: Implement `src/master-data.js`**

```javascript
const FIELD_TO_COLUMNS = {
  buyer_name:         { value: 'buyer_name',         source: 'buyer_source',     decided: 'buyer_decided_at' },
  purchase_price_aed: { value: 'purchase_price_aed', source: 'price_source',     decided: 'price_decided_at' },
  status:             { value: 'status',             source: 'status_source',    decided: 'status_decided_at' },
  procedure_number:   { value: 'procedure_number',   source: 'procedure_source', decided: 'procedure_decided_at' },
  area_sqm:           { value: 'area_sqm',           source: 'area_source',      decided: 'area_decided_at' }
};

function getMasterRow(db, projectId, unitNumberNorm) {
  return db.prepare(
    'SELECT * FROM master_data WHERE project_id = ? AND unit_number_norm = ?'
  ).get(projectId, unitNumberNorm) || null;
}

function upsertMasterField(db, projectId, unitNumberNorm, fieldName, value, source) {
  const cols = FIELD_TO_COLUMNS[fieldName];
  if (!cols) throw new Error('unknown master_data field: ' + fieldName);
  if (source !== 'staff' && source !== 'dld_approved') {
    throw new Error('source must be "staff" or "dld_approved", got: ' + source);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const existing = getMasterRow(db, projectId, unitNumberNorm);
  if (existing) {
    db.prepare(
      `UPDATE master_data
         SET ${cols.value}   = ?,
             ${cols.source}  = ?,
             ${cols.decided} = ?,
             updated_at      = ?
       WHERE project_id = ? AND unit_number_norm = ?`
    ).run(value, source, now, now, projectId, unitNumberNorm);
  } else {
    db.prepare(
      `INSERT INTO master_data
         (project_id, unit_number_norm, ${cols.value}, ${cols.source}, ${cols.decided}, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(projectId, unitNumberNorm, value, source, now, now, now);
  }
}

function seedMasterFromDld(db, projectId, unitNumberNorm, dldFields) {
  // No-op when a row already exists. Bootstrap path: first DLD snapshot for a
  // unit creates master_data with source='dld_approved' (no approval needed
  // because there's no prior canonical to disagree with).
  if (getMasterRow(db, projectId, unitNumberNorm)) return false;
  for (const [field, value] of Object.entries(dldFields)) {
    if (value == null) continue;
    if (!FIELD_TO_COLUMNS[field]) continue;
    upsertMasterField(db, projectId, unitNumberNorm, field, value, 'dld_approved');
  }
  return true;
}

module.exports = { getMasterRow, upsertMasterField, seedMasterFromDld, FIELD_TO_COLUMNS };
```

- [ ] **Step 3.4: Run and verify the tests pass**

Run: `node --test test/master-data.test.js`
Expected: all 5 tests PASS.

- [ ] **Step 3.5: Run the full suite**

Run: `npm test`
Expected: 171 tests pass (166 + 5).

- [ ] **Step 3.6: Commit**

```
git add src/master-data.js test/master-data.test.js
git commit -m "feat(master-data): pure helpers getMasterRow/upsertMasterField/seedMasterFromDld"
```

---

## Task 4: `src/pending-change.js` pure helpers

Four pure helpers for the approval queue. Critical: `queueMasterDiffs` must respect the sticky-reject + re-propose-on-shift rules from Q7-iii.

**Files:**
- Create: `src/pending-change.js`
- Create: `test/pending-change.test.js`

- [ ] **Step 4.1: Create `test/pending-change.test.js` with 12 failing tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { upsertMasterField, seedMasterFromDld } = require('../src/master-data');
const {
  queueMasterDiffs,
  listPending,
  applyDecision,
  proposalAlreadyRejected
} = require('../src/pending-change');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function insertProject(db, name) {
  return db.prepare('INSERT INTO dld_project (project_name) VALUES (?)').run(name).lastInsertRowid;
}

function insertSnapshot(db, projectId) {
  return db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, total_units, total_tx)
     VALUES (?, 'csv', 'fake.csv', '2026-01-01', 1, 1)`
  ).run(projectId).lastInsertRowid;
}

function insertUnitWithBuyer(db, snapshotId, projectId, unitNumber, buyerName) {
  const norm = String(unitNumber).toUpperCase().replace(/\s+/g, '');
  const uid = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area)
     VALUES (?, ?, ?, ?, ?)`
  ).run(snapshotId, projectId, unitNumber, norm, 75.0).lastInsertRowid;
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed)
     VALUES (?, ?, ?, ?, 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1500000)`
  ).run(uid, snapshotId, projectId, buyerName);
  return uid;
}

test('queueMasterDiffs creates pending row when DLD differs from master', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'BOB');
  // Pre-existing master with different buyer:
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  const buyerRow = pending.find(p => p.field_name === 'buyer_name' && p.unit_number_norm === '101');
  assert.ok(buyerRow);
  assert.equal(buyerRow.proposed_value, 'BOB');
  assert.equal(buyerRow.old_value, 'ALICE');
  assert.equal(buyerRow.decision, 'pending');
});

test('queueMasterDiffs skips fields that match master', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'ALICE');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.find(p => p.field_name === 'buyer_name'), undefined);
});

test('queueMasterDiffs does NOT queue when no master row exists; bootstrap seeds master instead', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'ALICE');
  // No master row exists for this unit.
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 0, 'no pending changes for bootstrap');
  // master_data should now have a seeded row with dld_approved source.
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.ok(master);
  assert.equal(master.buyer_name, 'ALICE');
  assert.equal(master.buyer_source, 'dld_approved');
});

test('proposalAlreadyRejected returns true for matching rejected row', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  // Insert a rejected pending row directly:
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  assert.equal(proposalAlreadyRejected(db, pid, '101', 'buyer_name', 'BOB'), true);
  assert.equal(proposalAlreadyRejected(db, pid, '101', 'buyer_name', 'CAROL'), false);
});

test('queueMasterDiffs skips when proposal matches a rejected one (sticky reject)', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'BOB');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 0, 'sticky reject suppresses re-queueing');
});

test('queueMasterDiffs re-queues when proposed_value differs from a rejected one', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const sid = insertSnapshot(db, pid);
  insertUnitWithBuyer(db, sid, pid, '101', 'CAROL');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB', 'rejected', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  queueMasterDiffs(db, sid);
  const pending = listPending(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].proposed_value, 'CAROL');
});

test('applyDecision approve updates master_data and marks pending row approved', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid).lastInsertRowid;
  applyDecision(db, cid, 'approve', 'OK');
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(master.buyer_name, 'BOB');
  assert.equal(master.buyer_source, 'dld_approved');
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision, 'approved');
  assert.ok(pc.decided_at);
  assert.equal(pc.decision_notes, 'OK');
  assert.equal(pc.decided_by, 'ali');
});

test('applyDecision reject leaves master_data alone', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid).lastInsertRowid;
  applyDecision(db, cid, 'reject', 'wrong');
  const master = db.prepare('SELECT * FROM master_data WHERE project_id=? AND unit_number_norm=?').get(pid, '101');
  assert.equal(master.buyer_name, 'ALICE');
  const pc = db.prepare('SELECT * FROM pending_change WHERE change_id=?').get(cid);
  assert.equal(pc.decision, 'rejected');
  assert.equal(pc.decision_notes, 'wrong');
});

test('applyDecision throws on non-existent change_id', () => {
  const db = buildDb();
  assert.throws(() => applyDecision(db, 99999, 'approve', ''), /change_id 99999 not found/);
});

test('applyDecision throws on already-decided row (idempotency check)', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  const cid = db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '101', 'buyer_name', 'BOB', 'approved', '2026-01-01 10:00:00', 'ali')`
  ).run(pid).lastInsertRowid;
  assert.throws(() => applyDecision(db, cid, 'approve', ''), /already decided/);
});

test('listPending returns only decision=pending rows by default', () => {
  const db = buildDb();
  const pid = insertProject(db, 'A');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision)
     VALUES (?, '101', 'buyer_name', 'BOB', 'pending')`
  ).run(pid);
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value, decision, decided_at, decided_by)
     VALUES (?, '102', 'buyer_name', 'CAROL', 'approved', '2026-01-01 10:00:00', 'ali')`
  ).run(pid);
  const rows = listPending(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].proposed_value, 'BOB');
});

test('listPending filters by project name when provided', () => {
  const db = buildDb();
  const a = insertProject(db, 'A');
  const b = insertProject(db, 'B');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value)
     VALUES (?, '101', 'buyer_name', 'BOB')`
  ).run(a);
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, proposed_value)
     VALUES (?, '102', 'buyer_name', 'CAROL')`
  ).run(b);
  const rowsA = listPending(db, 'A');
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].proposed_value, 'BOB');
});
```

- [ ] **Step 4.2: Run and verify failure**

Run: `node --test test/pending-change.test.js`
Expected: 12 tests FAIL — `Cannot find module '../src/pending-change'`.

- [ ] **Step 4.3: Implement `src/pending-change.js`**

```javascript
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
  // Numeric tolerance: 0.5 AED for prices, 0.01 sqm for areas, exact for strings.
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
  for (const u of units) {
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
}

module.exports = {
  queueMasterDiffs,
  listPending,
  applyDecision,
  proposalAlreadyRejected,
  dldViewForUnit,
  TRACKED_FIELDS
};
```

- [ ] **Step 4.4: Run and verify the tests pass**

Run: `node --test test/pending-change.test.js`
Expected: all 12 tests PASS.

- [ ] **Step 4.5: Run the full suite**

Run: `npm test`
Expected: 183 tests pass (171 + 12).

- [ ] **Step 4.6: Commit**

```
git add src/pending-change.js test/pending-change.test.js
git commit -m "feat(pending-change): queue, list, apply helpers with sticky reject"
```

---

## Task 5: Wire `queueMasterDiffs` into DLD ingestion

After every DLD snapshot import, queue diffs against master_data.

**Files:**
- Modify: `src/import-dld.js`

- [ ] **Step 5.1: Add the import and post-commit call in `src/import-dld.js`**

In `src/import-dld.js`, locate the top of the file. Add to the requires:
```javascript
const { queueMasterDiffs } = require('./pending-change');
```

Find the function `importDldSnapshot` (or whatever the main exported function is). After the snapshot is fully committed and the function is about to return its result, add:
```javascript
  const queueResult = queueMasterDiffs(db, result.snapshotId);
  result.queuedDiffs = queueResult.queued;
  result.seededMaster = queueResult.seeded;
```

(`result.snapshotId` is whatever name the existing return uses for the new snapshot's id — read the file to confirm. If the variable name differs, adapt.)

- [ ] **Step 5.2: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: 183 tests still pass. The existing import tests will exercise the new step transparently because importing a fresh snapshot just bootstraps master_data.

- [ ] **Step 5.3: Commit**

```
git add src/import-dld.js
git commit -m "feat(import-dld): queue master_data diffs after every snapshot"
```

---

## Task 6: Refactor `src/overrides.js` to read from master_data

`getOverridesMapForProject` is consumed by `compareProject` to find staff-defined buyer overrides. After this task it reads the same information from `master_data.buyer_name` (when source is 'staff' or 'dld_approved').

**Files:**
- Modify: `src/overrides.js`

- [ ] **Step 6.1: Update `getOverridesMapForProject`**

Read `src/overrides.js`. Find `getOverridesMapForProject`. Replace its body with:

```javascript
function getOverridesMapForProject(db, projectId) {
  const rows = db.prepare(`
    SELECT unit_number_norm, buyer_name
    FROM master_data
    WHERE project_id = ? AND buyer_name IS NOT NULL
  `).all(projectId);
  const map = new Map();
  for (const r of rows) map.set(r.unit_number_norm, r.buyer_name);
  return map;
}
```

(Keep the function signature and exports unchanged.)

- [ ] **Step 6.2: Run the full suite**

Run: `npm test`
Expected: 183 tests still pass. compareProject's existing tests use `manual_override` writes via test fixtures — the migration in Task 2 ensures those become master_data rows with `buyer_source='staff'`, so the lookup still finds them.

If any compare test fails because it writes to `manual_override` and expects compare to read from there: update the test to write directly to `master_data` with `upsertMasterField(db, pid, '101', 'buyer_name', 'X', 'staff')`. Do NOT remove the override behavior from production code.

- [ ] **Step 6.3: Commit**

```
git add src/overrides.js
git commit -m "refactor(overrides): read staff overrides from master_data instead of manual_override"
```

---

## Task 7: Refactor `src/area-template.js apply-areas` to write to master_data

`apply-areas` previously wrote to `manual_area`. Now it writes to `master_data.area_sqm` with `source='staff'`.

**Files:**
- Modify: `src/area-template.js`

- [ ] **Step 7.1: Update the apply path**

Read `src/area-template.js`. Find the function that writes accepted CSV rows (probably `applyAreaTemplate` or similar, around the section that does `INSERT INTO manual_area`).

Replace the `INSERT INTO manual_area ...` (or upsert) with a call to `upsertMasterField`:
```javascript
const { upsertMasterField } = require('./master-data');
// ... inside the loop where each accepted row is processed:
upsertMasterField(db, projectId, unitNumberNorm, 'area_sqm', Number(areaSqm), 'staff');
```

(Adapt variable names to match the actual function.)

The CSV format Ali uses for `area-template` is unchanged — only the destination table changes.

- [ ] **Step 7.2: Run the full suite**

Run: `npm test`
Expected: 183 tests pass. Existing `area-template` tests should still pass because the new helper produces the same logical effect (area_sqm stored per unit). If a test reads back from `manual_area` directly: update the test to read from `master_data.area_sqm` instead.

- [ ] **Step 7.3: Commit**

```
git add src/area-template.js
git commit -m "refactor(area-template): apply-areas writes to master_data with source=staff"
```

---

## Task 8: Compare flow hybrid lookup + PENDING flag

`compareProject` reads master_data when present, falls back to DLD's latest. Pending changes are surfaced as a `PENDING` flag in `match_flags` and a new `pending_changes` array on each result row.

**Files:**
- Modify: `src/compare.js`
- Create: `test/compare-with-master.test.js`

- [ ] **Step 8.1: Create `test/compare-with-master.test.js` with 5 failing tests**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrateSchema } = require('../src/db');
const { compareProject } = require('../src/compare');
const { upsertMasterField } = require('../src/master-data');

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function buildDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  return db;
}

function setupProjectWithUnit(db, projectName, unitNumber, dldBuyer, sfBuyer) {
  const pid = db.prepare(
    'INSERT INTO dld_project (project_name, sf_sub_project, sf_unit_prefix) VALUES (?, ?, ?)'
  ).run(projectName, projectName + ' Sub', 'P').lastInsertRowid;
  const sid = db.prepare(
    `INSERT INTO dld_snapshot (project_id, source_format, source_file, snapshot_date, total_units, total_tx)
     VALUES (?, 'csv', 'fake.csv', '2026-01-01', 1, 1)`
  ).run(pid).lastInsertRowid;
  const norm = String(unitNumber).toUpperCase();
  const uid = db.prepare(
    `INSERT INTO dld_unit (snapshot_id, project_id, unit_number, unit_number_norm, net_area)
     VALUES (?, ?, ?, ?, 75.0)`
  ).run(sid, pid, unitNumber, norm).lastInsertRowid;
  db.prepare(
    `INSERT INTO dld_transaction (unit_id, snapshot_id, project_id, party_name, ft_share, share_unit, tx_type, tx_date, tx_date_iso, amount_aed)
     VALUES (?, ?, ?, ?, 100, 'F.T.', 'Sell - Pre registration', '04/02/2024', '2024-02-04', 1500000)`
  ).run(uid, sid, pid, dldBuyer);
  const sfSid = db.prepare(
    `INSERT INTO sf_snapshot (source_file, total_rows) VALUES ('sf.xlsx', 1)`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO sf_booking (sf_snapshot_id, sub_project, unit, unit_norm, applicant_name, purchase_price)
     VALUES (?, ?, ?, ?, ?, 1500000)`
  ).run(sfSid, projectName + ' Sub', 'P-' + unitNumber, 'P-' + norm, sfBuyer);
  return pid;
}

test('compareProject uses master_data.buyer_name when set, ignoring DLD primary', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'BOB', 'ALICE');
  upsertMasterField(db, pid, '101', 'buyer_name', 'ALICE', 'staff');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'master ALICE matches SF ALICE — clean MATCH');
});

test('compareProject falls back to DLD primary when master_data has no row', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  // No master_data row.
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'fallback to DLD ALICE matches SF ALICE');
});

test('compareProject result row includes pending_changes array (empty by default)', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.ok(Array.isArray(row.pending_changes));
  assert.equal(row.pending_changes.length, 0);
});

test('compareProject populates pending_changes when open changes exist', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'ALICE', 'ALICE');
  db.prepare(
    `INSERT INTO pending_change (project_id, unit_number_norm, field_name, old_value, proposed_value)
     VALUES (?, '101', 'buyer_name', 'ALICE', 'BOB')`
  ).run(pid);
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.pending_changes.length, 1);
  assert.equal(row.pending_changes[0].field_name, 'buyer_name');
  assert.equal(row.pending_changes[0].proposed_value, 'BOB');
  assert.ok(row.match_flags.includes('PENDING'), 'PENDING flag should be in match_flags');
});

test('compareProject SF matching uses canonical buyer (master if set, else DLD primary)', () => {
  const db = buildDb();
  const pid = setupProjectWithUnit(db, 'A', '101', 'BOB', 'CAROL');
  upsertMasterField(db, pid, '101', 'buyer_name', 'CAROL', 'staff');
  const result = compareProject(db, pid);
  const row = result.rows.find(r => r.dld_unit_number === '101');
  assert.equal(row.match_status, 'MATCH', 'master CAROL matches SF CAROL despite DLD saying BOB');
});
```

- [ ] **Step 8.2: Run and verify failure**

Run: `node --test test/compare-with-master.test.js`
Expected: 5 tests FAIL — current `compareProject` doesn't read from master_data and doesn't emit PENDING flag.

- [ ] **Step 8.3: Update `compareProject` in `src/compare.js`**

In `src/compare.js`, find the per-unit loop in `compareProject`. Just inside the loop, before the existing `classifyMatch` call, add:

```javascript
    const masterRow = db.prepare(
      'SELECT * FROM master_data WHERE project_id = ? AND unit_number_norm = ?'
    ).get(projectId, u.unit_number_norm);

    const pendingForUnit = db.prepare(
      `SELECT field_name, proposed_value FROM pending_change
       WHERE project_id = ? AND unit_number_norm = ? AND decision = 'pending'`
    ).all(projectId, u.unit_number_norm);
```

Find where `classifyMatch` is called. The override-buyer argument currently comes from `overrideMap.get(u.unit_number_norm)`. Replace that with the canonical buyer derived from master:

```javascript
    const canonicalBuyer = masterRow?.buyer_name || overrideMap.get(u.unit_number_norm) || null;
    const cls = classifyMatch(u, dldTxs, sfRow, canonicalBuyer);
```

(`overrideMap` was already populated by `getOverridesMapForProject` from Task 6 — which now reads from master_data.buyer_name. So this is partially redundant; one fallback suffices. Keep the chain for clarity.)

In the row-push block, locate the existing field list (where `match_flags`, `dld_buyers`, etc. are emitted). Append:
```javascript
      pending_changes:          pendingForUnit,
```

Locate where `match_flags` is computed (the `Array.from(new Set(...))` line). After that, conditionally add 'PENDING':
```javascript
      match_flags:              Array.from(new Set([
        ...(cls.flags || []),
        ...auditFlags,
        ...(pendingForUnit.length > 0 ? ['PENDING'] : [])
      ])),
```

For the SF-only path (the second `rows.push` block in `compareProject`), also add `pending_changes: []` for consistency.

- [ ] **Step 8.4: Run and verify the tests pass**

Run: `node --test test/compare-with-master.test.js`
Expected: 5 tests PASS.

- [ ] **Step 8.5: Run the full suite**

Run: `npm test`
Expected: 188 tests pass (183 + 5).

- [ ] **Step 8.6: Commit**

```
git add src/compare.js test/compare-with-master.test.js
git commit -m "feat(compare): hybrid lookup against master_data + PENDING flag in match_flags"
```

---

## Task 9: `cmdReviewPending` CLI subcommand

Writes `output/csv/pending-changes.csv` with all pending rows (optionally filtered by project).

**Files:**
- Modify: `index.js`

- [ ] **Step 9.1: Add the subcommand**

In `index.js`, locate the requires block at the top. Add:
```javascript
const { listPending, applyDecision } = require('./src/pending-change');
```

Add the function (before `main()`):

```javascript
function cmdReviewPending(filterProjectName) {
  const db = openDb();
  const rows = listPending(db, filterProjectName);
  if (rows.length === 0) {
    console.log('  no pending changes');
    db.close();
    return;
  }
  // Group counts for terminal output.
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.project_name)) byProject.set(r.project_name, { total: 0, byField: {} });
    const slot = byProject.get(r.project_name);
    slot.total += 1;
    slot.byField[r.field_name] = (slot.byField[r.field_name] || 0) + 1;
  }
  console.log('  pending changes:');
  for (const [name, slot] of byProject) {
    const fields = Object.entries(slot.byField).map(([k, v]) => v + ' ' + k.replace('buyer_name', 'buyer').replace('purchase_price_aed', 'price').replace('procedure_number', 'procedure').replace('area_sqm', 'area')).join(', ');
    console.log('    ' + name + ': ' + slot.total + ' (' + fields + ')');
  }
  console.log('  TOTAL: ' + rows.length + ' pending across ' + byProject.size + ' project' + (byProject.size === 1 ? '' : 's'));

  fs.mkdirSync(CSV_DIR, { recursive: true });
  const outPath = path.join(CSV_DIR, 'pending-changes.csv');
  const header = ['change_id', 'project_name', 'unit', 'field', 'old_value', 'proposed_value', 'source_snapshot_date', 'proposed_at', 'decision', 'notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const snap = r.source_snapshot_id
      ? db.prepare('SELECT snapshot_date FROM dld_snapshot WHERE snapshot_id = ?').get(r.source_snapshot_id)
      : null;
    lines.push(header.map(h => {
      const v = h === 'project_name' ? r.project_name :
                h === 'unit' ? r.unit_number_norm :
                h === 'field' ? r.field_name :
                h === 'source_snapshot_date' ? (snap ? snap.snapshot_date : '') :
                h === 'decision' ? 'pending' :
                h === 'notes' ? '' :
                r[h] == null ? '' : r[h];
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
  console.log('  wrote: ' + path.relative(process.cwd(), outPath));
  db.close();
}
```

In `main()`, locate the existing subcommand routing (`if (cmd === 'compare')`, etc.). Add:
```javascript
  if (cmd === 'review-pending') {
    cmdReviewPending(rest[0] || null);
    return;
  }
```

In `usage()`, add the new line:
```javascript
  console.log('  node index.js review-pending [name]  write pending-changes.csv for review');
```

- [ ] **Step 9.2: Manual smoke test**

Run: `node index.js review-pending`
Expected: `no pending changes` (DB has none yet because nothing's been imported on this branch). Or with a populated DB, the CSV gets written.

- [ ] **Step 9.3: Run the full suite**

Run: `npm test`
Expected: still 188 (no new tests).

- [ ] **Step 9.4: Commit**

```
git add index.js
git commit -m "feat(cli): review-pending writes pending-changes.csv"
```

---

## Task 10: `cmdApplyPending` CLI subcommand

Reads the CSV, applies approve/reject decisions via `applyDecision`.

**Files:**
- Modify: `index.js`

- [ ] **Step 10.1: Add the subcommand**

In `index.js`, add the function (after `cmdReviewPending`):

```javascript
function cmdApplyPending(csvPath) {
  const db = openDb();
  const inputPath = csvPath || path.join(CSV_DIR, 'pending-changes.csv');
  if (!fs.existsSync(inputPath)) {
    console.log('  no pending CSV at ' + inputPath);
    db.close();
    return;
  }
  const content = fs.readFileSync(inputPath, 'utf8');
  // Minimal CSV parse — assumes no quoted commas in change_id/decision/notes;
  // for full correctness, use the same parser the codebase uses elsewhere.
  // (csv-parse is already an npm dep — used by src/sources/csv.js.)
  const { parse } = require('csv-parse/sync');
  const rows = parse(content, { relax_quotes: true, columns: true, skip_empty_lines: true });
  let approved = 0, rejected = 0, deferred = 0, errors = 0;
  for (const r of rows) {
    const cid = parseInt(r.change_id, 10);
    if (isNaN(cid)) { errors += 1; continue; }
    const decision = String(r.decision || '').trim().toLowerCase();
    const notes = r.notes || '';
    if (decision === 'approve') {
      try { applyDecision(db, cid, 'approve', notes); approved += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'reject') {
      try { applyDecision(db, cid, 'reject', notes); rejected += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'pending' || decision === '') {
      deferred += 1;
    } else {
      console.log('  warn change_id ' + cid + ': unknown decision "' + decision + '", skipping');
      errors += 1;
    }
  }
  const masterCount = db.prepare('SELECT COUNT(*) AS n FROM master_data').get().n;
  console.log('  applied ' + approved + ' approval' + (approved === 1 ? '' : 's') + ' · ' + rejected + ' rejection' + (rejected === 1 ? '' : 's') + ' · ' + deferred + ' deferred (still pending)');
  if (errors) console.log('  ' + errors + ' row' + (errors === 1 ? '' : 's') + ' had errors (see warnings above)');
  console.log('  master_data now has ' + masterCount + ' canonical row' + (masterCount === 1 ? '' : 's'));
  db.close();
}
```

In `main()`, add:
```javascript
  if (cmd === 'apply-pending') {
    cmdApplyPending(rest[0] || null);
    return;
  }
```

In `usage()`, add:
```javascript
  console.log('  node index.js apply-pending [csv]    apply approve/reject decisions from a filled CSV');
```

- [ ] **Step 10.2: Manual smoke test**

Run: `node index.js apply-pending`
Expected: `no pending CSV at output/csv/pending-changes.csv` (no CSV exists yet).

After Task 9 + Task 10 are both shipped, the round-trip will work end-to-end on a populated DB.

- [ ] **Step 10.3: Run the full suite**

Run: `npm test`
Expected: still 188.

- [ ] **Step 10.4: Commit**

```
git add index.js
git commit -m "feat(cli): apply-pending applies approve/reject decisions from CSV"
```

---

## Task 11: Dashboard `Pending` column

Add a per-project pending count column to the master dashboard.

**Files:**
- Modify: `src/dashboard.js`

- [ ] **Step 11.1: Update `buildProjectStat`**

Read `src/dashboard.js`. Locate `buildProjectStat`. Add a new field to the returned shape (use the existing function signature; the function currently takes `(project, result, auditTaskCount)` — extend with a pending count argument):

```javascript
function buildProjectStat(project, result, auditTaskCount, pendingCount) {
  const base = project.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
  if (!result || result.status !== 'ok') {
    return {
      name: project.project_name,
      base,
      status: result ? result.status : 'no-result',
      matchCount: null,
      buyerCount: null,
      auditCount: null,
      pendingCount: pendingCount != null ? pendingCount : null,
      a10: null,
      a11: null,
      a12: null,
      hasCompare: false
    };
  }
  // ... existing body ...
  return {
    // ... existing fields ...
    pendingCount: pendingCount != null ? pendingCount : 0,
    // ... rest of existing fields ...
  };
}
```

(Read the file to find the exact placement — keep the same return shape style.)

In the `writeDashboardHtml` function, locate the table header row and add a column:
```html
<th data-col="N" class="num">Pending</th>
```
(where N is the next column index; insert between Audit Tasks and A10).

In the same function, find the row construction. Add the new cell:
```javascript
<td class="num warn" data-sort-val="${s.pendingCount == null ? -1 : s.pendingCount}">${fmt(s.pendingCount)}</td>
```

In the totals reduce, add `pending: t.pending + (s.pendingCount || 0)` to the accumulator initial state and to the running total.

In the totals row of the HTML, add:
```html
<td class="num warn">${fmt(totals.pending)}</td>
```

- [ ] **Step 11.2: Update `cmdCompare` to pass the pending count**

In `index.js cmdCompare`, locate the existing `dashboardStats.push(buildProjectStat(p, result, tasks.length))` line. Replace with:
```javascript
const pendingCount = db.prepare(
  `SELECT COUNT(*) AS n FROM pending_change
   WHERE project_id = ? AND decision = 'pending'`
).get(p.project_id).n;
dashboardStats.push(buildProjectStat(p, result, tasks.length, pendingCount));
```

For the error path (where `buildProjectStat(p, { status: 'error: ' + e.message }, null)` is called from the try/catch added in Phase 3): pass `null` as the fourth arg (signaling unknown).

- [ ] **Step 11.3: Manual smoke test**

Run: `node index.js compare "Sobha Hartland Waves"` (or any single project that exists).
Open the resulting `output/dashboard.html` in a browser. Confirm: the new Pending column appears (with `0` for every project initially), totals row shows the right sum.

- [ ] **Step 11.4: Run the full suite**

Run: `npm test`
Expected: still 188.

- [ ] **Step 11.5: Commit**

```
git add src/dashboard.js index.js
git commit -m "feat(dashboard): add Pending column with per-project count and total"
```

---

## Task 12: Menu entries `[V]` and `[B]`; rename `[5]`

**Files:**
- Modify: `src/menu.js`

- [ ] **Step 12.1: Rename existing `[5] Manual Overrides` → `[5] Master Data (staff edits)`**

In `src/menu.js`, locate the menu line for `[5]` (the entry that says `Manual Overrides` or similar). Rename the label to `Master Data (staff edits)`.

The existing function that handles `[5]` (probably `doOverrides()` or similar) writes to `manual_override`. Update it to call `upsertMasterField(db, projectId, unitNumberNorm, 'buyer_name', value, 'staff')` instead of inserting into `manual_override`. The TUI prompts stay the same.

```javascript
const { upsertMasterField } = require('./master-data');
// inside doOverrides (or whatever the function is):
upsertMasterField(db, projectId, unitNumberNorm, 'buyer_name', enteredBuyer, 'staff');
```

- [ ] **Step 12.2: Add `[V] Review pending changes`**

In the menu line list, add (after the existing entries):
```
    [V]  Review pending changes              writes pending-changes.csv and opens it
```

Add a new function:
```javascript
async function doReviewPending() {
  await showHeader(); sectionHeader('REVIEW PENDING CHANGES');
  runNode(['review-pending']);
  // Open the CSV in the OS default editor (Excel on Windows).
  const csvPath = path.join(ROOT, 'output', 'csv', 'pending-changes.csv');
  if (fs.existsSync(csvPath)) {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', csvPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [csvPath], { detached: true, stdio: 'ignore' }).unref();
    }
  }
  await pause();
}
```

Wire it into the dispatch:
```javascript
case 'V': case 'v': await doReviewPending(); break;
```

- [ ] **Step 12.3: Add `[B] Apply pending decisions`**

```
    [B]  Apply pending decisions             reads pending-changes.csv, commits decisions
```

Function:
```javascript
async function doApplyPending() {
  await showHeader(); sectionHeader('APPLY PENDING DECISIONS');
  runNode(['apply-pending']);
  await pause();
}
```

Dispatch:
```javascript
case 'B': case 'b': await doApplyPending(); break;
```

- [ ] **Step 12.4: Manual smoke test**

Run: `dl-processor.bat` (or `node src/menu.js`). Verify:
- The `[5]` label now reads `Master Data (staff edits)`.
- `[V]` runs review-pending and opens the CSV.
- `[B]` runs apply-pending.

- [ ] **Step 12.5: Run the full suite**

Run: `npm test`
Expected: still 188.

- [ ] **Step 12.6: Commit**

```
git add src/menu.js
git commit -m "feat(menu): [5] master data, [V] review pending, [B] apply pending"
```

---

## Task 13: Final integration check

- [ ] **Step 13.1: Run the full pipeline end-to-end on the real DB**

Run:
```
node index.js
```
Expected:
- `[1/5]` through `[5/5]` complete without error.
- Some projects might log `seeded N master rows` after their first import (bootstrap path).
- Compare runs with hybrid lookup; dashboard shows Pending column.

- [ ] **Step 13.2: Run the full test suite once more**

Run: `npm test`
Expected: 188 tests pass.

- [ ] **Step 13.3: Verify the round-trip works on a real project**

Pick any project in your DB. Manually create a discrepancy by editing `master_data.buyer_name` to a different value:
```
node -e "const {openDb}=require('./src/db'); const db=openDb(); db.prepare(\"UPDATE master_data SET buyer_name='TEST_OLD_NAME' WHERE project_id = (SELECT project_id FROM dld_project WHERE project_name='Sobha Hartland Waves') LIMIT 1\").run(); db.close();"
```

Then re-import a recent DLD snapshot for that project. The next import will see DLD's "TEST_OLD_NAME" doesn't match the latest DLD-extracted buyer and create a pending row.

Run:
```
node index.js review-pending "Sobha Hartland Waves"
```
Expected: a CSV with at least 1 row.

Open it, set `decision` to `approve` for the row, save.

Run:
```
node index.js apply-pending
```
Expected: `applied 1 approval`. master_data now has the latest buyer.

(Skip this test if your DB is empty.)

- [ ] **Step 13.4: Confirm git log**

Run: `git log --oneline master..HEAD`
Expected (top to bottom is most recent first):
```
feat(menu): [5] master data, [V] review pending, [B] apply pending
feat(dashboard): add Pending column with per-project count and total
feat(cli): apply-pending applies approve/reject decisions from CSV
feat(cli): review-pending writes pending-changes.csv
feat(compare): hybrid lookup against master_data + PENDING flag in match_flags
refactor(area-template): apply-areas writes to master_data with source=staff
refactor(overrides): read staff overrides from master_data instead of manual_override
feat(import-dld): queue master_data diffs after every snapshot
feat(pending-change): queue, list, apply helpers with sticky reject
feat(master-data): pure helpers getMasterRow/upsertMasterField/seedMasterFromDld
feat(db): migrate manual_override + manual_area into master_data on first run
feat(schema): add master_data and pending_change tables
docs: spec for master_data + approval_queue (S1+S2)
```
13 commits ahead of master.

---

## Out of Scope Reminders

These are intentionally NOT in this plan (per spec §Non-Goals):

- No buyers as first-class entity.
- No four-way HTML report split.
- No SF-side approval queue.
- No multi-user auth.
- No HTML approval UI (CSV round-trip only).
- No auto-approve threshold.
- `manual_override` and `manual_area` tables are NOT dropped (frozen, drop in a follow-up).
- No master_data export.
- No separate master_data_history table.

If any of these come up during implementation, stop and revisit the spec.
