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

    const uploaded = await fetch(`${base}/api/apps/${created.appId}/uploads?name=receipt.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71])
    }).then((res) => res.json());
    assert.equal(uploaded.file.name, 'receipt.png');
    assert.match(uploaded.file.url, /^\/uploads\//);
    const uploadedFile = await fetch(`${base}${uploaded.file.url}`);
    assert.equal(uploadedFile.status, 200);
    assert.equal(uploadedFile.headers.get('content-type'), 'image/png');

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

test('HTTP API supports V2 tables, relation fields, colored options, and confirmed AI execution', async () => {
  await withServer(async (base) => {
    const created = await post(`${base}/api/apps/generate`, { prompt: '帮我创建一个商品管理系统' });
    const appId = created.appId;

    const categoryTable = await post(`${base}/api/apps/${appId}/tables`, { name: '分类表' });
    const categoryEntity = categoryTable.app.schema.entities.find((entity) => entity.name === '分类表');
    assert.ok(categoryEntity);
    await post(`${base}/api/apps/${appId}/tables/${categoryEntity.id}/fields`, {
      id: 'category_code',
      label: '分类编码',
      type: 'text'
    });

    const productEntity = categoryTable.app.schema.entities[0];
    const relationField = await post(`${base}/api/apps/${appId}/tables/${productEntity.id}/fields`, {
      label: '商品分类',
      type: 'relation',
      targetEntity: categoryEntity.id,
      displayField: 'category_code',
      multiple: false
    });
    const relation = relationField.app.schema.entities[0].fields.find((field) => field.type === 'relation');
    assert.equal(relation.targetEntity, categoryEntity.id);

    const category = await post(`${base}/api/apps/${appId}/records`, {
      entityId: categoryEntity.id,
      data: { name: '手机' }
    });
    const product = await post(`${base}/api/apps/${appId}/records`, {
      entityId: productEntity.id,
      data: { name: 'iPhone', [relation.id]: [category.record.id] }
    });
    assert.ok(product.record.id);

    const options = await getJson(`${base}/api/apps/${appId}/fields/${productEntity.id}/${relation.id}/relation-options?keyword=${encodeURIComponent('手机')}`);
    assert.equal(options.options[0].displayValue, '手机');

    const records = await getJson(`${base}/api/apps/${appId}/records?entity=${productEntity.id}`);
    assert.equal(records.records[0].data[relation.id][0].displayValue, '手机');

    const blockedDelete = await fetch(`${base}/api/apps/${appId}/records/${category.record.id}`, { method: 'DELETE' });
    assert.equal(blockedDelete.status, 409);
    const forcedDelete = await fetch(`${base}/api/apps/${appId}/records/${category.record.id}?force=true`, { method: 'DELETE' });
    assert.equal(forcedDelete.status, 200);

    const beforePlan = await getJson(`${base}/api/apps`);
    const planned = await post(`${base}/api/ai/plan`, { prompt: '帮我创建一个商品管理系统，包括商品、分类、供应商、库存流水' });
    assert.equal(planned.plan.type, 'app_creation_plan');
    const afterPlan = await getJson(`${base}/api/apps`);
    assert.equal(afterPlan.apps.length, beforePlan.apps.length);

    const executed = await post(`${base}/api/ai/sessions/${planned.session.id}/execute`, {});
    assert.ok(executed.appId);
    assert.equal(executed.session.status, 'completed');
    assert.ok(executed.app.schema.entities.length >= 3);
    assert.ok(executed.app.schema.entities.some((entity) => entity.fields.some((field) => field.type === 'relation')));
  });
});

test('AI agent clarifies vague requests before planning or execution', async () => {
  await withServer(async (base) => {
    const before = await getJson(`${base}/api/apps`);
    const clarified = await post(`${base}/api/ai/plan`, { prompt: '帮我创建一个系统' });

    assert.equal(clarified.state, 'CLARIFY');
    assert.equal(clarified.session.status, 'clarifying');
    assert.ok(clarified.clarification.questions.length >= 1);
    assert.equal(clarified.plan, undefined);

    const afterClarify = await getJson(`${base}/api/apps`);
    assert.equal(afterClarify.apps.length, before.apps.length);

    const planned = await post(`${base}/api/ai/plan`, {
      sessionId: clarified.session.id,
      prompt: '用于管理客户线索，记录客户名称、联系方式、跟进状态和下一次跟进日期'
    });
    assert.equal(planned.state, 'CONFIRM');
    assert.equal(planned.session.status, 'waiting_confirmation');
    assert.equal(planned.plan.type, 'app_creation_plan');

    const cancelled = await post(`${base}/api/ai/sessions/${planned.session.id}/cancel`, {});
    assert.equal(cancelled.session.status, 'cancelled');
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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}
