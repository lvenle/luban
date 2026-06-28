import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, preparePackage } from '../src/core/packageProtocol.js';
import { generatePlanFromPrompt, planToPackage } from '../src/ai/service.js';
import { createBudgetPackage } from '../src/ai/samplePackages.js';
import { packageToZipPayload, zipPayloadToPackage } from '../src/utils/zip.js';
import { PAGE_TYPES } from '../src/core/contract.js';

test('validates and normalizes a software package', () => {
  const pkg = preparePackage(createBudgetPackage());
  assert.equal(pkg.manifest.name, '家庭记账本');
  assert.equal(pkg.schema.entities[0].id, 'transaction');
  assert.ok(pkg.ui.pages.some((page) => page.type === 'table'));
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

test('rejects duplicate page ids', () => {
  const pkg = createBudgetPackage();
  pkg.ui.pages.push({ ...pkg.ui.pages[0] });
  assert.throws(() => preparePackage(pkg), /页面 ID 重复/);
});

test('allows blank pages without bound table', () => {
  const pkg = createBudgetPackage();
  pkg.ui.pages.push({ id: 'blank-board', title: '空白页面', type: 'blank', navKind: 'page', cards: [] });
  const clean = preparePackage(pkg);
  const blank = clean.ui.pages.find((page) => page.id === 'blank-board');
  assert.equal(blank.type, 'page');
  assert.equal(blank.entity, undefined);
});

test('converts multiple views for one table into unique pages', () => {
  const pkg = planToPackage({
    type: 'app_creation_plan',
    appName: '客户工具',
    tables: [
      {
        tempId: 'customer',
        name: '客户',
        fields: [{ tempId: 'name', name: '名称', type: 'text' }]
      }
    ],
    relations: [],
    views: [
      { tableTempId: 'customer', name: '客户列表', type: 'grid' },
      { tableTempId: 'customer', name: '重点客户列表', type: 'grid' }
    ]
  });
  assert.equal(pkg.ui.pages.length, 2);
  assert.equal(new Set(pkg.ui.pages.map((page) => page.id)).size, 2);
  assert.ok(pkg.ui.pages.every((page) => page.entity === 'customer'));
});

test('mock AI modification can add a page for an existing table', async () => {
  const pkg = preparePackage(createBudgetPackage());
  const plan = await generatePlanFromPrompt('给交易表新增一个旅游统计页面', {}, pkg);
  assert.equal(plan.type, 'app_modification_plan');
  assert.ok(plan.operations.some((operation) => operation.op === 'addPage' && operation.page?.entity === 'transaction'));
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
  assert.equal(pkg.ui.pages[0].type, 'table');
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
  assert.ok(next.schema.entities[0].fields.some((field) => field.id === 'travel_budget' && field.type === 'select'));
  assert.ok(next.ui.pages.some((page) => page.id === 'travel-budget-page' && page.type === 'page' && page.chart));
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

test('normalizes colored options and relation fields', () => {
  const pkg = preparePackage({
    manifest: { name: '商品管理系统' },
    schema: {
      entities: [
        {
          id: 'product',
          name: '商品',
          fields: [
            { id: 'name', label: '名称', type: 'text' },
            { id: 'status', label: '状态', type: 'select', options: ['在售', { label: '停售', color: 'gray' }] },
            { id: 'category', label: '分类', type: 'relation', targetEntity: 'category', displayField: 'name' }
          ]
        },
        { id: 'category', name: '分类', fields: [{ id: 'name', label: '分类名称', type: 'text' }] }
      ]
    },
    ui: { pages: [{ id: 'product-list', title: '商品列表', type: 'list', entity: 'product' }] },
    actions: { actions: [] }
  });
  const status = pkg.schema.entities[0].fields.find((field) => field.id === 'status');
  assert.deepEqual(Object.keys(status.options[0]), ['id', 'label', 'color']);
  assert.equal(status.options[0].label, '在售');
  const relation = pkg.schema.entities[0].fields.find((field) => field.id === 'category');
  assert.equal(relation.type, 'relation');
  assert.equal(relation.targetEntity, 'category');
  assert.equal(relation.displayField, 'name');
});

test('rejects invalid relation target', () => {
  assert.throws(() => preparePackage({
    manifest: { name: '坏关系' },
    schema: {
      entities: [
        {
          id: 'product',
          name: '商品',
          fields: [
            { id: 'name', label: '名称', type: 'text' },
            { id: 'category', label: '分类', type: 'relation', targetEntity: 'missing', displayField: 'name' }
          ]
        }
      ]
    },
    ui: { pages: [{ id: 'product-list', title: '商品列表', type: 'list', entity: 'product' }] },
    actions: { actions: [] }
  }), /关联字段/);
});

test('dashboard is a valid PAGE_TYPES entry', () => {
  assert.ok(PAGE_TYPES.has('dashboard'));
  assert.ok(!PAGE_TYPES.has('list'));
  assert.ok(!PAGE_TYPES.has('blank'));
});

test('normalizePageType returns dashboard for dashboard input', async () => {
  const { preparePackage } = await import('../src/core/packageProtocol.js');
  const pkg = preparePackage(createBudgetPackage());
  pkg.ui.pages.push({ id: 'my-dashboard', title: '经营看板', type: 'dashboard', cards: [{ type: 'stat', title: '总支出', entity: 'transaction', operation: 'sum', field: 'amount' }] });
  const clean = preparePackage(pkg);
  const dash = clean.ui.pages.find((p) => p.id === 'my-dashboard');
  assert.equal(dash.type, 'dashboard');
  assert.equal(dash.entity, undefined);
  assert.ok(Array.isArray(dash.cards));
});

test('dashboard-only (no data table) package is rejected by validation', async () => {
  const { preparePackage } = await import('../src/core/packageProtocol.js');
  assert.throws(() => preparePackage({
    manifest: { name: 'Just Dashboard' },
    schema: { entities: [{ id: 'placeholder', name: '占位', fields: [{ id: 'name', label: '名称', type: 'text' }] }] },
    ui: { pages: [{ id: 'dash', title: '看板', type: 'dashboard', cards: [] }] },
    actions: { actions: [] },
    prompts: {}
  }), /至少需要一个数据页面/);
});
