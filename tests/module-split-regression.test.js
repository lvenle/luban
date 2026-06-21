import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppServer } from '../src/server.js';

const appShellJs = source('../public/app.js');
const cellSelectionJs = source('../public/app-runtime/CellSelection.js');
const pageTypesJs = source('../public/app-runtime/PageTypes.js');
const runtimeIndexJs = source('../public/app-runtime/index.js');

test('module split keeps global cell-selection events wired to the app shell', () => {
  assert.match(cellSelectionJs, /export function bindCellSelectionEvents\(\)/);
  for (const eventName of ['pointerdown', 'pointerup', 'pointermove', 'copy', 'paste']) {
    assert.match(cellSelectionJs, new RegExp(`document\\.addEventListener\\('${eventName}'`), eventName);
  }
  assert.match(appShellJs, /import\('\.\/app-runtime\/CellSelection\.js'\)/);
  assert.match(appShellJs, /bindCellSelectionEvents\(\)/);
  assert.match(appShellJs, /document\.addEventListener\('focusin'/);
});

test('module split keeps every specialized page renderer registered and implemented', () => {
  assert.match(runtimeIndexJs, /import\('\.\/PageTypes\.js'\)/);
  for (const renderer of ['renderBlankPage', 'renderChartPage', 'renderDashboardPage', 'renderEditorPage']) {
    assert.match(pageTypesJs, new RegExp(`export function ${renderer}\\(`), renderer);
  }
  assert.match(pageTypesJs, /page-card-canvas/);
  assert.match(pageTypesJs, /class: 'bar-fill'/);
  assert.match(pageTypesJs, /class: 'stat-grid'/);
  assert.match(pageTypesJs, /renderListPage\(\{ \.\.\.page, type: 'list' \}\)/);
});

test('module split keeps API method guards and unknown-route fallthroughs', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-module-split.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const cases = [
      ['GET', '/api/unknown'],
      ['GET', '/api/apps/generate'],
      ['GET', '/api/apps/import'],
      ['POST', '/api/settings'],
      ['DELETE', '/api/apps/missing-app']
    ];
    for (const [method, path] of cases) {
      const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dbPath, { force: true });
  }
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
