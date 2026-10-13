import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { buildLubanRuntimeConfig, LUBAN_TOOL_NAMES } from '../src/agent/runtime-adapter.js';
import { LubanToolProvider } from '../src/agent/tool-provider.js';
import { buildLubanSystemPrompt, runLubanPlatformSession } from '../src/agent/session-adapter.js';
import { prepareLubanToolCalls } from '../src/agent/tool-batch.js';
import { createLubanProductRuntimeAdapter } from '../src/agent/product-runtime-adapter.js';
import { compareDualRuntimeTraces } from '../src/agent/dual-audit.js';
import { completeWithLubanProvider } from '../src/agent/non-chat-provider.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLubanPlatformService } from '../src/agent/platform-service.js';
import { rm } from 'node:fs/promises';
import { resolveLubanAgent } from '../src/agent/agent-resolver.js';

function legacyTool({ name = 'remove_entity', risk = 'high', handler = async (input) => input } = {}) {
  return {
    name,
    risk,
    description: 'test tool',
    schema: { type: 'function', function: { name, description: 'test tool', parameters: {
      type: 'object', properties: { appId: { type: 'string' }, value: { type: 'string' } }, required: ['appId']
    } } },
    handler
  };
}

test('Luban runtime adapter compiles product settings without exposing the secret', () => {
  const config = buildLubanRuntimeConfig({ apiKey: 'must-not-leak', baseUrl: 'https://example.test/v1', model: 'model-x' });
  assert.equal(config.product.id, 'luban');
  assert.equal(config.agent.id, 'luban-app-builder');
  assert.equal(config.model.credential_ref, 'secret:model-default');
  assert.equal(JSON.stringify(config).includes('must-not-leak'), false);
  assert.ok(config.tools.allowed.includes('luban.records.query'));
});

test('Luban reuses the platform Agent and seeds a fallback Agent when explicitly requested Agent is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'luban-agent-'));
  const first = await resolveLubanAgent({ settings: { agentId: 'missing-agent' }, instanceDirectory: directory });
  assert.equal(first.id, 'luban-app-builder');
  assert.equal(first.source, 'agent-platform');
  const second = await resolveLubanAgent({ instanceDirectory: directory });
  assert.equal(second.id, 'luban-app-builder');
  assert.match(await readFile(join(directory, 'instance.yaml'), 'utf8'), /luban-app-builder/);
});

test('Luban Agent package prompt is loaded and legacy tool names are namespaced', () => {
  const prompt = buildLubanSystemPrompt('Use create_app, add_field and query_data.');
  assert.match(prompt, /鲁班应用构建助手/);
  assert.match(prompt, /luban\.app\.create/);
  assert.match(prompt, /luban\.field\.create/);
  assert.match(prompt, /luban\.records\.query/);
  assert.doesNotMatch(prompt, /\bcreate_app\b/);
});

test('Luban Tool Provider namespaces tools, pins current app, and confirms high-risk calls', async () => {
  const seen = [];
  const provider = new LubanToolProvider({
    tools: [legacyTool({ handler: async (input) => { seen.push(input); return { ok: true }; } })],
    appId: 'app-current',
    requestApproval: async ({ name }) => name === 'luban.entity.delete'
  });
  const registry = new ToolRegistry();
  registry.registerProvider(provider);
  const output = await registry.execute({
    callId: 'call-1', name: LUBAN_TOOL_NAMES.remove_entity,
    input: { appId: 'app-from-model', value: 'x' },
    allowedTools: [LUBAN_TOOL_NAMES.remove_entity]
  });
  assert.deepEqual(output, { ok: true });
  assert.equal(seen[0].appId, 'app-current');
});

test('prepareLubanToolCalls merges namespaced add_field calls by entity', () => {
  const merged = prepareLubanToolCalls([
    { id: 'c1', name: 'luban.field.create', arguments: '{"entityId":"e1","id":"f1","label":"A","type":"text"}' },
    { id: 'c2', name: 'luban.field.create', arguments: '{"entityId":"e1","id":"f2","label":"B","type":"text"}' },
    { id: 'c3', name: 'luban.page.create', arguments: '{"title":"Page"}' }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].name, 'luban.field.create');
  const args = JSON.parse(merged[0].arguments);
  assert.equal(args.entityId, 'e1');
  assert.equal(args.fields.length, 2);
});

test('Luban product runtime adapter resolves model credential from settings', async () => {
  const adapter = createLubanProductRuntimeAdapter({ apiKey: 'hidden-key' });
  assert.equal(await adapter.resolveCredential('secret:model-default'), 'hidden-key');
  await assert.rejects(() => adapter.resolveCredential('secret:other'), /Unsupported credential/);
});

