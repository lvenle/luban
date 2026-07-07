import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateInputValue, dateInputLocale, formatDateFieldValue } from '../public/app-runtime/DateFormat.js';
import { setClientRuntimeSettings } from '../public/common/runtime-settings-store.js';

test('all date displays use hyphen separators', () => {
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date' }), '2026-06-21');
  assert.equal(formatDateFieldValue('2026/06/21', { type: 'date' }), '2026-06-21');
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date', format: 'yyyy-mm-dd' }), '2026-06-21');
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date', format: 'mm-dd' }), '2026-06-21');
});

test('datetime display never exposes the storage T separator', () => {
  assert.equal(formatDateFieldValue('2026-06-21T09:30', { type: 'datetime' }), '2026-06-21 09:30');
  assert.equal(formatDateFieldValue('2026/06/21 09:30', { type: 'datetime' }), '2026-06-21 09:30');
  assert.equal(formatDateFieldValue('2026-06-21T09:30', { type: 'datetime', format: 'yyyy-mm-dd hh:mm' }), '2026-06-21 09:30');
});

test('date displays follow runtime settings', () => {
  setClientRuntimeSettings({ dateFormat: 'yyyy年m月d日', dateTimeFormat: 'yyyy/mm/dd hh:mm' });
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date' }), '2026年6月21日');
  assert.equal(formatDateFieldValue('2026-06-21T09:30', { type: 'datetime' }), '2026/06/21 09:30');
  setClientRuntimeSettings();
});

test('date editor values are normalized for native controls', () => {
  assert.equal(dateInputValue('2026/06/21', 'date'), '2026-06-21');
  assert.equal(dateInputValue('2026/06/21 09:30', 'datetime'), '2026-06-21T09:30');
  assert.equal(dateInputLocale('date'), 'en-CA');
  assert.equal(dateInputLocale('datetime'), 'en-CA');
});

test('table and record modal bind the same date-time picker behavior', () => {
  const tableEditor = readFileSync(new URL('../public/app-runtime/CellEditor.js', import.meta.url), 'utf8');
  const recordModal = readFileSync(new URL('../public/app-runtime/RecordModal.js', import.meta.url), 'utf8');
  assert.match(tableEditor, /bindDateTimePicker\(input\)/);
  assert.match(recordModal, /import \{ inputForField, valueFromInput, renderFormFieldBlock/);
});
