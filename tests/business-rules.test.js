import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord, deleteRecordForApp, getRecord } from '../src/models/record.js';
import { compileBusinessRule, saveCompiledRule, updateCompiledRule } from '../src/services/rule-creation.js';
import { createRecordWithRules, updateRecordWithRules } from '../src/services/rule-runtime.js';
import { deleteRule, getRule, listRules, updateRuleStatus } from '../src/models/rule.js';
import { listRuleRuns } from '../src/models/rule-run.js';
import { listRuleRecordStates } from '../src/models/rule-record-state.js';
import { getTool } from '../src/ai/registry.js';
import { createAppServer } from '../src/server.js';

function salesPackage() {
  return {
    manifest: { packageVersion: '2.0', id: 'sales-rule-test', name: '销售管理', version: '2.0.0' },
    schema: { entities: [
      { id: 'customers', name: '客户', fields: [
        { id: 'name', label: '客户名称', type: 'text' },
        { id: 'total_spending', label: '累计消费', type: 'number' }
      ] },
      { id: 'orders', name: '订单', fields: [
        { id: 'title', label: '订单名称', type: 'text' },
        { id: 'customer', label: '客户', type: 'relation', targetEntity: 'customers', displayField: 'name', multiple: false },
        { id: 'amount', label: '订单金额', type: 'number' },
        { id: 'status', label: '状态', type: 'select', options: [
          { id: 'pending', label: '待处理', color: 'gray' },
          { id: 'completed', label: '已完成', color: 'green' }
        ] }
      ] }
    ] },
    ui: { pages: [
      { id: 'customers-list', title: '客户', type: 'table', entity: 'customers' },
      { id: 'orders-list', title: '订单', type: 'table', entity: 'orders' }
    ] },
    actions: { actions: [] },
    prompts: {}
  };
}

function orderCompletedIntent() {
  return {
    supported: true,
    name: '订单完成后累计客户消费',
    summary: '订单完成时，将订单金额累加到关联客户的累计消费。',
    trigger: { entity: 'orders', field: 'status', from: 'pending', to: 'completed' },
    target: { entity: 'customers', relationField: 'customer', field: 'total_spending' },
    action: { operation: 'increment', value: { type: 'trigger.field', field: 'amount' } },
    display: { when: '订单状态从“待处理”变为“已完成”', then: '关联客户的累计消费增加订单金额' }
  };
}

function orderCreatedIntent() {
  return {
    supported: true,
    name: '新增订单后累计客户消费',
    summary: '新增订单时，将订单金额累加到关联客户的累计消费。',
    trigger: { event: 'record.created', entity: 'orders' },
    target: { entity: 'customers', relationField: 'customer', field: 'total_spending' },
    action: { operation: 'increment', value: { type: 'trigger.field', field: 'amount' } },
    display: { when: '新增一条订单记录', then: '关联客户的累计消费增加订单金额' }
  };
}

function fixture(suffix = 'success') {
  const path = join(process.cwd(), 'data', `test-business-rule-${suffix}.sqlite`);
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const customer = createRecord(app.id, 'customers', { name: '星河公司', total_spending: 1000 });
  const order = createRecord(app.id, 'orders', { title: '订单 A', customer: [customer.id], amount: 500, status: 'pending' });
  const compiled = compileBusinessRule(app, '订单完成后，把订单金额累计到客户消费', orderCompletedIntent());
  const rule = saveCompiledRule(app.id, '订单完成后，把订单金额累计到客户消费', compiled);
  return { app, customer, order, rule, compiled };
}

test('generic compiler creates relation-based increment Contract without inventory concepts', () => {
  const { compiled } = fixture('compile');
  assert.deepEqual(compiled.contract.steps.map((step) => step.type), ['read.related', 'update.field', 'log.run']);
  assert.equal(compiled.contract.steps[1].operation, 'increment');
  assert.equal(compiled.contract.steps[1].value, '{{trigger.record.amount}}');
  assert.doesNotMatch(JSON.stringify(compiled.contract), /stock|inventory|库存/i);
});

