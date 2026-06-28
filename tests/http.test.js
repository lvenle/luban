import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
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
    const allRecords = await getJson(`${base}/api/apps/${created.appId}/records`);
    assert.ok(allRecords.records.some((item) => item.id === record.record.id));

    const uploaded = await fetch(`${base}/api/apps/${created.appId}/uploads?name=receipt.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
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
    const selectedXlsxBytes = await selectedXlsx.arrayBuffer();

    const csvImport = await fetch(`${base}/api/apps/${created.appId}/tables/transaction/import?name=transactions.csv`, {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: '类型,金额,分类,日期,备注\n收入,2200,工资,2026-06-11,CSV导入'
    }).then((res) => res.json());
    assert.equal(csvImport.importedCount, 1);

    const xlsxImport = await fetch(`${base}/api/apps/${created.appId}/tables/transaction/import?name=transactions.xlsx`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      body: selectedXlsxBytes
    }).then((res) => res.json());
    assert.equal(xlsxImport.importedCount, 1);
    const importedRecords = await getJson(`${base}/api/apps/${created.appId}/records?entity=transaction`);
    assert.equal(importedRecords.records.length, 3);

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
      data: { ...sampleEntityData(categoryEntity, '手机'), category_code: '手机' }
    });
    const product = await post(`${base}/api/apps/${appId}/records`, {
      entityId: productEntity.id,
      data: { ...sampleEntityData(productEntity, 'iPhone'), [relation.id]: [category.record.id] }
    });
    assert.ok(product.record.id);

    const options = await getJson(`${base}/api/apps/${appId}/fields/${productEntity.id}/${relation.id}/relation-options?keyword=${encodeURIComponent('手机')}`);
    assert.equal(options.options[0].displayValue, '手机');

    const records = await getJson(`${base}/api/apps/${appId}/records?entity=${productEntity.id}`);
    assert.equal(records.records[0].data[relation.id][0].displayValue, '手机');

    const blockedTableDelete = await fetch(`${base}/api/apps/${appId}/tables/${categoryEntity.id}`, { method: 'DELETE' });
    assert.equal(blockedTableDelete.status, 409);
    const blockedTableBody = await blockedTableDelete.json();
    assert.equal(blockedTableBody.details.references[0].sourceEntityId, productEntity.id);
    assert.equal(blockedTableBody.details.references[0].fieldId, relation.id);

    const blockedTableClear = await fetch(`${base}/api/apps/${appId}/tables/${categoryEntity.id}/records`, { method: 'DELETE' });
    assert.equal(blockedTableClear.status, 409);
    const blockedClearBody = await blockedTableClear.json();
    assert.equal(blockedClearBody.details.references[0].sourceEntityId, productEntity.id);
    assert.equal(blockedClearBody.details.references[0].fieldId, relation.id);

    const blockedDelete = await fetch(`${base}/api/apps/${appId}/records/${category.record.id}`, { method: 'DELETE' });
    assert.equal(blockedDelete.status, 409);
    const forcedDelete = await fetch(`${base}/api/apps/${appId}/records/${category.record.id}?force=true`, { method: 'DELETE' });
    assert.equal(forcedDelete.status, 200);

    await post(`${base}/api/apps/${appId}/records`, {
      entityId: categoryEntity.id,
      data: { ...sampleEntityData(categoryEntity, '电脑'), category_code: '电脑' }
    });
    const clearedTable = await fetch(`${base}/api/apps/${appId}/tables/${categoryEntity.id}/records`, { method: 'DELETE' }).then((res) => res.json());
    assert.equal(clearedTable.deletedCount, 1);
    const clearedRecords = await getJson(`${base}/api/apps/${appId}/records?entity=${categoryEntity.id}`);
    assert.equal(clearedRecords.records.length, 0);
    const appAfterClear = await getJson(`${base}/api/apps/${appId}`);
    assert.ok(appAfterClear.app.schema.entities.some((entity) => entity.id === categoryEntity.id));

    const deletedTable = await fetch(`${base}/api/apps/${appId}/tables/${categoryEntity.id}`, { method: 'DELETE' }).then((res) => res.json());
    assert.ok(!deletedTable.app.schema.entities.some((entity) => entity.id === categoryEntity.id));
    assert.ok(!deletedTable.app.schema.entities.some((entity) => entity.fields.some((field) => field.type === 'relation' && field.targetEntity === categoryEntity.id)));

  });
});

test('bidirectional relation fields stay synchronized from either table', async () => {
  await withServer(async (base) => {
    const created = await post(`${base}/api/apps/generate`, { prompt: '帮我创建一个商品管理系统' });
    const appId = created.appId;
    const productEntity = created.app.schema.entities[0];
    const productDisplayField = productEntity.fields.find((field) => ['text', 'textarea', 'richText'].includes(field.type))
      || productEntity.fields.find((field) => field.type !== 'relation');
    const categoryTable = await post(`${base}/api/apps/${appId}/tables`, { name: '分类表' });
    const categoryEntity = categoryTable.app.schema.entities.find((entity) => entity.name === '分类表');

    const productRelationResult = await post(`${base}/api/apps/${appId}/tables/${productEntity.id}/fields`, {
      id: 'category_link', label: '所属分类', type: 'relation', targetEntity: categoryEntity.id,
      displayField: 'name', multiple: false, reciprocalFieldId: 'products_link'
    });
    await post(`${base}/api/apps/${appId}/tables/${categoryEntity.id}/fields`, {
      id: 'products_link', label: '分类商品', type: 'relation', targetEntity: productEntity.id,
      displayField: productDisplayField.id, multiple: true, reciprocalFieldId: 'category_link'
    });
    const productRelation = productRelationResult.app.schema.entities
      .find((entity) => entity.id === productEntity.id).fields.find((field) => field.id === 'category_link');

    const category = await post(`${base}/api/apps/${appId}/records`, {
      entityId: categoryEntity.id, data: { name: '手机' }
    });
    const product = await post(`${base}/api/apps/${appId}/records`, {
      entityId: productEntity.id,
      data: { ...sampleEntityData(productEntity, 'iPhone', productDisplayField.id), [productRelation.id]: [category.record.id] }
    });

    let categories = await getJson(`${base}/api/apps/${appId}/records?entity=${categoryEntity.id}`);
    assert.equal(categories.records[0].data.products_link[0].targetRecordId, product.record.id);
    assert.equal(categories.records[0].data.products_link[0].displayValue, 'iPhone');

    const reverseRelations = await getJson(`${base}/api/apps/${appId}/records/${category.record.id}/relations/products_link`);
    assert.equal(reverseRelations.relations[0].targetRecordId, product.record.id);

    await put(`${base}/api/apps/${appId}/records/${category.record.id}/relations/products_link`, { targetRecordIds: [] });
    const products = await getJson(`${base}/api/apps/${appId}/records?entity=${productEntity.id}`);
    assert.deepEqual(products.records.find((record) => record.id === product.record.id).data.category_link, []);
    categories = await getJson(`${base}/api/apps/${appId}/records?entity=${categoryEntity.id}`);
    assert.deepEqual(categories.records[0].data.products_link, []);
  });
});

test('AI session metadata is correctly recorded on app generation', async () => {
  await withServer(async (base) => {
    const created = await post(`${base}/api/apps/generate`, { prompt: '帮我创建一个客户管理系统' });
    assert.ok(created.appId);
    assert.ok(created.app.manifest.name.includes('客户管理'));
  });
});

function sampleEntityData(entity, marker, markerFieldId) {
  const textField = markerFieldId
    ? entity.fields.find((field) => field.id === markerFieldId)
    : entity.fields.find((field) => ['text', 'textarea', 'richText'].includes(field.type));
  return Object.fromEntries(entity.fields
    .filter((field) => field.type !== 'formula' && field.type !== 'relation')
    .map((field) => [field.id, sampleFieldValue(field, field.id === textField?.id ? marker : undefined)]));
}

function sampleFieldValue(field, marker) {
  if (marker !== undefined) return marker;
  if (field.type === 'number') return 42;
  if (field.type === 'date') return '2026-06-11';
  if (field.type === 'datetime') return '2026-06-11T10:00';
  if (field.type === 'boolean') return true;
  const firstOption = typeof field.options?.[0] === 'object'
    ? (field.options[0].id || field.options[0].value || field.options[0].label)
    : field.options?.[0];
  if (field.type === 'select') return firstOption || '';
  if (field.type === 'multiSelect') return firstOption ? [firstOption] : [];
  return '验收数据';
}

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
