const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultDataFolder(documentsPath) {
  const docs = documentsPath || path.join(os.homedir(), 'Documents');
  return path.join(docs, 'DL-Processor');
}

const SUBFOLDERS = ['db', 'input', 'input/Changes Template Input', 'output', 'sf-input', 'config'];

function ensureDataFolderLayout(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of SUBFOLDERS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

// Look for an existing DL-Processor install by checking each candidate path
// for a `db/dl-processor.db` file. Returns the first match or null.
function detectLegacyInstall(candidatePaths) {
  for (const root of candidatePaths) {
    const dbPath = path.join(root, 'db', 'dl-processor.db');
    if (fs.existsSync(dbPath)) {
      return { root, dbPath };
    }
  }
  return null;
}

// Recursive copy with destination-pre-existence preserving source intact.
function copyRecursive(srcRoot, dstRoot) {
  let filesCopied = 0;
  function copy(srcPath, dstPath) {
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      for (const entry of fs.readdirSync(srcPath)) {
        copy(path.join(srcPath, entry), path.join(dstPath, entry));
      }
    } else {
      fs.copyFileSync(srcPath, dstPath);
      filesCopied += 1;
    }
  }
  copy(srcRoot, dstRoot);
  return filesCopied;
}

function migrateLegacyData(legacyRoot, targetRoot) {
  const summary = { filesCopied: 0, foldersCopied: [] };
  const folders = ['db', 'input', 'output', 'sf-input', 'config'];
  for (const folder of folders) {
    const src = path.join(legacyRoot, folder);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(targetRoot, folder);
    summary.filesCopied += copyRecursive(src, dst);
    summary.foldersCopied.push(folder);
  }
  return summary;
}

function loadAppConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (e) { throw new Error('failed to parse app config at ' + configPath + ': ' + e.message); }
}

function saveAppConfig(configPath, cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = {
  defaultDataFolder,
  ensureDataFolderLayout,
  detectLegacyInstall,
  migrateLegacyData,
  loadAppConfig,
  saveAppConfig,
  SUBFOLDERS
};