test('updating an order atomically increments the related customer field and writes a run', () => {
  const { app, customer, order, rule } = fixture('execute');
  const output = updateRecordWithRules(app.id, order.id, { status: 'completed' });
  assert.equal(output.record.data.status, 'completed');
  assert.equal(getRecord(customer.id).data.total_spending, 1500);
  assert.equal(output.ruleResults[0].status, 'success');
  assert.deepEqual(
    { before: output.ruleResults[0].changes[0].beforeValue, after: output.ruleResults[0].changes[0].afterValue },
    { before: 1000, after: 1500 }
  );
  const runs = listRuleRuns(app.id, { ruleId: rule.id });
  assert.equal(runs[0].status, 'success');
  assert.deepEqual(runs[0].stepsJson.map((step) => step.type), ['record.updated', 'read.related', 'update.field', 'log.run']);
});

test('creating a record can generically update a related table field', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-created.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const customer = createRecord(app.id, 'customers', { name: '远山公司', total_spending: 1000 });
  const compiled = compileBusinessRule(app, '新增订单时累计客户消费', orderCreatedIntent());
  const rule = saveCompiledRule(app.id, '新增订单时累计客户消费', compiled);
  assert.equal(compiled.contract.trigger.type, 'record.created');
  const output = createRecordWithRules(app.id, 'orders', {
    title: '订单 C', customer: [customer.id], amount: 250, status: 'pending'
  });
  assert.equal(getRecord(customer.id).data.total_spending, 1250);
  assert.equal(output.ruleResults[0].status, 'success');
  assert.deepEqual(
    { before: output.ruleResults[0].changes[0].beforeValue, after: output.ruleResults[0].changes[0].afterValue },
    { before: 1000, after: 1250 }
  );
  assert.equal(listRuleRuns(app.id, { ruleId: rule.id })[0].stepsJson[0].type, 'record.created');
});

test('incomplete created records wait freely, execute once when ready, and never compensate later edits or deletion', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-waiting.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const customer = createRecord(app.id, 'customers', { name: '自由编辑客户', total_spending: 1000 });
  const compiled = compileBusinessRule(app, '新增订单时累计客户消费', orderCreatedIntent());
  const rule = saveCompiledRule(app.id, '新增订单时累计客户消费', compiled);

  const created = createRecordWithRules(app.id, 'orders', { title: '自由编辑订单' });
  assert.equal(created.ruleResults[0].status, 'waiting');
  assert.deepEqual(created.ruleResults[0].missingFields.map((field) => field.fieldId).sort(), ['amount', 'customer']);
  assert.equal(getRecord(customer.id).data.total_spending, 1000);
  assert.equal(listRuleRuns(app.id, { ruleId: rule.id }).length, 0);
  assert.equal(listRuleRecordStates(app.id, { ruleId: rule.id })[0].state, 'waiting');

  const partlyReady = updateRecordWithRules(app.id, created.record.id, { amount: 250 });
  assert.equal(partlyReady.ruleResults[0].status, 'waiting');
  assert.deepEqual(partlyReady.ruleResults[0].missingFields.map((field) => field.fieldId), ['customer']);

  const ready = updateRecordWithRules(app.id, created.record.id, { customer: [customer.id] });
  assert.equal(ready.ruleResults[0].status, 'success');
  assert.equal(getRecord(customer.id).data.total_spending, 1250);
  assert.equal(listRuleRecordStates(app.id, { ruleId: rule.id })[0].state, 'success');

  const editedAfterExecution = updateRecordWithRules(app.id, created.record.id, { amount: 900 });
  assert.equal(editedAfterExecution.ruleResults.length, 0);
  assert.equal(getRecord(customer.id).data.total_spending, 1250);
  deleteRecordForApp(app.id, created.record.id);
  assert.equal(getRecord(customer.id).data.total_spending, 1250);
  deleteRule(app.id, rule.id);
  assert.equal(getRecord(customer.id).data.total_spending, 1250);
});

test('created rules never scan historical records that lack a waiting state', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-no-retroactive.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const customer = createRecord(app.id, 'customers', { name: '历史客户', total_spending: 1000 });
  const historical = createRecord(app.id, 'orders', { title: '历史订单' });
  const compiled = compileBusinessRule(app, '新增订单时累计客户消费', orderCreatedIntent());
  const rule = saveCompiledRule(app.id, '新增订单时累计客户消费', compiled);
  const output = updateRecordWithRules(app.id, historical.id, { customer: [customer.id], amount: 500 });
  assert.equal(output.ruleResults.length, 0);
  assert.equal(getRecord(customer.id).data.total_spending, 1000);
  assert.equal(listRuleRecordStates(app.id, { ruleId: rule.id }).length, 0);
});

