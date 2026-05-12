#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const {
  INPUT_DIR, SF_INPUT_DIR,
  CHANGES_TEMPLATE_DIR, CHANGES_TEMPLATE_INPUT_DIR,
  LOGS_DIR,
  openDb,
  listFiles
} = require('./src/commands/shared');

const { cmdParse }          = require('./src/commands/parse');
const { cmdImport }         = require('./src/commands/import-dld');
const { cmdImportSf }       = require('./src/commands/import-sf');
const { cmdCompare }        = require('./src/commands/compare');
const { cmdDiff }           = require('./src/commands/diff');
const { cmdProjects }       = require('./src/commands/projects');
const { cmdStatus }         = require('./src/commands/status');
const { cmdAll }            = require('./src/commands/all');
const { cmdReviewPending }  = require('./src/commands/review-pending');
const { cmdApplyPending }   = require('./src/commands/apply-pending');

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
  console.log('  node index.js review-pending         deprecated — open the desktop app and use sidebar [5]');
  console.log('  node index.js apply-pending [csv]    legacy: apply approve/reject decisions from a filled CSV');
  console.log('');
  console.log('Drop DLD .xps/.csv into input/ and SF .xlsx into sf-input/, then run with no args.');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  // --json subcommands need clean JSON on stdout; suppress the banner so
  // callers (the Electron renderer's projects:list IPC) can parse the
  // first character without stripping prelude lines.
  if (!rest.includes('--json')) banner();

  if (cmd === '-h' || cmd === '--help') { usage(); return; }

  if (!cmd) { cmdAll(); return; }

  if (cmd === 'parse') {
    const targets = rest.length ? rest : listFiles(INPUT_DIR(), ['.xps', '.csv']);
    if (targets.length === 0) { console.log('  no files'); return; }
    cmdParse(targets);
    return;
  }

  if (cmd === 'import') {
    const targets = rest.length ? rest : listFiles(INPUT_DIR(), ['.xps', '.csv']);
    if (targets.length === 0) { console.log('  no files'); return; }
    cmdImport(targets);
    return;
  }

  if (cmd === 'import-sf') {
    const targets = rest.length ? rest : listFiles(SF_INPUT_DIR(), ['.xlsx']);
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

  if (cmd === 'projects') { cmdProjects({ json: rest.includes('--json') }); return; }
  if (cmd === 'status')   { cmdStatus();   return; }

  if (cmd === 'db-export') {
    const { cmdDbExport } = require('./src/commands/db-backup');
    cmdDbExport(rest);
    return;
  }
  if (cmd === 'db-import') {
    const { cmdDbImport } = require('./src/commands/db-backup');
    cmdDbImport(rest);
    return;
  }

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
    const db = openDb();
    try {
      fs.mkdirSync(CHANGES_TEMPLATE_DIR(), { recursive: true });
      const safe = (projectFilter || 'all').replace(/[^A-Za-z0-9_-]+/g, '_');
      const outPath = path.join(CHANGES_TEMPLATE_DIR(), 'area-template-' + safe + '.csv');
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
      if (fs.existsSync(CHANGES_TEMPLATE_INPUT_DIR())) {
        const csvs = fs.readdirSync(CHANGES_TEMPLATE_INPUT_DIR()).filter(f => f.toLowerCase().endsWith('.csv'));
        if (csvs.length === 1) {
          csvPath = path.join(CHANGES_TEMPLATE_INPUT_DIR(), csvs[0]);
          console.log('  using: ' + path.relative(process.cwd(), csvPath));
        } else if (csvs.length > 1) {
          console.error('multiple CSVs in ' + path.relative(process.cwd(), CHANGES_TEMPLATE_INPUT_DIR()) + '; specify one explicitly');
          process.exit(1);
        }
      }
    }
    if (!csvPath) { console.error('usage: apply-areas <csv-file>  (or drop a CSV into input/Changes Template Input/)'); process.exit(1); }
    const { applyAreaTemplate } = require('./src/area-template');
    const db = openDb();
    try {
      const res = applyAreaTemplate({ db, csvPath });
      console.log('  -> applied ' + res.applied + ' rows; skipped ' + res.skipped);
      for (const w of res.warnings.slice(0, 20)) console.log('     warn: ' + w);
      // Append an audit-log entry so the monthly audit trail stays complete.
      try {
        const logsDir = LOGS_DIR();
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
