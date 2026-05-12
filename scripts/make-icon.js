#!/usr/bin/env node
// One-shot: convert electron/assets/icon-source.png into a multi-resolution
// icon.ico that electron-builder packs into the .exe. Re-run only when the
// source PNG changes; the produced icon.ico is committed.

const fs   = require('fs');
const path = require('path');
const toIco = require('to-ico');

const SRC = path.join(__dirname, '..', 'electron', 'assets', 'icon-source.png');
const OUT = path.join(__dirname, '..', 'electron', 'assets', 'icon.ico');

const src = fs.readFileSync(SRC);
toIco([src], { resize: true, sizes: [16, 24, 32, 48, 64, 128, 256] })
  .then((buf) => {
    fs.writeFileSync(OUT, buf);
    console.log('wrote', OUT, '(' + buf.length + ' bytes)');
  })
  .catch((err) => {
    console.error('icon build failed:', err.message);
    process.exit(1);
  });