test('deleting an incomplete source record removes only its waiting state', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-delete-waiting.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const compiled = compileBusinessRule(app, '新增订单时累计客户消费', orderCreatedIntent());
  const rule = saveCompiledRule(app.id, '新增订单时累计客户消费', compiled);
  const created = createRecordWithRules(app.id, 'orders', { title: '待删除空白订单' });
  assert.equal(listRuleRecordStates(app.id, { ruleId: rule.id, state: 'waiting' }).length, 1);
  deleteRecordForApp(app.id, created.record.id);
  assert.equal(listRuleRecordStates(app.id, { ruleId: rule.id, state: 'waiting' }).length, 0);
});

test('non-matching updates and disabled rules preserve existing behavior', () => {
  const { app, customer, order, rule } = fixture('disabled');
  updateRecordWithRules(app.id, order.id, { title: '订单 B' });
  assert.equal(getRecord(customer.id).data.total_spending, 1000);
  updateRuleStatus(app.id, rule.id, 'disabled');
  updateRecordWithRules(app.id, order.id, { status: 'completed' });
  assert.equal(getRecord(customer.id).data.total_spending, 1000);
});

test('server rules are isolated by app and retain complete creation metadata', () => {
  const { app, rule } = fixture('repository');
  assert.equal(listRules(app.id).length, 1);
  assert.equal(getRule(app.id, rule.id).sourceText, '订单完成后，把订单金额累计到客户消费');
  assert.equal(getRule('another-app', rule.id), null);
});

test('compiler rejects cross-table updates without a valid relation', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-invalid.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const intent = orderCompletedIntent();
  intent.target.relationField = 'missing_relation';
  assert.throws(() => compileBusinessRule(app, '无效规则', intent), /关联字段不能定位目标表/);
});

test('a rule failure rolls back the trigger record instead of leaving a half-applied state', () => {
  const path = join(process.cwd(), 'data', 'test-business-rule-rollback.sqlite');
  rmSync(path, { force: true });
  resetDbForTests(path);
  const app = createAppFromPackage(salesPackage());
  const order = createRecord(app.id, 'orders', { title: '无客户订单', amount: 500, status: 'pending' });
  const compiled = compileBusinessRule(app, '订单完成后累计客户消费', orderCompletedIntent());
  const rule = saveCompiledRule(app.id, '订单完成后累计客户消费', compiled);
  assert.throws(() => updateRecordWithRules(app.id, order.id, { status: 'completed' }), /找不到目标上下文/);
  assert.equal(getRecord(order.id).data.status, 'pending');
  assert.equal(listRuleRuns(app.id, { ruleId: rule.id })[0].status, 'failed');
});

test('create_rule tool exposes only natural-language intent and requires confirmation', async () => {
  await import('../src/ai/tools/create-rule.js');
  const tool = getTool('create_rule');
  assert.equal(tool.risk, 'high');
  assert.deepEqual(tool.schema.function.parameters.required, ['intent']);
  assert.deepEqual(Object.keys(tool.schema.function.parameters.properties), ['intent']);
});

test('AI and manual rule updates keep the same rule identity and recompile the Contract', async () => {
  const { app, rule } = fixture('update-definition');
  const changedIntent = orderCompletedIntent();
  changedIntent.name = '订单完成后扣减客户额度';
  changedIntent.action.operation = 'decrement';
  const compiled = compileBusinessRule(app, '订单完成后扣减客户额度', changedIntent);
  const updated = updateCompiledRule(app.id, rule.id, '订单完成后扣减客户额度', compiled);
  assert.equal(updated.id, rule.id);
  assert.equal(updated.contractJson.steps.find((step) => step.type === 'update.field').operation, 'decrement');
  await import('../src/ai/tools/update-rule.js');
  const tool = getTool('update_rule');
  assert.equal(tool.risk, 'high');
  assert.deepEqual(tool.schema.function.parameters.required, ['ruleId', 'intent']);
});

