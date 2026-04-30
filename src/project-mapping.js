const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'project-mapping.json');

function loadOverrides() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return raw.overrides || {};
  } catch (e) {
    console.warn('[mapping] could not read', CONFIG_PATH, '-', e.message);
    return {};
  }
}

function inferSubProjectPrefixes(sfRows) {
  const byProject = new Map();
  for (const r of sfRows) {
    if (!r.subProject || !r.unit) continue;
    const m = String(r.unit).match(/^([A-Z]+)-/);
    if (!m) continue;
    const prefix = m[1];
    if (!byProject.has(r.subProject)) byProject.set(r.subProject, new Map());
    const cnt = byProject.get(r.subProject);
    cnt.set(prefix, (cnt.get(prefix) || 0) + 1);
  }
  const out = new Map();
  for (const [sub, prefixes] of byProject.entries()) {
    let best = null, bestCount = 0, totalCount = 0;
    for (const [pref, cnt] of prefixes.entries()) {
      totalCount += cnt;
      if (cnt > bestCount) { best = pref; bestCount = cnt; }
    }
    const project = sfRows.find(r => r.subProject === sub)?.project || null;
    out.set(sub, { sub_project: sub, prefix: best, total: totalCount, project });
  }
  return out;
}

// Tokenize a project name into lower-case alphanumeric words ≥3 chars long.
// Drops generic real-estate words that appear in many project names and would
// otherwise produce spurious matches.
const PROJECT_STOPWORDS = new Set([
  'sobha', 'tower', 'towers', 'building', 'phase', 'plot',
  'block', 'residence', 'residences', 'community', 'project'
]);

function projectTokens(name) {
  const out = new Set();
  if (!name) return out;
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return out;
  const words = cleaned.split(/\s+/).filter(w => w.length >= 3 && !PROJECT_STOPWORDS.has(w));
  for (const w of words) out.add(w);
  // Add the no-space concatenation as a pseudo-token so "Sea Haven" can
  // match a DLD form like "Seahaven" (and vice versa).
  if (words.length >= 2) out.add(words.join(''));
  return out;
}

function guessSubProjectFromDldName(dldName, inferred) {
  if (!dldName) return null;
  const lc = dldName.toLowerCase();

  // Pass 1: exact substring (preserves existing behaviour).
  let best = null, bestLen = 0;
  for (const [sub] of inferred.entries()) {
    const subLc = sub.toLowerCase();
    if (lc.includes(subLc) && subLc.length > bestLen) {
      best = sub; bestLen = subLc.length;
    }
  }
  if (best) return best;

  // Pass 2: token-overlap fallback.
  const dldTokens = projectTokens(dldName);
  if (dldTokens.size === 0) return null;
  let bestSub = null, bestScore = 0;
  for (const [sub] of inferred.entries()) {
    const subTokens = projectTokens(sub);
    if (subTokens.size === 0) continue;
    let shared = 0;
    for (const t of subTokens) if (dldTokens.has(t)) shared++;
    if (shared === 0) continue;
    // Prefer candidates that share more tokens; tie-break on subTokens.size
    // so longer SF names (e.g. "Creek Vistas Grande") beat shorter prefixes.
    const score = shared * 1000 + subTokens.size;
    if (score > bestScore) { bestSub = sub; bestScore = score; }
  }
  if (!bestSub) return null;
  // Accept the match if either:
  //   (a) shared tokens cover at least half of the SF candidate's tokens, OR
  //   (b) at least one shared token is long enough (≥6 chars) to be distinctive
  //       on its own — handles spacing variants like "Seahaven" vs "Sea Haven"
  //       which share a single concatenation pseudo-token.
  const bestTokens = projectTokens(bestSub);
  let sharedCount = 0;
  let hasLongShared = false;
  for (const t of bestTokens) {
    if (dldTokens.has(t)) {
      sharedCount++;
      if (t.length >= 6) hasLongShared = true;
    }
  }
  if (sharedCount * 2 < bestTokens.size && !hasLongShared) return null;
  return bestSub;
}

function buildMappingFor(dldProjectName, sfRows) {
  const overrides = loadOverrides();
  const inferred  = inferSubProjectPrefixes(sfRows);

  if (overrides[dldProjectName]) {
    const o = overrides[dldProjectName];
    return {
      source: 'override',
      sf_project:     o.sf_project || null,
      sf_sub_project: o.sf_sub_project,
      sf_unit_prefix: o.sf_unit_prefix,
      unitTransforms: Array.isArray(o.unitTransforms) ? o.unitTransforms : []
    };
  }

  const guess = guessSubProjectFromDldName(dldProjectName, inferred);
  if (guess) {
    const info = inferred.get(guess);
    return {
      source: 'auto',
      sf_project:     info.project || null,
      sf_sub_project: guess,
      sf_unit_prefix: info.prefix,
      unitTransforms: []
    };
  }

  return {
    source: 'unknown',
    sf_project: null,
    sf_sub_project: null,
    sf_unit_prefix: null,
    unitTransforms: []
  };
}

function applyUnitTransforms(normalizedDldUnit, transforms) {
  if (!transforms || transforms.length === 0) return normalizedDldUnit;
  for (const t of transforms) {
    try {
      const re = new RegExp(t.match);
      if (re.test(normalizedDldUnit)) {
        return normalizedDldUnit.replace(re, t.replace);
      }
    } catch (_) { /* bad regex in config — skip */ }
  }
  return normalizedDldUnit;
}

function expectedSfUnit(dldUnitNumberNorm, mapping) {
  if (!dldUnitNumberNorm || !mapping.sf_unit_prefix) return null;
  const transformed = applyUnitTransforms(dldUnitNumberNorm, mapping.unitTransforms);
  return `${mapping.sf_unit_prefix}-${transformed}`;
}

function saveMappingToDb(db, projectId, mapping) {
  // Skip projects with no inferred mapping. project_mapping.sf_sub_project is
  // NOT NULL; an INSERT with null would crash. compareProject() already handles
  // unmapped projects by returning status:'no-mapping' and skipping them.
  if (!mapping.sf_sub_project) return;
  db.prepare(`
    INSERT INTO project_mapping (project_id, sf_sub_project, sf_unit_prefix, sf_project, source, updated_at)
    VALUES (@pid, @sub, @prefix, @proj, @source, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      sf_sub_project = excluded.sf_sub_project,
      sf_unit_prefix = excluded.sf_unit_prefix,
      sf_project     = excluded.sf_project,
      source         = excluded.source,
      updated_at     = datetime('now')
  `).run({
    pid: projectId,
    sub: mapping.sf_sub_project,
    prefix: mapping.sf_unit_prefix,
    proj: mapping.sf_project,
    source: mapping.source
  });
  db.prepare(`
    UPDATE dld_project SET sf_project=?, sf_sub_project=?, sf_unit_prefix=? WHERE project_id=?
  `).run(mapping.sf_project, mapping.sf_sub_project, mapping.sf_unit_prefix, projectId);
}

module.exports = {
  buildMappingFor,
  inferSubProjectPrefixes,
  applyUnitTransforms,
  expectedSfUnit,
  saveMappingToDb,
  loadOverrides,
  guessSubProjectFromDldName
};
