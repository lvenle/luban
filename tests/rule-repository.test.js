import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageRuleRepository } from '../public/rules/rule-repository.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function input(overrides = {}) {
  return {
    name: '出库确认后自动扣库存',
    description: '库存规则',
    status: 'active',
    sourceText: '出库确认后自动扣库存，库存不足不能出库',
    businessIntentJson: { trigger: '出库确认' },
    schemaMappingJson: { stock: 'products.stock' },
    contractJson: { trigger: { type: 'record.updated' } },
    ...overrides
  };
}

test('LocalStorageRuleRepository creates, reads, lists and updates complete rules', () => {
  const repository = new LocalStorageRuleRepository(new MemoryStorage());
  const created = repository.createRule(input());
  assert.ok(created.id);
  assert.ok(created.createdAt);
  assert.equal(created.updatedAt, created.createdAt);
  assert.deepEqual(repository.getRule(created.id), created);
  assert.equal(repository.listRules().length, 1);

  const updated = repository.updateRule(created.id, { status: 'disabled' });
  assert.equal(updated.status, 'disabled');
  assert.equal(updated.name, created.name);
  assert.deepEqual(updated.contractJson, created.contractJson);
});

test('LocalStorageRuleRepository validates statuses and deletes by id', () => {
  const repository = new LocalStorageRuleRepository(new MemoryStorage());
  assert.throws(() => repository.createRule(input({ status: 'running' })), /规则状态无效/);
  const created = repository.createRule(input({ status: 'draft' }));
  assert.equal(repository.deleteRule(created.id), true);
  assert.equal(repository.getRule(created.id), null);
  assert.equal(repository.deleteRule(created.id), false);
});
