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

// ---------------------------------------------------------------------------
// Bank / financial-entity name patterns
// ---------------------------------------------------------------------------
// Used in compare.js (regex) and overrides.js (SQL LIKE fragments) to identify
// DLD transaction parties that are banks/mortgagees rather than individual buyers.
//
// ⚠️  "AL " (with trailing space) is kept deliberately — bare "AL" without a
// space would collide with Arabic-article prefixes in personal names like
// "AL FARSI". The current regex in compare.js uses /^AL\s/ which catches
// "AL ANSARI EXCHANGE" etc. while avoiding plain personal-name tokens.
// This behaviour is intentionally preserved here; do not remove the \s.
//
// Each string is a plain keyword/prefix. BANK_PREFIX_RE is built from them.
// BANK_SQL_CONDITIONS builds the SQL LIKE fragment for overrides.js queries.
const BANK_PATTERNS = [
  'BANK',           // catches "%BANK%" anywhere (most common)
  'COMMERCIAL ',    // COMMERCIAL BANK OF..., etc.
  'EMIRATES ',      // EMIRATES NBD, EMIRATES ISLAMIC, etc.
  'DUBAI ISLAMIC',  // specific: avoids "DUBAI" as city alone
  'ABU DHABI ',     // ABU DHABI COMMERCIAL, ABU DHABI ISLAMIC, etc.
  'AJMAN ',         // AJMAN BANK
  'SHARJAH ',       // SHARJAH ISLAMIC BANK, etc.
  'AL ',            // ⚠️ see note above — requires trailing space to avoid name collision
  'HSBC',
  'MASHREQ',
  'UNION NATIONAL', // UNION NATIONAL BANK
  'FIRST ABU DHABI',
  'FAB',            // First Abu Dhabi Bank abbreviation
  'RAK BANK',
  'NATIONAL BANK OF',
  'ENBD',           // Emirates NBD abbreviation
  'SAMBA',
  'SABB',
  'RIYAD',          // RIYAD BANK
  'ARAB ',          // ARAB BANK, etc. — trailing space avoids "ARAB" in personal names
  'EMIRATES NBD',
  'EMIRATES ISLAMIC'
];

// Regex for compare.js: anchored at start-of-string (^) so only name prefixes match.
// The alternation is built from BANK_PATTERNS sorted longest-first so that
// "EMIRATES NBD" matches before bare "EMIRATES".
const BANK_PREFIX_RE = new RegExp(
  '^(' +
  BANK_PATTERNS
    .slice()
    .sort((a, b) => b.length - a.length)   // longest first — avoids short prefix shadowing
    .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') +
  ')',
  'i'
);

// SQL LIKE fragments for overrides.js (upper-cased party_name column).
// Each entry becomes:  lt.party_name LIKE '<fragment>'
// We use the same BANK_PATTERNS list to stay in sync.
const BANK_SQL_CONDITIONS = BANK_PATTERNS.map(p => {
  // "BANK" as a substring → %BANK%; everything else is a prefix → 'PATTERN%'
  if (p === 'BANK') return `lt.party_name LIKE '%BANK%'`;
  // Trailing space in pattern (e.g. "AL ") — keep it; LIKE is not anchored
  return `lt.party_name LIKE '${p.trimEnd()}%'`;
}).join('\n        OR ');

module.exports = {
  asNumber,
  stripAedLeak,
  parsePartyText,
  parseAmountText,
  normalizeUnitNumber,
  SHARE_RE,
  BANK_PATTERNS,
  BANK_PREFIX_RE,
  BANK_SQL_CONDITIONS
};
