const path = require('path');
const { parseFileFromPath, printParseSummary, writeOutputFiles } = require('./shared');

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

module.exports = { cmdParse };
