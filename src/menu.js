#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { pickDldFiles, pickSfFile, pickFile } = require('./file-picker');
const { upsertMasterField } = require('./master-data');
const { archiveOutput } = require('./archive');

const ROOT         = path.join(__dirname, '..');
const INPUT_DIR    = path.join(ROOT, 'input');
const SF_INPUT_DIR = path.join(ROOT, 'sf-input');
const OUTPUT_DIR   = path.join(ROOT, 'output');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  black: '\x1b[30m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m',
  cyan: '\x1b[36m', white: '\x1b[37m', bgBlack: '\x1b[40m'
};

function write(s) { process.stdout.write(s); }
function clear() { write('\x1b[2J\x1b[H'); }
function moveTo(r, c) { write(`\x1b[${r};${c}H`); }
function hideCursor() { write('\x1b[?25l'); }
function showCursor() { write('\x1b[?25h'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const GLITCH = '!@#$%^&*<>[]/\\|:;?=+-_0123456789ABCDEFabcdef';
function glitchChar() { return GLITCH[Math.floor(Math.random() * GLITCH.length)]; }

async function typeGlitch(text, color, delayMs = 18) {
  write(color);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== ' ') {
      write(C.cyan + glitchChar());
      await sleep(Math.max(6, delayMs / 2));
      write('\b' + color + ch);
    } else {
      write(ch);
    }
    await sleep(delayMs / 2);
  }
  write(C.reset);
}

async function printBanner() {
  const lines = [
    '╔══════════════════════════════════════════════════════════════════════╗',
    '║                                                                      ║',
    '║   ██████╗ ██╗      ██████╗ ██████╗  ██████╗  ██████╗███████╗███████╗ ║',
    '║   ██╔══██╗██║      ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██╔════╝██╔════╝ ║',
    '║   ██║  ██║██║      ██████╔╝██████╔╝██║   ██║██║     █████╗  ███████╗ ║',
    '║   ██║  ██║██║      ██╔═══╝ ██╔══██╗██║   ██║██║     ██╔══╝  ╚════██║ ║',
    '║   ██████╔╝███████╗ ██║     ██║  ██║╚██████╔╝╚██████╗███████╗███████║ ║',
    '║   ╚═════╝ ╚══════╝ ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚══════╝╚══════╝ ║',
    '║                                                                      ║',
    '║       DLD Project Inquiry  ⇄  Salesforce Reconciler                  ║',
    '║       Sobha Realty  ·  Registration Team                             ║',
    '║                                                                      ║',
    '╚══════════════════════════════════════════════════════════════════════╝'
  ];
  for (const ln of lines) {
    console.log(C.magenta + ln + C.reset);
    await sleep(18);
  }
}

function runNode(args, opts = {}) {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'index.js'), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    ...opts
  });
  return res.status || 0;
}

function listInputs() {
  const dld = fs.existsSync(INPUT_DIR)    ? fs.readdirSync(INPUT_DIR).filter(f => /\.(xps|csv)$/i.test(f)) : [];
  const sf  = fs.existsSync(SF_INPUT_DIR) ? fs.readdirSync(SF_INPUT_DIR).filter(f => /\.xlsx$/i.test(f))    : [];
  return { dld, sf };
}

function dbSummary() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(ROOT, 'data', 'dld-sync.sqlite');
    if (!fs.existsSync(dbPath)) return { projects: 0, snapshots: 0, sfRows: 0 };
    const db = new Database(dbPath, { readonly: true });
    const p = db.prepare('SELECT COUNT(*) AS n FROM dld_project').get();
    const s = db.prepare('SELECT COUNT(*) AS n FROM dld_snapshot').get();
    const f = db.prepare('SELECT COUNT(*) AS n FROM sf_booking').get();
    db.close();
    return { projects: p.n, snapshots: s.n, sfRows: f.n };
  } catch (e) {
    return { projects: 0, snapshots: 0, sfRows: 0 };
  }
}

async function showHeader() {
  clear();
  await printBanner();
}

function pause() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(C.dim + '\n   [press ENTER to return]' + C.reset, () => { rl.close(); resolve(); });
  });
}

function askPrompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function sectionHeader(title) {
  const bar = '═'.repeat(68);
  console.log('');
  console.log(C.cyan + '  ' + bar + C.reset);
  console.log('  ' + C.cyan + C.bold + '  ' + title + C.reset);
  console.log(C.cyan + '  ' + bar + C.reset);
  console.log('');
}

function menuLine(key, label, note) {
  const k = C.magenta + C.bold + '[' + key + ']' + C.reset;
  const l = C.white + label.padEnd(38, ' ') + C.reset;
  const n = note ? C.dim + note + C.reset : '';
  console.log('    ' + k + '  ' + l + n);
}

async function showMenu() {
  await showHeader();
  const inputs = listInputs();
  const db = dbSummary();

  console.log('');
  console.log('    ' + C.dim + 'input:    ' + C.reset + C.white + inputs.dld.length + C.reset + C.dim + ' DLD file(s)  (' + INPUT_DIR.replace(ROOT, '').replace(/^\\/, '') + '/)' + C.reset);
  console.log('    ' + C.dim + 'sf-input: ' + C.reset + C.white + inputs.sf.length  + C.reset + C.dim + ' SF file(s)   (' + SF_INPUT_DIR.replace(ROOT, '').replace(/^\\/, '') + '/)' + C.reset);
  console.log('    ' + C.dim + 'DB:       ' + C.reset + C.white + db.projects + C.reset + C.dim + ' projects · ' + C.reset + C.white + db.snapshots + C.reset + C.dim + ' snapshots · ' + C.reset + C.white + db.sfRows + C.reset + C.dim + ' SF rows' + C.reset);
  console.log('');

  sectionHeader('MAIN MENU');
  menuLine('1', 'Parse & Import DLD',        'pick .xps or .csv file');
  menuLine('2', 'Import Salesforce',          'pick .xlsx file');
  menuLine('3', 'Compare  (DLD vs SF)',        'writes .compare.csv / .html / audit-tasks');
  menuLine('4', 'Month-over-Month Diff',        'writes .diff.csv / .html');
  menuLine('5', 'Master Data (staff edits)',     'unit-level buyer overrides');
  menuLine('6', 'FULL PIPELINE (folders)',       'process everything in input/ & sf-input/');
  menuLine('7', 'QUICK AUDIT',                   'pick DLD + SF files, run everything');
  menuLine('L', 'Last drop',                     'imports the newest file in input/ + sf-input/, then full pipeline');
  console.log('');
  menuLine('A', 'Audit Report',                 'reconciliation summary + per-project mapping');
  menuLine('U', 'Import Audit Workbook',        'pick the team verification xlsx');
  menuLine('D', 'Audit Delta',                  'tool vs auditor cross-check (HTML + CSV per project)');
  menuLine('P', 'Projects list',                '');
  menuLine('S', 'Status',                       '');
  menuLine('O', 'Open latest HTML report',       '');
  menuLine('R', 'Reveal output folder',          '');
  menuLine('Z', 'Archive output',                'snapshots output/ to output/archive/<timestamp>/');
  console.log('');
  menuLine('Y', 'Area template',                 'generate / apply staff-filled SQM CSVs');
  menuLine('V', 'Review pending changes',        'writes pending-changes.csv and opens it');
  menuLine('B', 'Apply pending decisions',       'reads pending-changes.csv, commits decisions');
  console.log('');
  menuLine('Q', 'Quit',                          '');
  console.log('');
  process.stdout.write('    ' + C.magenta + '>>' + C.reset + ' ');
}

function validateDldPaths(picks) {
  const good = [];
  const bad  = [];
  for (const p of picks || []) {
    if (!p || !fs.existsSync(p)) { bad.push({ p, why: 'not found' }); continue; }
    const ext = path.extname(p).toLowerCase();
    if (ext !== '.xps' && ext !== '.csv') { bad.push({ p, why: 'not .xps or .csv' }); continue; }
    good.push(p);
  }
  return { good, bad };
}

