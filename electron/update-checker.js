function parseLatestYml(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function compareVersions(a, b) {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] || 0, bv = bp[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function buildUpdateResult(currentVersion, parsedYml, baseUrl) {
  const cmp = compareVersions(parsedYml.version, currentVersion);
  if (cmp <= 0) {
    return {
      status: 'up-to-date',
      current: currentVersion,
      message: 'You are up to date (' + currentVersion + ').'
    };
  }
  const file = parsedYml.path;
  return {
    status: 'available',
    current: currentVersion,
    available: parsedYml.version,
    downloadUrl: baseUrl + '/' + encodeURIComponent(file),
    releaseDate: parsedYml.releaseDate,
    message: 'Update available: ' + parsedYml.version + ' (you have ' + currentVersion + ')'
  };
}

async function checkForUpdates({ currentVersion, baseUrl, fetchImpl }) {
  const fetch = fetchImpl || globalThis.fetch;
  const res = await fetch(baseUrl + '/latest.yml');
  if (!res.ok) throw new Error('update server returned ' + res.status);
  const text = await res.text();
  const parsed = parseLatestYml(text);
  if (!parsed.version) throw new Error('latest.yml is missing version field');
  return buildUpdateResult(currentVersion, parsed, baseUrl);
}

module.exports = { parseLatestYml, compareVersions, buildUpdateResult, checkForUpdates };
