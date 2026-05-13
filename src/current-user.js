// currentUser() — returns the user identity to stamp on audit_log entries.
//
// Resolution order:
//   1. audit_user from %APPDATA%\dl-processor\config.json (Settings-defined value)
//   2. OS user via os.userInfo().username
//   3. 'unknown' fallback (shouldn't happen on Windows; defensive)
//
// Used by src/audit-log.js's writeAuditLog when no explicit user is passed.
// Works in BOTH the Electron main process AND CLI subprocesses spawned via
// command-bridge.js — the config file path is the same.

const fs = require('fs');
const path = require('path');
const os = require('os');

function appConfigPath() {
  // Windows: %APPDATA% is reliable. The Electron main process writes
  // config.json here at first launch via app.getPath('userData').
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'dl-processor', 'config.json');
}

function readSettingsUser() {
  const p = appConfigPath();
  if (!fs.existsSync(p)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const v = cfg && cfg.audit_user;
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
  } catch {
    return null;   // malformed config — fall through to OS user
  }
}

function osUser() {
  try {
    const u = os.userInfo();
    return (u && u.username && u.username.trim()) ? u.username.trim() : null;
  } catch {
    return null;
  }
}

function currentUser() {
  return readSettingsUser() || osUser() || 'unknown';
}

module.exports = { currentUser, appConfigPath };