function validateSfPaths(picks) {
  const good = [];
  const bad  = [];
  for (const p of picks || []) {
    if (!p || !fs.existsSync(p)) { bad.push({ p, why: 'not found' }); continue; }
    if (path.extname(p).toLowerCase() !== '.xlsx') { bad.push({ p, why: 'not .xlsx' }); continue; }
    good.push(p);
  }
  return { good, bad };
}

async function doParseImport() {
  await showHeader(); sectionHeader('PARSE & IMPORT DLD');
  console.log('   opening file browser...');
  const picks = await Promise.resolve(pickDldFiles());
  if (!picks || picks.length === 0) {
    console.log('   ' + C.dim + 'cancelled — no file selected' + C.reset);
    await pause(); return;
  }
  const { good, bad } = validateDldPaths(picks);
  bad.forEach(b => console.log('   ' + C.red + 'skip: ' + C.reset + (b.p || '(empty)') + C.dim + '  (' + b.why + ')' + C.reset));
  if (good.length === 0) { console.log('   ' + C.red + 'nothing to import' + C.reset); await pause(); return; }
  console.log('   selected:');
  good.forEach(p => console.log('     ' + C.white + path.basename(p) + C.reset + C.dim + '  ' + p + C.reset));
  console.log('');
  runNode(['import', ...good]);
  await pause();
}

async function doImportSf() {
  await showHeader(); sectionHeader('IMPORT SALESFORCE');
  console.log('   opening file browser...');
  const picks = await Promise.resolve(pickSfFile());
  if (!picks || picks.length === 0) {
    console.log('   ' + C.dim + 'cancelled — no file selected' + C.reset);
    await pause(); return;
  }
  const { good, bad } = validateSfPaths(picks);
  bad.forEach(b => console.log('   ' + C.red + 'skip: ' + C.reset + (b.p || '(empty)') + C.dim + '  (' + b.why + ')' + C.reset));
  if (good.length === 0) { console.log('   ' + C.red + 'nothing to import' + C.reset); await pause(); return; }
  console.log('   selected:');
  good.forEach(p => console.log('     ' + C.white + path.basename(p) + C.reset + C.dim + '  ' + p + C.reset));
  console.log('');
  runNode(['import-sf', ...good]);
  await pause();
}

async function doQuickAudit() {
  await showHeader(); sectionHeader('QUICK AUDIT  /  pick files + run all');
  console.log('   Step 1/3 — pick DLD file(s)...');
  const dldPicksRaw = await Promise.resolve(pickDldFiles());
  const { good: dldPicks, bad: dldBad } = validateDldPaths(dldPicksRaw);
  dldBad.forEach(b => console.log('   ' + C.red + 'skip: ' + C.reset + (b.p || '(empty)') + C.dim + '  (' + b.why + ')' + C.reset));
  if (dldPicks.length === 0) { console.log('   ' + C.dim + 'cancelled — no valid DLD file' + C.reset); await pause(); return; }
  console.log('   DLD: ' + dldPicks.map(p => path.basename(p)).join(', '));
  console.log('');
  console.log('   Step 2/3 — pick Salesforce xlsx...');
  const sfPicksRaw = await Promise.resolve(pickSfFile());
  const { good: sfPicks, bad: sfBad } = validateSfPaths(sfPicksRaw);
  sfBad.forEach(b => console.log('   ' + C.red + 'skip: ' + C.reset + (b.p || '(empty)') + C.dim + '  (' + b.why + ')' + C.reset));
  if (sfPicks.length === 0) { console.log('   ' + C.dim + '(no SF — compare will reuse last imported SF snapshot)' + C.reset); }
  else console.log('   SF: ' + path.basename(sfPicks[0]));
  console.log('');
  console.log('   Step 3/3 — running pipeline...');
  console.log('');

  runNode(['import', ...dldPicks]);
  if (sfPicks.length) runNode(['import-sf', sfPicks[0]]);
  runNode(['compare']);
  runNode(['diff']);
  await pause();
}

async function doCompare() {
  await showHeader(); sectionHeader('COMPARE  /  DLD  ⇄  SALESFORCE');
  runNode(['compare']);
  await pause();
}

async function doDiff() {
  await showHeader(); sectionHeader('MONTH-OVER-MONTH DIFF');
  runNode(['diff']);
  await pause();
}

