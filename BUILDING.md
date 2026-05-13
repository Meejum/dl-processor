# Building & Releasing DL-Processor Desktop

Notes for producing the Windows `.exe` from this repo.

## Prerequisites

One-time setup on a clean Windows machine:

- **Windows 10 / 11** (the build target — desktop is Windows-only for v1.0).
- **Node.js 18 or 22 LTS** on PATH. Node 24 currently lacks pre-built `better-sqlite3` Electron binaries; use 22.
- **Python 3.10+** on PATH. Required by `node-gyp` when electron-builder rebuilds `better-sqlite3` against Electron's ABI. Easiest path on Windows: open the **Microsoft Store** and install "Python 3.12" (no admin needed).
- **C++ build tools** are sometimes required if `node-gyp` can't find prebuilt binaries. If `npm run dist` fails inside the rebuild step with a Visual Studio error, install the **"Desktop development with C++" workload** via the Visual Studio Build Tools installer (no admin required for the Standalone Build Tools edition).
- ~3 GB free disk for the Electron + electron-builder caches.

After install, confirm versions:

```bat
node --version    :: → v22.x (or v18.x)
npm --version     :: → 9.x or newer
python --version  :: → 3.10 or newer
```

## Local development

```bat
git clone <repo>
cd DL-Processor
npm install              :: ~2 minutes; pulls Electron + rebuilds native modules
npm run start:electron   :: opens the dev window with DevTools off
npm run dev:electron     :: same, but opens DevTools auto
```

To clear the first-run wizard for re-testing:

```bat
del "%APPDATA%\dl-processor\config.json"
```

## Building the Windows installer

```bat
npm run dist
```

Produces inside `dist-electron/`:

- `DL-Processor Setup 1.0.0.exe` — NSIS installer (~75-100 MB)
- `DL-Processor-1.0.0-win.zip` — portable zip (~80-110 MB)
- `latest.yml` — manifest read by the in-app update checker
- `win-unpacked/` — the raw unpacked app (handy for debugging)

