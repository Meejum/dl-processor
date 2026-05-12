// Shared helpers for src/commands/*.js modules.
//
// Path helpers are lazy (function-form) so that DLP_DATA_ROOT can be set by
// the Electron host before any command runs. The CLI leaves DLP_DATA_ROOT
// unset, so paths resolve to the repo root exactly as before.
//
// openDb() respects DLP_DATA_ROOT for the same reason. When unset, it falls
// through to src/db.js's DEFAULT_DB_PATH so CLI behavior stays byte-identical.

const fs   = require('fs');
const path = require('path');
const { extractXps }   = require('../extractor');
const { parseProject } = require('../parser');
const { parseDldCsv }  = require('../sources/csv');
const { writeJson, writeUnitsCsv, writeTransactionsCsv, safeName } = require('../writers');
const { openDb: openDbDefault } = require('../db');

function repoRoot() {
  return process.env.DLP_DATA_ROOT || path.join(__dirname, '..', '..');
}

const INPUT_DIR    = () => path.join(repoRoot(), 'input');
const SF_INPUT_DIR = () => path.join(repoRoot(), 'sf-input');
const OUTPUT_DIR   = () => path.join(repoRoot(), 'output');
const COMPARE_DIR  = () => path.join(OUTPUT_DIR(), 'compare');
const DIFF_DIR     = () => path.join(OUTPUT_DIR(), 'diff');
const CSV_DIR      = () => path.join(OUTPUT_DIR(), 'csv');
const PARSE_DIR    = () => path.join(OUTPUT_DIR(), 'parse');
const CHANGES_TEMPLATE_DIR       = () => path.join(OUTPUT_DIR(), 'Changes Template');
const CHANGES_TEMPLATE_INPUT_DIR = () => path.join(INPUT_DIR(), 'Changes Template Input');
const LOGS_DIR     = () => path.join(repoRoot(), 'logs');
const CONFIG_DIR   = () => path.join(repoRoot(), 'config');

function openDb() {
  if (process.env.DLP_DATA_ROOT) {
    return openDbDefault(path.join(repoRoot(), 'data', 'dld-sync.sqlite'));
  }
  return openDbDefault();
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => extensions.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(dir, f));
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
  fs.mkdirSync(PARSE_DIR(), { recursive: true });
  const base = safeName(data.project.projectName) || path.basename(sourceFilename, path.extname(sourceFilename));
  const jsonPath = path.join(PARSE_DIR(), base + '.json');
  const unitsCsv = path.join(PARSE_DIR(), base + '.units.csv');
  const txCsv    = path.join(PARSE_DIR(), base + '.transactions.csv');
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

module.exports = {
  repoRoot,
  INPUT_DIR, SF_INPUT_DIR, OUTPUT_DIR, COMPARE_DIR, DIFF_DIR, CSV_DIR, PARSE_DIR,
  CHANGES_TEMPLATE_DIR, CHANGES_TEMPLATE_INPUT_DIR, LOGS_DIR, CONFIG_DIR,
  openDb,
  listFiles,
  parseFileFromPath,
  printParseSummary,
  writeOutputFiles
};
