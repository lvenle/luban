const STORAGE_KEY = 'luban-ai:rules:v1';
const RULE_STATUSES = new Set(['draft', 'active', 'disabled']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function requiredObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} 必须是对象`);
  }
  return clone(value);
}

function normalizeInput(input, existing = null) {
  const name = String(input.name ?? existing?.name ?? '').trim();
  const sourceText = String(input.sourceText ?? existing?.sourceText ?? '').trim();
  const status = input.status ?? existing?.status ?? 'draft';
  if (!name) throw new TypeError('规则名称不能为空');
  if (!sourceText) throw new TypeError('用户原始输入不能为空');
  if (!RULE_STATUSES.has(status)) throw new TypeError('规则状态无效');
  return {
    name,
    description: String(input.description ?? existing?.description ?? '').trim(),
    status,
    sourceText,
    businessIntentJson: requiredObject(input.businessIntentJson ?? existing?.businessIntentJson, 'businessIntentJson'),
    schemaMappingJson: requiredObject(input.schemaMappingJson ?? existing?.schemaMappingJson, 'schemaMappingJson'),
    contractJson: requiredObject(input.contractJson ?? existing?.contractJson, 'contractJson')
  };
}

export class LocalStorageRuleRepository {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  readAll() {
    try {
      const value = JSON.parse(this.storage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  writeAll(rules) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(rules));
  }

  listRules() {
    return clone(this.readAll().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
  }

  getRule(id) {
    const rule = this.readAll().find((item) => item.id === id);
    return rule ? clone(rule) : null;
  }

  createRule(input) {
    const now = new Date().toISOString();
    const rule = { id: createId(), ...normalizeInput(input), createdAt: now, updatedAt: now };
    const rules = this.readAll();
    rules.push(rule);
    this.writeAll(rules);
    return clone(rule);
  }

  updateRule(id, input) {
    const rules = this.readAll();
    const index = rules.findIndex((item) => item.id === id);
    if (index < 0) return null;
    rules[index] = { ...rules[index], ...normalizeInput(input, rules[index]), updatedAt: new Date().toISOString() };
    this.writeAll(rules);
    return clone(rules[index]);
  }

  deleteRule(id) {
    const rules = this.readAll();
    const next = rules.filter((item) => item.id !== id);
    if (next.length === rules.length) return false;
    this.writeAll(next);
    return true;
  }
}

export const ruleRepository = new LocalStorageRuleRepository();
