const { INPUT_DIR, SF_INPUT_DIR, listFiles } = require('./shared');
const { cmdImport }   = require('./import-dld');
const { cmdImportSf } = require('./import-sf');
const { cmdCompare }  = require('./compare');
const { cmdDiff }     = require('./diff');
const { cmdStatus }   = require('./status');

function cmdAll() {
  console.log('  [1/5] parse + import DLD files from input/');
  const dldTargets = listFiles(INPUT_DIR(), ['.xps', '.csv']);
  if (dldTargets.length === 0) console.log('     (no DLD files)');
  else cmdImport(dldTargets);

  console.log('  [2/5] import Salesforce files from sf-input/');
  const sfTargets = listFiles(SF_INPUT_DIR(), ['.xlsx']);
  if (sfTargets.length === 0) console.log('     (no SF files)');
  else cmdImportSf(sfTargets);

  console.log('  [3/5] compare');
  cmdCompare(null);

  console.log('  [4/5] month-over-month diff');
  cmdDiff([]);

  console.log('  [5/5] summary');
  cmdStatus();
}

module.exports = { cmdAll };
