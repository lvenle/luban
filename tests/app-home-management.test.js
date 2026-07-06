import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage, listApps, moveApp, updateAppMetadata } from '../src/models/app.js';
import { createBudgetPackage } from '../src/templates/appTemplates.js';

test('apps persist enabled state and user ordering with disabled apps last', () => {
  const dbPath = join(process.cwd(), 'data', 'test-app-home-management.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const first = createAppFromPackage(createBudgetPackage());
  const second = createAppFromPackage(createBudgetPackage());
  assert.equal(first.enabled, true);
  assert.equal(second.enabled, true);
  assert.deepEqual(listApps().slice(0, 2).map((app) => app.id), [second.id, first.id]);

  moveApp(first.id, second.id, 'before');
  assert.deepEqual(listApps().slice(0, 2).map((app) => app.id), [first.id, second.id]);

  const disabled = updateAppMetadata(first.id, { enabled: false, expectedUpdatedAt: listApps()[0].updatedAt });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(listApps().slice(0, 2).map((app) => app.id), [second.id, first.id]);

  const recategorized = updateAppMetadata(second.id, { category: '自定义分类', expectedUpdatedAt: listApps()[0].updatedAt });
  assert.equal(recategorized.manifest.category, '自定义分类');
});

test('home UI exposes search, drag ordering, status toggle, and category editing', () => {
  const home = readFileSync(new URL('../public/app-home/index.js', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../public/app-home/AppCard.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(home, /class: 'app-search-input'/);
  assert.match(home, /state\.appSearch/);
  assert.match(home, /card\.hidden = !matchesSearch/);
  assert.match(home, /emptyResults\.hidden = visibleCount > 0/);
  assert.doesNotMatch(home, /oninput:[\s\S]{0,240}renderHome\(\)/);
  assert.match(styles, /\.app-card\[hidden\],[\s\S]*display: none/);
  assert.match(home, /section-heading home-section-heading[\s\S]*section-title[\s\S]*home-list-controls[\s\S]*searchInput[\s\S]*category-filter/);
  assert.doesNotMatch(home, /个本地软件，可打开、导出或继续改造/);
  assert.match(card, /draggable: 'true'/);
  assert.match(card, /\/api\/apps\/order/);
  assert.match(card, /app\.enabled === false \? '启用' : '禁用'/);
  assert.match(card, /class: `app-status/);
  assert.match(card, /ondblclick:[\s\S]*openCategoryEditor\(app\)/);
});
