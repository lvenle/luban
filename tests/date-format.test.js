import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInputValue, formatDateFieldValue } from '../public/app-runtime/DateFormat.js';

test('default date display matches the localized editor separator', () => {
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date' }), '2026/06/21');
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date', format: 'yyyy-mm-dd' }), '2026-06-21');
  assert.equal(formatDateFieldValue('2026-06-21', { type: 'date', format: 'mm-dd' }), '06-21');
});

test('datetime display never exposes the storage T separator', () => {
  assert.equal(formatDateFieldValue('2026-06-21T09:30', { type: 'datetime' }), '2026/06/21 09:30');
  assert.equal(formatDateFieldValue('2026-06-21T09:30', { type: 'datetime', format: 'yyyy-mm-dd hh:mm' }), '2026-06-21 09:30');
});

test('date editor values are normalized for native controls', () => {
  assert.equal(dateInputValue('2026/06/21', 'date'), '2026-06-21');
  assert.equal(dateInputValue('2026/06/21 09:30', 'datetime'), '2026-06-21T09:30');
});
