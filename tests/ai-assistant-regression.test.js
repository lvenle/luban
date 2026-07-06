import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createFieldsInApp } from '../src/services/operations.js';
import { createBudgetPackage } from '../src/templates/appTemplates.js';
import { buildToolDisplayInfo, mergeBatchableToolCalls } from '../src/routes/ai.js';
import { historyBusinessDetail } from '../public/ai-assistant/ToolDisplay.js';

const appShellJs = source('../public/app.js');
const assistantIndexJs = source('../public/ai-assistant/index.js');
const chatViewJs = source('../public/ai-assistant/ChatView.js');
const toolDisplayJs = source('../public/ai-assistant/ToolDisplay.js');
const assistantCss = source('../public/ai-assistant/style.css');
const appHomeJs = source('../public/app-home/index.js');
const runtimeIndexJs = source('../public/app-runtime/index.js');
const mainCss = source('../public/styles.css');
const addFieldToolJs = source('../src/ai/tools/add-field.js');
const createAppToolJs = source('../src/ai/tools/create-app.js');

test('AI tool log layout stays compact', () => {
  assert.match(assistantCss, /\.tool-card[\s\S]*padding: 2px 6px/);
  assert.match(assistantCss, /\.tool-card[\s\S]*line-height: 1\.2/);
  assert.match(assistantCss, /\.tool-confirm-card[\s\S]*padding: 8px 10px/);
});

test('add_field accepts and persists multiple fields in one update', () => {
  const dbPath = join(process.cwd(), 'data', 'test-batch-fields.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const nextApp = createFieldsInApp(app, 'transaction', [
    { label: '发票号', type: 'text' },
    { label: '已报销', type: 'boolean' }
  ]);
  const entity = nextApp.schema.entities.find((item) => item.id === 'transaction');
  assert.ok(entity.fields.some((field) => field.label === '发票号'));
  assert.ok(entity.fields.some((field) => field.label === '已报销'));
  assert.match(addFieldToolJs, /fields: \{ type: 'array'/);
});

test('parallel add_field calls for one table are merged before execution', () => {
  const calls = ['电话', '邮箱', '来源'].map((label, index) => ({
    id: `call_${index}`,
    function: { name: 'add_field', arguments: JSON.stringify({ entityId: 'customer', label, type: 'text' }) }
  }));
  const merged = mergeBatchableToolCalls(calls);
  assert.equal(merged.length, 1);
  assert.deepEqual(JSON.parse(merged[0].function.arguments).fields.map((field) => field.label), ['电话', '邮箱', '来源']);
});

test('different tools and different tables are never merged', () => {
  const calls = [
    { id: 'create', function: { name: 'create_app', arguments: JSON.stringify({ description: '客户系统' }) } },
    { id: 'customer-field', function: { name: 'add_field', arguments: JSON.stringify({ entityId: 'customer', label: '电话', type: 'phone' }) } },
    { id: 'order-field', function: { name: 'add_field', arguments: JSON.stringify({ entityId: 'order', label: '金额', type: 'number' }) } }
  ];
  const merged = mergeBatchableToolCalls(calls);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((call) => call.function.name), ['create_app', 'add_field', 'add_field']);
});

test('tool display info contains app, table, and field business names', () => {
  const app = {
    name: '客户管理',
    schema: { entities: [{ id: 'customer', name: '客户', fields: [{ id: 'phone', label: '电话', type: 'phone' }] }] }
  };
  const display = buildToolDisplayInfo('add_field', {
    entityId: 'customer',
    fields: [{ label: '邮箱', type: 'email' }, { label: '来源', type: 'select' }]
  }, app);
  assert.equal(display.title, '添加字段');
  assert.equal(display.detail, '客户管理 · 客户 · 邮箱、来源');
});

