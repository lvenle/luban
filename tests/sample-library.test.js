import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord, listRecords } from '../src/models/record.js';
import { createRule, listRules } from '../src/models/rule.js';
import { exportAppPayload, importAppPayload } from '../src/services/package-transfer.js';

const dbPath = join(process.cwd(), 'data', 'test-sample-library.sqlite');
test.after(() => rmSync(dbPath, { force: true }));

test('sample payload restores records, relations, and business rules', () => {
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage({
    manifest: { packageVersion: '2.0', id: 'sample-relations', name: '关联样例', version: '1.0.0' },
    schema: { entities: [
      { id: 'customer', name: '客户', fields: [{ id: 'name', label: '姓名', type: 'text' }] },
      { id: 'order', name: '订单', fields: [
        { id: 'number', label: '单号', type: 'text' },
        { id: 'customer', label: '客户', type: 'relation', targetEntity: 'customer', multiple: false }
      ] }
    ] },
    ui: { pages: [{ id: 'customers', title: '客户', type: 'list', entity: 'customer' }, { id: 'orders', title: '订单', type: 'list', entity: 'order' }] },
    actions: { actions: [] },
    prompts: {}
  });
  const customer = createRecord(app.id, 'customer', { name: '张三' });
  createRecord(app.id, 'order', { number: 'SO-1', customer: [customer.id] });
  createRule({
    appId: app.id,
    name: '订单联动',
    status: 'disabled',
    sourceText: '创建订单后执行联动',
    businessIntentJson: { supported: true },
    schemaMappingJson: { trigger: { entity: 'order' } },
    contractJson: { trigger: { type: 'record.created', entity: 'order' }, steps: [] }
  });

  const payload = exportAppPayload(app.id, 'all');
  const imported = importAppPayload(payload);
  const records = listRecords(imported.id);
  const importedCustomer = records.find((record) => record.entityId === 'customer');
  const importedOrder = records.find((record) => record.entityId === 'order');
  assert.equal(records.length, 2);
  assert.equal(importedOrder.data.customer[0].targetRecordId, importedCustomer.id);
  assert.equal(listRules(imported.id).length, 1);
  assert.equal(listRules(imported.id)[0].status, 'disabled');
});

test('generated sample catalog contains the current applications and import metadata', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/samples/catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalog.version, 1);
  assert.ok(catalog.samples.length >= 11);
  assert.ok(catalog.samples.every((sample) => sample.payload?.sampleData && sample.payload?.businessRules));
  assert.ok(catalog.samples.some((sample) => sample.payload.businessRules.length > 0));
});

test('system settings exposes the sample import tab and batch import controls', () => {
  const settings = [
    '../public/app-runtime/SettingsModal.js',
    '../public/app-runtime/settings/RuntimeSettingsPanel.js',
    '../public/app-runtime/settings/SampleImportPanel.js'
  ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.match(settings, /text: appId \? '应用设置' : '系统设置'/);
  assert.match(settings, /tab\('runtime', '运行参数'\)/);
  assert.match(settings, /paginationMax/);
  assert.match(settings, /aiStreamReadTimeoutMs/);
  assert.match(settings, /rateLimitWindowMs/);
  assert.match(settings, /tab\('samples', `样例导入/);
  assert.match(settings, /JSON\.stringify\(\{ ids \}\)/);
  assert.match(settings, /text: busy \? '导入中…' : '导入'/);
});
