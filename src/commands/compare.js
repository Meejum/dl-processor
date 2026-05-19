const fs   = require('fs');
const path = require('path');
const { buildMappingFor, saveMappingToDb } = require('../project-mapping');
const { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks } = require('../compare');
const { buildProjectStat, writeDashboardHtml } = require('../dashboard');
const { openDb, OUTPUT_DIR, COMPARE_DIR, CSV_DIR, CONFIG_DIR } = require('./shared');

function ensureMappings(db) {
  const { rows: sfRows } = (function () {
    const latest = db.prepare(`SELECT * FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`).get();
    if (!latest) return { rows: [] };
    const rows = db.prepare(`SELECT sub_project AS subProject, unit, project FROM sf_booking WHERE sf_snapshot_id=?`).all(latest.sf_snapshot_id);
    return { rows };
  })();
  const projects = db.prepare(`SELECT * FROM dld_project`).all();
  for (const p of projects) {
    const mapping = buildMappingFor(p.project_name, sfRows);
    saveMappingToDb(db, p.project_id, mapping);
  }
}

// Run the compare body against an already-open db. Extracted from cmdCompare
// so dry-run mode can wrap the same body in a SAVEPOINT inside a fresh
// :memory: or production DB without re-opening. Returns { projects, ran }
// so callers can build summaries; in dry-run mode the caller is expected
// to query pending_change / audit_log counts BEFORE the savepoint rollback.
function runCompareBody(db, filterProjectName) {
  ensureMappings(db);
  const projects = db.prepare(
    filterProjectName
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project`
  ).all(...(filterProjectName ? [filterProjectName] : []));
  if (projects.length === 0) {
    console.log('  no projects in DB. Run: node index.js import <file>');
    return { projects: [], ran: false };
  }
  // Load project-mapping.json once for all projects (avoids repeated disk reads per project)
  const configPath = path.join(CONFIG_DIR(), 'project-mapping.json');
  let cachedConfig = {};
  try { cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) {}
  fs.mkdirSync(COMPARE_DIR(), { recursive: true });
  fs.mkdirSync(CSV_DIR(), { recursive: true });
  const dashboardStats = [];
  for (const p of projects) {
    console.log(`  -> ${p.project_name}`);
    try {
      const result = compareProject(db, p.project_id, cachedConfig);
      if (result.status !== 'ok') {
        console.log(`     skipped: ${result.status}`);
        dashboardStats.push(buildProjectStat(p, result, null, null));
        continue;
      }
      const counts = summarize(result.rows);
      console.log(`     MATCH:${counts.MATCH||0}  PRICE↑:${counts.PRICE_UP||0}  PRICE↓:${counts.PRICE_DOWN||0}  BUYER:${counts.BUYER_MISMATCH||0}  AREA:${counts.AREA_MISMATCH||0}  DLD-only:${counts.DLD_ONLY||0}  SF-only:${counts.SF_ONLY||0}`);
      const base   = p.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
      const csvOut = path.join(CSV_DIR(), base + '.compare.csv');
      const htmlOut= path.join(COMPARE_DIR(), base + '.compare.html');
      const tasksOut = path.join(CSV_DIR(), base + '.audit-tasks.csv');
      writeCompareCsv(csvOut, result.rows);
      writeCompareHtml(htmlOut, p, result.rows, counts);
      const tasks = writeAuditTasks(tasksOut, p, result.rows);
      const pendingCount = db.prepare(
        `SELECT COUNT(*) AS n FROM pending_change
         WHERE project_id = ? AND decision = 'pending'`
      ).get(p.project_id).n;
      dashboardStats.push(buildProjectStat(p, result, tasks.length, pendingCount));
      console.log(`     wrote: ${path.relative(process.cwd(), csvOut)}`);
      console.log(`     wrote: ${path.relative(process.cwd(), htmlOut)}`);
      console.log(`     wrote: ${path.relative(process.cwd(), tasksOut)}  (${tasks.length} audit tasks)`);
      console.log('');
    } catch (e) {
      console.log(`     error: ${e.message}`);
      dashboardStats.push(buildProjectStat(p, { status: 'error: ' + e.message }, null, null));
    }
  }
  if (dashboardStats.length > 0) {
    const dashOut = path.join(OUTPUT_DIR(), 'dashboard.html');
    writeDashboardHtml(dashOut, dashboardStats);
    console.log(`  wrote dashboard: ${path.relative(process.cwd(), dashOut)}`);
  }
  return { projects, ran: true };
}

function cmdCompare(filterProjectName, opts) {
  opts = opts || {};
  const db = openDb();
  try {
    if (opts.dryRun) {
      return runCompareDryRun(db, filterProjectName, opts);
    }
    runCompareBody(db, filterProjectName);
  } finally {
    db.close();
  }
}

// Dry-run wraps the compare body inside a SAVEPOINT, collects what *would* be
// written by querying pending_change / audit_log AFTER the body but BEFORE
// the rollback, then unconditionally rolls back (try/finally) so the DB is
// left untouched even if the body throws.
//
// Spec § 8.2 JSON shape:
//   { would_write: { pending_change, audit_log_auto_apply },
//     by_change_type: [{ type, total }, ...],
//     by_project:     [{ project_id, name, total }, ...],
//     samples:        [{ unit, field, old, new, decision: { action } }, ...] }
function runCompareDryRun(db, filterProjectName, opts) {
  opts = opts || {};
  const format = opts.format === 'json' ? 'json' : 'text';
  // _bodyOverride is a test seam — when provided, runs that function inside
  // the SAVEPOINT instead of the real compare body. Production callers
  // never set it.
  const body = typeof opts._bodyOverride === 'function'
    ? opts._bodyOverride
    : (d) => runCompareBody(d, filterProjectName);
  // _emit controls IO: defaults true; tests can set false to avoid stdout
  // noise and writing files into output/.
  const emit = opts._emit !== false;

  // Pre-savepoint baselines.
  const baselinePc = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n;
  const baselineAlAuto = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auto_apply'"
  ).get().n;

  let summary;
  db.exec('SAVEPOINT dry');
  try {
    let bodyError = null;
    try {
      body(db);
    } catch (e) {
      bodyError = e;
    }

    // Collect what the body would have written, regardless of whether it
    // threw partway — query everything new since the baseline.
    const wouldWritePc = db.prepare('SELECT COUNT(*) AS n FROM pending_change').get().n - baselinePc;
    const wouldWriteAuto =
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auto_apply'").get().n
      - baselineAlAuto;

    // Buckets are computed from the NEW pending_change rows only — i.e. those
    // appended during this body run. We approximate "new" by ordering DESC and
    // taking the delta count; on :memory: DBs this matches exactly because
    // rowid is monotonic. (Production DB also monotonic by AUTOINCREMENT.)
    const newPc = wouldWritePc > 0
      ? db.prepare(
          'SELECT change_id, project_id, unit_number_norm, field_name, ' +
          'old_value, proposed_value, change_type, decision ' +
          'FROM pending_change ORDER BY change_id DESC LIMIT ?'
        ).all(wouldWritePc)
      : [];

    const typeBuckets = new Map();
    for (const r of newPc) {
      const k = r.change_type || 'UNKNOWN';
      typeBuckets.set(k, (typeBuckets.get(k) || 0) + 1);
    }
    const byChangeType = [...typeBuckets.entries()]
      .map(([type, total]) => ({ type, total }))
      .sort((a, b) => b.total - a.total);

    const projBuckets = new Map();
    for (const r of newPc) {
      const k = r.project_id;
      projBuckets.set(k, (projBuckets.get(k) || 0) + 1);
    }
    const byProject = [];
    if (projBuckets.size > 0) {
      const nameStmt = db.prepare('SELECT project_name FROM dld_project WHERE project_id = ?');
      for (const [project_id, total] of projBuckets.entries()) {
        const row = nameStmt.get(project_id);
        byProject.push({ project_id, name: row ? row.project_name : null, total });
      }
      byProject.sort((a, b) => b.total - a.total);
    }

    const samples = newPc.slice(0, 10).map(r => ({
      unit:  r.unit_number_norm,
      field: r.field_name,
      old:   r.old_value,
      new:   r.proposed_value,
      decision: { action: r.decision === 'auto_applied' ? 'auto_apply' : 'pending' }
    }));

    summary = {
      would_write: {
        pending_change: wouldWritePc,
        audit_log_auto_apply: wouldWriteAuto
      },
      by_change_type: byChangeType,
      by_project: byProject,
      samples
    };

    if (bodyError) summary.error = bodyError.message;
  } finally {
    // Unconditional rollback — even if collection above threw.
    db.exec('ROLLBACK TO dry');
    db.exec('RELEASE dry');
  }

  // Emit + persist (unless _emit:false suppresses for tests).
  if (emit) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(OUTPUT_DIR(), { recursive: true });
    if (format === 'json') {
      const json = JSON.stringify(summary, null, 2);
      process.stdout.write(json + '\n');
      fs.writeFileSync(path.join(OUTPUT_DIR(), `dry-run-${ts}.json`), json, 'utf8');
    } else {
      const text = renderDryRunText(summary);
      process.stdout.write(text);
      fs.writeFileSync(path.join(OUTPUT_DIR(), `dry-run-${ts}.txt`), text, 'utf8');
    }
  }
  return summary;
}

function renderDryRunText(s) {
  const lines = [];
  lines.push(`DRY-RUN — would write ${s.would_write.pending_change} pending_change rows + ${s.would_write.audit_log_auto_apply} audit_log auto_apply rows`);
  lines.push('');
  if (s.by_change_type.length > 0) {
    lines.push('By change_type:');
    for (const b of s.by_change_type) lines.push(`  ${String(b.type).padEnd(18)}${b.total}`);
    lines.push('');
  }
  if (s.by_project.length > 0) {
    lines.push('By project:');
    for (const b of s.by_project) lines.push(`  ${String(b.name || ('#' + b.project_id)).padEnd(20)}${b.total}`);
    lines.push('');
  }
  if (s.samples.length > 0) {
    lines.push('Top 10 sample rows:');
    for (const r of s.samples) {
      lines.push(`  ${r.unit}  ${r.field}  ${r.old == null ? '∅' : r.old} -> ${r.new == null ? '∅' : r.new}  [${r.decision.action}]`);
    }
    lines.push('');
  }
  if (s.error) lines.push(`(body error during dry-run: ${s.error})`);
  return lines.join('\n') + '\n';
}

module.exports = { cmdCompare, ensureMappings, runCompareDryRun, runCompareBody, renderDryRunText };
