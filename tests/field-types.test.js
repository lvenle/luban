import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFieldType, preparePackage } from '../src/core/packageProtocol.js';
import { numberInputValue, storedNumberValue } from '../public/app-runtime/NumberValues.js';

test('percent fields edit whole percentages while storing fractions', () => {
  const field = { type: 'number', format: 'percent' };
  assert.equal(numberInputValue(0.01, field), 1);
  assert.equal(numberInputValue(0.25, field), 25);
  assert.equal(storedNumberValue('1', field), 0.01);
  assert.equal(storedNumberValue('25', field), 0.25);
  assert.equal(storedNumberValue('', field), null);
});

test('url is a supported first-class field type', () => {
  assert.equal(normalizeFieldType('url'), 'url');
  assert.equal(normalizeFieldType('website'), 'url');
  const pkg = preparePackage({
    manifest: { id: 'links', name: '链接' },
    schema: { entities: [{ id: 'item', name: '项目', fields: [
      { id: 'name', label: '名称', type: 'text' },
      { id: 'site', label: '网址', type: 'url' }
    ] }] },
    ui: { pages: [{ id: 'items', title: '项目', type: 'list', entity: 'item' }] },
    actions: { actions: [] }
  });
  assert.equal(pkg.schema.entities[0].fields[1].type, 'url');
});

test('previously-created boolean fields are converted to yes-no selects', () => {
  const pkg = preparePackage({
    manifest: { name: '任务' },
    schema: { entities: [{ id: 'task', name: '任务', fields: [
      { id: 'name', label: '名称', type: 'text' },
      { id: 'done', label: '完成', type: 'boolean' }
    ] }] },
    ui: { pages: [{ id: 'tasks', title: '任务', type: 'table', entity: 'task' }] },
    actions: { actions: [] }
  });
  assert.equal(pkg.schema.entities[0].fields[1].type, 'select');
  assert.deepEqual(pkg.schema.entities[0].fields[1].options.map((option) => option.label), ['否', '是']);
});

test('new field UI and AI tools expose url but not boolean', () => {
  const fieldEditor = source('../public/app-runtime/FieldEditor.js');
  const cellEditor = source('../public/app-runtime/CellEditor.js');
  const addField = source('../src/ai/tools/add-field.js');
  const updateField = source('../src/ai/tools/update-field.js');
  assert.match(fieldEditor, /\['url', '链接'\]/);
  assert.doesNotMatch(fieldEditor, /\['boolean'\]/);
  assert.doesNotMatch(fieldEditor, /includeLegacyBoolean/);
  assert.match(cellEditor, /field\.type === 'url'/);
  assert.match(cellEditor, /class: 'cell-link url-link'/);
  assert.doesNotMatch(addField, /t !== 'boolean'/);
  assert.doesNotMatch(updateField, /t !== 'boolean'/);
});

function source(relativePath) { return readFileSync(new URL(relativePath, import.meta.url), 'utf8'); }