test('Luban product runtime adapter translates scheduled events into RunRequest', async () => {
  const adapter = createLubanProductRuntimeAdapter({ apiKey: 'hidden-key' });
  const run = await adapter.createScheduledRun({ app_id: 'app-1', message: '检查今天的记录', request_id: 'schedule-1' });
  assert.deepEqual(run, {
    requestId: 'schedule-1',
    runId: undefined,
    appId: 'app-1',
    pageId: null,
    messages: [{ role: 'user', content: '检查今天的记录' }],
    source: 'schedule'
  });
  await assert.rejects(() => adapter.createScheduledRun({ appId: 'app-1' }), /non-empty prompt/);
});

test('dual runtime audit normalizes legacy and platform tool traces', () => {
  const audit = compareDualRuntimeTraces({
    legacy: [
      { name: 'add_field', arguments: JSON.stringify({ entityId: 'e1', fields: [{ id: 'f1' }, { id: 'f2' }] }), status: 'success' },
      { name: 'remove_entity', arguments: '{"appId":"a1","entityId":"e1"}', confirmation: true, status: 'success' }
    ],
    platform: [
      { name: 'luban.field.create', input: { entityId: 'e1', fields: [{ id: 'f1' }, { id: 'f2' }] }, status: 'success' },
      { name: 'luban.entity.delete', input: { appId: 'a1', entityId: 'e1' }, confirmation: true, status: 'success' }
    ]
  });
  assert.equal(audit.equal, true);
  assert.deepEqual(audit.differences, []);
});

test('dual runtime audit reports order, input, and confirmation differences', () => {
  const audit = compareDualRuntimeTraces({
    legacy: [{ name: 'remove_entity', arguments: '{"entityId":"e1"}', confirmation: true }],
    platform: [{ name: 'luban.entity.delete', input: { entityId: 'e2' }, confirmation: false }]
  });
  assert.equal(audit.equal, false);
  assert.equal(audit.differences[0].legacy.input.entityId, 'e1');
  assert.equal(audit.differences[0].platform.confirmation, false);
});

test('Luban platform session runs the shared RunService with product tools', async t => {
  let turn = 0;
  const provider = { async *stream() {
    if (turn++ === 0) {
      yield { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'luban.records.query', arguments_delta: '{"appId":"wrong"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else {
      yield { type: 'text_delta', delta: '已查询' };
      yield { type: 'finish', reason: 'stop' };
    }
  } };
  const directory = await mkdtemp(join(tmpdir(), 'luban-session-'));
  const runtime = await createLubanPlatformService({ directory, workspaceRoot: join(directory, 'workspace'),
    tools: [], authorizeRequest: () => true, startBackgroundServices: false });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  await runtime.service.store.saveConnection({ id: 'test', provider: 'openai-compatible', model: 'mock-model', apiKey: 'secret' }, 0);
  await resolveLubanAgent({ store: runtime.service.store });
  const agent = runtime.service.store.snapshot().agents.find(item => item.id === 'luban-app-builder');
  await runtime.service.store.saveAgent({ ...agent, ...agent.draft, tools: ['luban.records.query'] }, runtime.service.store.snapshot().revision);
  const events = [];
  const result = await runLubanPlatformSession({
    runtime, request: { requestId: 'req-1', runId: 'run-1', appId: 'app-current' },
    settings: { apiKey: 'secret', model: 'mock-model' },
    system: 'test', messages: [{ role: 'user', content: '查询' }], provider,
    tools: [legacyTool({ name: 'query_data', risk: 'low', handler: async (input) => ({ appId: input.appId }) })],
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.output, '已查询');
  assert.ok(events.some((event) => event.type === 'tool_completed' && event.payload.output.appId === 'app-current'));
  assert.equal(events.at(-1).type, 'run_completed');
});

test('non-chat completions use the shared lifecycle and structured response format', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'luban-completion-'));
  const runtime = await createLubanPlatformService({ directory, workspaceRoot: join(directory, 'workspace'), tools: [], authorizeRequest: () => true, startBackgroundServices: false });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  await runtime.service.store.saveConnection({ id: 'test', provider: 'openai-compatible', model: 'mock-model', apiKey: 'secret' }, 0);
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
  };
  try {
    const output = await completeWithLubanProvider({ apiKey: 'secret', model: 'mock-model' }, {
      runtime, messages: [{ role: 'user', content: 'test' }]
    });
    assert.equal(output, '{"ok":true}');
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    assert.equal(payload.stream, true);
    assert.ok(!payload.tools?.length);
    assert.equal(runtime.service.runs.history('local')[0].source, 'luban-generation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
