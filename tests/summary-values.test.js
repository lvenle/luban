import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSummary, summaryMode, summaryOptions } from '../public/app-runtime/SummaryValues.js';

const records = [
  { data: { amount: 10, title: '甲' } },
  { data: { amount: 20, title: '' } },
  { data: { amount: null, title: '丙' } }
];
const numberField = { id: 'amount', type: 'number' };
const textField = { id: 'title', type: 'text' };

test('numeric summary supports hidden, sum, average, maximum and minimum', () => {
  assert.equal(calculateSummary(records, numberField, 'none'), null);
  assert.equal(calculateSummary(records, numberField, 'sum'), 30);
  assert.equal(calculateSummary(records, numberField, 'average'), 15);
  assert.equal(calculateSummary(records, numberField, 'max'), 20);
  assert.equal(calculateSummary(records, numberField, 'min'), 10);
  assert.deepEqual(summaryOptions(numberField).map(([mode]) => mode), ['none', 'sum', 'average', 'max', 'min']);
});

test('non-numeric summary supports total, filled and empty counts', () => {
  assert.equal(calculateSummary(records, textField, 'none'), null);
  assert.equal(calculateSummary(records, textField, 'count'), 3);
  assert.equal(calculateSummary(records, textField, 'filled'), 2);
  assert.equal(calculateSummary(records, textField, 'empty'), 1);
  assert.deepEqual(summaryOptions(textField).map(([mode]) => mode), ['none', 'count', 'filled', 'empty']);
});

test('summary defaults to sum for numbers and hidden for other fields', () => {
  assert.equal(summaryMode(numberField, {}), 'sum');
  assert.equal(summaryMode(textField, {}), 'none');
  assert.equal(summaryMode(textField, { title: 'filled' }), 'filled');
});
