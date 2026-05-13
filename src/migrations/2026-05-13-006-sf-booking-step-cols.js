module.exports = {
  id: '2026-05-13-006-sf-booking-step-cols',
  up(db) {
    // Add 3 nullable TEXT columns to sf_booking. Adding nullable columns is
    // safe in SQLite — no rebuild required. Guard against re-running by
    // checking for one of the NEW columns (current_step_assigned_name),
    // since current_step_name has existed in sf_booking since v1.0.
    //
    // Guard 0: if sf_booking doesn't exist (bare in-memory DB used in
    // some unit tests), skip — nothing to widen.
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf_booking'"
    ).get();
    if (!exists) return;

    const cols = db.prepare("PRAGMA table_info(sf_booking)").all().map(c => c.name);
    if (cols.includes('current_step_assigned_name')) return;

    // current_step_name pre-dates this migration but old DBs may have it
    // already; only add the columns that are actually missing.
    if (!cols.includes('current_step_name')) {
      db.exec("ALTER TABLE sf_booking ADD COLUMN current_step_name TEXT;");
    }
    db.exec(`
      ALTER TABLE sf_booking ADD COLUMN current_step_assigned_name TEXT;
      ALTER TABLE sf_booking ADD COLUMN comments                   TEXT;
    `);
  }
};
