import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePageTitle, pageTitleExists, uniquePageTitle } from '../public/common/page-title.js';

const pages = [
  { id: 'orders', title: '销售订单' },
  { id: 'docs', title: '未命名文档' },
  { id: 'docs-2', title: '未命名文档 2' }
];

test('page titles compare after trimming, unicode normalization and case folding', () => {
  assert.equal(normalizePageTitle('  ＡＢＣ  '), 'abc');
  assert.equal(pageTitleExists(pages, '  销售订单 '), true);
  assert.equal(pageTitleExists([{ id: 'english', title: 'Orders' }], 'orders'), true);
});

test('page title duplicate check can exclude the page being renamed', () => {
  assert.equal(pageTitleExists(pages, '销售订单', 'orders'), false);
  assert.equal(pageTitleExists(pages, '未命名文档', 'orders'), true);
});

test('default unnamed pages receive the next available non-duplicate title', () => {
  assert.equal(uniquePageTitle(pages, '未命名文档'), '未命名文档 3');
  assert.equal(uniquePageTitle(pages, '未命名网页'), '未命名网页');
});