async function doFull() {
  await showHeader(); sectionHeader('FULL PIPELINE');
  runNode([]);
  await pause();
}

async function doLastDrop() {
  await showHeader(); sectionHeader('LAST DROP  /  newest input file + full pipeline');
  const inputDir = path.join(ROOT, 'input');
  const sfDir = path.join(ROOT, 'sf-input');
  const findNewest = (dir, exts) => {
    if (!fs.existsSync(dir)) return null;
    const candidates = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && exts.includes(path.extname(d.name).toLowerCase()))
      .map(d => ({ name: d.name, full: path.join(dir, d.name), mtime: fs.statSync(path.join(dir, d.name)).mtimeMs }));
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0] || null;
  };
  const newestDld = findNewest(inputDir, ['.xps', '.csv']);
  const newestSf  = findNewest(sfDir,    ['.xlsx', '.xls']);

  if (!newestDld && !newestSf) {
    console.log('  ' + C.dim + 'no inputs found in input/ or sf-input/' + C.reset);
    await pause(); return;
  }

  if (newestDld) {
    console.log('  newest DLD: ' + path.basename(newestDld.full) + '  (' + new Date(newestDld.mtime).toISOString().slice(0, 10) + ')');
  } else {
    console.log('  ' + C.dim + 'no DLD file in input/' + C.reset);
  }
  if (newestSf) {
    console.log('  newest SF:  ' + path.basename(newestSf.full) + '  (' + new Date(newestSf.mtime).toISOString().slice(0, 10) + ')');
  } else {
    console.log('  ' + C.dim + 'no SF file in sf-input/' + C.reset);
  }

  const ok = await askPrompt('  ' + C.green + 'run full pipeline on these? [Y/n]' + C.reset + ' ');
  if (ok && /^n/i.test(ok.trim())) {
    console.log('  ' + C.dim + 'cancelled' + C.reset);
    await pause(); return;
  }

  // Just delegate to the existing full-pipeline runner. cmdAll picks up
  // everything in input/ and sf-input/ — there's no per-file selection in
  // the pipeline today, so "newest" is informational. (The pipeline imports
  // every file present in input/, which is typically just the newest one.)
  runNode([]);  // no-arg = full pipeline
  await pause();
}

async function doProjects() {
  await showHeader(); sectionHeader('PROJECTS');
  runNode(['projects']);
  await pause();
}

async function doStatus() {
  await showHeader(); sectionHeader('SYSTEM STATUS');
  runNode(['status']);
  await pause();
}

async function doAuditReport() {
  await showHeader(); sectionHeader('AUDIT REPORT');
  const { openDb } = require('./db');
  const { runAudit } = require('./audit-report');
  const db = openDb();
  try {
    runAudit({ db });
  } finally {
    db.close();
  }
  await pause();
}

async function doImportAudit() {
  await showHeader(); sectionHeader('IMPORT AUDIT WORKBOOK');
  const { pickAuditFile } = require('./file-picker');
  const picks = await pickAuditFile();
  if (!picks || picks.length === 0) { console.log('  no file selected.'); await pause(); return; }
  const { importAuditWorkbook } = require('./import-audit');
  const { openDb } = require('./db');
  const db = openDb();
  try {
    const res = importAuditWorkbook({ db, filePath: picks[0] });
    if (res.status === 'duplicate') {
      console.log('  already imported (snapshot #' + res.manualAuditSnapshotId + ', as-of ' + res.asOfMonth + ')');
    } else {
      console.log('  snapshot #' + res.manualAuditSnapshotId + '  (as-of ' + res.asOfMonth + ')');
      console.log('  projects: ' + res.projects + '  (matched ' + res.matchedProjects + ', unmatched ' + res.unmatchedProjects + ')');
      console.log('  rows imported: ' + res.inserted);
      const unmatched = (res.projectResults || []).filter(p => !p.projectId);
      if (unmatched.length) {
        console.log('');
        console.log('  unmatched sheets (no DLD project found):');
        for (const u of unmatched) console.log('    - ' + u.sheetName + '  (' + u.rows.length + ' rows)');
      }
    }
  } finally { db.close(); }
  await pause();
}

