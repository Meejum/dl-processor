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

function cmdCompare(filterProjectName) {
  const db = openDb();
  ensureMappings(db);
  const projects = db.prepare(
    filterProjectName
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project`
  ).all(...(filterProjectName ? [filterProjectName] : []));
  if (projects.length === 0) {
    console.log('  no projects in DB. Run: node index.js import <file>');
    db.close();
    return;
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
  db.close();
}

module.exports = { cmdCompare, ensureMappings };
