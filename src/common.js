function asNumber(s) {
  if (s == null || s === '' || s === '-') return null;
  const v = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

function stripAedLeak(name) {
  return String(name || '').replace(/^AED\s*/, '').trim();
}

const SHARE_RE = /^(.*?)\(\s*([-\d.]+)\s*(F\.T\.|SQ\.M\.?)\s*\)\s*$/;

function parsePartyText(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const m = trimmed.match(SHARE_RE);
  if (!m) return { name: stripAedLeak(trimmed), ftShare: null, shareUnit: null, raw };
  return {
    name: stripAedLeak(m[1].trim()),
    ftShare: asNumber(m[2]),
    shareUnit: m[3].trim(),
    raw
  };
}

function parseAmountText(raw) {
  if (!raw) return { amount: null, nameOverflow: '', inlineParty: null };
  const s = String(raw);
  let m = s.match(/^\s*([\d.,]+)\s*AED\s*(.*)$/);
  if (!m) {
    const bareNum = s.match(/^\s*([\d.,]+)\s*$/);
    if (bareNum) return { amount: asNumber(bareNum[1]), nameOverflow: '', inlineParty: null };
    return { amount: null, nameOverflow: '', inlineParty: null };
  }
  const leftover = m[2].trim();
  const ftMatch  = leftover.match(SHARE_RE);
  if (ftMatch) {
    return {
      amount: asNumber(m[1]),
      nameOverflow: '',
      inlineParty: {
        name: stripAedLeak(ftMatch[1].trim()),
        ftShare: asNumber(ftMatch[2]),
        shareUnit: ftMatch[3].trim()
      }
    };
  }
  return { amount: asNumber(m[1]), nameOverflow: leftover, inlineParty: null };
}

function normalizeUnitNumber(raw) {
  if (raw == null) return null;
  return String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
}

module.exports = {
  asNumber,
  stripAedLeak,
  parsePartyText,
  parseAmountText,
  normalizeUnitNumber,
  SHARE_RE
};
