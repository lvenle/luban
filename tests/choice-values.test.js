import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeChoiceInitialValue, relationChoicesFromValue, mergeChoiceOptions } from '../public/app-runtime/ChoiceValues.js';

test('single relation edit values unwrap hydrated relation arrays', () => {
  const hydrated = [{ targetRecordId: 'rec_category', displayValue: '手机' }];
  assert.deepEqual(normalizeChoiceInitialValue({ type: 'relation', multiple: false }, hydrated), hydrated[0]);
  assert.deepEqual(normalizeChoiceInitialValue({ type: 'relation', multiple: true }, hydrated), hydrated);
});

test('hydrated relation values provide immediate fallback labels in edit forms', () => {
  const choices = relationChoicesFromValue([{ targetRecordId: 'rec_category', displayValue: '手机' }]);
  assert.deepEqual(choices, [{ id: 'rec_category', label: '手机', color: 'gray' }]);
  assert.deepEqual(mergeChoiceOptions([], choices), choices);
});

test('record modal loads complete relation options after rendering fallback values', () => {
  const source = readFileSync(new URL('../public/app-runtime/RecordModal.js', import.meta.url), 'utf8');
  const sharedEditor = readFileSync(new URL('../public/app-runtime/CellEditor.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ inputForField, valueFromInput, renderFormFieldBlock/);
  assert.match(sharedEditor, /normalizeChoiceInitialValue\(field, initialValue\)/);
  assert.match(sharedEditor, /relationChoicesFromValue\(currentValue\)/);
  assert.match(sharedEditor, /relation-options/);
});
