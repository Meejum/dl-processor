#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { extractXps }   = require('./src/extractor');
const { parseProject } = require('./src/parser');
const { parseDldCsv }  = require('./src/sources/csv');
const { writeJson, writeUnitsCsv, writeTransactionsCsv, safeName } = require('./src/writers');
const { openDb }       = require('./src/db');
const { importDldSnapshot } = require('./src/import-dld');
const { importSfSnapshot, readSfWorkbook } = require('./src/salesforce');
const { buildMappingFor, saveMappingToDb } = require('./src/project-mapping');
const { compareProject, summarize, writeCompareCsv, writeCompareHtml, writeAuditTasks } = require('./src/compare');
const { diffProject, summarizeDiff, writeDiffCsv, writeDiffHtml } = require('./src/diff');
const { buildProjectStat, writeDashboardHtml } = require('./src/dashboard');
const { listPending, applyDecision } = require('./src/pending-change');
const { generateApproveHtml } = require('./src/approve-html');
const { loadAutoApproveConfig } = require('./src/auto-approve');
const { lookupSfUnit } = require('./src/sf-lookup');
const { openFile } = require('./src/open-file');
const { getMasterRow } = require('./src/master-data');

const INPUT_DIR    = path.join(__dirname, 'input');
const SF_INPUT_DIR = path.join(__dirname, 'sf-input');
const OUTPUT_DIR   = path.join(__dirname, 'output');
const COMPARE_DIR  = path.join(OUTPUT_DIR, 'compare');
const DIFF_DIR     = path.join(OUTPUT_DIR, 'diff');
const CSV_DIR      = path.join(OUTPUT_DIR, 'csv');
const PARSE_DIR    = path.join(OUTPUT_DIR, 'parse');
const CHANGES_TEMPLATE_DIR       = path.join(OUTPUT_DIR, 'Changes Template');
const CHANGES_TEMPLATE_INPUT_DIR = path.join(__dirname, 'input', 'Changes Template Input');

function banner() {
  console.log('');
  console.log('  DL-PROCESSOR  /  DLD Project Inquiry <-> Salesforce Reconciler');
  console.log('  Sobha Realty  -  Registration Team');
  console.log('');
}

function usage() {
  console.log('Usage:');
  console.log('  node index.js                  full pipeline: parse, import, import SF, compare');
  console.log('  node index.js parse    [file]  parse XPS/CSV -> JSON+CSV in output/parse/');
  console.log('  node index.js import   [file]  parse + store in SQLite');
  console.log('  node index.js import-sf [file] import Salesforce xlsx snapshot');
  console.log('  node index.js compare  [name]  DLD vs SF comparison');
  console.log('  node index.js diff     [name] [--since YYYY-MM-DD] [--show-missing]  month-over-month DLD snapshot diff');
  console.log('  node index.js projects         list projects stored in DB');
  console.log('  node index.js status           overview');
  console.log('  node index.js audit                audit DB state + area coverage');
  console.log('  node index.js import-audit <xlsx>   import the team\'s audit workbook');
  console.log('  node index.js audit-delta [name]    cross-check tool vs auditor');
  console.log('  node index.js area-template [project|all]   emit per-unit area CSV for staff to fill');
  console.log('  node index.js apply-areas   <csv>            apply filled-in area CSV to manual_area');
  console.log('  node index.js review-pending [name]  write pending-changes.csv for review');
  console.log('  node index.js apply-pending [csv]    apply approve/reject decisions from a filled CSV');
  console.log('');
  console.log('Drop DLD .xps/.csv into input/ and SF .xlsx into sf-input/, then run with no args.');
}

function parseFileFromPath(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('file not found: ' + (filePath || '(empty)'));
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xps') {
    const pages = extractXps(filePath);
    return { data: parseProject(pages), sourceFormat: 'xps' };
  }
  if (ext === '.csv') {
    return { data: parseDldCsv(filePath), sourceFormat: 'csv' };
  }
  throw new Error('unsupported file type: "' + ext + '" for ' + path.basename(filePath) + ' (expect .xps or .csv)');
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => extensions.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(dir, f));
}

