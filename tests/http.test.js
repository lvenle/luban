import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/db.js';
import { createAppServer } from '../src/server.js';

async function withServer(fn) {
  const dbPath = join(process.cwd(), 'data', 'test-http.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('HTTP API creates, runs, modifies, exports, and imports an app', async () => {
  await withServer(async (base) => {
    const created = await post(`${base}/api/apps/generate`, {
      prompt: '帮我创建一个家庭记账本，可以记录收入、支出、分类、日期、备注，并统计每月支出。'
    });
    assert.ok(created.appId);
    assert.equal(created.app.manifest.name, '家庭记账本');
    assert.ok(created.logs.includes('软件包协议校验通过'));

    const renamed = await put(`${base}/api/apps/${created.appId}`, { name: '个人现金流', category: '财务' });
    assert.equal(renamed.app.name, '个人现金流');
    assert.equal(renamed.app.manifest.category, '财务');

    const record = await post(`${base}/api/apps/${created.appId}/records`, {
      entityId: 'transaction',
      data: { type: '支出', amount: 100, category: '餐饮', date: '2026-06-10' }
    });
    assert.ok(record.record.id);

    const action = await post(`${base}/api/apps/${created.appId}/actions/monthly_summary/run`, {});
    assert.match(action.result, /已分析 1 条记录/);

    const xlsx = await fetch(`${base}/api/apps/${created.appId}/export.xlsx?entity=transaction`);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const xlsxBytes = new Uint8Array(await xlsx.arrayBuffer());
    assert.equal(String.fromCharCode(...xlsxBytes.slice(0, 2)), 'PK');

    const selectedXlsx = await fetch(`${base}/api/apps/${created.appId}/export.xlsx?entity=transaction&ids=${record.record.id}`);
    assert.equal(selectedXlsx.status, 200);
    assert.equal(selectedXlsx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const modified = await post(`${base}/api/apps/${created.appId}/modify`, { prompt: '增加旅游预算功能' });
    assert.ok(modified.app.schema.entities[0].fields.some((field) => field.id === 'travel_budget'));
    assert.ok(modified.logs.includes('Patch 应用并重新校验通过'));

    const exported = await fetch(`${base}/api/apps/${created.appId}/export`);
    assert.equal(exported.status, 200);
    const buffer = await exported.arrayBuffer();

    const imported = await fetch(`${base}/api/apps/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: buffer
    }).then((res) => res.json());
    assert.ok(imported.appId);
    assert.notEqual(imported.appId, created.appId);
  });
});

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}

async function put(url, body) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}
