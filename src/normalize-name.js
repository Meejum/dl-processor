const transliterationMap = require('./transliteration-map');

const TITLE_RE = /^(mr|mrs|ms|miss|dr|eng|sheikh|sh)\s*\.?\s+/i;
const PUNCT_RE = /[.\-_,]/g;
const WS_RE    = /\s+/g;

// Build a regex once per process that matches any transliteration variant
// as a whole token, longest-first to prefer 'al-ghumlasi' over 'al'.
const VARIANTS = Object.keys(transliterationMap)
  .sort((a, b) => b.length - a.length)
  .map(v => v.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));   // regex-escape

const TRANSLIT_RE = new RegExp('\\b(' + VARIANTS.join('|') + ')\\b', 'g');

function normalizeName(raw) {
  if (raw == null) return '';
  let s = String(raw).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(TITLE_RE, '');
  s = s.replace(PUNCT_RE, ' ');
  s = s.replace(WS_RE, ' ').trim();
  s = s.replace(TRANSLIT_RE, (m) => transliterationMap[m] || m);
  s = s.replace(WS_RE, ' ').trim();
  return s;
}

module.exports = { normalizeName };