function printParseSummary(data) {
  const totalBuildings = data.buildings.length;
  const totalUnits     = data.buildings.reduce((n, b) => n + b.units.length, 0);
  const totalTx        = data.buildings.reduce((n, b) => n + b.units.reduce((m, u) => m + (u.transactions?.length || 0), 0), 0);
  console.log(`     project:   ${data.project.projectName || '(unknown)'}`);
  console.log(`     developer: ${data.project.developer || '(unknown)'}`);
  console.log(`     value:     ${data.project.projectValueAED != null ? data.project.projectValueAED.toLocaleString() + ' AED' : '(unknown)'}`);
  console.log(`     buildings: ${totalBuildings}  |  units: ${totalUnits}  |  parties/tx: ${totalTx}`);
  if (data.project.totalInvestors != null) console.log(`     investors: ${data.project.totalInvestors}`);
}

function writeOutputFiles(data, sourceFilename) {
  fs.mkdirSync(PARSE_DIR, { recursive: true });
  const base = safeName(data.project.projectName) || path.basename(sourceFilename, path.extname(sourceFilename));
  const jsonPath = path.join(PARSE_DIR, base + '.json');
  const unitsCsv = path.join(PARSE_DIR, base + '.units.csv');
  const txCsv    = path.join(PARSE_DIR, base + '.transactions.csv');
  writeJson({
    source: sourceFilename,
    extractedAt: new Date().toISOString(),
    project: data.project,
    buildings: data.buildings.map(b => ({ id: b.id, name: b.name, type: b.type, unitCount: b.units.length, units: b.units }))
  }, jsonPath);
  writeUnitsCsv(data, unitsCsv);
  writeTransactionsCsv(data, txCsv);
  return { jsonPath, unitsCsv, txCsv };
}

function cmdParse(targets) {
  for (const t of targets) {
    console.log(`  -> ${path.basename(t)}`);
    const { data } = parseFileFromPath(t);
    printParseSummary(data);
    const outs = writeOutputFiles(data, path.basename(t));
    console.log(`     wrote: ${path.relative(process.cwd(), outs.jsonPath)}`);
    console.log(`     wrote: ${path.relative(process.cwd(), outs.unitsCsv)}`);
    console.log(`     wrote: ${path.relative(process.cwd(), outs.txCsv)}`);
    console.log('');
  }
}

function cmdImport(targets) {
  const db = openDb();
  for (const t of targets) {
    console.log(`  -> ${path.basename(t)}`);
    const { data, sourceFormat } = parseFileFromPath(t);
    printParseSummary(data);
    const result = importDldSnapshot({ db, data, sourceFormat, sourceFile: t });
    console.log(`     imported as snapshot #${result.snapshotId} (project #${result.projectId})`);
    console.log(`     db: ${result.totalUnits} units, ${result.totalTx} tx rows`);
    writeOutputFiles(data, path.basename(t));
    console.log('');
  }
  db.close();
}

function cmdImportSf(targets) {
  const db = openDb();
  for (const t of targets) {
    console.log(`  -> SF: ${path.basename(t)}`);
    try {
      const result = importSfSnapshot({ db, filePath: t });
      if (result.deduped) {
        console.log(`     already imported (sha matches) — snapshot #${result.sfSnapshotId} reused`);
      } else {
        console.log(`     imported snapshot #${result.sfSnapshotId} (${result.rowsInserted} rows, generated ${result.generatedAt || 'unknown'})`);
      }
    } catch (e) {
      const msg = e.message || '';
      if (msg.match(/EBUSY|EPERM|being used by another process/i)) {
        console.log(`     SKIPPED: ${path.basename(t)} is open in another program (close Excel and re-run)`);
      } else {
        throw e;  // unexpected — let it propagate
      }
    }
    console.log('');
  }
  db.close();
}

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
  const configPath = path.join(__dirname, 'config', 'project-mapping.json');
  let cachedConfig = {};
  try { cachedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) {}
  fs.mkdirSync(COMPARE_DIR, { recursive: true });
  fs.mkdirSync(CSV_DIR, { recursive: true });
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
      const csvOut = path.join(CSV_DIR, base + '.compare.csv');
      const htmlOut= path.join(COMPARE_DIR, base + '.compare.html');
      const tasksOut = path.join(CSV_DIR, base + '.audit-tasks.csv');
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
    const dashOut = path.join(OUTPUT_DIR, 'dashboard.html');
    writeDashboardHtml(dashOut, dashboardStats);
    console.log(`  wrote dashboard: ${path.relative(process.cwd(), dashOut)}`);
  }
  db.close();
}

