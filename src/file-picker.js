const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const PROJECT_ROOT = path.join(__dirname, '..');
const DLD_INPUT_DIR = path.join(PROJECT_ROOT, 'input');
const SF_INPUT_DIR  = path.join(PROJECT_ROOT, 'sf-input');

function listFilesInDir(dir, extensions) {
  if (!dir || !fs.existsSync(dir)) return [];
  const lower = (extensions || []).map(e => e.toLowerCase());
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter(name => {
      if (lower.length === 0) return true;
      return lower.includes(path.extname(name).toLowerCase());
    })
    .map(name => path.join(dir, name))
    .filter(p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } })
    .sort();
}

function parseSelection(input, files, multi) {
  const trimmed = (input || '').trim().replace(/^"|"$/g, '');
  if (!trimmed) return [];
  if (/^[\d,\s-]+$/.test(trimmed) && files.length > 0) {
    const indices = new Set();
    for (const part of trimmed.split(',').map(s => s.trim()).filter(Boolean)) {
      const range = part.match(/^(\d+)-(\d+)$/);
      if (range) {
        const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) indices.add(i);
      } else if (/^\d+$/.test(part)) {
        indices.add(parseInt(part, 10));
      }
    }
    const picked = [];
    for (const idx of [...indices].sort((a, b) => a - b)) {
      if (idx >= 1 && idx <= files.length) picked.push(files[idx - 1]);
    }
    return multi ? picked : picked.slice(0, 1);
  }
  return [trimmed];
}

function pickFile({ title, filter, initialDir, multi, searchDir, extensions } = {}) {
  if (process.platform !== 'win32') return pickViaPrompt({ title, searchDir, extensions, multi });

  const startDir = initialDir && fs.existsSync(initialDir) ? initialDir : DOWNLOADS;

  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$f = New-Object System.Windows.Forms.OpenFileDialog',
    `$f.Title = '${(title || 'Select file').replace(/'/g, "''")}'`,
    `$f.Filter = '${(filter || 'All files (*.*)|*.*').replace(/'/g, "''")}'`,
    `$f.InitialDirectory = '${startDir.replace(/'/g, "''")}'`,
    `$f.Multiselect = $${multi ? 'true' : 'false'}`,
    '$f.RestoreDirectory = $true',
    '$result = $f.ShowDialog()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $f.FileNames.Length -gt 0) {',
    '  ($f.FileNames -join [char]0x7C) | Write-Output',
    '}'
  ].join('\n');

  const tmp = path.join(os.tmpdir(), 'dlp-picker-' + Date.now() + '.ps1');
  fs.writeFileSync(tmp, psScript, 'utf8');

  let res;
  try {
    res = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-STA',
      '-File', tmp
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }

  if (res.error) {
    console.log('   (file dialog failed: ' + res.error.message + ' — falling back to typed input)');
    return pickViaPrompt({ title, searchDir, extensions, multi });
  }
  const out = (res.stdout || '').trim();
  if (!out) return []; // user cancelled, don't fall back — just return empty
  const paths = out.split('|').map(s => s.trim()).filter(Boolean);
  return paths.filter(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
}

function pickViaPrompt({ title, searchDir, extensions, multi }) {
  const readline = require('readline');
  const files = listFilesInDir(searchDir, extensions);
  return new Promise(resolve => {
    if (files.length > 0) {
      console.log('');
      console.log('  Files in ' + searchDir + ':');
      files.forEach((f, i) => console.log('    [' + (i + 1) + '] ' + path.basename(f)));
      console.log('');
    } else if (searchDir) {
      console.log('');
      console.log('  (no matching files in ' + searchDir + ')');
      console.log('');
    }
    const hint = files.length > 0
      ? (multi ? 'number(s) e.g. 1 or 1,3 — or full path' : 'number e.g. 1 — or full path')
      : 'full file path';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${title || 'Enter'} [${hint}]: `, ans => {
      rl.close();
      const picked = parseSelection(ans, files, !!multi);
      const existing = picked.filter(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
      resolve(existing);
    });
  });
}

function pickDldFiles() {
  return pickFile({
    title: 'Select DLD Project Inquiry file(s) — XPS or CSV',
    filter: 'DLD files (*.xps;*.csv)|*.xps;*.csv|XPS (*.xps)|*.xps|CSV (*.csv)|*.csv|All files (*.*)|*.*',
    initialDir: DLD_INPUT_DIR,
    searchDir:  DLD_INPUT_DIR,
    extensions: ['.xps', '.csv'],
    multi: true
  });
}

function pickSfFile() {
  return pickFile({
    title: 'Select Salesforce export (xlsx)',
    filter: 'Salesforce export (*.xlsx)|*.xlsx|All files (*.*)|*.*',
    initialDir: SF_INPUT_DIR,
    searchDir:  SF_INPUT_DIR,
    extensions: ['.xlsx', '.xls'],
    multi: false
  });
}

function pickAuditFile() {
  return pickFile({
    title: 'Select audit workbook (xlsx) — team verification',
    filter: 'Audit workbook (*.xlsx)|*.xlsx|All files (*.*)|*.*',
    initialDir: DLD_INPUT_DIR,
    searchDir:  DLD_INPUT_DIR,
    extensions: ['.xlsx'],
    multi: false
  });
}

module.exports = { pickFile, pickDldFiles, pickSfFile, pickAuditFile, listFilesInDir, parseSelection };
