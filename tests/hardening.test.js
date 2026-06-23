import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests, getPackageFromApp } from '../src/storage/db.js';
import { createAppFromPackage, getApp, updateAppPackage } from '../src/models/app.js';
import {
  clampPageLimit, countRecords, createRecord, deleteRecordForApp, getRecordForApp,
  listRecords, updateRecordForApp
} from '../src/models/record.js';
import { getTool } from '../src/ai/registry.js';
import { preparePackage } from '../src/core/packageProtocol.js';
import { PassThrough } from 'node:stream';
import { readJson } from '../src/routes/_helpers.js';
import { handleSettingsApi } from '../src/routes/settings.js';
import { setSetting } from '../src/models/session.js';

await Promise.all([
  import('../src/ai/tools/update-record.js'),
  import('../src/ai/tools/create-view.js'),
  import('../src/ai/tools/design-form.js')
]);

test('record validation, ownership, transactions, pagination and persisted AI tools stay consistent', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-hardening.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);

  const first = createAppFromPackage(testPackage('first'));
  const second = createAppFromPackage(testPackage('second'));
  assert.throws(() => createRecord(first.id, 'task', { status: 'todo' }), /必填项/);
  assert.throws(() => createRecord(first.id, 'task', { name: '坏关联', status: 'todo', owner: 'missing' }), /无效记录/);
  assert.equal(countRecords(first.id, { entityId: 'task' }), 0, 'failed relation writes must roll back the inserted record');

  const owner = createRecord(first.id, 'person', { name: '小明' });
  const record = createRecord(first.id, 'task', { name: '任务 1', status: '待办', owner: owner.id });
  assert.equal(record.data.status, 'todo', 'select labels normalize to option IDs');
  assert.equal(getRecordForApp(second.id, record.id), null);
  assert.throws(() => updateRecordForApp(second.id, record.id, record.data), /找不到记录/);
  assert.throws(() => deleteRecordForApp(second.id, record.id), /找不到记录/);

  for (let index = 2; index <= 12; index++) createRecord(first.id, 'task', { name: `任务 ${index}`, status: 'todo' });
  assert.equal(clampPageLimit(5000), 1000);
  const oversizedPage = testPackage('page-size');
  oversizedPage.ui.pages[0].pageSize = 5000;
  assert.equal(preparePackage(oversizedPage).ui.pages[0].pageSize, 1000);
  assert.equal(preparePackage(testPackage('default-size')).ui.pages[0].pageSize, 100);
  assert.equal(listRecords(first.id, { entityId: 'task', limit: 5, offset: 0 }).length, 5);
  assert.equal(listRecords(first.id, { entityId: 'task', limit: 5, offset: 10 }).length, 2);

  const updated = await getTool('update_record').handler({ appId: first.id, recordId: record.id, data: { name: 'AI 已更新' } });
  assert.equal(updated.data.name, 'AI 已更新');
  await getTool('create_view').handler({ appId: first.id, entityId: 'task', name: 'AI 视图', visibleFields: ['name'], sorts: [{ field: 'name', direction: 'asc' }] });
  await getTool('design_form').handler({ appId: first.id, entityId: 'task', fieldOrder: ['status', 'name'], columns: 3 });
  const saved = getApp(first.id);
  assert.ok(saved.ui.pages[0].views.some((view) => view.name === 'AI 视图'));
  assert.deepEqual(saved.schema.entities.find((entity) => entity.id === 'task').formLayout, { columns: 3, order: ['status', 'name', 'owner'] });

  const stale = getApp(first.id);
  const pkg = getPackageFromApp(stale);
  pkg.manifest.description = '较新的修改';
  updateAppPackage(first.id, pkg, { expectedUpdatedAt: stale.updatedAt });
  assert.throws(() => updateAppPackage(first.id, getPackageFromApp(stale), { expectedUpdatedAt: stale.updatedAt }), /其他页面发生变化/);
});

test('request limits and settings responses do not expose secrets', async () => {
  const request = new PassThrough();
  request.headers = { 'content-length': String(3 * 1024 * 1024) };
  request.end('{}');
  await assert.rejects(() => readJson(request), (error) => error.status === 413);

  const dbPath = join(process.cwd(), 'data', 'test-settings-mask.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  setSetting('ai', { baseUrl: 'https://example.test/v1', apiKey: 'secret-value', model: 'test-model' });
  const response = mockResponse();
  await handleSettingsApi({}, response, 'GET');
  const body = JSON.parse(response.body);
  assert.equal(body.ai.apiKey, '');
  assert.equal(body.ai.hasApiKey, true);
});

function mockResponse() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(body = '') { this.body = String(body); }
  };
}

function testPackage(id) {
  return {
    manifest: { id, name: id },
    schema: { entities: [
      { id: 'task', name: '任务', fields: [
        { id: 'name', label: '名称', type: 'text', required: true },
        { id: 'status', label: '状态', type: 'select', options: [{ id: 'todo', label: '待办', color: 'blue' }] },
        { id: 'owner', label: '负责人', type: 'relation', targetEntity: 'person', displayField: 'name' }
      ] },
      { id: 'person', name: '人员', fields: [{ id: 'name', label: '姓名', type: 'text', required: true }] }
    ] },
    ui: { pages: [{ id: 'task-list', title: '任务', type: 'list', entity: 'task', views: [{ id: 'default', name: '全部记录', type: 'list' }] }] },
    actions: { actions: [] }, prompts: { suggestedCommands: [] }
  };
}
