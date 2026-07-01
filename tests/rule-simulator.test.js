import test from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_SAMPLE_DATA, simulateRule } from '../public/rules/rule-simulator.js';

const contract = {
  trigger: { type: 'record.updated', entity: 'stock_out', field: 'status', to: 'confirmed' },
  check: { left: 'products.stock', operator: '>=', right: 'stock_out_items.quantity' },
  then: { type: 'inventory.adjust', operation: 'decrease' },
  else: { type: 'block', message: '库存不足，无法出库' }
};

test('RuleSimulator returns the specified success result and readable steps', () => {
  const sample = structuredClone(INVENTORY_SAMPLE_DATA.enough);
  const result = simulateRule(contract, sample);

  assert.equal(result.status, 'success');
  assert.equal(result.title, '允许出库');
  assert.equal(result.product.name, 'iPhone 15');
  assert.equal(result.currentStock, 10);
  assert.equal(result.quantity, 2);
  assert.equal(result.afterStock, 8);
  assert.equal(result.after.product.stock, 8);
  assert.deepEqual(result.steps.map((step) => step.name), ['触发规则', '读取出库明细', '按商品汇总', '检查库存', '模拟扣减库存']);
  assert.match(result.steps[3].detail, /库存 10 >= 出库数量 2/);
  assert.equal(sample.product.stock, 10, 'simulation must not mutate sample inventory');
});

test('RuleSimulator returns the specified blocked result without reducing inventory', () => {
  const sample = structuredClone(INVENTORY_SAMPLE_DATA.shortage);
  const result = simulateRule(contract, sample);

  assert.equal(result.status, 'blocked');
  assert.equal(result.title, '阻止出库');
  assert.equal(result.product.name, 'AirPods Pro');
  assert.equal(result.currentStock, 0);
  assert.equal(result.quantity, 1);
  assert.equal(result.afterStock, undefined);
  assert.equal(result.after.product.stock, 0);
  assert.equal(result.steps.at(-1).status, 'blocked');
  assert.equal(result.steps.at(-1).detail, '库存不足，无法出库');
  assert.equal(sample.product.stock, 0);
});

test('RuleSimulator aggregates matching items by product', () => {
  const sample = structuredClone(INVENTORY_SAMPLE_DATA.enough);
  sample.stockOutItems.push({ id: 'item2', stock_out_id: 'so1', product_id: 'p1', quantity: 3 });
  const result = simulateRule(contract, sample);
  assert.equal(result.quantity, 5);
  assert.equal(result.afterStock, 5);
  assert.match(result.steps[1].detail, /2 条明细/);
});

test('RuleSimulator returns an error instead of throwing for incomplete contracts', () => {
  const result = simulateRule({ trigger: {} }, INVENTORY_SAMPLE_DATA.enough);
  assert.equal(result.status, 'error');
  assert.equal(result.summary, 'Contract 缺少必要字段，无法模拟');
  assert.equal(result.steps[0].status, 'error');
});
