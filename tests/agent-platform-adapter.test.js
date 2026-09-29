import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { buildLubanRuntimeConfig, LUBAN_TOOL_NAMES } from '../src/agent/runtime-adapter.js';
import { LubanToolProvider } from '../src/agent/tool-provider.js';
import { buildLubanSystemPrompt, runLubanPlatformSession } from '../src/agent/session-adapter.js';

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

test('Luban platform session runs the shared Agent Loop with product tools', async () => {
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
  const events = [];
  const result = await runLubanPlatformSession({
    request: { requestId: 'req-1', runId: 'run-1', appId: 'app-current' },
    settings: { apiKey: 'secret', model: 'mock-model' },
    system: 'test', messages: [{ role: 'user', content: '查询' }], provider,
    tools: [legacyTool({ name: 'query_data', risk: 'low', handler: async (input) => ({ appId: input.appId }) })],
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.output, '已查询');
  assert.ok(events.some((event) => event.type === 'tool_completed' && event.payload.output.appId === 'app-current'));
  assert.equal(events.at(-1).type, 'run_completed');
});
