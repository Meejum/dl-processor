const transliterationMap = require('../transliteration-map');

module.exports = {
  id: '2026-05-12-004-buyer-alias-seed',
  up(db) {
    const ins = db.prepare(`
      INSERT INTO buyer_alias (project_id, variant, canonical, display, created_by)
      VALUES (NULL, ?, ?, ?, 'seed')
    `);
    for (const [variant, canonical] of Object.entries(transliterationMap)) {
      // 'display' for seeds is just the canonical with title case for first letter
      const display = canonical.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      ins.run(variant, canonical, display);
    }
  }
};
