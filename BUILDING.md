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
