import { getDb } from '../storage/db.js';

function parseJson(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToState(row) {
  if (!row) return null;
  return {
    appId: row.appId,
    ruleId: row.ruleId,
    sourceEntity: row.sourceEntity,
    sourceRecordId: row.sourceRecordId,
    state: row.state,
    missingFields: parseJson(row.missingFieldsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function getRuleRecordState(appId, ruleId, sourceRecordId, database = getDb()) {
  return rowToState(database.prepare(`
    SELECT * FROM rule_record_states WHERE appId = ? AND ruleId = ? AND sourceRecordId = ?
  `).get(appId, ruleId, sourceRecordId));
}

export function upsertRuleRecordState(input, database = getDb()) {
  const existing = getRuleRecordState(input.appId, input.ruleId, input.sourceRecordId, database);
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt || now;
  database.prepare(`
    INSERT INTO rule_record_states (
      appId, ruleId, sourceEntity, sourceRecordId, state, missingFieldsJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(appId, ruleId, sourceRecordId) DO UPDATE SET
      sourceEntity = excluded.sourceEntity,
      state = excluded.state,
      missingFieldsJson = excluded.missingFieldsJson,
      updatedAt = excluded.updatedAt
  `).run(
    input.appId, input.ruleId, input.sourceEntity, input.sourceRecordId, input.state,
    JSON.stringify(input.missingFields || []), createdAt, now
  );
  return getRuleRecordState(input.appId, input.ruleId, input.sourceRecordId, database);
}

export function listRuleRecordStates(appId, options = {}, database = getDb()) {
  const conditions = ['appId = ?'];
  const params = [appId];
  if (options.ruleId) { conditions.push('ruleId = ?'); params.push(options.ruleId); }
  if (options.sourceRecordId) { conditions.push('sourceRecordId = ?'); params.push(options.sourceRecordId); }
  if (options.state) { conditions.push('state = ?'); params.push(options.state); }
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
  params.push(limit);
  return database.prepare(`
    SELECT * FROM rule_record_states
    WHERE ${conditions.join(' AND ')}
    ORDER BY updatedAt DESC LIMIT ?
  `).all(...params).map(rowToState);
}
