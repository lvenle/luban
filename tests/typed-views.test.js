import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { preparePackage } from '../src/core/packageProtocol.js';
import { getPackageFromApp, resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage, getApp } from '../src/models/app.js';
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

test('grid, quadrant, gantt, and calendar view definitions are normalized and validated', () => {
  const clean = preparePackage(viewPackage([
    { id: 'grid', name: '网格', type: 'grid', grid: { columns: 3, imageField: 'cover', titleField: 'name', displayFields: ['priority', 'start'] } },
    { id: 'quadrant', name: '四象限', type: 'quadrant', quadrant: { fieldId: 'priority', optionIds: ['a', 'b', 'c', 'd'] } },
    { id: 'gantt', name: '排期', type: 'gantt', gantt: { titleField: 'name', startField: 'start', endField: 'end', progressField: 'progress' } },
    { id: 'calendar', name: '日历', type: 'calendar', calendar: { titleField: 'name', dateField: 'start', endField: 'end' } }
  ]));
  assert.deepEqual(clean.ui.pages[0].views.map((view) => view.type), ['grid', 'quadrant', 'gantt', 'calendar']);
  assert.equal(clean.ui.pages[0].views[0].grid.columns, 3);
  assert.deepEqual(clean.ui.pages[0].views[0].grid.displayFields, ['priority', 'start']);
  assert.equal(clean.ui.pages[0].views[2].gantt.progressField, 'progress');
  assert.equal(clean.ui.pages[0].views[3].calendar.dateField, 'start');
  const legacy = preparePackage(viewPackage([{ id: 'legacy-gantt', name: '旧排期', type: 'gantt', titleField: 'name', startField: 'start', endField: 'end', progressField: 'progress' }]));
  assert.equal(legacy.ui.pages[0].views[0].gantt.progressField, 'progress');
  assert.equal('progressField' in legacy.ui.pages[0].views[0], false);
  const legacyCalendar = preparePackage(viewPackage([{ id: 'legacy-calendar', name: '旧日历', type: 'calendar', titleField: 'name', dateField: 'start' }]));
  assert.equal(legacyCalendar.ui.pages[0].views[0].calendar.dateField, 'start');
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad-grid', name: '坏网格', type: 'grid', grid: { titleField: 'name', imageField: 'name', displayFields: ['priority'] } }])), /网格视图/);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad', name: '坏象限', type: 'quadrant', quadrant: { fieldId: 'priority', optionIds: ['a'] } }])), /四象限视图/);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad-gantt', name: '坏甘特', type: 'gantt', gantt: { titleField: 'name', startField: 'name', endField: 'end' } }])), /甘特视图/);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad-progress', name: '坏进度', type: 'gantt', gantt: { titleField: 'name', startField: 'start', endField: 'end', progressField: 'name' } }])), /进度字段必须是数值字段/);
  assert.throws(() => preparePackage(viewPackage([{ id: 'bad-calendar', name: '坏日历', type: 'calendar', calendar: { titleField: 'name', dateField: 'priority' } }])), /日历视图/);
});

