#!/usr/bin/env node
// One-shot: render electron/assets/icon.svg into a multi-resolution icon.ico
// that electron-builder packs into the .exe. SVG → PNG via @resvg/resvg-js
// (Rust rasterizer, vector-crisp at every size), PNG → ICO via to-ico.
//
// Re-run only when icon.svg changes; the produced icon.ico is committed.

const fs    = require('fs');
const path  = require('path');
const { Resvg } = require('@resvg/resvg-js');
const toIco = require('to-ico');

const SVG  = path.join(__dirname, '..', 'electron', 'assets', 'icon.svg');
const OUT  = path.join(__dirname, '..', 'electron', 'assets', 'icon.ico');

// electron-builder requires a 256x256 entry, so include it. The Windows
// taskbar/Start menu use 16/24/32/48; the installer uses 256.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Render the DL silhouette on a soft cream square (matches the in-app
// Sobha palette). This gives a recognizable Sobha brand mark on the
// Windows desktop / taskbar / installer where the icon shows on a
// neutral background. The SVG itself uses currentColor; we wrap it
// in a background so the icon doesn't disappear on light Windows themes.
const WRAPPED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="14" fill="#F0E4CE"/>
  <g style="color:#5C3D1E">
    <path fill="currentColor" fill-rule="evenodd" d="M 10 12 H 50 A 30 38 0 0 1 50 88 H 10 Z M 22 24 V 76 H 46 A 18 26 0 0 0 46 24 Z"/>
    <path fill="currentColor" d="M 58 12 H 72 V 74 H 90 V 88 H 58 Z"/>
  </g>
</svg>`;

async function main() {
  // Sanity check the SVG exists (we don't actually use it — we use the
  // wrapped variant inline above — but its presence proves the design
  // file is committed and reviewable).
  if (!fs.existsSync(SVG)) {
    console.error('missing source SVG:', SVG);
    process.exit(1);
  }

  const pngs = [];
  for (const size of SIZES) {
    const resvg = new Resvg(WRAPPED, { fitTo: { mode: 'width', value: size } });
    const png = resvg.render().asPng();
    pngs.push(png);
  }

  const ico = await toIco(pngs);
  fs.writeFileSync(OUT, ico);
  console.log('wrote', OUT, '(' + ico.length + ' bytes, sizes:', SIZES.join('/'), ')');
}

main().catch((err) => {
  console.error('icon build failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