test('completed app creation refreshes the home list with the created app id', () => {
  assert.match(assistantIndexJs, /if \(data\.appId\) \{\s*if \(currentMode === 'create'\) \{[\s\S]*chatView\.setMode\(currentMode\)/);
  assert.match(assistantIndexJs, /detail: \{ appId: data\.appId \|\| currentAppId \}/);
  assert.match(appShellJs, /if \(!state\.currentApp\) \{\s*await loadApps\(\)/);
});

test('assistant modes expose their requested preset prompts', () => {
  for (const label of ['创建任务管理', '创建项目管理', '创建客户管理', '创建收支记录']) {
    assert.match(chatViewJs, new RegExp(label));
  }
  for (const label of ['新增字段', '新增页面', '新增数据分析', '添加10行样例数据']) {
    assert.match(chatViewJs, new RegExp(label));
  }
  assert.match(chatViewJs, /const presets = this\.mode === 'create' \? CREATE_PRESETS : MODIFY_PRESETS/);
  assert.match(assistantCss, /\.assistant-quick\[hidden\][\s\S]*display: none/);
});

test('assistant is docked without a backdrop and resizes the main page', () => {
  assert.doesNotMatch(assistantIndexJs, /document\.body\.append\(backdrop, drawer\)/);
  assert.match(assistantIndexJs, /document\.body\.classList\.add\('assistant-open'\)/);
  assert.match(mainCss, /body\.assistant-open #app[\s\S]*margin-right: clamp\(340px, 34vw, 420px\)/);
  assert.match(mainCss, /@media \(max-width: 760px\)[\s\S]*height: 52vh/);
});

test('assistant header keeps its close action aligned and history controls constrained', () => {
  assert.match(assistantIndexJs, /class: 'assistant-head-copy'[\s\S]*class: 'assistant-close'/);
  assert.match(assistantIndexJs, /'aria-label': '关闭 AI 助理'/);
  assert.match(mainCss, /\.assistant-head \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(mainCss, /\.assistant-head-actions \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(assistantCss, /\.assistant-close \{[\s\S]*width: 30px;[\s\S]*height: 30px/);
});

test('assistant mode follows home and app-detail navigation', () => {
  assert.match(appHomeJs, /setAssistantMode\(\{ mode: 'create' \}\)/);
  assert.match(runtimeIndexJs, /setAssistantMode\(\{ mode: 'modify', appId: app\.id, appName: app\.name/);
  assert.doesNotMatch(appHomeJs, /state\.assistantOpen = false;\s*window\.history\.pushState/);
  assert.match(assistantIndexJs, /软件修改助理/);
  assert.match(assistantIndexJs, /应用创建助理/);
});

test('completed tool cards remain visible and are restored from session logs', () => {
  assert.match(assistantIndexJs, /body\.session\.logs/);
  assert.match(assistantIndexJs, /toolDisplay\.showHistoryLog\(entry\.item\)/);
  assert.match(assistantIndexJs, /card && !card\.isConnected/);
  assert.match(toolDisplayJs, /showHistoryLog\(log\)/);
  assert.match(toolDisplayJs, /log\.status === 'running'/);
  assert.match(toolDisplayJs, /tool-history/);
  assert.match(toolDisplayJs, /return input\.label \|\| input\.title \|\| input\.name \|\| output\.name/);
  assert.match(assistantIndexJs, /sessionHistoryEntries\(body\.session\.messages \|\| \[\], body\.session\.logs \|\| \[\]\)/);
  assert.match(assistantIndexJs, /history\.push\(\{ kind: 'message', item: message \}\);[\s\S]*history\.push\(\{ kind: 'tool'/);
  assert.match(assistantIndexJs, /export function completedToolLogs\(logs\)/);
  assert.match(assistantIndexJs, /const input = hasOwnInput \? log\.input : \(queue\.shift\(\) \|\| null\)/);
});

test('failed tool cards show detailed live and historical errors', () => {
  assert.match(toolDisplayJs, /if \(data\.status === 'error'\) appendToolError\(existing\.card, data\.output\)/);
  assert.match(toolDisplayJs, /appendToolError\(card, log\.error \|\| log\.output\)/);
  assert.match(toolDisplayJs, /class: 'tool-card-error-detail'/);
  assert.match(assistantCss, /\.tool-card-error-detail[\s\S]*overflow-wrap: anywhere/);
});

test('historical failed tool logs tolerate null input and output', () => {
  assert.doesNotThrow(() => historyBusinessDetail({
    toolName: 'create_app',
    status: 'failed',
    input: null,
    output: null
  }));
  assert.equal(historyBusinessDetail({
    toolName: 'create_app',
    status: 'failed',
    input: null,
    output: null
  }), '');
  assert.equal(historyBusinessDetail({
    toolName: 'query_data',
    status: 'failed',
    input: null,
    output: null
  }), '查询到 0 条');
});

test('create_app tool cards disclose all fields created inside the operation', () => {
  assert.match(createAppToolJs, /entities: app\.schema\.entities\.map/);
  assert.match(createAppToolJs, /fields: entity\.fields\.map/);
  assert.match(toolDisplayJs, /appendOperationDetails\(/);
  assert.match(toolDisplayJs, /text: '新建字段'/);
  assert.match(toolDisplayJs, /fieldNames\.join\('、'\)/);
  assert.match(assistantCss, /\.tool-card-operation-list/);
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