test('add_view creates a persisted typed view without merging other tools', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-add-view.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(viewPackage([{ id: 'default', name: '全部记录', type: 'list' }]));
  const result = await getTool('add_view').handler({
    appId: app.id, entityId: 'task', pageId: 'task-list', name: '任务排期', type: 'gantt',
    titleField: 'name', startField: 'start', endField: 'end', progressField: 'progress'
  });
  assert.equal(result.type, 'gantt');
  const saved = getPackageFromApp(getApp(result.appId));
  assert.equal(saved.ui.pages[0].views.at(-1).gantt.progressField, 'progress');
  const calendar = await getTool('add_view').handler({
    appId: app.id, entityId: 'task', pageId: 'task-list', name: '任务日历', type: 'calendar',
    titleField: 'name', dateField: 'start', endField: 'end'
  });
  assert.equal(calendar.type, 'calendar');
  const grid = await getTool('add_view').handler({
    appId: app.id, entityId: 'task', pageId: 'task-list', name: '任务网格', type: 'grid',
    titleField: 'name', imageField: 'cover', displayFields: ['priority', 'start'], columns: 3
  });
  assert.equal(grid.type, 'grid');
  assert.equal(getPackageFromApp(getApp(result.appId)).ui.pages[0].views.at(-1).grid.columns, 3);
  await assert.rejects(() => getTool('add_view').handler({
    appId: app.id, entityId: 'task', pageId: 'task-list', name: '错误排期', type: 'gantt',
    titleField: 'name', startField: 'start', endField: 'end', progressField: 'name'
  }), /进度字段必须是数值字段/);
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
  assert.match(viewBarSource, /\['grid', '网格视图'\]/);
  assert.match(viewBarSource, /\['quadrant', '四象限视图'\]/);
  assert.match(viewBarSource, /\['gantt', '甘特视图'\]/);
  assert.match(viewBarSource, /\['calendar', '日历视图'\]/);
  assert.match(viewBarSource, /进度字段（可选）/);
  assert.match(viewBarSource, /patch\.calendar = \{ titleField, dateField, endField \}/);
  assert.match(viewBarSource, /patch\.gantt = \{ titleField, startField, endField, progressField \}/);
  assert.match(dataTableSource, /renderTypedTableView/);
  assert.match(typedViewsSource, /export function renderQuadrantView/);
  assert.match(typedViewsSource, /export function renderGridView/);
  assert.match(typedViewsSource, /export function renderGanttView/);
  assert.match(typedViewsSource, /export function renderCalendarView/);
  assert.match(typedViewsSource, /openCalendarConfigModal/);
  assert.match(typedViewsSource, /export function ganttProgressPercent/);
  assert.match(typedViewsSource, /days <= 45/);
  assert.match(typedViewsSource, /days <= 270/);
  assert.match(cssSource, /\.gantt-bar-title/);
  assert.match(cssSource, /\.gantt-bar-fill/);
  assert.match(cssSource, /\.quadrant-grid/);
  assert.match(cssSource, /\.record-card-grid/);
  assert.match(cssSource, /\.record-grid-image/);
  assert.match(cssSource, /\.quadrant-cell:nth-child\(1\) \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(cssSource, /\.quadrant-cell:nth-child\(2\) \{ grid-column: 1; grid-row: 1; \}/);
  assert.match(cssSource, /\.quadrant-cell:nth-child\(3\) \{ grid-column: 1; grid-row: 2; \}/);
  assert.match(cssSource, /\.quadrant-cell:nth-child\(4\) \{ grid-column: 2; grid-row: 2; \}/);
  assert.match(cssSource, /\.gantt-scroll/);
  assert.match(cssSource, /\.calendar-grid/);
  assert.match(cssSource, /\.calendar-event/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.quadrant-grid[\s\S]*grid-template-columns: 1fr/);
});

test('formula fields have configuration controls and remain read only', () => {
  assert.match(fieldEditorSource, /\['formula', '公式'\]/);
  assert.match(fieldEditorSource, /formulaExpression/);
  assert.match(fieldEditorSource, /formulaResultType/);
  assert.match(fieldEditorSource, /export async function updateField[\s\S]*?await loadCurrentPageRecords\(\);[\s\S]*?renderRuntime\(\);/);
  assert.match(fieldEditorSource, /export async function createField[\s\S]*?await loadCurrentPageRecords\(\);[\s\S]*?renderRuntime\(\);/);
  assert.match(source('../public/app-runtime/CellEditor.js'), /公式字段由系统实时计算，不能直接编辑/);
  assert.match(source('../public/app-runtime/CellEditor.js'), /公式字段由系统实时计算/);
});

function viewPackage(views) {
  return {
    manifest: { id: 'views-test', name: '视图测试' },
    schema: { entities: [{ id: 'task', name: '任务', fields: [
      { id: 'name', label: '名称', type: 'text' },
      { id: 'cover', label: '封面', type: 'image' },
      { id: 'priority', label: '优先级', type: 'select', options: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase(), color: 'blue' })) },
      { id: 'start', label: '开始', type: 'date' },
      { id: 'end', label: '结束', type: 'date' },
      { id: 'progress', label: '进度', type: 'number', format: 'percent' }
    ] }] },
    ui: { pages: [{ id: 'task-list', title: '任务列表', type: 'list', entity: 'task', views }] },
    actions: { actions: [] }, prompts: { suggestedCommands: [] }
  };
}

test('dashboard page type dispatches to renderDashboardPage as independent entry', () => {
  const pt = source('../public/app-runtime/PageTypes.js');
  assert.match(pt, /if \(page\.type === 'dashboard'\) return renderDashboardPage\(page\);/);
  assert.match(pt, /export function renderDashboardPage\(page\)/);
});

function source(relativePath) { return readFileSync(new URL(relativePath, import.meta.url), 'utf8'); }
