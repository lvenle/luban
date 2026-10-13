import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const application = resolve(process.argv[2] || '.desktop-runtime');
const root = await mkdtemp(join(tmpdir(), 'luban-packaged-smoke-'));
process.env.LUBAN_DATA_DIR = join(root, 'product');
process.env.LUBAN_PLATFORM_INSTANCE_DIR = join(root, 'runtime');
process.env.LUBAN_WORKSPACE_DIR = join(root, 'workspace');
process.env.LUBAN_PUBLIC_DIR = join(application, 'public');
process.env.LUBAN_DESKTOP_TOKEN = 'packaged-smoke-token';
const load = path => import(pathToFileURL(join(application, path)).href);
const { initDb, closeDb } = await load('src/storage/db.js');
const { createAppServer } = await load('src/server.js');
const { ensurePlatformService, closePlatformService } = await load('src/agent/platform-service.js');
const { resolveLubanAgent } = await load('src/agent/agent-resolver.js');
let server;
try {
  const { normalizeAiCreatedPackage } = await load('src/ai/service.js');
  const { preparePackage } = await load('src/core/packageProtocol.js');
  const clinic = preparePackage(normalizeAiCreatedPackage({
    manifest: { name: '看诊回归验证' },
    schema: { entities: [
      { id: 'prescription', name: '处方', fields: [{ id: 'field_prescription_record', label: '就诊记录', type: 'relation', targetEntity: 'record', displayField: 'name' }] },
      { id: 'record', name: '就诊记录', fields: [{ id: 'field_record_title', label: '病历标题', type: 'text' }] }
    ] },
    ui: { pages: [{ id: 'prescriptions', title: '处方', type: 'table', entity: 'prescription' }] }
  }));
  assert.equal(clinic.schema.entities[0].fields[0].displayField, 'field_record_title');
  await initDb();
  const runtime = await ensurePlatformService();
  const agent = await resolveLubanAgent({ store: runtime.service.store });
  assert.equal(agent.id, 'luban-app-builder');
  assert.notEqual(new URL(runtime.url).port, '5190');
  assert.equal(runtime.service.store.snapshot().productId, 'luban');
  assert.equal((await fetch(runtime.url)).status, 403);
  const headers = { 'x-luban-desktop-token': process.env.LUBAN_DESKTOP_TOKEN };
  const adminPage = await fetch(runtime.url + '/models', { headers });
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /<title>底座管理<\/title>/);
  for (const page of ['home','conversation','wechat','knowledge-sources','customers']) {
    assert.equal((await fetch(runtime.url + '/' + page, { headers })).status, 404);
  }
  server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const productUrl = `http://127.0.0.1:${server.address().port}`;
  const settings = await fetch(productUrl + '/api/settings/platform', { headers }).then(response => response.json());
  assert.equal(settings.consoleUrl, runtime.url + '/models');
  const result = await runtime.service.startProductRun({ agentId: agent.id, agentVersion: 'draft', messages: [], executionMode: 'mock', source: 'packaged-smoke' }).result;
  assert.equal(result.output, 'Mock response');
  const manifest = JSON.parse(await readFile(join(application, 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.product, 'luban');
  assert.equal(manifest.consoleMode, 'admin');
  assert.match(manifest.runtimeSha256, /^[a-f0-9]{64}$/);
  const runtimeUrl = runtime.url;
  await closePlatformService();
  await assert.rejects(fetch(runtimeUrl));
  console.log(JSON.stringify({ ok: true, product: 'luban', modelCall: 'mock', ownedRuntime: true, consoleProtected: true, cleanShutdown: true, runtimeSha256: manifest.runtimeSha256 }));
} finally {
  await closePlatformService();
  if (server) await new Promise(resolve => server.close(resolve));
  await closeDb();
  await rm(root, { recursive: true, force: true });
}
