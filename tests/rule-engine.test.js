import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord, getRecord } from '../src/models/record.js';
import { executeRuleEvent } from '../src/services/rule-engine.js';
import { listRuleRuns } from '../src/models/rule-run.js';
import { createBudgetPackage } from '../src/templates/appTemplates.js';
import { createAppServer } from '../src/server.js';

function inventoryPackage() {
  const pkg = createBudgetPackage();
  pkg.manifest.id = 'rule-engine-fixture';
  pkg.manifest.name = '规则引擎验收应用';
  pkg.schema.entities = [
    { id: 'products', name: '商品', fields: [{ id: 'name', label: '名称', type: 'text' }, { id: 'stock', label: '库存', type: 'number' }] },
    { id: 'stock_out', name: '出库单', fields: [{ id: 'status', label: '状态', type: 'text' }] },
    { id: 'stock_out_items', name: '出库明细', fields: [
      { id: 'stock_out_id', label: '出库单', type: 'text' },
      { id: 'product_id', label: '商品', type: 'text' },
      { id: 'quantity', label: '数量', type: 'number' }
    ] }
  ];
  pkg.ui = { home: { layout: 'dashboard', cards: [] }, pages: pkg.schema.entities.map((entity) => ({ id: `${entity.id}-list`, title: entity.name, type: 'list', entity: entity.id })) };
  pkg.actions = { actions: [] };
  return pkg;
}

function contract(overrides = {}) {
  return {
    id: 'stock_out_confirm_decrease_inventory',
    name: '验收规则（名称不参与执行）',
    trigger: { type: 'record.updated', entity: 'stock_out', field: 'status', from: 'draft', to: 'confirmed' },
    steps: [
      { id: 'read_items', type: 'read.records', entity: 'stock_out_items', where: { stock_out_id: '{{trigger.record.id}}' }, output: 'items' },
      { id: 'group_items', type: 'aggregate.sum', input: 'items', groupBy: 'product_id', sum: 'quantity', output: 'groupedItems' },
      { id: 'check_stock', type: 'condition', scope: 'each groupedItems', left: 'products.stock', operator: '>=', right: 'groupedItems.quantity', then: ['decrease_stock'], else: ['block_stock_out'] },
      { id: 'decrease_stock', type: 'update.field', entity: 'products', record: '{{groupedItems.product_id}}', field: 'stock', operation: 'decrement', value: '{{groupedItems.quantity}}' },
      { id: 'block_stock_out', type: 'block', message: '库存不足，无法出库' },
      { id: 'write_log', type: 'log.run' }
    ],
    idempotency: { key: '{{rule.id}}:{{trigger.entity}}:{{trigger.record.id}}' },
    ...overrides
  };
}

function fixture(suffix, productName, stock, quantity) {
  const dbPath = join(process.cwd(), 'data', `test-rule-engine-${suffix}.sqlite`);
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(inventoryPackage());
  const product = createRecord(app.id, 'products', { name: productName, stock });
  const stockOut = createRecord(app.id, 'stock_out', { status: 'draft' });
  createRecord(app.id, 'stock_out_items', { stock_out_id: stockOut.id, product_id: product.id, quantity });
  const event = { type: 'record.updated', entity: 'stock_out', recordId: stockOut.id, before: { status: 'draft' }, after: { status: 'confirmed' } };
  return { app, product, stockOut, event, rule: { id: 'rule_acceptance', contractJson: contract() } };
}

test('trigger mismatch returns skipped without changing data', () => {
  const data = fixture('skip', '商品 A', 10, 2);
  const result = executeRuleEvent({ appId: data.app.id, rule: data.rule, event: { ...data.event, after: { status: 'draft' } } });
  assert.equal(result.status, 'skipped');
  assert.equal(getRecord(data.product.id).data.stock, 10);
});

test('draft or disabled saved rules are skipped', () => {
  const data = fixture('disabled', '商品 A2', 10, 2);
  const result = executeRuleEvent({ appId: data.app.id, rule: { ...data.rule, status: 'disabled' }, event: data.event });
  assert.equal(result.status, 'skipped');
  assert.match(result.steps[0].message, /当前未启用/);
  assert.equal(getRecord(data.product.id).data.stock, 10);
});

test('generic update.field decrements 10 to 8 and writes a success run', () => {
  const data = fixture('success', 'iPhone 15', 10, 2);
  const result = executeRuleEvent({ appId: data.app.id, rule: data.rule, event: data.event });
  assert.equal(result.status, 'success');
  assert.equal(result.changes[0].beforeValue, 10);
  assert.equal(result.changes[0].afterValue, 8);
  assert.equal(result.changes[0].recordLabel, 'iPhone 15');
  assert.equal(getRecord(data.product.id).data.stock, 8);
  assert.deepEqual(result.steps.map((step) => step.type), ['record.updated', 'read.records', 'aggregate.sum', 'condition', 'update.field', 'log.run']);
  assert.match(result.steps[0].message, /触发字段已由 draft 变为 confirmed/);
  assert.match(result.steps[1].message, /已找到 1 条符合条件的数据/);
  assert.match(result.steps[2].message, /数据汇总完成，共 1 组/);
  assert.match(result.steps[3].message, /条件检查通过：当前值 10，要求至少为 2/);
  const runs = listRuleRuns(data.app.id, { ruleId: data.rule.id });
  assert.equal(runs[0].status, 'success');
  assert.equal(runs[0].idempotencyKey, `rule_acceptance:stock_out:${data.stockOut.id}`);
  assert.equal(runs[0].outputSnapshotJson.updates[0].before.data.stock, 10);
  assert.equal(runs[0].outputSnapshotJson.updates[0].after.data.stock, 8);
  assert.equal(runs[0].outputSnapshotJson.updates[0].recordLabel, 'iPhone 15');
});

