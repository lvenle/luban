import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage, updateAppPackage } from '../src/models/app.js';
import { getPackageFromApp } from '../src/storage/db.js';
import { createBudgetPackage } from '../src/templates/appTemplates.js';
import { getTool } from '../src/ai/registry.js';
import { serveHtmlPreview } from '../src/server.js';
import '../src/ai/tools/add-page.js';
import '../src/ai/tools/update-page.js';

test('AI tools create complete HTML pages and update HTML or Markdown source', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-webpage-ai.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const firstHtml = '<!doctype html><html><body><h1>第一版</h1></body></html>';
  const added = await getTool('add_page').handler({
    appId: app.id,
    title: 'AI 网页',
    type: 'webpage',
    content: firstHtml
  });
  const webpage = added.ui.pages.find((page) => page.navKind === 'webpage');
  assert.equal(webpage.content, firstHtml);

  const secondHtml = '<!doctype html><html><body><h1>第二版</h1></body></html>';
  const updated = await getTool('update_page').handler({ appId: app.id, pageId: webpage.id, content: secondHtml });
  assert.equal(updated.ui.pages.find((page) => page.id === webpage.id).content, secondHtml);

  const pkg = getPackageFromApp(updated);
  pkg.ui.pages.push({ id: 'ai-doc', title: 'AI 文档', type: 'page', navKind: 'markdown', content: '# 初稿' });
  const withDocument = updateAppPackage(app.id, pkg, { expectedUpdatedAt: updated.updatedAt });
  const documentUpdated = await getTool('update_page').handler({ appId: app.id, pageId: 'ai-doc', content: '# AI 修改稿' });
  assert.equal(documentUpdated.ui.pages.find((page) => page.id === 'ai-doc').content, '# AI 修改稿');
  assert.ok(withDocument.ui.pages.some((page) => page.id === 'ai-doc'));

  const response = { status: 0, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  serveHtmlPreview({ method: 'GET' }, response, `/html-preview/${app.id}/${webpage.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body, secondHtml);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['content-security-policy'], /sandbox allow-scripts/);
});
