const fs = require('fs');
const path = require('path');

function archiveOutput(outputDir) {
  const ts = new Date().toISOString().replace('T', '-').replace(/:/g, '-').slice(0, 16);
  const archiveRoot = path.join(outputDir, 'archive');
  const dest = path.join(archiveRoot, ts);
  if (!fs.existsSync(outputDir)) {
    return { ok: false, reason: 'output dir does not exist' };
  }
  fs.mkdirSync(dest, { recursive: true });
  const copyRec = (src, dst) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (src === outputDir && entry.name === 'archive') continue;
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copyRec(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
      }
    }
  };
  copyRec(outputDir, dest);
  const count = (function walk(dir) {
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += walk(path.join(dir, e.name));
      else n += 1;
    }
    return n;
  })(dest);
  return { ok: true, dest, count };
}

module.exports = { archiveOutput };