async function doAuditDeltaMenu() {
  await showHeader(); sectionHeader('AUDIT DELTA');
  const { runAuditDelta } = require('./audit-delta');
  const { openDb } = require('./db');
  const db = openDb();
  try {
    const res = runAuditDelta({ db });
    console.log('  ' + res.projectsRun + ' projects with audit data');
    console.log('  ' + '-'.repeat(73));
    for (const w of res.written) {
      if (w.status === 'ok') {
        console.log('  ' + w.project.padEnd(45).slice(0, 45) +
          '  agree:' + String(w.counts.AGREE_MATCH).padStart(5) +
          '  ⚠:' + String(w.counts.TOOL_STRICTER).padStart(4) +
          '  total:' + String(w.total).padStart(5));
      } else {
        console.log('  ' + w.project + '  (' + w.status + ')');
      }
    }
    console.log('  ' + '-'.repeat(73));
    console.log('  totals — agree:' + res.summary.AGREE_MATCH +
      '  tool-flagged:' + res.summary.TOOL_STRICTER +
      '  manual-only:' + res.summary.MANUAL_ONLY +
      '  tool-only:' + res.summary.DL_ONLY);
    console.log('');
    console.log('  HTML files written to output/<project>.audit-delta.html');
  } catch (e) {
    console.log('  error: ' + e.message);
  } finally { db.close(); }
  await pause();
}

function latestHtmlReport() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  // Prefer the master dashboard when it exists — it's the operational entry
  // point, not the most-recently-touched per-project file.
  const dashboardPath = path.join(OUTPUT_DIR, 'dashboard.html');
  if (fs.existsSync(dashboardPath)) return dashboardPath;
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.html')) {
        hits.push({ full, t: fs.statSync(full).mtimeMs });
      }
    }
  };
  walk(OUTPUT_DIR);
  hits.sort((a, b) => b.t - a.t);
  return hits[0] ? hits[0].full : null;
}

async function doOpenReport() {
  await showHeader(); sectionHeader('OPEN LATEST HTML REPORT');
  const p = latestHtmlReport();
  if (!p) { console.log('   no HTML report found in output/'); await pause(); return; }
  console.log('   opening: ' + path.basename(p));
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
  }
  await sleep(500);
  await pause();
}

async function doReveal() {
  await showHeader(); sectionHeader('REVEAL OUTPUT FOLDER');
  console.log('   ' + OUTPUT_DIR);
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', OUTPUT_DIR], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [OUTPUT_DIR], { detached: true, stdio: 'ignore' }).unref();
  }
  await sleep(400);
  await pause();
}

async function doArchiveOutput() {
  await showHeader(); sectionHeader('ARCHIVE OUTPUT');
  const res = archiveOutput(OUTPUT_DIR);
  if (!res.ok) {
    console.log('  ' + C.dim + res.reason + C.reset);
  } else {
    console.log('  archived ' + res.count + ' file(s) to:');
    console.log('    ' + path.relative(ROOT, res.dest));
  }
  await pause();
}

function loadDb() {
  const Database = require('better-sqlite3');
  return new Database(path.join(ROOT, 'data', 'dld-sync.sqlite'));
}

async function doOverrides() {
  const { listBankOnlyUnits } = require('./overrides');

  while (true) {
    await showHeader();
    sectionHeader('MASTER DATA  /  bank-only units');

    let db;
    try { db = loadDb(); }
    catch (e) {
      console.log('   DB not found. Run option [1] first to import DLD.');
      await pause(); return;
    }

    const projects = db.prepare('SELECT * FROM dld_project ORDER BY project_name').all();
    if (projects.length === 0) {
      console.log('   no DLD projects imported yet');
      db.close(); await pause(); return;
    }

    console.log('   PROJECTS:');
    projects.forEach((p, i) => console.log('    ' + C.magenta + '[' + (i + 1) + ']' + C.reset + ' ' + p.project_name));
    console.log('   ' + C.magenta + '[B]' + C.reset + ' Back');
    console.log('');

    const ans = await askPrompt('    ' + C.magenta + '>>' + C.reset + ' select project: ');
    if (/^b$/i.test(ans)) { db.close(); return; }
    const idx = parseInt(ans, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= projects.length) { db.close(); continue; }
    const project = projects[idx];

    await overridesFor(db, project);
    db.close();
  }
}

