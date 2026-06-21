import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppServer } from '../src/server.js';
import { allSamplePackages } from '../src/ai/samplePackages.js';

const SCENARIOS = allSamplePackages()
  .slice(0, 50)
  .map((pkg) => `帮我创建一个${pkg.manifest.name}，${pkg.manifest.description}`);

async function withServer(fn) {
  const dbPath = join(process.cwd(), 'data', 'test-http-scenarios.sqlite');
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

test('50 generated app scenarios are usable through HTTP runtime APIs', async () => {
  await withServer(async (base) => {
    const generatedNames = new Set();
    for (const [index, prompt] of SCENARIOS.entries()) {
      const created = await post(`${base}/api/apps/generate`, { prompt });
      const app = created.app;
      generatedNames.add(app.name);
      assert.ok(created.appId, prompt);
      assert.ok(app.schema.entities.length >= 1, prompt);
      assert.ok(app.ui.pages.some((page) => page.type === 'list'), prompt);

      const entity = app.schema.entities[0];
      const marker = `验收记录-${index}`;
      const data = sampleRecord(entity, marker);
      const record = await post(`${base}/api/apps/${app.id}/records`, { entityId: entity.id, data });
      assert.ok(record.record.id, prompt);

      const searched = await getJson(`${base}/api/apps/${app.id}/records?entity=${entity.id}&q=${encodeURIComponent(marker)}`);
      assert.equal(searched.records.length, 1, prompt);

      const firstAction = app.actions.actions[0];
      const actionResult = await post(`${base}/api/apps/${app.id}/actions/${firstAction.id}/run`, {});
      assert.ok('result' in actionResult, prompt);

      const csv = await fetch(`${base}/api/apps/${app.id}/export.csv?entity=${entity.id}`);
      assert.equal(csv.status, 200, prompt);
      assert.match(await csv.text(), new RegExp(marker), prompt);

      const modified = await post(`${base}/api/apps/${app.id}/modify`, { prompt: '增加验收日期字段' });
      const fields = modified.app.schema.entities[0].fields.map((field) => field.id);
      assert.ok(fields.includes('date_field') || fields.includes('acceptance_date'), prompt);
    }
    assert.equal(SCENARIOS.length, 50);
    assert.ok(generatedNames.size >= 50);
  });
});

function sampleRecord(entity, marker) {
  const data = {};
  for (const [index, field] of entity.fields.entries()) {
    data[field.id] = sampleValue(field, index === 0 ? marker : undefined);
  }
  return data;
}

function sampleValue(field, marker) {
  if (marker) return marker;
  if (field.type === 'number') return 42;
  if (field.type === 'date') return '2026-06-11';
  if (field.type === 'datetime') return '2026-06-11T10:00';
  if (field.type === 'boolean') return true;
  if (field.type === 'select') return field.options?.[0] || '默认';
  if (field.type === 'multiSelect') return [field.options?.[0] || '默认'];
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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) assert.fail(await response.text());
  return response.json();
}