function parseDiffArgs(rest) {
  const opts = { name: null, since: null, showMissing: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--show-missing') { opts.showMissing = true; continue; }
    if (a === '--since') {
      opts.since = rest[++i];
      if (!opts.since) throw new Error('--since requires a YYYY-MM-DD argument');
      continue;
    }
    if (a.startsWith('--since=')) { opts.since = a.slice('--since='.length); continue; }
    if (a.startsWith('--')) throw new Error('unknown flag: ' + a);
    if (!opts.name) { opts.name = a; continue; }
    throw new Error('unexpected argument: ' + a);
  }
  return opts;
}

function cmdDiff(rest) {
  let opts;
  try {
    opts = parseDiffArgs(Array.isArray(rest) ? rest : []);
  } catch (e) {
    console.log('  ' + e.message);
    return;
  }

  const db = openDb();
  const projects = db.prepare(
    opts.name
      ? `SELECT * FROM dld_project WHERE project_name = ?`
      : `SELECT * FROM dld_project`
  ).all(...(opts.name ? [opts.name] : []));
  if (projects.length === 0) { console.log('  no projects in DB'); db.close(); return; }
  fs.mkdirSync(DIFF_DIR, { recursive: true });
  fs.mkdirSync(CSV_DIR, { recursive: true });

  const totals = { new: 0, changed: 0, hidden: 0, projects: 0 };

  for (const p of projects) {
    console.log(`  -> ${p.project_name}`);
    try {
      const result = diffProject(db, p.project_id, { since: opts.since, includeMissing: opts.showMissing });
      if (result.status !== 'ok') {
        const reasons = {
          'not-enough-snapshots': '(need >= 2 snapshots)',
          'no-baseline-before-date': `(no snapshot before ${opts.since})`
        };
        console.log(`     skipped: ${result.status} ${reasons[result.status] || ''}`.trimEnd());
        continue;
      }
      if (opts.since) result.sinceUsed = opts.since;

      const counts = summarizeDiff(result.rows);
      const oldLabel = result.oldSnapshot.snapshot_date + ' ' + result.oldSnapshot.source_format;
      const newLabel = result.newSnapshot.snapshot_date + ' ' + result.newSnapshot.source_format;
      const sinceTag = opts.since ? ` (--since ${opts.since})` : '';

      const newUnits   = counts.NEW_UNIT   || 0;
      const newTxs     = counts.NEW_TX     || 0;
      const newTotal   = newUnits + newTxs;
      const changedAmt = counts.AMOUNT_CHANGED   || 0;
      const changedAr  = counts.AREA_CHANGED     || 0;
      const changedTy  = counts.UNIT_TYPE_CHANGED|| 0;
      const changedTot = changedAmt + changedAr + changedTy;
      const missingU   = counts.MISSING_UNIT || 0;
      const missingT   = counts.MISSING_TX   || 0;
      const missingTot = missingU + missingT;
      const hiddenU    = (result.hiddenMissingCount && result.hiddenMissingCount.units) || 0;
      const hiddenT    = (result.hiddenMissingCount && result.hiddenMissingCount.txs)   || 0;
      const hiddenTot  = hiddenU + hiddenT;
      const totalRows  = result.rows.length;

      console.log(`     baseline  ${oldLabel}${sinceTag}   ->   latest  ${newLabel}`);
      if (totalRows === 0 && hiddenTot === 0) {
        console.log('     no changes');
      } else {
        console.log(`     new       :  ${newTotal}  (units ${newUnits}, tx ${newTxs})`);
        console.log(`     changed   :  ${changedTot}  (amount ${changedAmt}, area ${changedAr}, type ${changedTy})`);
        if (opts.showMissing && missingTot > 0) {
          console.log(`     missing   :  ${missingTot}  (units ${missingU}, tx ${missingT})`);
        } else if (!opts.showMissing && hiddenTot > 0) {
          const noun = hiddenTot === 1 ? 'row' : 'rows';
          console.log(`     hidden    :  ${hiddenTot} missing ${noun} (use --show-missing to include)`);
        }
      }

      const base = p.project_name.replace(/[^A-Za-z0-9_-]+/g, '_');
      const csvOut  = path.join(CSV_DIR, base + '.diff.csv');
      const htmlOut = path.join(DIFF_DIR, base + '.diff.html');
      writeDiffCsv(csvOut, result);
      writeDiffHtml(htmlOut, result, counts);
      console.log(`     wrote     :  ${path.relative(process.cwd(), csvOut)}`);
      console.log(`     wrote     :  ${path.relative(process.cwd(), htmlOut)}`);
      console.log('');

      totals.projects += 1;
      totals.new     += newTotal;
      totals.changed += changedTot;
      totals.hidden  += hiddenTot;
    } catch (e) {
      console.log(`     error: ${e.message}`);
    }
  }

  if (totals.projects > 0) {
    const hiddenSeg = (!opts.showMissing && totals.hidden > 0) ? `   hidden ${totals.hidden}` : '';
    console.log(`  TOTAL across ${totals.projects} project${totals.projects === 1 ? '' : 's'}:  new ${totals.new}   changed ${totals.changed}${hiddenSeg}`);
  }

  db.close();
}

