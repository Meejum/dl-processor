#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { extractXps } = require('./src/extractor');
const { parseProject } = require('./src/parser');
const { writeJson, writeUnitsCsv, writeTransactionsCsv, safeName } = require('./src/writers');

function banner() {
  console.log('');
  console.log('  XPS-Processor  /  DLD Project Inquiry Parser');
  console.log('  Sobha Realty — Registration Team');
  console.log('');
}

function usage() {
  console.log('Usage:');
  console.log('  node index.js <path-to-xps>           process a single XPS file');
  console.log('  node index.js                         process all XPS files in input/');
  console.log('');
}

function processOne(xpsPath, outDir) {
  const started = Date.now();
  console.log(`  -> ${path.basename(xpsPath)}`);
  const pages = extractXps(xpsPath);
  console.log(`     pages: ${pages.length}`);
  const data = parseProject(pages);

  const totalBuildings = data.buildings.length;
  const totalUnits     = data.buildings.reduce((n, b) => n + b.units.length, 0);
  const totalTx        = data.buildings.reduce((n, b) => n + b.units.reduce((m, u) => m + (u.transactions?.length || 0), 0), 0);

  console.log(`     project:   ${data.project.projectName || '(unknown)'}`);
  console.log(`     developer: ${data.project.developer || '(unknown)'}`);
  console.log(`     value:     ${data.project.projectValueAED != null ? data.project.projectValueAED.toLocaleString() + ' AED' : '(unknown)'}`);
  console.log(`     window:    ${data.project.startDate || '?'} -> ${data.project.endDate || '?'}`);
  console.log(`     buildings: ${totalBuildings}  |  units: ${totalUnits}  |  parties/tx: ${totalTx}`);
  if (data.project.totalTransactions != null) {
    console.log(`     header lifetime-tx count: ${data.project.totalTransactions} (historical, not detail-level)`);
  }
  if (data.project.totalInvestors != null) {
    console.log(`     investors: ${data.project.totalInvestors}`);
  }

  const base = safeName(data.project.projectName) || path.basename(xpsPath, path.extname(xpsPath));
  const jsonPath = path.join(outDir, base + '.json');
  const unitsCsv = path.join(outDir, base + '.units.csv');
  const txCsv    = path.join(outDir, base + '.transactions.csv');

  const payload = {
    source: path.basename(xpsPath),
    extractedAt: new Date().toISOString(),
    project: data.project,
    buildings: data.buildings.map(b => ({
      id: b.id, name: b.name, type: b.type, unitCount: b.units.length, units: b.units
    }))
  };
  writeJson(payload, jsonPath);
  writeUnitsCsv(data, unitsCsv);
  writeTransactionsCsv(data, txCsv);

  const ms = Date.now() - started;
  console.log(`     wrote: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`     wrote: ${path.relative(process.cwd(), unitsCsv)}`);
  console.log(`     wrote: ${path.relative(process.cwd(), txCsv)}`);
  console.log(`     done in ${ms}ms`);
  console.log('');
}

function main() {
  banner();
  const arg = process.argv[2];
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });

  let targets = [];
  if (arg === '-h' || arg === '--help') { usage(); return; }
  if (arg) {
    if (!fs.existsSync(arg)) { console.error('File not found: ' + arg); process.exit(1); }
    targets = [arg];
  } else {
    const inputDir = path.join(__dirname, 'input');
    if (!fs.existsSync(inputDir)) { console.error('No input/ folder and no file argument.'); process.exit(1); }
    targets = fs.readdirSync(inputDir)
      .filter(f => /\.xps$/i.test(f))
      .map(f => path.join(inputDir, f));
    if (targets.length === 0) { console.log('  No .xps files in input/'); usage(); return; }
  }

  for (const t of targets) processOne(t, outDir);
  console.log('  All done.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { processOne };
