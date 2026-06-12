import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, preparePackage } from '../src/packageProtocol.js';
import { createBudgetPackage } from '../src/samplePackages.js';
import { packageToZipPayload, zipPayloadToPackage } from '../src/zip.js';

test('validates and normalizes a software package', () => {
  const pkg = preparePackage(createBudgetPackage());
  assert.equal(pkg.manifest.name, '家庭记账本');
  assert.equal(pkg.schema.entities[0].id, 'transaction');
  assert.ok(pkg.ui.pages.some((page) => page.type === 'list'));
});

test('rejects unsupported field types', () => {
  const pkg = createBudgetPackage();
  pkg.schema.entities[0].fields[0].type = 'script';
  assert.throws(() => preparePackage(pkg), /类型不支持/);
});

test('applies patch and keeps package valid', () => {
  const pkg = preparePackage(createBudgetPackage());
  const next = applyPatch(pkg, {
    summary: '增加旅游预算字段',
    operations: [
      { op: 'addField', entity: 'transaction', field: { id: 'travel_budget', label: '是否计入旅游预算', type: 'boolean' } },
      { op: 'addSuggestedCommand', command: '查看旅游预算' }
    ]
  });
  assert.ok(next.schema.entities[0].fields.some((field) => field.id === 'travel_budget'));
  assert.ok(next.prompts.suggestedCommands.includes('查看旅游预算'));
});

test('exports and imports .sgpkg zip payload', () => {
  const pkg = preparePackage(createBudgetPackage());
  const zip = packageToZipPayload(pkg);
  const imported = preparePackage(zipPayloadToPackage(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)));
  assert.equal(imported.manifest.id, 'budget-book');
  assert.equal(imported.schema.entities[0].fields.length, pkg.schema.entities[0].fields.length);
});

test('normalizes JSON Schema style model output', () => {
  const pkg = preparePackage({
    manifest: { name: 'todo-tool', displayName: '智能待办事项管理器' },
    schema: {
      properties: {
        todoList: {
          type: 'array',
          description: '待办任务',
          items: {
            properties: {
              title: { type: 'string', description: '任务标题', required: true },
              priority: { type: 'enum', values: ['低', '中', '高'] }
            }
          }
        }
      }
    },
    ui: { layout: ['任务列表区'] },
    actions: [{ name: 'addTodo', description: '新增任务' }],
    prompts: ['增加今日任务页面']
  });
  assert.equal(pkg.manifest.name, '智能待办事项管理器');
  assert.equal(pkg.schema.entities[0].id, 'todo_list');
  assert.equal(pkg.schema.entities[0].fields[0].type, 'text');
  assert.equal(pkg.schema.entities[0].fields[1].type, 'select');
  assert.equal(pkg.ui.pages[0].type, 'list');
  assert.equal(pkg.actions.actions[0].type, 'data.queryRecords');
  assert.deepEqual(pkg.prompts.suggestedCommands, ['增加今日任务页面']);
});

test('normalizes generic model patch operations', () => {
  const pkg = preparePackage(createBudgetPackage());
  const next = applyPatch(pkg, {
    summary: '增加旅游预算',
    operations: [
      {
        op: 'add',
        type: 'field',
        entity: 'transaction',
        field: { name: 'travelBudget', displayName: '旅游预算', type: 'bool' }
      },
      {
        op: 'add',
        type: 'page',
        page: {
          name: 'travelBudgetPage',
          displayName: '旅游预算统计',
          type: 'statistics',
          entity: 'transaction',
          chart: { type: 'bar', groupBy: 'travel_budget', value: 'count' }
        }
      }
    ]
  });
  assert.ok(next.schema.entities[0].fields.some((field) => field.id === 'travel_budget' && field.type === 'boolean'));
  assert.ok(next.ui.pages.some((page) => page.id === 'travel-budget-page' && page.type === 'chart'));
});

test('normalizes JSON Patch style model operations', () => {
  const pkg = preparePackage(createBudgetPackage());
  const next = applyPatch(pkg, {
    summary: '增加提醒字段',
    operations: [
      {
        op: 'add',
        path: '/schema/entities/0/fields/-',
        value: { id: 'followRemindDate', label: '跟进提醒日期', type: 'date' }
      },
      { op: 'replace', path: '/manifest/version', value: '1.1.0' }
    ]
  });
  assert.ok(next.schema.entities[0].fields.some((field) => field.id === 'follow_remind_date' && field.type === 'date'));
});