async function overridesFor(db, project) {
  const { listBankOnlyUnits } = require('./overrides');
  while (true) {
    await showHeader();
    sectionHeader('MASTER DATA  ·  ' + project.project_name);
    const units = listBankOnlyUnits(db, project.project_id);
    if (units.length === 0) {
      console.log('   no bank-only units in latest snapshot.');
      console.log('');
      await pause();
      return;
    }
    const headers = ['#', 'UNIT', 'BANK (DLD)', 'MASTER BUYER', 'NOTES'];
    const rows = units.map((u, i) => [
      String(i + 1),
      u.unit_number || '',
      (u.last_party || '').slice(0, 32),
      (u.override_buyer || C.dim + '—' + C.reset).slice(0, 40),
      (u.override_notes || '').slice(0, 20)
    ]);
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => stripAnsi(r[i]).length)));
    const hdrLine = headers.map((h, i) => C.dim + h.padEnd(widths[i]) + C.reset).join('  ');
    console.log('   ' + hdrLine);
    console.log('   ' + C.dim + headers.map((_, i) => '-'.repeat(widths[i])).join('  ') + C.reset);
    rows.forEach(r => {
      const line = r.map((cell, i) => pad(cell, widths[i])).join('  ');
      console.log('   ' + line);
    });
    console.log('');
    console.log('   ' + C.magenta + '[#]' + C.reset + ' edit row    '
              + C.magenta + '[D#]' + C.reset + ' delete row    '
              + C.magenta + '[B]' + C.reset + ' back');
    console.log('');

    const ans = await askPrompt('    ' + C.magenta + '>>' + C.reset + ' ');
    if (!ans || /^b$/i.test(ans)) return;
    const delMatch = ans.match(/^d\s*(\d+)$/i);
    if (delMatch) {
      const i = parseInt(delMatch[1], 10) - 1;
      if (i >= 0 && i < units.length) {
        const u = units[i];
        db.prepare('DELETE FROM master_data WHERE project_id = ? AND unit_number_norm = ?')
          .run(project.project_id, u.unit_number_norm);
      }
      continue;
    }
    const i = parseInt(ans, 10) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= units.length) continue;
    const u = units[i];
    console.log('');
    console.log('   Unit ' + C.bold + u.unit_number + C.reset + ' · DLD bank: ' + (u.last_party || '—'));
    if (u.override_buyer) console.log('   current master buyer: ' + u.override_buyer);
    const name = await askPrompt('    ' + C.magenta + 'real buyer name' + C.reset + ' (blank = keep, "-" = delete): ');
    if (name === '') continue;
    if (name === '-') {
      db.prepare('DELETE FROM master_data WHERE project_id = ? AND unit_number_norm = ?')
        .run(project.project_id, u.unit_number_norm);
      continue;
    }
    const notes = await askPrompt('    ' + C.magenta + 'notes' + C.reset + ' (optional): ');
    upsertMasterField(db, project.project_id, u.unit_number_norm, 'buyer_name', name, 'staff');
  }
}

