import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeViewName, viewNameExists, uniqueViewName, numberedViewName } from '../public/common/view-name.js';

const views = [
  { id: 'all', name: '全部记录' },
  { id: 'active', name: '进行中' },
  { id: 'copy', name: '全部记录 副本' }
];

test('view names compare after trimming, unicode normalization and case folding', () => {
  assert.equal(normalizeViewName('  ＬＩＳＴ  '), 'list');
  assert.equal(viewNameExists(views, '  全部记录 '), true);
  assert.equal(viewNameExists([{ id: 'list', name: 'List' }], 'list'), true);
});

test('view name duplicate check excludes the view being renamed', () => {
  assert.equal(viewNameExists(views, '全部记录', 'all'), false);
  assert.equal(viewNameExists(views, '进行中', 'all'), true);
});

test('cloned views receive an available non-duplicate name', () => {
  assert.equal(uniqueViewName(views, '全部记录 副本'), '全部记录 副本 2');
  assert.equal(uniqueViewName(views, '已完成'), '已完成');
});

test('new typed views append compact numeric suffixes starting at one', () => {
  const views = [{ id: 'a', name: '网格视图' }, { id: 'b', name: '网格视图1' }, { id: 'c', name: '网格视图2' }];
  assert.equal(numberedViewName(views, '网格视图'), '网格视图3');
  assert.equal(numberedViewName(views, '日历视图'), '日历视图');
});
