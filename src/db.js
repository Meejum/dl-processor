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
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE project_mapping_new (
        project_id     INTEGER PRIMARY KEY REFERENCES dld_project ON DELETE CASCADE,
        sf_sub_project TEXT,
        sf_unit_prefix TEXT,
        sf_project     TEXT,
        match_scope    TEXT NOT NULL DEFAULT 'sub_project',
        source         TEXT NOT NULL DEFAULT 'auto',
        notes          TEXT,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
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