function cmdProjects() {
  const db = openDb();
  const rows = db.prepare(`
    SELECT p.project_name, p.developer, p.sf_sub_project, p.sf_unit_prefix,
           (SELECT COUNT(*) FROM dld_snapshot s WHERE s.project_id = p.project_id) AS snapshot_count,
           (SELECT MAX(imported_at) FROM dld_snapshot s WHERE s.project_id = p.project_id) AS last_imported
    FROM dld_project p
    ORDER BY p.project_name
  `).all();
  if (rows.length === 0) { console.log('  no projects imported yet'); db.close(); return; }
  console.log('  ' + 'PROJECT'.padEnd(35) + 'SF SUB'.padEnd(20) + 'PFX'.padEnd(6) + 'SNAP'.padEnd(6) + 'LAST IMPORTED');
  for (const r of rows) {
    console.log('  '
      + (r.project_name || '').padEnd(35)
      + (r.sf_sub_project || '-').padEnd(20)
      + ((r.sf_unit_prefix || '-') + '-').padEnd(6)
      + String(r.snapshot_count || 0).padEnd(6)
      + (r.last_imported || '-')
    );
  }
  db.close();
}

function cmdStatus() {
  const db = openDb();
  const projCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_project`).get().n;
  const snapCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_snapshot`).get().n;
  const unitCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_unit`).get().n;
  const txCount   = db.prepare(`SELECT COUNT(*) AS n FROM dld_transaction`).get().n;
  const sfCount   = db.prepare(`SELECT COUNT(*) AS n FROM sf_booking`).get().n;
  const sfLatest  = db.prepare(`SELECT source_file, generated_at FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`).get();
  console.log('  DB: ' + path.relative(process.cwd(), path.join(__dirname, 'data', 'dld-sync.sqlite')));
  console.log('  projects: ' + projCount);
  console.log('  DLD snapshots: ' + snapCount);
  console.log('  DLD units (all snapshots): ' + unitCount);
  console.log('  DLD tx rows (all snapshots): ' + txCount);
  console.log('  SF bookings (all snapshots): ' + sfCount);
  if (sfLatest) console.log('  latest SF: ' + sfLatest.source_file + ' (' + (sfLatest.generated_at || 'unknown') + ')');
  db.close();
}

function cmdAll() {
  console.log('  [1/5] parse + import DLD files from input/');
  const dldTargets = listFiles(INPUT_DIR, ['.xps', '.csv']);
  if (dldTargets.length === 0) console.log('     (no DLD files)');
  else cmdImport(dldTargets);

  console.log('  [2/5] import Salesforce files from sf-input/');
  const sfTargets = listFiles(SF_INPUT_DIR, ['.xlsx']);
  if (sfTargets.length === 0) console.log('     (no SF files)');
  else cmdImportSf(sfTargets);

  console.log('  [3/5] compare');
  cmdCompare(null);

  console.log('  [4/5] month-over-month diff');
  cmdDiff([]);

  console.log('  [5/5] summary');
  cmdStatus();
}

function cmdReviewPending(filterProjectName) {
  const db = openDb();
  const rows = listPending(db, filterProjectName);
  if (rows.length === 0) {
    console.log('  no pending changes');
    db.close();
    return;
  }
  // Group counts for terminal output.
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.project_name)) byProject.set(r.project_name, { total: 0, byField: {} });
    const slot = byProject.get(r.project_name);
    slot.total += 1;
    slot.byField[r.field_name] = (slot.byField[r.field_name] || 0) + 1;
  }
  console.log('  pending changes:');
  for (const [name, slot] of byProject) {
    const fields = Object.entries(slot.byField).map(([k, v]) => v + ' ' + k.replace('buyer_name', 'buyer').replace('purchase_price_aed', 'price').replace('procedure_number', 'procedure').replace('area_sqm', 'area')).join(', ');
    console.log('    ' + name + ': ' + slot.total + ' (' + fields + ')');
  }
  console.log('  TOTAL: ' + rows.length + ' pending across ' + byProject.size + ' project' + (byProject.size === 1 ? '' : 's'));

  // Enrich rows with SF unit, applicant, price, and current master_data buyer.
  for (const r of rows) {
    const sf = lookupSfUnit(db, r.project_id, r.unit_number_norm);
    r.sf_unit      = sf ? sf.sf_unit      : null;
    r.sf_applicant = sf ? sf.sf_applicant : null;
    r.sf_price     = sf ? sf.sf_price     : null;
    const masterRow = getMasterRow(db, r.project_id, r.unit_number_norm);
    r.current_buyer = masterRow ? masterRow.buyer_name : null;
  }

  fs.mkdirSync(CSV_DIR, { recursive: true });
  const outPath = path.join(CSV_DIR, 'pending-changes.csv');
  const header = ['change_id', 'project_name', 'unit', 'field', 'old_value', 'proposed_value', 'applied_value', 'source_snapshot_date', 'proposed_at', 'decision', 'notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(h => {
      const v = h === 'project_name' ? r.project_name :
                h === 'unit' ? r.unit_number_norm :
                h === 'field' ? r.field_name :
                h === 'source_snapshot_date' ? (r.source_snapshot_date || '') :
                h === 'decision' ? 'pending' :
                h === 'notes' ? '' :
                h === 'applied_value' ? '' :   // initial CSV has no override; staff fill in via HTML or edit
                r[h] == null ? '' : r[h];
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\r\n') + '\r\n', 'utf8');
  console.log('  wrote: ' + path.relative(process.cwd(), outPath));
  const htmlPath = path.join(OUTPUT_DIR, 'approve-pending.html');
  const tolerances = loadAutoApproveConfig();
  generateApproveHtml(rows, tolerances, htmlPath);
  console.log('  wrote: ' + path.relative(process.cwd(), htmlPath));
  try {
    openFile(htmlPath);
    console.log('  opened in browser');
  } catch (e) {
    console.log('  (could not auto-open: ' + e.message + ')');
  }
  db.close();
}

function cmdApplyPending(csvPath) {
  const db = openDb();
  const inputPath = csvPath || path.join(CSV_DIR, 'pending-changes.csv');
  if (!fs.existsSync(inputPath)) {
    console.log('  no pending CSV at ' + inputPath);
    db.close();
    return;
  }
  const content = fs.readFileSync(inputPath, 'utf8');
  // Use the same csv-parse already in deps (used by src/sources/csv.js).
  const { parse } = require('csv-parse/sync');
  const rows = parse(content, { relax_quotes: true, columns: true, skip_empty_lines: true });
  let approved = 0, rejected = 0, deferred = 0, errors = 0;
  for (const r of rows) {
    const cid = parseInt(r.change_id, 10);
    if (isNaN(cid)) { errors += 1; continue; }
    const decision = String(r.decision || '').trim().toLowerCase();
    const notes = r.notes || '';
    const applied = r.applied_value === '' || r.applied_value == null ? null : r.applied_value;
    if (decision === 'approve') {
      try { applyDecision(db, cid, 'approve', notes, applied); approved += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'reject') {
      try { applyDecision(db, cid, 'reject', notes, applied); rejected += 1; }
      catch (e) { console.log('  warn change_id ' + cid + ': ' + e.message); errors += 1; }
    } else if (decision === 'pending' || decision === '') {
      deferred += 1;
    } else {
      console.log('  warn change_id ' + cid + ': unknown decision "' + decision + '", skipping');
      errors += 1;
    }
  }
  const masterCount = db.prepare('SELECT COUNT(*) AS n FROM master_data').get().n;
  console.log('  applied ' + approved + ' approval' + (approved === 1 ? '' : 's') + ' · ' + rejected + ' rejection' + (rejected === 1 ? '' : 's') + ' · ' + deferred + ' deferred (still pending)');
  if (errors) console.log('  ' + errors + ' row' + (errors === 1 ? '' : 's') + ' had errors (see warnings above)');
  console.log('  master_data now has ' + masterCount + ' canonical row' + (masterCount === 1 ? '' : 's'));
  db.close();
}

function main() {
  banner();
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === '-h' || cmd === '--help') { usage(); return; }

  if (!cmd) { cmdAll(); return; }

  if (cmd === 'parse') {
    const targets = rest.length ? rest : listFiles(INPUT_DIR, ['.xps', '.csv']);
    if (targets.length === 0) { console.log('  no files'); return; }
    cmdParse(targets);
    return;
  }

  if (cmd === 'import') {
    const targets = rest.length ? rest : listFiles(INPUT_DIR, ['.xps', '.csv']);
    if (targets.length === 0) { console.log('  no files'); return; }
    cmdImport(targets);
    return;
  }

  if (cmd === 'import-sf') {
    const targets = rest.length ? rest : listFiles(SF_INPUT_DIR, ['.xlsx']);
    if (targets.length === 0) { console.log('  no files'); return; }
    cmdImportSf(targets);
    return;
  }

  if (cmd === 'compare') {
    cmdCompare(rest[0] || null);
    return;
  }

  if (cmd === 'diff') {
    cmdDiff(rest);
    return;
  }

  if (cmd === 'projects') { cmdProjects(); return; }
  if (cmd === 'status')   { cmdStatus();   return; }

  if (cmd === 'audit') {
    const { runAudit } = require('./src/audit-report');
    const db = openDb();
    try { runAudit({ db }); } finally { db.close(); }
    return;
  }

  if (cmd === 'import-audit') {
    const filePath = process.argv[3];
    if (!filePath) { console.error('usage: import-audit <xlsx-file>'); process.exit(1); }
    const { importAuditWorkbook } = require('./src/import-audit');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      const res = importAuditWorkbook({ db, filePath });
      if (res.status === 'duplicate') {
        console.log('  -> already imported (snapshot #' + res.manualAuditSnapshotId + ', as-of ' + res.asOfMonth + ')');
      } else {
        console.log('  -> snapshot #' + res.manualAuditSnapshotId + ' (as-of ' + res.asOfMonth + ')');
        console.log('     projects: ' + res.projects + '  (matched ' + res.matchedProjects + ', unmatched ' + res.unmatchedProjects + ')');
        console.log('     rows imported: ' + res.inserted);
      }
    } finally { db.close(); }
    return;
  }

  if (cmd === 'audit-delta') {
    const filter = process.argv[3] || null;
    const { runAuditDelta } = require('./src/audit-delta');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      const res = runAuditDelta({ db, projectFilter: filter });
      console.log('  -> ' + res.projectsRun + ' projects with audit data');
      for (const w of res.written) {
        if (w.status === 'ok') {
          console.log('     ' + w.project + ': agree ' + w.counts.AGREE_MATCH + ' / ⚠ tool-flagged ' + w.counts.TOOL_STRICTER + ' / total ' + w.total);
        } else {
          console.log('     ' + w.project + ': skipped (' + w.status + ')');
        }
      }
      console.log('     totals — agree:' + res.summary.AGREE_MATCH + '  tool-flagged:' + res.summary.TOOL_STRICTER + '  manual-only:' + res.summary.MANUAL_ONLY + '  tool-only:' + res.summary.DL_ONLY);
    } finally { db.close(); }
    return;
  }

  if (cmd === 'area-template') {
    const projectFilter = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
    const { generateAreaTemplate } = require('./src/area-template');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      fs.mkdirSync(CHANGES_TEMPLATE_DIR, { recursive: true });
      const safe = (projectFilter || 'all').replace(/[^A-Za-z0-9_-]+/g, '_');
      const outPath = path.join(CHANGES_TEMPLATE_DIR, 'area-template-' + safe + '.csv');
      const res = generateAreaTemplate({ db, projectFilter, outPath });
      console.log('  -> wrote ' + path.relative(process.cwd(), outPath));
      console.log('     ' + res.rowCount + ' rows across ' + res.projects + ' project(s)');
    } finally { db.close(); }
    return;
  }

  if (cmd === 'apply-areas') {
    let csvPath = process.argv[3];
    if (!csvPath) {
      // Default: look for a single CSV in input/Changes Template Input/.
      // If exactly one file is present, use it. Otherwise show usage.
      if (fs.existsSync(CHANGES_TEMPLATE_INPUT_DIR)) {
        const csvs = fs.readdirSync(CHANGES_TEMPLATE_INPUT_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
        if (csvs.length === 1) {
          csvPath = path.join(CHANGES_TEMPLATE_INPUT_DIR, csvs[0]);
          console.log('  using: ' + path.relative(process.cwd(), csvPath));
        } else if (csvs.length > 1) {
          console.error('multiple CSVs in ' + path.relative(process.cwd(), CHANGES_TEMPLATE_INPUT_DIR) + '; specify one explicitly');
          process.exit(1);
        }
      }
    }
    if (!csvPath) { console.error('usage: apply-areas <csv-file>  (or drop a CSV into input/Changes Template Input/)'); process.exit(1); }
    const { applyAreaTemplate } = require('./src/area-template');
    const { openDb } = require('./src/db');
    const db = openDb();
    try {
      const res = applyAreaTemplate({ db, csvPath });
      console.log('  -> applied ' + res.applied + ' rows; skipped ' + res.skipped);
      for (const w of res.warnings.slice(0, 20)) console.log('     warn: ' + w);
      // Append an audit-log entry so the monthly audit trail stays complete.
      try {
        const logsDir = path.join(__dirname, 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const entry = JSON.stringify({
          ts:      new Date().toISOString(),
          command: 'apply-areas',
          source:  csvPath,
          applied: res.applied,
          skipped: res.skipped,
          warnings: res.warnings.length
        });
        fs.appendFileSync(path.join(logsDir, 'audit.jsonl'), entry + '\n', 'utf8');
      } catch (_) { /* never let audit-log failure break the user-facing command */ }
    } finally { db.close(); }
    return;
  }

  if (cmd === 'review-pending') {
    cmdReviewPending(rest[0] || null);
    return;
  }

  if (cmd === 'apply-pending') {
    cmdApplyPending(rest[0] || null);
    return;
  }

  console.log('unknown command: ' + cmd);
  usage();
  process.exit(1);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}
