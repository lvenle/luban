import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { preparePackage } from '../src/core/packageProtocol.js';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { getTool } from '../src/ai/registry.js';
import { mergeBatchableToolCalls } from '../src/routes/ai.js';

await import('../src/ai/tools/add-view.js');

const viewBarSource = source('../public/app-runtime/ViewBar.js');
const typedViewsSource = source('../public/app-runtime/TypedViews.js');
const dataTableSource = source('../public/app-runtime/DataTable.js');
const fieldEditorSource = source('../public/app-runtime/FieldEditor.js');
const cssSource = source('../public/styles.css');

test('missing table view type normalizes to the default list view', () => {
  const pkg = viewPackage([{ id: 'default', name: '全部记录' }]);
  const clean = preparePackage(pkg);
  assert.equal(clean.ui.pages[0].views[0].type, 'list');
});

test('quadrant and gantt view definitions are normalized and validated', () => {
  const clean = preparePackage(viewPackage([
    { id: 'quadrant', name: '四象限', type: 'quadrant', quadrant: { fieldId: 'priority', optionIds: ['a', 'b', 'c', 'd'] } },
    { id: 'gantt', name: '排期', type: 'gantt', gantt: { titleField: 'name', startField: 'start', endField: 'end' } }
  ]));
  assert.deepEqual(clean.ui.pages[0].views.map((view) => view.type), ['quadrant', 'gantt']);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad', name: '坏象限', type: 'quadrant', quadrant: { fieldId: 'priority', optionIds: ['a'] } }])), /四象限视图/);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad-gantt', name: '坏甘特', type: 'gantt', gantt: { titleField: 'name', startField: 'name', endField: 'end' } }])), /甘特视图/);
});

test('add_view creates a persisted typed view without merging other tools', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-add-view.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(viewPackage([{ id: 'default', name: '全部记录', type: 'list' }]));
  const result = await getTool('add_view').handler({
    appId: app.id, entityId: 'task', pageId: 'task-list', name: '任务排期', type: 'gantt',
    titleField: 'name', startField: 'start', endField: 'end'
  });
  assert.equal(result.type, 'gantt');
  const calls = [
    { id: 'field', function: { name: 'add_field', arguments: JSON.stringify({ entityId: 'task', label: '成本', type: 'number' }) } },
    { id: 'view', function: { name: 'add_view', arguments: JSON.stringify({ entityId: 'task', name: '排期', type: 'gantt' }) } },
    { id: 'page', function: { name: 'add_page', arguments: JSON.stringify({ entityId: 'task', title: '页面', type: 'list' }) } }
  ];
  assert.deepEqual(mergeBatchableToolCalls(calls).map((call) => call.function.name), ['add_field', 'add_view', 'add_page']);
});

test('typed view UI persists package views and exposes both renderers', () => {
  assert.match(viewBarSource, /page\.views = normalized/);
  assert.match(viewBarSource, /localStorage\.removeItem\(legacyKey\)/);
  assert.match(viewBarSource, /\['list', '表格视图'\]/);
  assert.match(viewBarSource, /\['quadrant', '四象限视图'\]/);
  assert.match(viewBarSource, /\['gantt', '甘特视图'\]/);
  assert.match(dataTableSource, /renderTypedTableView/);
  assert.match(typedViewsSource, /export function renderQuadrantView/);
  assert.match(typedViewsSource, /export function renderGanttView/);
  assert.match(typedViewsSource, /days <= 45/);
  assert.match(typedViewsSource, /days <= 270/);
  assert.match(cssSource, /\.quadrant-grid/);
  assert.match(cssSource, /\.gantt-scroll/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.quadrant-grid[\s\S]*grid-template-columns: 1fr/);
});

test('formula fields have configuration controls and remain read only', () => {
  assert.match(fieldEditorSource, /\['formula', '公式'\]/);
  assert.match(fieldEditorSource, /formulaExpression/);
  assert.match(fieldEditorSource, /formulaResultType/);
  assert.match(fieldEditorSource, /export async function updateField[\s\S]*?await loadCurrentPageRecords\(\);[\s\S]*?renderRuntime\(\);/);
  assert.match(fieldEditorSource, /export async function createField[\s\S]*?await loadCurrentPageRecords\(\);[\s\S]*?renderRuntime\(\);/);
  assert.match(source('../public/app-runtime/CellEditor.js'), /公式字段由系统实时计算，不能直接编辑/);
  assert.match(source('../public/app-runtime/RecordModal.js'), /公式字段由系统实时计算/);
});

function viewPackage(views) {
  return {
    manifest: { id: 'views-test', name: '视图测试' },
    schema: { entities: [{ id: 'task', name: '任务', fields: [
      { id: 'name', label: '名称', type: 'text' },
      { id: 'priority', label: '优先级', type: 'select', options: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase(), color: 'blue' })) },
      { id: 'start', label: '开始', type: 'date' },
      { id: 'end', label: '结束', type: 'date' }
    ] }] },
    ui: { pages: [{ id: 'task-list', title: '任务列表', type: 'list', entity: 'task', views }] },
    actions: { actions: [] }, prompts: { suggestedCommands: [] }
  };
}

function source(relativePath) { return readFileSync(new URL(relativePath, import.meta.url), 'utf8'); }
