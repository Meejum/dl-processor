const AdmZip = require('adm-zip');

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractGlyphs(pageXml) {
  const glyphs = [];
  const canvasRegex = /<Canvas\b[^>]*>/g;
  const canvasCloseRegex = /<\/Canvas>/g;
  const stack = [{ x: 0, y: 0 }];
  const tokenRegex = /<Canvas\b[^>]*?>|<\/Canvas>|<Glyphs\b[^>]*?\/>|<Glyphs\b[^>]*?>[\s\S]*?<\/Glyphs>/g;

  let m;
  while ((m = tokenRegex.exec(pageXml))) {
    const tok = m[0];
    if (tok.startsWith('</Canvas')) {
      if (stack.length > 1) stack.pop();
    } else if (tok.startsWith('<Canvas')) {
      const rtMatch = tok.match(/RenderTransform="([^"]+)"/);
      const parent = stack[stack.length - 1];
      if (rtMatch) {
        const parts = rtMatch[1].split(',').map(Number);
        stack.push({ x: parent.x + parts[4], y: parent.y + parts[5] });
      } else {
        stack.push({ x: parent.x, y: parent.y });
      }
    } else if (tok.startsWith('<Glyphs')) {
      const usMatch = tok.match(/UnicodeString="([^"]*)"/);
      if (!usMatch) continue;
      const text = decodeEntities(usMatch[1]);
      const oxMatch = tok.match(/OriginX="([-\d.eE]+)"/);
      const oyMatch = tok.match(/OriginY="([-\d.eE]+)"/);
      const ox = oxMatch ? parseFloat(oxMatch[1]) : 0;
      const oy = oyMatch ? parseFloat(oyMatch[1]) : 0;
      const parent = stack[stack.length - 1];
      glyphs.push({ x: parent.x + ox, y: parent.y + oy, t: text });
    }
  }
  return glyphs;
}

function extractXps(xpsPath) {
  const zip = new AdmZip(xpsPath);
  const entries = zip.getEntries();
  const pages = [];
  for (const e of entries) {
    const name = e.entryName.replace(/\\/g, '/');
    const match = name.match(/Documents\/\d+\/Pages\/(\d+)\.fpage$/);
    if (!match) continue;
    const pageNum = parseInt(match[1], 10);
    const xml = e.getData().toString('utf8');
    const glyphs = extractGlyphs(xml);
    glyphs.sort((a, b) => a.y - b.y || a.x - b.x);
    pages.push({ pageNum, glyphs });
  }
  pages.sort((a, b) => a.pageNum - b.pageNum);
  return pages;
}

function groupRows(glyphs, tolerance = 3) {
  const rows = [];
  let current = null;
  for (const g of glyphs) {
    if (!current || Math.abs(g.y - current.y) > tolerance) {
      current = { y: g.y, items: [g] };
      rows.push(current);
    } else {
      current.items.push(g);
    }
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }
  return rows;
}

module.exports = { extractXps, groupRows };
