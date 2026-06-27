import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reorderIds, reorderItemsById, orderSelectedOptions, optionDisplayValue, frozenColumnMeta } from '../public/app-runtime/Ordering.js';

test('dragging table columns reorders fields without mutating the source order', () => {
  const original = ['name', 'status', 'owner', 'date'];
  assert.deepEqual(reorderIds(original, 'date', 'status', 'before'), ['name', 'date', 'status', 'owner']);
  assert.deepEqual(reorderIds(original, 'name', 'owner', 'after'), ['status', 'owner', 'name', 'date']);
  assert.deepEqual(original, ['name', 'status', 'owner', 'date']);
});

test('dragging horizontal view tabs persists their new item order', () => {
  const views = [{ id: 'all' }, { id: 'mine' }, { id: 'archived' }];
  assert.deepEqual(reorderItemsById(views, 'archived', 'all', 'before').map((view) => view.id), ['archived', 'all', 'mine']);
  assert.deepEqual(views.map((view) => view.id), ['all', 'mine', 'archived']);
});

test('quadrants follow the current select option order', () => {
  const options = [{ id: 'three' }, { id: 'one' }, { id: 'four' }, { id: 'two' }, { id: 'unused' }];
  const ordered = orderSelectedOptions(options, ['one', 'two', 'three', 'four']);
  assert.deepEqual(ordered.map((option) => option.id), ['three', 'one', 'four', 'two']);
});

test('quadrants group records by option display value', () => {
  const options = [
    { id: 'urgent', label: '重要且紧急' },
    { id: 'planned', label: '重要不紧急' }
  ];
  assert.equal(optionDisplayValue(options, '重要且紧急'), '重要且紧急');
  assert.equal(optionDisplayValue(options, 'urgent'), '重要且紧急');
  assert.equal(optionDisplayValue(options, { optionId: 'planned' }), '重要不紧急');
  assert.equal(optionDisplayValue(options, { label: '重要且紧急' }), '重要且紧急');
});

test('freezing through a column calculates sticky offsets and the freeze boundary', () => {
  const fields = [{ id: 'name' }, { id: 'status' }, { id: 'owner' }];
  const widths = { name: 180, status: 120, owner: 200 };
  assert.deepEqual(frozenColumnMeta(fields, widths, 'status', 0), { frozen: true, boundary: false, left: 106 });
  assert.deepEqual(frozenColumnMeta(fields, widths, 'status', 1), { frozen: true, boundary: true, left: 286 });
  assert.deepEqual(frozenColumnMeta(fields, widths, 'status', 2), { frozen: false, boundary: false, left: 0 });
});

test('column drag and freeze interactions are wired to the table header and view config', () => {
  const header = readFileSync(new URL('../public/app-runtime/TableHeader.js', import.meta.url), 'utf8');
  const viewBar = readFileSync(new URL('../public/app-runtime/ViewBar.js', import.meta.url), 'utf8');
  const dataTable = readFileSync(new URL('../public/app-runtime/DataTable.js', import.meta.url), 'utf8');
  const cellSelection = readFileSync(new URL('../public/app-runtime/CellSelection.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(header, /draggable: 'true'/);
  assert.match(header, /冻结到此列/);
  assert.match(header, /frozenFieldId/);
  assert.match(viewBar, /bindViewTabDrag/);
  assert.match(viewBar, /setViews\(entity, reordered\)/);
  assert.match(dataTable, /frozen-quick-add-button/);
  assert.match(styles, /\.editable-cell\.frozen-column\.cell-editing/);
  assert.match(styles, /\.frozen-quick-add-button[\s\S]*position: sticky/);
  assert.match(header, /selectColumnHeader\(header\)/);
  assert.match(header, /createColumnDragGhost/);
  assert.match(header, /column-dragging-cell/);
  assert.match(styles, /\.column-drag-ghost/);
  assert.match(styles, /th:has\(\+ th\.selected-column-header\)/);
  assert.match(styles, /td:has\(\+ td\.selected-column-cell\)/);
  assert.match(styles, /th\.selected-column-header[\s\S]*border-top: 1px solid (var\(--brand\)|#2563eb);[\s\S]*border-left: 1px solid (var\(--brand\)|#2563eb);[\s\S]*border-right: 1px solid (var\(--brand\)|#2563eb);[\s\S]*box-shadow: none;/);
  assert.match(styles, /selected-column-cell\.selected-cell[\s\S]*border-top: 0;[\s\S]*border-left: 1px solid (var\(--brand\)|#2563eb);[\s\S]*border-right: 1px solid (var\(--brand\)|#2563eb);[\s\S]*border-bottom: 1px solid var\(--line\);[\s\S]*box-shadow: none !important;/);
  assert.match(styles, /selected-column-cell\.selected-cell\.selection-bottom[\s\S]*border-bottom: 1px solid (var\(--brand\)|#2563eb);/);
  assert.match(cellSelection, /const cells = \[\.\.\.table\.querySelectorAll\(`\.editable-cell\[data-field-id=/);
  assert.match(cellSelection, /cells\.forEach\(\(cell\) => cell\.classList\.add\('selected-column-cell'\)\)/);
  assert.doesNotMatch(cellSelection, /querySelectorAll\(`\[data-field-id=/);
});