test('block rolls back all updates and writes the reason', () => {
  const data = fixture('blocked', 'AirPods Pro', 0, 1);
  const result = executeRuleEvent({ appId: data.app.id, rule: data.rule, event: data.event });
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorMessage, '库存不足，无法出库');
  assert.equal(getRecord(data.product.id).data.stock, 0);
  const runs = listRuleRuns(data.app.id, { ruleId: data.rule.id });
  assert.equal(runs[0].status, 'blocked');
  assert.match(runs[0].stepsJson.at(-1).message, /库存不足/);
});

test('successful idempotency key is never executed twice', () => {
  const data = fixture('idempotency', '商品 B', 10, 2);
  assert.equal(executeRuleEvent({ appId: data.app.id, rule: data.rule, event: data.event }).status, 'success');
  const repeated = executeRuleEvent({ appId: data.app.id, rule: data.rule, event: data.event });
  assert.equal(repeated.status, 'skipped');
  assert.match(repeated.steps[0].message, /已经执行过/);
  assert.equal(getRecord(data.product.id).data.stock, 8);
  assert.equal(listRuleRuns(data.app.id, { ruleId: data.rule.id }).filter((run) => run.status === 'success').length, 1);
});

test('missing contract fields return failed and write a failed run', () => {
  const data = fixture('invalid', '商品 C', 10, 2);
  const result = executeRuleEvent({ appId: data.app.id, rule: { id: data.rule.id, contractJson: { trigger: contract().trigger } }, event: data.event });
  assert.equal(result.status, 'failed');
  assert.match(result.errorMessage, /Contract 缺少必要字段/);
  assert.equal(getRecord(data.product.id).data.stock, 10);
  assert.equal(listRuleRuns(data.app.id, { ruleId: data.rule.id })[0].status, 'failed');
});

test('unsupported step type returns failed without arbitrary execution', () => {
  const data = fixture('unsupported', '商品 D', 10, 2);
  const invalidContract = contract({ steps: [{ id: 'unsafe', type: 'javascript.eval', code: 'throw new Error()' }] });
  const result = executeRuleEvent({ appId: data.app.id, rule: { id: data.rule.id, contractJson: invalidContract }, event: data.event });
  assert.equal(result.status, 'failed');
  assert.match(result.errorMessage, /不支持的 Step 类型/);
  assert.equal(getRecord(data.product.id).data.stock, 10);
});

test('condition branches cannot recursively invoke other conditions', () => {
  const data = fixture('recursive', '商品 D2', 10, 2);
  const invalid = contract();
  invalid.steps.find((step) => step.id === 'check_stock').then = ['check_stock'];
  const result = executeRuleEvent({ appId: data.app.id, rule: { id: data.rule.id, contractJson: invalid }, event: data.event });
  assert.equal(result.status, 'failed');
  assert.match(result.errorMessage, /condition 分支仅支持/);
  assert.equal(getRecord(data.product.id).data.stock, 10);
});

test('a later block rolls back an earlier generic field update in the same transaction', () => {
  const data = fixture('rollback', '商品 E', 10, 2);
  const insufficient = createRecord(data.app.id, 'products', { name: '商品 F', stock: 0 });
  createRecord(data.app.id, 'stock_out_items', { stock_out_id: data.stockOut.id, product_id: insufficient.id, quantity: 1 });
  const result = executeRuleEvent({ appId: data.app.id, rule: data.rule, event: data.event });
  assert.equal(result.status, 'blocked');
  assert.equal(getRecord(data.product.id).data.stock, 10, 'first update must be rolled back');
  assert.equal(getRecord(insufficient.id).data.stock, 0);
  assert.ok(result.steps.some((step) => step.type === 'update.field' && step.status === 'skipped' && step.message.includes('数据已恢复')));
});

test('runtime API executes a submitted saved Contract and exposes Rule Runs', async () => {
  const data = fixture('http', '商品 G', 6, 2);
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const executed = await fetch(`${base}/api/apps/${data.app.id}/rules/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rule: data.rule, event: data.event })
    });
    assert.equal(executed.status, 200);
    assert.equal((await executed.json()).status, 'success');

    const logs = await fetch(`${base}/api/apps/${data.app.id}/rule-runs?ruleId=${data.rule.id}`);
    assert.equal(logs.status, 200);
    const body = await logs.json();
    assert.equal(body.runs[0].status, 'success');
    assert.equal(body.runs[0].sourceRecordId, data.stockOut.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
