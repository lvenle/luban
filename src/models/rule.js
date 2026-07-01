import { getDb, triggerBackup } from '../storage/db.js';
import { createId } from '../core/ids.js';

const STATUSES = new Set(['draft', 'active', 'disabled']);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    description: row.description || '',
    status: row.status,
    sourceText: row.sourceText,
    businessIntentJson: parseJson(row.businessIntentJson),
    schemaMappingJson: parseJson(row.schemaMappingJson),
    contractJson: parseJson(row.contractJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function requiredObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} 必须是对象`);
  return value;
}

export function createRule(input) {
  const now = new Date().toISOString();
  const status = input.status || 'active';
  if (!input.appId) throw new TypeError('appId 不能为空');
  if (!String(input.name || '').trim()) throw new TypeError('规则名称不能为空');
  if (!String(input.sourceText || '').trim()) throw new TypeError('规则原始描述不能为空');
  if (!STATUSES.has(status)) throw new TypeError('规则状态无效');
  const rule = {
    id: createId('rule'), appId: input.appId, name: String(input.name).trim(),
    description: String(input.description || '').trim(), status,
    sourceText: String(input.sourceText).trim(),
    businessIntentJson: requiredObject(input.businessIntentJson, 'businessIntentJson'),
    schemaMappingJson: requiredObject(input.schemaMappingJson, 'schemaMappingJson'),
    contractJson: requiredObject(input.contractJson, 'contractJson'),
    createdAt: now, updatedAt: now
  };
  getDb().prepare(`
    INSERT INTO rules (
      id, appId, name, description, status, sourceText, businessIntentJson,
      schemaMappingJson, contractJson, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.id, rule.appId, rule.name, rule.description, rule.status, rule.sourceText,
    JSON.stringify(rule.businessIntentJson), JSON.stringify(rule.schemaMappingJson),
    JSON.stringify(rule.contractJson), rule.createdAt, rule.updatedAt
  );
  triggerBackup();
  return rule;
}

export function getRule(appId, ruleId) {
  return rowToRule(getDb().prepare('SELECT * FROM rules WHERE appId = ? AND id = ?').get(appId, ruleId));
}

export function listRules(appId, options = {}) {
  const status = options.status && STATUSES.has(options.status) ? options.status : '';
  const rows = status
    ? getDb().prepare('SELECT * FROM rules WHERE appId = ? AND status = ? ORDER BY updatedAt DESC').all(appId, status)
    : getDb().prepare('SELECT * FROM rules WHERE appId = ? ORDER BY updatedAt DESC').all(appId);
  return rows.map(rowToRule);
}

export function listActiveRulesForEvent(appId, event) {
  return listRules(appId, { status: 'active' }).filter((rule) => {
    const trigger = rule.contractJson?.trigger;
    return trigger?.type === event?.type && trigger?.entity === event?.entity;
  });
}

export function updateRuleStatus(appId, ruleId, status) {
  if (!STATUSES.has(status)) throw new TypeError('规则状态无效');
  const updatedAt = new Date().toISOString();
  const result = getDb().prepare('UPDATE rules SET status = ?, updatedAt = ? WHERE appId = ? AND id = ?')
    .run(status, updatedAt, appId, ruleId);
  if (!result.changes) return null;
  triggerBackup();
  return getRule(appId, ruleId);
}

export function updateRuleDefinition(appId, ruleId, input) {
  const existing = getRule(appId, ruleId);
  if (!existing) return null;
  const updatedAt = new Date().toISOString();
  const next = {
    name: String(input.name || existing.name).trim(),
    description: String(input.description ?? existing.description ?? '').trim(),
    sourceText: String(input.sourceText || existing.sourceText).trim(),
    businessIntentJson: requiredObject(input.businessIntentJson, 'businessIntentJson'),
    schemaMappingJson: requiredObject(input.schemaMappingJson, 'schemaMappingJson'),
    contractJson: requiredObject(input.contractJson, 'contractJson')
  };
  getDb().prepare(`
    UPDATE rules SET name = ?, description = ?, sourceText = ?, businessIntentJson = ?,
      schemaMappingJson = ?, contractJson = ?, updatedAt = ?
    WHERE appId = ? AND id = ?
  `).run(
    next.name, next.description, next.sourceText, JSON.stringify(next.businessIntentJson),
    JSON.stringify(next.schemaMappingJson), JSON.stringify(next.contractJson), updatedAt, appId, ruleId
  );
  triggerBackup();
  return getRule(appId, ruleId);
}

export function deleteRule(appId, ruleId) {
  const deleted = getDb().prepare('DELETE FROM rules WHERE appId = ? AND id = ?').run(appId, ruleId).changes > 0;
  if (deleted) triggerBackup();
  return deleted;
}
