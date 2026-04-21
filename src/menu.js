#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const { pickDldFiles, pickSfFile } = require('./file-picker');

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
  menuLine('5', 'Manual Overrides',              'bank-only units → real buyer');
  menuLine('6', 'FULL PIPELINE (folders)',       'process everything in input/ & sf-input/');
  menuLine('7', 'QUICK AUDIT',                   'pick DLD + SF files, run everything');
  console.log('');
  menuLine('P', 'Projects list',                '');
  menuLine('S', 'Status',                       '');
  menuLine('O', 'Open latest HTML report',       '');
  menuLine('R', 'Reveal output folder',          '');
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

function latestHtmlReport() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => ({ f, t: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs }));
  files.sort((a, b) => b.t - a.t);
  return files[0] ? path.join(OUTPUT_DIR, files[0].f) : null;
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

function loadDb() {
  const Database = require('better-sqlite3');
  return new Database(path.join(ROOT, 'data', 'dld-sync.sqlite'));
}

async function doOverrides() {
  const { listBankOnlyUnits, getOverride, setOverride, deleteOverride } = require('./overrides');

  while (true) {
    await showHeader();
    sectionHeader('MANUAL OVERRIDES  /  bank-only units');

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
  const { listBankOnlyUnits, setOverride, deleteOverride } = require('./overrides');
  while (true) {
    await showHeader();
    sectionHeader('OVERRIDES  ·  ' + project.project_name);
    const units = listBankOnlyUnits(db, project.project_id);
    if (units.length === 0) {
      console.log('   no bank-only units in latest snapshot.');
      console.log('');
      await pause();
      return;
    }
    const headers = ['#', 'UNIT', 'BANK (DLD)', 'OVERRIDE BUYER', 'NOTES'];
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
        deleteOverride(db, project.project_id, units[i].unit_number_norm);
      }
      continue;
    }
    const i = parseInt(ans, 10) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= units.length) continue;
    const u = units[i];
    console.log('');
    console.log('   Unit ' + C.bold + u.unit_number + C.reset + ' · DLD bank: ' + (u.last_party || '—'));
    if (u.override_buyer) console.log('   current override: ' + u.override_buyer);
    const name = await askPrompt('    ' + C.magenta + 'real buyer name' + C.reset + ' (blank = keep, "-" = delete): ');
    if (name === '') continue;
    if (name === '-') {
      deleteOverride(db, project.project_id, u.unit_number_norm);
      continue;
    }
    const notes = await askPrompt('    ' + C.magenta + 'notes' + C.reset + ' (optional): ');
    setOverride(db, project.project_id, u.unit_number_norm, name, notes || null);
  }
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }
function pad(s, w) { const vis = stripAnsi(s); return s + ' '.repeat(Math.max(0, w - vis.length)); }

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
        case 'p': await doProjects();    break;
        case 's': await doStatus();      break;
        case 'o': await doOpenReport();  break;
        case 'r': await doReveal();      break;
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
