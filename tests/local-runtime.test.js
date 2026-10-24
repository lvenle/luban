import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLubanPlatformService } from '../src/agent/platform-service.js';
import { resolveLubanAgent } from '../src/agent/agent-resolver.js';
import { runLubanPlatformSession } from '../src/agent/session-adapter.js';
import { completeWithLubanProvider } from '../src/agent/non-chat-provider.js';

async function fixture(t, providerFactory) {
  const directory = await mkdtemp(join(tmpdir(), 'luban-local-runtime-'));
  const runtime = await createLubanPlatformService({ edition: 'local', directory, workspaceRoot: join(directory, 'workspace'), tools: [], providerFactory });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const store = runtime.service.store;
  await store.saveConnection({ id: 'test', provider: 'openai-compatible', model: 'local-model', apiKey: 'test-secret', params: { temperature: 0.3 } }, 0);
  const assistant = await resolveLubanAgent({ store });
  await store.saveAgent({ ...assistant, tools: [] }, store.snapshot().revision);
  return { runtime, store };
}
test('local Luban executes scoped business tools and reuses sessions without a platform port', async t => {
  const { runtime, store } = await fixture(t);
  const assistant = store.resolveAgent('luban-app-builder', 'draft');
  await store.saveAgent({ ...assistant, tools: ['luban.records.query'] }, store.snapshot().revision);
  assert.equal(runtime.url, null);
  assert.equal(runtime.server, undefined);
  assert.equal(runtime.service.scheduler, undefined);
  const tools = [{ name: 'query_data', risk: 'low', description: '查询', schema: { function: { parameters: { type: 'object', properties: { appId: { type: 'string' } } } } }, handler: async input => input }];
  const provider = { async *stream({ messages, temperature }) {
    assert.equal(temperature, 0.3);
    if (!messages.some(message => message.role === 'tool')) {
      yield { type: 'tool_call_delta', index: 0, id: 'query', name: 'luban.records.query', arguments_delta: '{"appId":"wrong"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else yield { type: 'text_delta', delta: messages.find(message => message.role === 'tool').content };
  } };
  const execute = () => runLubanPlatformSession({ runtime, tools, provider, request: { requestId: 'local', sessionId: 'existing', appId: 'pinned' }, messages: [{ role: 'user', content: '查询' }] });
  const first = await execute(), second = await execute();
  assert.equal(JSON.parse(first.output).appId, 'pinned');
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(runtime.service.runs.history('local').length, 2);
  assert.equal(store.getApplicationAssistant('luban').id, 'luban-app-builder');
});
test('local answer-only generation uses shared model configuration and disables tools', async t => {
  const { runtime } = await fixture(t, () => ({ async *stream({ model, tools, responseFormat }) {
    assert.equal(model, 'local-model');
    assert.equal(tools.length, 0);
    assert.deepEqual(responseFormat, { type: 'json_object' });
    yield { type: 'text_delta', delta: '{"ok":true}' };
  } }));
  assert.equal(await completeWithLubanProvider({}, { runtime, messages: [] }), '{"ok":true}');
});
test('local bound skills retain their shared loading and audit behavior', async t => {
  const { runtime, store } = await fixture(t);
  await runtime.service.skills.createDraft('local-help', { description: '本地技能' });
  await runtime.service.skills.publish('local-help', 'v1.0');
  const agent = store.resolveAgent('luban-app-builder', 'draft');
  await store.saveAgent({ ...agent, skills: [{ id: 'local-help', version: 'v1.0' }] }, store.snapshot().revision);
  const result = await runLubanPlatformSession({ runtime, tools: [], request: { requestId: 'skill' }, messages: [], provider: { async *stream({ messages, tools }) {
    assert.ok(tools.some(tool => tool.name === 'platform.skills.read'));
    if (!messages.some(message => message.role === 'tool')) {
      yield { type: 'tool_call_delta', index: 0, id: 'skill', name: 'platform.skills.read', arguments_delta: '{"id":"local-help"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else yield { type: 'text_delta', delta: 'done' };
  } } });
  assert.ok(runtime.service.runs.events(result.runId).some(event => event.type === 'skill_loaded'));
});
