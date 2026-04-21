const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

function pickFile({ title, filter, initialDir, multi } = {}) {
  if (process.platform !== 'win32') return pickViaPrompt({ title });

  const startDir = initialDir && fs.existsSync(initialDir) ? initialDir : DOWNLOADS;

  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$f = New-Object System.Windows.Forms.OpenFileDialog',
    `$f.Title = '${(title || 'Select file').replace(/'/g, "''")}'`,
    `$f.Filter = '${(filter || 'All files (*.*)|*.*').replace(/'/g, "''")}'`,
    `$f.InitialDirectory = '${startDir.replace(/'/g, "''")}'`,
    `$f.Multiselect = $${multi ? 'true' : 'false'}`,
    '$f.RestoreDirectory = $true',
    '$null = $f.ShowDialog()',
    'if ($f.FileNames -and $f.FileNames.Length -gt 0) { ($f.FileNames -join [char]0x7C) }'
  ].join('; ');

  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  if (res.error || (res.status !== 0 && !res.stdout)) {
    return pickViaPrompt({ title });
  }
  const out = (res.stdout || '').trim();
  if (!out) return [];
  return out.split('|').map(s => s.trim()).filter(Boolean);
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
