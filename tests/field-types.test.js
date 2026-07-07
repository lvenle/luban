import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFieldType, preparePackage } from '../src/core/packageProtocol.js';
import { numberInputValue, storedNumberValue } from '../public/app-runtime/NumberValues.js';
import { formatFieldValue } from '../public/common/field-format.js';

test('percent fields edit whole percentages while storing fractions', () => {
  const field = { type: 'number', format: 'percent' };
  assert.equal(numberInputValue(0.01, field), 1);
  assert.equal(numberInputValue(0.25, field), 25);
  assert.equal(storedNumberValue('1', field), 0.01);
  assert.equal(storedNumberValue('25', field), 0.25);
  assert.equal(storedNumberValue('', field), null);
  assert.equal(formatFieldValue(0.25, field), '25%');
  assert.equal(formatFieldValue(0.255, field), '26%');
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

test('auto number is normalized with safe defaults and keeps custom settings', () => {
  assert.equal(normalizeFieldType('auto_number'), 'autoNumber');
  const pkg = preparePackage({
    manifest: { id: 'serials', name: '序号' },
    schema: { entities: [{ id: 'item', name: '项目', fields: [
      { id: 'serial', label: '序号', type: 'autoNumber' },
      { id: 'custom', label: '自定义编号', type: 'autoNumber', autoNumber: { start: 100, step: 10, prefix: 'NO-' } }
    ] }] },
    ui: { pages: [{ id: 'items', title: '项目', type: 'table', entity: 'item' }] },
    actions: { actions: [] }
  });
  assert.deepEqual(pkg.schema.entities[0].fields[0].autoNumber, { start: 1, step: 1, prefix: '' });
  assert.deepEqual(pkg.schema.entities[0].fields[1].autoNumber, { start: 100, step: 10, prefix: 'NO-' });
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
  assert.match(fieldEditor, /\['autoNumber', '自增序号'\]/);
  assert.match(fieldEditor, /autoNumberStart/);
  assert.doesNotMatch(fieldEditor, /\['boolean'\]/);
  assert.doesNotMatch(fieldEditor, /includeLegacyBoolean/);
  assert.match(cellEditor, /field\.type === 'url'/);
  assert.match(cellEditor, /class: 'cell-link url-link'/);
  assert.match(cellEditor, /自增序号由系统自动生成/);
  assert.doesNotMatch(addField, /t !== 'boolean'/);
  assert.doesNotMatch(updateField, /t !== 'boolean'/);
});

function source(relativePath) { return readFileSync(new URL(relativePath, import.meta.url), 'utf8'); }
