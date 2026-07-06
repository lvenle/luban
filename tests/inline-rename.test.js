import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helper = readFileSync(new URL('../public/common/inline-rename.js', import.meta.url), 'utf8');
const appCard = readFileSync(new URL('../public/app-home/AppCard.js', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../public/app-runtime/Sidebar.js', import.meta.url), 'utf8');
const viewBar = readFileSync(new URL('../public/app-runtime/ViewBar.js', import.meta.url), 'utf8');

test('software cards expose an in-place rename action', () => {
  assert.match(appCard, /text: '重命名'/);
  assert.match(appCard, /startInlineRename\(title/);
  assert.match(appCard, /className: 'app-card-name-input'/);
});

test('software cards edit category in place from the overflow menu', () => {
  assert.match(appCard, /text: '修改分类'/);
  assert.match(appCard, /startCategoryInlineEdit\(categoryPill, app\)/);
  assert.match(appCard, /className: 'app-card-category-input'/);
  assert.doesNotMatch(appCard, /编辑软件分类/);
});

test('page and view rename actions share the inline editor instead of a modal', () => {
  assert.match(sidebar, /startInlineRename\(titleButton/);
  assert.doesNotMatch(sidebar, /text: '重命名页面'/);
  assert.match(viewBar, /startInlineRename\(button/);
});

test('inline rename supports save, cancel, blur and validation', () => {
  assert.match(helper, /input\.addEventListener\('blur'/);
  assert.match(helper, /event\.stopPropagation\(\)/);
  assert.match(helper, /event\.key === 'Enter'/);
  assert.match(helper, /event\.key === 'Escape'/);
  assert.match(helper, /const validationMessage = await validate/);
});