async function doAreaTemplate() {
  await showHeader(); sectionHeader('AREA TEMPLATE  /  generate & apply SQM CSVs');
  console.log('');
  menuLine('1', 'Generate template',   'writes area-template-<project>.csv to output/Changes Template/');
  menuLine('2', 'Apply filled template', 'reads back a staff-filled CSV from input/Changes Template Input/');
  menuLine('B', 'Back',                '');
  console.log('');

  const choice = await askPrompt('    ' + C.magenta + '>>' + C.reset + ' ');

  if (choice === '1') {
    await showHeader(); sectionHeader('AREA TEMPLATE  /  Generate');
    const proj = await askPrompt('  Project name (blank = all projects): ');
    const projectFilter = proj.trim() || null;

    const { generateAreaTemplate } = require('./area-template');
    const { openDb } = require('./db');
    const db = openDb();
    try {
      const templateDir = path.join(ROOT, 'output', 'Changes Template');
      fs.mkdirSync(templateDir, { recursive: true });
      const safe = (projectFilter || 'all').replace(/[^A-Za-z0-9_-]+/g, '_');
      const outPath = path.join(templateDir, 'area-template-' + safe + '.csv');
      const res = generateAreaTemplate({ db, projectFilter, outPath });
      console.log('');
      console.log('  -> wrote ' + path.relative(process.cwd(), outPath) + ' (' + res.rowCount + ' rows)');
    } catch (e) {
      console.log('  ' + C.red + 'error: ' + C.reset + e.message);
    } finally { db.close(); }
    await pause();

  } else if (choice === '2') {
    await showHeader(); sectionHeader('AREA TEMPLATE  /  Apply');
    const inputDir = path.join(ROOT, 'input', 'Changes Template Input');
    fs.mkdirSync(inputDir, { recursive: true });
    console.log('  Select a filled area-template CSV from input/Changes Template Input/.');
    const picks = await pickFile({
      title: 'Select filled area-template CSV',
      filter: 'CSV files (*.csv)|*.csv|All files (*.*)|*.*',
      initialDir: inputDir,
      searchDir:  inputDir,
      extensions: ['.csv'],
      multi: false
    });
    if (!picks || picks.length === 0) {
      console.log('  ' + C.dim + 'cancelled — no file selected' + C.reset);
      await pause(); return;
    }
    const csvPath = picks[0];
    console.log('  applying: ' + path.basename(csvPath));

    const { applyAreaTemplate } = require('./area-template');
    const { openDb } = require('./db');
    const db = openDb();
    try {
      const res = applyAreaTemplate({ db, csvPath });
      console.log('');
      console.log('  -> applied: ' + res.applied + '  skipped: ' + res.skipped);
    } catch (e) {
      console.log('  ' + C.red + 'error: ' + C.reset + e.message);
    } finally { db.close(); }
    await pause();
  }
  // 'B' or anything else — just return to main menu
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }
function pad(s, w) { const vis = stripAnsi(s); return s + ' '.repeat(Math.max(0, w - vis.length)); }

async function doReviewPending() {
  await showHeader(); sectionHeader('REVIEW PENDING CHANGES');
  runNode(['review-pending']);
  const csvPath = path.join(ROOT, 'output', 'csv', 'pending-changes.csv');
  if (fs.existsSync(csvPath)) {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', csvPath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [csvPath], { detached: true, stdio: 'ignore' }).unref();
    }
  }
  await pause();
}

async function doApplyPending() {
  await showHeader(); sectionHeader('APPLY PENDING DECISIONS');
  runNode(['apply-pending']);
  await pause();
}

function askOnce(promptText) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(promptText, ans => { rl.close(); resolve((ans || '').trim()); });
  });
}

async function mainLoop() {
  hideCursor();
  try {
    while (true) {
      await showMenu();
      const choice = (await askOnce('')).toLowerCase();
      switch (choice) {
        case '1': await doParseImport(); break;
        case '2': await doImportSf();    break;
        case '3': await doCompare();     break;
        case '4': await doDiff();        break;
        case '5': await doOverrides();   break;
        case '6': await doFull();        break;
        case '7': await doQuickAudit();  break;
        case 'l': await doLastDrop();    break;
        case 'a': await doAuditReport();    break;
        case 'u': await doImportAudit();    break;
        case 'd': await doAuditDeltaMenu(); break;
        case 'p': await doProjects();       break;
        case 's': await doStatus();      break;
        case 'o': await doOpenReport();  break;
        case 'r': await doReveal();      break;
        case 'z': await doArchiveOutput(); break;
        case 'y': await doAreaTemplate(); break;
        case 'v': await doReviewPending(); break;
        case 'b': await doApplyPending(); break;
        case 'q': case 'exit': case 'quit':
          showCursor(); clear();
          console.log('  bye.\n');
          return;
        default: /* re-show menu */;
      }
    }
  } finally {
    showCursor();
  }
}

if (require.main === module) {
  mainLoop().catch(e => { showCursor(); console.error(e); process.exit(1); });
}

module.exports = { mainLoop };
