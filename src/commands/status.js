const path = require('path');
const { openDb, repoRoot } = require('./shared');

function cmdStatus() {
  const db = openDb();
  const projCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_project`).get().n;
  const snapCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_snapshot`).get().n;
  const unitCount = db.prepare(`SELECT COUNT(*) AS n FROM dld_unit`).get().n;
  const txCount   = db.prepare(`SELECT COUNT(*) AS n FROM dld_transaction`).get().n;
  const sfCount   = db.prepare(`SELECT COUNT(*) AS n FROM sf_booking`).get().n;
  const sfLatest  = db.prepare(`SELECT source_file, generated_at FROM sf_snapshot ORDER BY imported_at DESC LIMIT 1`).get();
  console.log('  DB: ' + path.relative(process.cwd(), path.join(repoRoot(), 'data', 'dld-sync.sqlite')));
  console.log('  projects: ' + projCount);
  console.log('  DLD snapshots: ' + snapCount);
  console.log('  DLD units (all snapshots): ' + unitCount);
  console.log('  DLD tx rows (all snapshots): ' + txCount);
  console.log('  SF bookings (all snapshots): ' + sfCount);
  if (sfLatest) console.log('  latest SF: ' + sfLatest.source_file + ' (' + (sfLatest.generated_at || 'unknown') + ')');
  db.close();
}

module.exports = { cmdStatus };
