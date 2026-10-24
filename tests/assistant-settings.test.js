import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, closeDb } from '../src/storage/db.js';
import { createAppServer } from '../src/server.js';
import { ensurePlatformService, closePlatformService } from '../src/agent/platform-service.js';

test('frontend settings edit the bound assistant atomically and reject stale or foreign edits', async () => {
  await initDb();
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(base + '/api/settings/platform');
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.applicationAssistantId, 'luban-app-builder');
    assert.equal(state.defaultAgentId, 'assistant');
    const save = body => fetch(base + '/api/settings/platform', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    response = await save({ revision: state.revision, agent: { id: 'assistant', system: 'foreign' }, connection: { model: 'invalid' } });
    assert.equal(response.status, 400);
    assert.equal((await ensurePlatformService()).service.store.snapshot().revision, state.revision);
    response = await save({ revision: state.revision, agent: { id: state.applicationAssistantId, system: 'from frontend' }, connection: { name: '测试模型', model: 'test', apiKey: 'private-key' } });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(JSON.stringify(saved).includes('private-key'), false);
    assert.equal(saved.agents.find(agent => agent.id === state.applicationAssistantId).draft.system, 'from frontend');
    response = await save({ revision: state.revision, agent: { id: state.applicationAssistantId, system: 'stale' } });
    assert.equal(response.status, 400);
    const store = (await ensurePlatformService()).service.store;
    assert.equal(store.getApplicationAssistant('luban').system, 'from frontend');
    assert.equal(store.resolveAgent('assistant', 'draft').system.includes('from frontend'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closePlatformService();
    await closeDb();
  }
});