Build time: **~3-5 minutes warm**; **~10 minutes cold** (first Electron download caches under `%LOCALAPPDATA%\electron\Cache\`).

### What's in the package

`electron-builder.yml` controls inclusion:

- All of `src/`, `electron/`, `index.js`, `db/schema.sql`, `config/`, `package.json`
- `node_modules/**/*` minus the data folders (`input/`, `sf-input/`, `output/`, `data/`, `logs/`)
- `node_modules/better-sqlite3/**/*` is **unpacked** from the asar archive — the native `.node` binary cannot be loaded from inside an asar.

### NSIS installer behavior

- Installs per-user (no admin prompt) to `%LOCALAPPDATA%\Programs\DL-Processor\`.
- User can change the install location via the wizard.
- Creates a desktop shortcut and a Start Menu entry.
- Registers in **Settings → Apps → Installed apps** for uninstall.
- Uninstaller preserves the user's data folder (`~/Documents/DL-Processor/` or wherever the wizard pointed) — only program files are removed.

### Code-signing / SmartScreen

We're not code-signing v1.0. On a fresh machine the user will see:

> Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting.

Click **More info** → **Run anyway**. This is a one-time prompt per user; Windows tracks the SHA after that.

If we sign later (an Authenticode cert + a Windows-signing dance) the prompt goes away. Plan for v1.1.

## Releasing a new version

1. **Bump version.** Edit `package.json` `"version"`. Semver: `1.0.0` → `1.0.1` (patch) → `1.1.0` (minor feature) → `2.0.0` (breaking).
2. **Build.** `npm run dist`.
3. **Test locally.** Run the new `.exe`; verify first-run wizard, sidebar commands, Approve pending tab, DB export/import. Optionally clear `%APPDATA%\dl-processor\` first to simulate a clean install.
4. **Update changelog.** Edit `changelog.md` in the `dl-processor-releases` Cloudflare-Pages repo.
5. **Copy artifacts.** Copy these three files from `dist-electron/` into the releases repo root:
   - `DL-Processor Setup X.X.X.exe`
   - `DL-Processor-X.X.X-win.zip`
   - `latest.yml`
6. **Commit + push.**
   ```bash
   cd ~/dl-processor-releases
   git add .
   git commit -m "release: X.X.X"
   git push
   ```
7. **Verify.** Cloudflare Pages publishes within ~30 seconds. Open `https://dl-processor.pages.dev/latest.yml` and confirm the new version.
8. **Notify.** Colleagues using the desktop app see the new version on next launch via **Settings → Check for updates**.

## Schema migrations

v1.1 introduces a migration framework at `src/migrations/`. Migrations run automatically at every `openDb()` call — there's no separate "upgrade" step. Applied migrations are tracked in a `schema_migration` table (`id TEXT PRIMARY KEY, name TEXT, applied_at TEXT`); only un-applied ids execute on a given launch.

Each migration is wrapped in a single transaction — failure rolls back cleanly. If a migration takes longer than ~2 seconds the renderer shows a brief *"Upgrading database…"* splash so the user knows the app isn't hung.

To inspect what's been applied to a given DB:

```bat
sqlite3 data\dld-sync.sqlite "SELECT * FROM schema_migration ORDER BY applied_at;"
```

Migrations are idempotent — safe to re-run. Adding a new migration is a single append to the array in `src/migrations/index.js`; don't edit or renumber previously-shipped entries.

## Common troubleshooting

**`npm run dist` fails inside "rebuilding native dependencies"**
→ Python isn't on PATH. Install via Microsoft Store (no admin). Restart cmd window. Try again.

**`prebuild-install warn install No prebuilt binaries found (target=28.3.3 runtime=electron arch=x64 ...)`**
→ Expected. `better-sqlite3@12.9.0` doesn't ship Electron 28 prebuilts. electron-builder falls back to a source build — that's what needs Python + C++ tools.

**`ERR_DLOPEN_FAILED` when running `npm run start:electron` after a failed `dist`**
→ The aborted rebuild left `better-sqlite3` in a broken state. Recover:
```bat
rmdir /s /q node_modules\better-sqlite3
npm install better-sqlite3@^12.9.0
```

**Icon is a placeholder / generic Electron icon**
→ Replace `electron/assets/icon.ico` with a multi-resolution Sobha icon (16/32/48/64/128/256 px). Tools: an online converter, ImageMagick `magick convert sobha-logo.png -define icon:auto-resize=256,128,64,48,32,16 electron/assets/icon.ico`, or Photoshop's "Save As .ico" multi-size export.

---

## Releasing patch updates (v1.2+)

From v1.2 onward, every release also produces a small zip patch (~5-15 MB instead of the 78 MB full installer). Build flow:

```bat
REM 1. Bump version in package.json (e.g., 1.2.0 → 1.3.0)
REM 2. Clean rebuild the full installer (also produces the unpacked asar we need)
rmdir /s /q dist-electron
npm run dist

REM 3. Build the patch zip from the dist output
node scripts/build-patch.js --from 1.2.0 --to 1.3.0 --notes "BP grouping for Review Pending"

REM Output: dist-electron\dlp-patch-v1.2.0-to-v1.3.0.zip
```

`--from` is the **minimum** installed version the patch can be applied on top of. Use `1.2.0` if any v1.2.x install should be able to receive this patch.

`--to` MUST match the current `package.json` version. The build script verifies this.

The script prints the SHA-256 of the asar. Optionally share this with users so they can verify what they received hasn't been tampered with (the modal also shows the same hash).

### Sharing patches with the team

1. Upload `dlp-patch-vA-to-vB.zip` to OneDrive / email / shared drive
2. Tell users to open DL-Processor → sidebar → **⬆ Apply update** → pick the zip
3. App verifies the zip, shows summary, user clicks Apply & Restart
4. App quits, helper script swaps the asar, app relaunches with new version

If anything goes wrong: users can Settings → **Revert last patch** to restore the previous `app.asar.bak`.

### What CAN'T be patched

- Electron runtime version (stays at 28.x for v1.x)
- Native modules (`better-sqlite3`) — their .node binary doesn't change across v1.x
- The `patch-apply.cmd` helper itself — if it needs changes, requires a full installer release

For any of those, ship a full `.exe` installer instead.

### v2.0 patch zip workflow

v2.0 is the first real-world patch (v1.2.0 → v2.0.0). The build flow:

```bat
npm run dist
node scripts/build-patch.js --from 1.2.0 --to 2.0.0 --notes "BP grouping, de-iframe, DLD drift"
```

Expected patch zip size: **10-15 MB compressed** (the asar alone is ~17 MB; the build script compresses + deduplicates). This is well under the full installer size (~78 MB) and within the v1.2 design target.

The new schema migrations (006 + 007) ship inside the asar and run automatically on first launch after the patch is applied — no separate upgrade step.

---

## BP classifier — how to extend

`src/bp-classifier.js` exports `classifyBp(fieldSet)` — a pure function that takes a Set of changed field names and returns one of the seven BP labels (Resale / Buyer correction / Price amendment / Status update / Procedure update / Area correction / Multi-field update). The implementation is **first-match-wins**: each case checks whether the field set matches a known pattern, and the first match wins. The fallback at the bottom returns `'Multi-field update'`.

```js
// src/bp-classifier.js (shape)
function classifyBp(fieldSet) {
  if (matchesResale(fieldSet))          return 'Resale';
  if (matchesBuyerCorrection(fieldSet)) return 'Buyer correction';
  if (matchesPriceAmendment(fieldSet))  return 'Price amendment';
  if (matchesStatusUpdate(fieldSet))    return 'Status update';
  if (matchesProcedureUpdate(fieldSet)) return 'Procedure update';
  if (matchesAreaCorrection(fieldSet))  return 'Area correction';
  return 'Multi-field update';
}
```

**To add a new BP label:**

1. Append a new `if (matchesXxx(fieldSet)) return 'Xxx';` case **BEFORE** the `return 'Multi-field update'` fallback. Order matters — the first match wins, so more-specific patterns must come first.
2. Add a test case in `test/bp-classifier.test.js` covering the new pattern.
3. No schema change needed — labels are computed from `pending_change.field` at render time, not persisted.

Update the BP-type filter dropdown in the Review Pending pane if you want the new label selectable via the filter bar.

---

## SF state classifier — adapting to new SF status values

`src/sf-state.js` exports `classifyState(sfRow)` — returns one of `READY` / `IN_PROGRESS` / `DLD_ISSUE` / `REJECTED` / `NO_SF_ROW`. Driven by `sf_booking.status` and `sf_booking.dld_process_status`.

```js
// src/sf-state.js (shape)
function classifyState(sfRow) {
  if (!sfRow)                                       return 'NO_SF_ROW';
  if (isRejected(sfRow.status))                     return 'REJECTED';
  if (hasDldIssue(sfRow.dld_process_status))        return 'DLD_ISSUE';
  if (isReady(sfRow.status))                        return 'READY';
  return 'IN_PROGRESS';   // warn-by-default
}
```

The classifier is **conservative**: any unrecognized `status` value falls through to `IN_PROGRESS` (warn-by-default — disables `Approve all` until a human confirms). This is intentional: it's safer to over-prompt than to auto-approve a state we don't understand.

**To add a new known state value** (e.g., Salesforce adds a new status flow):

1. Edit the relevant predicate in `src/sf-state.js` (`isReady` / `isRejected` / `hasDldIssue`).
2. Add a test case in `test/sf-state.test.js` covering the new value.
3. If the new state needs a new badge color or action-button gating, update the Review Pending pane renderer in `electron/renderer/review-pending.js`.

`DLD_ISSUE` has higher precedence than `READY` — if both apply (e.g., `status='Approved'` but `dld_process_status='Submitted to DLD'`), the card lands in `DLD_ISSUE`.

---

## Extending tier-2 detection

`src/tier2.js` exports `isTier2(field, oldValue, newValue, thresholds)` — a pure function used by both the renderer (to know when to show the justification modal) AND the backend (defense-in-depth re-check inside `approvePending`). Only two dimensions are tier-2-eligible today:

```js
// src/tier2.js (shape)
const DEFAULT_THRESHOLDS = Object.freeze({
  tier2_price_pct: 10,      // 10% price change
  tier2_price_abs: 50000,   // 50,000 AED absolute
  tier2_area_pct:  5        // 5% area change
});

function isTier2(field, oldValue, newValue, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  if (field === 'purchase_price_aed') {
    // strict greater-than on either pctDelta or absDelta
  }
  if (field === 'area_sqm') {
    // strict greater-than on pctDelta
  }
  // Other AUDIT_FIELDS (buyer_name, status, procedure_number) are NEVER tier-2
  return false;
}
```

The comparison is **strict greater-than** (`pctDelta > t.tier2_price_pct`) — boundary cases (exactly 10%, exactly 50K AED) do NOT trip the gate. This is deliberate: round-number changes are common in price amendments and shouldn't always be tier-2.

**To add a new tier-2 dimension** (e.g., gate `procedure_number` changes when they cross a procedure-number range):

1. Edit `src/tier2.js` — add an `if (field === '<new_field>')` branch with the magnitude check.
2. Add a threshold key to `DEFAULT_THRESHOLDS` (and the threshold object the caller passes in).
3. Add the matching Settings field — `electron/renderer/settings.js` defines the form layout and the IPC store; mirror the existing `tier2_*` fields.
4. Add a test case in `test/tier2.test.js` covering the new dimension at, below, and above the threshold.

Magnitude-based fields are the natural fit. Non-magnitude fields (`buyer_name`, `status`) deliberately return `false` — there's no meaningful "delta > X" for a string.

---

## Hash format for the audit chain

`src/audit-hash.js` exports `canonicalize(row)` — a **stable** JSON serialization of an `audit_log` row used as input to the SHA-256 chain (`computeRowHash` and `chainAppend`).

```js
// src/audit-hash.js (shape)
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
```

The field order is **explicit** — not `Object.keys(row).sort()` — so that future column additions are deliberate. `prev_hash` and `row_hash` themselves are intentionally excluded (a row can't hash itself recursively).

**Migration pattern when adding a new chain-relevant column:**

If a future migration adds an `audit_log` column that should participate in the chain (e.g., `reviewer_id`, `severity`):

1. Migration appends the column as nullable.
2. **In the same migration**, re-canonicalize every existing row using a frozen snapshot of the new `canonicalize` (with the new field included), backfill `row_hash` chain in `(ts, audit_id)` order, and overwrite both `prev_hash` and `row_hash` end-to-end. Otherwise old rows' hashes won't match the new computation and the chain looks broken from day one.
3. **Add the field to `canonicalize` in the same commit** as the migration. Skipping this step means new rows after the migration will hash without the new field, but old rows (backfilled with it) will hash with the new field — the chain breaks at the migration boundary.
4. Add a test in `test/audit-hash.test.js` covering the new field's presence in the canonicalization output.

Migration 008 (`2026-05-13-008-audit-hardening`) is the reference implementation — it adds `user`, `tier2`, `prev_hash`, `row_hash` and backfills the chain forward from genesis (`'0' x 64`) in one idempotent pass.

---

## Adding revertable actions

`src/audit-fields.js` exports `REVERTABLE_ACTIONS` — the Set of `audit_log.action` values for which the History row `[↶ Revert]` button is rendered:

```js
// src/audit-fields.js
const REVERTABLE_ACTIONS = Object.freeze(new Set([
  'approve', 'override', 'approve_bp', 'revert'
]));
```

Actions absent from this set (`auto_apply`, `reject`, `learn_alias`, `acknowledge_bp`, `reject_bp`) don't get a button — they didn't modify `master_data`, so reverting them is a no-op the UI shouldn't offer.

**To add a new revertable action** (e.g., a future `bulk_approve` action that mutates many `master_data` rows in one go):

1. **Migration** — widen the `audit_log.action` CHECK constraint to include the new value (see migration 007 / 008 for the pattern). The CHECK is a table-level constraint, so the migration has to `CREATE TABLE audit_log_new` with the new CHECK, copy rows over, and rename.
2. **Add to `REVERTABLE_ACTIONS`** in `src/audit-fields.js` **only if** the action actually wrote to `master_data` and there's an `old_value` / `new_value` pair to restore. If it didn't (e.g., it's a pure log marker), leave it out.
3. **Renderer button gating** — the History page (`electron/renderer/history.js`) reads `REVERTABLE_ACTIONS` to decide whether to render the button. The check should remain `REVERTABLE_ACTIONS.has(row.action) && row.table_name === 'master_data'` — both conditions matter.
4. **Test case** — add to `test/revert.test.js` covering the new action's revert path end-to-end (revert restores `master_data` and appends a new `audit_log` row with `action='revert'`).

The `revert` action is itself in the set — so a revert is revertable (you can revert your revert), and the chain walks back another step.
