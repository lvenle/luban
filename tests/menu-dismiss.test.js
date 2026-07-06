import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../public/common/modal.js', import.meta.url), 'utf8');
const viewBar = readFileSync(new URL('../public/app-runtime/ViewBar.js', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../public/app-runtime/Sidebar.js', import.meta.url), 'utf8');
const tableHeader = readFileSync(new URL('../public/app-runtime/TableHeader.js', import.meta.url), 'utf8');
const mobileRecords = readFileSync(new URL('../public/app-runtime/MobileRecordList.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('detached popovers share outside-click, escape, resize and scroll dismissal', () => {
  assert.match(modal, /export function bindDismissiblePopover/);
  assert.match(modal, /document\.addEventListener\('pointerdown'/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /window\.addEventListener\('resize', close/);
  assert.match(modal, /window\.addEventListener\('scroll', close/);
  assert.match(viewBar, /bindDismissiblePopover\(menu, trigger\)/);
  assert.match(tableHeader, /bindDismissiblePopover\(menu\)/);
  assert.match(mobileRecords, /bindDismissiblePopover\(menu, anchor\)/);
});

test('data-table page menu omits delete-page while retaining delete-table', () => {
  assert.match(sidebar, /!isTablePage && navKind !== 'link'/);
  assert.match(sidebar, /text: '删除表'/);
});

test('overflow menus and block surfaces use shared visual tokens', () => {
  assert.match(styles, /--surface-radius: 12px/);
  assert.match(styles, /--menu-font-size: 13px/);
  assert.match(styles, /--menu-trigger-size: 28px/);
  assert.match(styles, /\.card-menu summary,[\s\S]*\.page-menu\.ghost,[\s\S]*\.view-menu-trigger,[\s\S]*\.mobile-card-menu-btn/);
  assert.match(styles, /\.hero,[\s\S]*\.card,[\s\S]*\.panel,[\s\S]*\.table-panel,[\s\S]*\.page-card/);
});
