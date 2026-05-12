#!/usr/bin/env node
// Build a DL-Processor patch zip from the current `npm run dist` output.
//
// Usage:
//   node scripts/build-patch.js --from <semver> --to <semver> [--notes "..."]
//
// Inputs:
//   --from   Minimum installed version that this patch can be applied on top of.
//            Example: 1.2.0 means "only applies if currently running v1.2.0 or
//            newer". Lets one patch span multiple consecutive versions.
//   --to     Target version the patch upgrades to. Must match package.json's
//            current `version` field — checked at build time.
//   --notes  Free-text release notes shown in the Apply Update modal.
//
// Reads:    dist-electron/win-unpacked/resources/app.asar
// Writes:   dist-electron/dlp-patch-v{from}-to-v{to}.zip
//
// Run `npm run dist` BEFORE this script. We don't trigger dist ourselves because
// the user might want to ship the same dist output as both a full .exe and a
// patch (e.g., first install vs upgrade).

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

function arg(name, required = false) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1 || i === process.argv.length - 1) {
    if (required) {
      console.error('missing required arg: --' + name);
      process.exit(1);
    }
    return null;
  }
  return process.argv[i + 1];
}

function main() {
  const from  = arg('from', true);
  const to    = arg('to',   true);
  const notes = arg('notes') || '';

  const repoRoot = path.join(__dirname, '..');
  const pkgPath  = path.join(repoRoot, 'package.json');
  const pkg      = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  if (pkg.version !== to) {
    console.error('--to (' + to + ') must match package.json version (' + pkg.version + ')');
    console.error('bump version first, then re-run');
    process.exit(1);
  }

  const asarPath = path.join(repoRoot, 'dist-electron', 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    console.error('missing ' + asarPath);
    console.error('run `npm run dist` first');
    process.exit(1);
  }

  const asarBytes = fs.readFileSync(asarPath);
  const asarSha   = crypto.createHash('sha256').update(asarBytes).digest('hex');

  const manifest = {
    app_id:           'ae.sobha.dl-processor',
    from_version_min: from,
    to_version:       to,
    built_at:         new Date().toISOString(),
    asar_sha256:      asarSha,
    asar_size:        asarBytes.length,
    release_notes:    notes
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile('app.asar',      asarBytes);

  const outDir  = path.join(repoRoot, 'dist-electron');
  const outName = 'dlp-patch-v' + from + '-to-v' + to + '.zip';
  const outPath = path.join(outDir, outName);
  zip.writeZip(outPath);

  const zipBytes = fs.statSync(outPath).size;
  console.log('wrote', outPath);
  console.log('  size:        ' + (zipBytes / (1024 * 1024)).toFixed(2) + ' MB');
  console.log('  asar size:   ' + (asarBytes.length / (1024 * 1024)).toFixed(2) + ' MB');
  console.log('  asar sha256: ' + asarSha);
  console.log('  from:        ' + from + '+');
  console.log('  to:          ' + to);
  if (notes) console.log('  notes:       ' + notes);
}

main();
