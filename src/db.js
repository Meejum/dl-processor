const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'dld-sync.sqlite');
const SCHEMA_PATH     = path.join(__dirname, '..', 'db', 'schema.sql');

function migrateSchema(db) {
  // 1. Add missing columns to sf_booking (ALTER TABLE ADD COLUMN is idempotent
  //    via PRAGMA inspection — SQLite has no IF NOT EXISTS for columns).
  const sfCols = new Set(db.prepare('PRAGMA table_info(sf_booking)').all().map(r => r.name));
  const sfMissing = [
    ['nationality',       'TEXT'],
    ['applicant_details', 'TEXT'],
    ['applicant_2_name',  'TEXT'],
    ['applicant_3_name',  'TEXT'],
    ['applicant_4_name',  'TEXT'],
    ['docusign_complete', 'TEXT']
  ];
  for (const [name, type] of sfMissing) {
    if (!sfCols.has(name)) {
      db.exec(`ALTER TABLE sf_booking ADD COLUMN ${name} ${type}`);
    }
  }

  // 2. Add match_scope column to project_mapping if missing.
  const pmCols = db.prepare('PRAGMA table_info(project_mapping)').all();
  const pmColNames = new Set(pmCols.map(r => r.name));
  if (!pmColNames.has('match_scope')) {
    db.exec(`ALTER TABLE project_mapping ADD COLUMN match_scope TEXT NOT NULL DEFAULT 'sub_project'`);
  }

  // 3. Drop NOT NULL on project_mapping.sf_sub_project and sf_unit_prefix.
  //    SQLite has no ALTER COLUMN — we rebuild the table.
  const subCol    = pmCols.find(r => r.name === 'sf_sub_project');
  const prefixCol = pmCols.find(r => r.name === 'sf_unit_prefix');
  const needsRebuild = (subCol && subCol.notnull === 1) || (prefixCol && prefixCol.notnull === 1);
  if (needsRebuild) {
    // v_unit_compare references project_mapping. SQLite errors on table drop /
    // rename when a view depends on the table. Drop the view first; schema.sql
    // will recreate it on the next openDb() (CREATE VIEW IF NOT EXISTS).
    db.exec(`
      BEGIN TRANSACTION;
      DROP VIEW IF EXISTS v_unit_compare;
      CREATE TABLE project_mapping_new (
        project_id          INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
        sf_sub_project      TEXT,
        sf_unit_prefix      TEXT,
        sf_project          TEXT,
        match_scope         TEXT NOT NULL DEFAULT 'sub_project',
        source              TEXT NOT NULL DEFAULT 'auto',
        notes               TEXT,
        area_threshold_pct  REAL,
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO project_mapping_new
        (project_id, sf_sub_project, sf_unit_prefix, sf_project, match_scope, source, notes, updated_at)
        SELECT project_id, sf_sub_project, sf_unit_prefix, sf_project,
               COALESCE(match_scope, 'sub_project'),
               source, notes, updated_at
          FROM project_mapping;
      DROP TABLE project_mapping;
      ALTER TABLE project_mapping_new RENAME TO project_mapping;
      COMMIT;
    `);
  }

  // 4. Create manual_area table if missing (durable across SF re-imports).
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  if (!tables.includes('manual_area')) {
    db.exec(`
      CREATE TABLE manual_area (
        manual_area_id    INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id        INTEGER NOT NULL REFERENCES dld_project ON DELETE CASCADE,
        unit_number_norm  TEXT NOT NULL,
        area_sqm          REAL NOT NULL,
        source_note       TEXT,
        entered_by        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, unit_number_norm)
      );
      CREATE INDEX idx_manual_area_proj_unit ON manual_area(project_id, unit_number_norm);
    `);
  }

  // 5. Add area_threshold_pct column to project_mapping if missing.
  //    (Runs after block 3's rebuild so it is never clobbered by the rebuild.)
  const pmCols2 = new Set(db.prepare('PRAGMA table_info(project_mapping)').all().map(r => r.name));
  if (!pmCols2.has('area_threshold_pct')) {
    db.exec(`ALTER TABLE project_mapping ADD COLUMN area_threshold_pct REAL`);
  }

  // 6. Master-data + approval-queue migration (run only when master_data is empty).
  //    Tables themselves are created by db/schema.sql via CREATE TABLE IF NOT EXISTS.
  //    See docs/superpowers/specs/2026-05-05-master-data-and-approval-queue-design.md.
  //    Guard: skip entirely when master_data table doesn't exist (e.g. old-schema test DBs).
  const hasMasterTable = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='master_data'`
  ).get();
  const masterCount = hasMasterTable
    ? db.prepare('SELECT COUNT(*) AS n FROM master_data').get().n
    : 1; // treat missing table as "already seeded" so we skip the block
  if (masterCount === 0) {
    db.exec(`
      BEGIN TRANSACTION;

      -- 6a. Seed master_data from manual_override.
      INSERT INTO master_data (
        project_id, unit_number_norm, buyer_name,
        buyer_source, buyer_decided_at, notes, created_at, updated_at
      )
      SELECT
        o.project_id, o.unit_number_norm, o.actual_buyer,
        'staff', o.updated_at, COALESCE(o.notes, ''),
        o.created_at, o.updated_at
      FROM manual_override o
      WHERE NOT EXISTS (
        SELECT 1 FROM master_data m
        WHERE m.project_id = o.project_id AND m.unit_number_norm = o.unit_number_norm
      );

      -- 6b. UPDATE area on existing master_data rows that already have a manual_override entry.
      UPDATE master_data
      SET area_sqm = (
            SELECT a.area_sqm FROM manual_area a
            WHERE a.project_id = master_data.project_id
              AND a.unit_number_norm = master_data.unit_number_norm
          ),
          area_source = 'staff',
          area_decided_at = (
            SELECT a.updated_at FROM manual_area a
            WHERE a.project_id = master_data.project_id
              AND a.unit_number_norm = master_data.unit_number_norm
          ),
          updated_at = datetime('now')
      WHERE EXISTS (
        SELECT 1 FROM manual_area a
        WHERE a.project_id = master_data.project_id
          AND a.unit_number_norm = master_data.unit_number_norm
      );

      -- 6c. INSERT new master_data rows for manual_area entries that have no override.
      INSERT INTO master_data (
        project_id, unit_number_norm, area_sqm,
        area_source, area_decided_at, notes, created_at, updated_at
      )
      SELECT
        a.project_id, a.unit_number_norm, a.area_sqm,
        'staff', a.updated_at, COALESCE(a.source_note, ''),
        a.created_at, a.updated_at
      FROM manual_area a
      WHERE NOT EXISTS (
        SELECT 1 FROM master_data m
        WHERE m.project_id = a.project_id AND m.unit_number_norm = a.unit_number_norm
      );

      COMMIT;
    `);
  }

  // 7. Drop unused raw_json column from dld_snapshot if present.
  const snapCols = new Set(db.prepare('PRAGMA table_info(dld_snapshot)').all().map(r => r.name));
  if (snapCols.has('raw_json')) {
    db.exec('ALTER TABLE dld_snapshot DROP COLUMN raw_json');
  }

  // 8. Drop unused v_unit_compare view if present.
  db.exec('DROP VIEW IF EXISTS v_unit_compare');
}

function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  migrateSchema(db);
  return db;
}

function sha256OfFile(filePath) {
  const crypto = require('crypto');
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function toIsoDate(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const m = String(ddmmyyyy).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d  = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  return `${m[3]}-${mo}-${d}`;
}

module.exports = { openDb, migrateSchema, sha256OfFile, toIsoDate, DEFAULT_DB_PATH };