test('application rule APIs expose list, detail, runs, and status management', async () => {
  const { app, order, rule } = fixture('http');
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await fetch(`${base}/api/apps/${app.id}/rules`).then((response) => response.json());
    assert.equal(list.rules[0].id, rule.id);
    const detail = await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}`).then((response) => response.json());
    assert.equal(detail.rule.name, '订单完成后累计客户消费');
    const manualIntent = orderCompletedIntent();
    manualIntent.name = '手动修改后的规则';
    manualIntent.action.operation = 'decrement';
    const manuallyUpdated = await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceText: '手动修改测试', businessIntentJson: manualIntent })
    }).then((response) => response.json());
    assert.equal(manuallyUpdated.rule.id, rule.id);
    assert.equal(manuallyUpdated.rule.contractJson.steps.find((step) => step.type === 'update.field').operation, 'decrement');
    manualIntent.name = '订单完成后累计客户消费';
    manualIntent.action.operation = 'increment';
    await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceText: '恢复测试规则', businessIntentJson: manualIntent })
    });
    const updated = await fetch(`${base}/api/apps/${app.id}/records/${order.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { status: 'completed' } })
    }).then((response) => response.json());
    assert.equal(updated.ruleResults[0].status, 'success');
    const runs = await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}/runs`).then((response) => response.json());
    assert.equal(runs.runs[0].status, 'success');
    const states = await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}/states`).then((response) => response.json());
    assert.deepEqual(states.states, []);
    const disabled = await fetch(`${base}/api/apps/${app.id}/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'disabled' })
    }).then((response) => response.json());
    assert.equal(disabled.rule.status, 'disabled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('runtime uses an application-settings entry with rules and execution-log tabs', () => {
  const appShell = readFileSync(join(process.cwd(), 'public/app.js'), 'utf8');
  const settings = readFileSync(join(process.cwd(), 'public/app-runtime/SettingsModal.js'), 'utf8');
  const recordModal = readFileSync(join(process.cwd(), 'public/app-runtime/RecordModal.js'), 'utf8');
  const ruleFeedback = readFileSync(join(process.cwd(), 'public/app-runtime/RuleFeedback.js'), 'utf8');
  const styles = readFileSync(join(process.cwd(), 'public/styles.css'), 'utf8');
  assert.match(appShell, /inRuntime[\s\S]*app-settings-button[\s\S]*应用设置/);
  assert.match(appShell, /system-settings-button[\s\S]*系统设置/);
  assert.match(settings, /tab\('rules',[\s\S]*业务规则/);
  assert.match(settings, /tab\('runs',[\s\S]*执行记录/);
  assert.match(settings, /\/rule-runs\?limit=100/);
  assert.match(settings, /让 AI 修改/);
  assert.match(settings, /手动修改业务规则/);
  assert.match(settings, /禁用规则/);
  assert.match(settings, /启用规则/);
  assert.match(settings, /status: nextStatus/);
  assert.match(settings, /businessIntentJson: nextIntent/);
  assert.match(recordModal, /rule\.status !== 'active'/);
  assert.match(recordModal, /trigger\?\.type !== 'record\.created'/);
  assert.match(recordModal, /createdRuleDependencyFieldIds/);
  assert.match(recordModal, /target\?\.relationField/);
  assert.match(recordModal, /action\?\.value\?\.type === 'trigger\.field'/);
  assert.match(ruleFeedback, /系统会自动完成相关业务处理/);
  assert.match(recordModal, /hasOwnProperty\.call\(options, 'ruleDependencyFieldIds'\)/);
  assert.match(recordModal, /class: 'rule-dependency-hint'/);
  assert.match(styles, /\.rule-dependency-hint[\s\S]*background: #fff3d6/);
  assert.doesNotMatch(recordModal, /请填写规则必需字段/);
  assert.match(settings, /所需信息填写完整后自动处理一次/);
  assert.match(settings, /处理范围/);
  assert.doesNotMatch(settings, /Schema Mapping/);
  assert.match(settings, /\/states\?limit=100/);
  assert.match(ruleFeedback, /beforeValue/);
  assert.match(ruleFeedback, /afterValue/);
  assert.match(ruleFeedback, /已完成/);
  assert.match(ruleFeedback, /formatRuleChanges/);
  assert.match(settings, /business-rule-change-detail/);
});
