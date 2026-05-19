// v2.3 — rules CRUD backend. Exposes operations on the automation_rule
// table for the renderer (Automation page) and CLI. Validates payloads
// using the same helpers as rule-loader.js so the rules editor cannot
// save a rule the engine will then disable.

const { writeAuditLog } = require('../audit-log');
const { validatePredicate, validateThen } = require('../rule-loader');

function listRules(db) {
  return db.prepare(`
    SELECT id, name, enabled, priority, when_json, then_json, builtin,
           created_at, created_by, applied_count, revert_count
    FROM automation_rule
    ORDER BY priority ASC, id ASC
  `).all().map(r => ({
    ...r,
    enabled: !!r.enabled,
    builtin: !!r.builtin,
    when: tryParse(r.when_json),
    then: tryParse(r.then_json)
  }));
}

function getRule(db, id) {
  const r = db.prepare('SELECT * FROM automation_rule WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, enabled: !!r.enabled, builtin: !!r.builtin,
           when: tryParse(r.when_json), then: tryParse(r.then_json) };
}

function createRule(db, payload) {
  const { name, priority, when, then, enabled = true } = payload || {};
  if (!name || typeof name !== 'string') throw new Error('name required (string)');
  if (typeof priority !== 'number') throw new Error('priority required (number)');
  if (priority < 1 || priority >= 1000) {
    throw new Error('user rule priority must be in [1, 999]; 1000+ reserved for built-ins');
  }
  validatePredicate(when);
  validateThen(then);
  const info = db.prepare(`
    INSERT INTO automation_rule
      (name, enabled, priority, when_json, then_json, builtin, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'), ?)
  `).run(name, enabled ? 1 : 0, priority, JSON.stringify(when), JSON.stringify(then),
         process.env.DLP_USER || 'user');
  return info.lastInsertRowid;
}

function updateRule(db, id, patch) {
  const existing = db.prepare('SELECT * FROM automation_rule WHERE id = ?').get(id);
  if (!existing) throw new Error('rule not found: ' + id);
  // Built-ins: only `enabled` is editable.
  if (existing.builtin) {
    const enabledOnly = Object.keys(patch).every(k => k === 'enabled');
    if (!enabledOnly) throw new Error('built-in rules: only `enabled` is editable');
  }
  const next = { ...existing, ...patch };
  if (patch.when) validatePredicate(patch.when);
  if (patch.then) validateThen(patch.then);
  if (typeof next.priority === 'number' && !existing.builtin) {
    if (next.priority < 1 || next.priority >= 1000) {
      throw new Error('user rule priority must be in [1, 999]');
    }
  }
  const wasEnabled = !!existing.enabled;
  const willBeEnabled = patch.enabled !== undefined ? !!patch.enabled : wasEnabled;

  db.prepare(`
    UPDATE automation_rule
       SET name = ?, enabled = ?, priority = ?, when_json = ?, then_json = ?
     WHERE id = ?
  `).run(
    typeof patch.name === 'string' ? patch.name : existing.name,
    willBeEnabled ? 1 : 0,
    typeof patch.priority === 'number' ? patch.priority : existing.priority,
    patch.when ? JSON.stringify(patch.when) : existing.when_json,
    patch.then ? JSON.stringify(patch.then) : existing.then_json,
    id
  );

  // Audit-log enabled flip — feeds the planning-mistakes log "rule disabled
  // silently" mitigation (audit chain captures every flip).
  if (wasEnabled !== willBeEnabled) {
    writeAuditLog(db, {
      tableName: 'automation_rule',
      field: 'enabled',
      oldValue: wasEnabled ? '1' : '0',
      newValue: willBeEnabled ? '1' : '0',
      action: 'auto_apply',
      source: 'rule_fired',
      userNote: `rule ${id} (${existing.name}) ${willBeEnabled ? 'enabled' : 'disabled'} by user`
    });
  }
  return id;
}

function deleteRule(db, id) {
  const existing = db.prepare('SELECT builtin FROM automation_rule WHERE id = ?').get(id);
  if (!existing) throw new Error('rule not found: ' + id);
  if (existing.builtin) throw new Error('built-in rules cannot be deleted; disable instead');
  db.prepare('DELETE FROM automation_rule WHERE id = ?').run(id);
}

// Dry-evaluate a rule against existing candidate changes. Used by the
// editor's "Test rule" button. Reads pending_change rows (any decision)
// from the given snapshot and returns engine decisions.
function testRule(db, ruleId, snapshotId) {
  const { evaluate } = require('../rule-engine');
  const r = getRule(db, ruleId);
  if (!r) throw new Error('rule not found: ' + ruleId);
  const rules = [{ id: r.id, priority: r.priority, enabled: true, when: r.when, then: r.then }];
  const candidates = db.prepare(`
    SELECT change_id, project_id, unit_number_norm, field_name AS field,
           old_value, proposed_value AS new_value, change_type
    FROM pending_change
    WHERE source_snapshot_id = ?
    LIMIT 100
  `).all(snapshotId);
  return candidates.map(c => {
    const change = {
      change_type:      c.change_type,
      field:            c.field,
      delta_pct:        0,
      delta_abs:        0,
      alias_exists:     false,
      bp_type:          null,
      sf_state:         null,
      project_id:       c.project_id,
      project_name:     null,
      tier2:            false,
      source:           'compare',
      unit_number_norm: c.unit_number_norm,
      procedure_number: null,
      old_value:        c.old_value,
      new_value:        c.new_value
    };
    return { change: c, decision: evaluate(change, {}, rules) };
  });
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { listRules, getRule, createRule, updateRule, deleteRule, testRule };
