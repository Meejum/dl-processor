const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

function pickFile({ title, filter, initialDir, multi } = {}) {
  if (process.platform !== 'win32') return pickViaPrompt({ title });

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
    return pickViaPrompt({ title });
  }
  const out = (res.stdout || '').trim();
  if (!out) return []; // user cancelled, don't fall back — just return empty
  const paths = out.split('|').map(s => s.trim()).filter(Boolean);
  return paths.filter(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
}

function pickViaPrompt({ title }) {
  const readline = require('readline');
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${title || 'Enter file path'}: `, ans => {
      rl.close();
      const p = (ans || '').trim().replace(/^"|"$/g, '');
      resolve(p ? [p] : []);
    });
  });
}

function pickDldFiles() {
  return pickFile({
    title: 'Select DLD Project Inquiry file(s) — XPS or CSV',
    filter: 'DLD files (*.xps;*.csv)|*.xps;*.csv|XPS (*.xps)|*.xps|CSV (*.csv)|*.csv|All files (*.*)|*.*',
    initialDir: DOWNLOADS,
    multi: true
  });
}

function pickSfFile() {
  return pickFile({
    title: 'Select Salesforce export (xlsx)',
    filter: 'Salesforce export (*.xlsx)|*.xlsx|All files (*.*)|*.*',
    initialDir: DOWNLOADS,
    multi: false
  });
}

module.exports = { pickFile, pickDldFiles, pickSfFile };
