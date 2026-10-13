import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLubanPlatformService } from '../src/agent/platform-service.js';
import { resolveLubanAgent } from '../src/agent/agent-resolver.js';
import { runLubanPlatformSession } from '../src/agent/session-adapter.js';
import { completeWithLubanProvider } from '../src/agent/non-chat-provider.js';
import { waitForConfirm, PENDING_CONFIRMS } from '../src/routes/ai-handlers/confirm-state.js';

const queryTool = (handler = async input => input) => ({
  name: 'query_data', risk: 'low', description: '读取应用数据',
  schema: { function: { parameters: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] } } }, handler
});
async function fixture(t, { tools = [queryTool()], ...options } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'luban-shared-'));
  const runtime = await createLubanPlatformService({ directory, workspaceRoot: join(directory, 'workspace'), tools,
    authorizeRequest: () => true, startBackgroundServices: false,
    providerFactory: () => ({ async *stream() { yield { type: 'text_delta', delta: '{}' }; } }), ...options });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const store = runtime.service.store;
  await store.saveConnection({ id: 'test', provider: 'openai-compatible', model: 'test', apiKey: 'fixture-secret', params: { temperature: 0.2 } }, 0);
  await resolveLubanAgent({ store });
  const update = async changes => {
    const agent = store.snapshot().agents.find(item => item.id === 'luban-app-builder');
    await store.saveAgent({ ...agent, ...agent.draft, ...changes }, store.snapshot().revision);
  };
  await update({ tools: tools.map(tool => ({ query_data: 'luban.records.query', remove_entity: 'luban.entity.delete' })[tool.name]) });
  return { runtime, store, update, tools };
}
function lookupProvider() {
  return { async *stream({ messages }) {
    const result = messages.find(message => message.role === 'tool');
    if (!result) {
      yield { type: 'tool_call_delta', index: 0, id: 'same-call-id', name: 'luban.records.query', arguments_delta: '{"appId":"model-selected"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else yield { type: 'text_delta', delta: result.content };
  } };
}

test('parallel product runs pin app context and map product sessions independently', async t => {
  const { runtime, tools } = await fixture(t);
  const execute = appId => runLubanPlatformSession({ runtime, tools, settings: {},
    request: { requestId: appId, sessionId: appId, appId }, messages: [{ role: 'user', content: appId }], provider: lookupProvider() });
  const [a, b] = await Promise.all([execute('app-a'), execute('app-b')]);
  assert.equal(JSON.parse(a.output).appId, 'app-a');
  assert.equal(JSON.parse(b.output).appId, 'app-b');
  assert.notEqual(a.sessionId, b.sessionId);
  const again = await execute('app-a');
  assert.equal(again.sessionId, a.sessionId);
  assert.equal(runtime.service.runs.history('local').length, 3);
});

test('saved prompt, model params and limits apply without being overwritten by product resolution', async t => {
  const { runtime, tools, store, update } = await fixture(t);
  await update({ system: '用户保存的鲁班指令', maxTurns: 1, timeoutMs: 1000, params: { temperature: 0.7 } });
  const agent = await resolveLubanAgent({ store });
  assert.equal(agent.system, '用户保存的鲁班指令');
  let received;
  const provider = { async *stream(request) { received = request; yield* lookupProvider().stream(request); } };
  await assert.rejects(runLubanPlatformSession({ runtime, tools, request: { requestId: 'limits', appId: 'a' },
    messages: [{ role: 'user', content: '查询' }], provider }), /max turns/);
  assert.match(received.system, /用户保存的鲁班指令/);
  assert.equal(received.temperature, 0.7);
  const history = runtime.service.runs.history('local');
  const start = runtime.service.runs.events(history[0].runId)[0];
  assert.equal(start.payload.agent_snapshot.maxTurns, 1);
  assert.equal(start.payload.agent_snapshot.timeoutMs, 1000);
  assert.equal(history[0].status, 'run_failed');
});

test('bound skill and knowledge use the same RunService and persist source events', async t => {
  const { runtime, update, tools } = await fixture(t);
  await runtime.service.skills.createDraft('luban-help', { description: '鲁班辅助技能' });
  await runtime.service.skills.publish('luban-help', 'v1.0');
  const library = runtime.service.knowledge.save({ name: '鲁班资料' });
  runtime.service.knowledge.import(library.id, { title: '客户字段', content: '客户表必须记录跟进日期。' });
  const built = await runtime.service.knowledge.build(library.id);
  await update({ skills: [{ id: 'luban-help', version: 'v1.0' }], knowledge: [library.id] });
  const provider = { async *stream({ system, messages, tools: capabilities }) {
    assert.match(system, /客户表必须记录跟进日期/);
    assert.ok(capabilities.some(tool => tool.name === 'platform.skills.read'));
    if (!messages.some(message => message.role === 'tool')) {
      yield { type: 'tool_call_delta', index: 0, id: 'skill-read', name: 'platform.skills.read', arguments_delta: '{"id":"luban-help"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else yield { type: 'text_delta', delta: '已读取技能和知识。[1]' };
  } };
  const result = await runLubanPlatformSession({ runtime, tools, request: { requestId: 'knowledge' }, messages: [{ role: 'user', content: '客户字段' }], provider });
  const events = runtime.service.runs.events(result.runId);
  assert.ok(events.some(event => event.type === 'skill_loaded'));
  assert.equal(result.sources[0].version, built.version);
  assert.ok(events.some(event => event.type === 'knowledge_sources'));
});

test('high-risk rejection never executes the business operation', async t => {
  let executed = 0;
  const tool = { ...queryTool(), name: 'remove_entity', risk: 'high', handler: async () => { executed++; } };
  const { runtime, tools } = await fixture(t, { tools: [tool] });
  let confirmations = 0;
  const provider = { async *stream({ messages }) {
    if (!messages.some(message => message.role === 'tool')) {
      yield { type: 'tool_call_delta', index: 0, id: 'delete', name: 'luban.entity.delete', arguments_delta: '{"appId":"wrong"}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else yield { type: 'text_delta', delta: '操作未执行' };
  } };
  await runLubanPlatformSession({ runtime, tools, request: { requestId: 'deny', appId: 'a' }, messages: [], provider,
    requestApproval: async input => { confirmations++; assert.equal(input.input.appId, 'a'); return false; } });
  assert.equal(confirmations, 1);
  assert.equal(executed, 0);
});

test('cancellation clears pending UI confirmation and creates exactly one terminal event', async t => {
  const { runtime, tools } = await fixture(t);
  const controller = new AbortController();
  const pending = waitForConfirm('cancel-test:tool', controller.signal);
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(PENDING_CONFIRMS.has('cancel-test:tool'), false);
  const runController = new AbortController();
  const events = [];
  const result = runLubanPlatformSession({ runtime, tools, request: { requestId: 'cancel' }, messages: [],
    signal: runController.signal, provider: { async *stream() { await new Promise(() => {}); } },
    onEvent: event => { events.push(event); if (event.type === 'run_started') runController.abort(); } });
  await assert.rejects(result, /cancelled/);
  assert.deepEqual(events.filter(event => /^run_(completed|failed|cancelled)$/.test(event.type)).map(event => event.type), ['run_cancelled']);
});

test('product policy rejects unapproved tools even when bound in Agent config', async t => {
  const { runtime, tools, update } = await fixture(t);
  runtime.service.tools.register({ name: 'runtime.exec', inputSchema: {}, execute: () => assert.fail('must not execute') });
  await update({ tools: ['runtime.exec'] });
  await assert.rejects(runLubanPlatformSession({ runtime, tools, request: { requestId: 'policy' }, messages: [], provider: lookupProvider() }), /product policy/);
});

test('runtime uses an owned random port and guards console HTML and management APIs', async t => {
  const { runtime } = await fixture(t, { authorizeRequest: req => req.headers['x-test-host'] === 'authorized' });
  assert.notEqual(new URL(runtime.url).port, '5190');
  assert.equal((await fetch(runtime.url)).status, 403);
  assert.equal((await fetch(runtime.url + '/api/agent/v1/instance')).status, 403);
  const response = await fetch(runtime.url + '/api/agent/v1/instance', { headers: { 'x-test-host': 'authorized' } });
  const snapshot = await response.json();
  assert.equal(snapshot.productId, 'luban');
  assert.equal(JSON.stringify(snapshot).includes('fixture-secret'), false);
});

test('answer-only generation disables skill and business tools at the provider boundary', async t => {
  const { runtime, update } = await fixture(t, { providerFactory: () => ({ async *stream({ tools, responseFormat }) {
    assert.equal(tools.length, 0);
    assert.deepEqual(responseFormat, { type: 'json_object' });
    yield { type: 'text_delta', delta: '{"ok":true}' };
  } }) });
  await runtime.service.skills.createDraft('help', { description: 'help' });
  await runtime.service.skills.publish('help', 'v1.0');
  await update({ skills: [{ id: 'help', version: 'v1.0' }] });
  assert.equal(await completeWithLubanProvider({}, { runtime, messages: [] }), '{"ok":true}');
});

test('disabling a business tool in the base also disables its scoped product implementation', async t => {
  let executed = 0;
  const { runtime, tools } = await fixture(t, { tools: [queryTool(async () => { executed++; })] });
  runtime.service.tools.setEnabled('luban.records.query', false);
  await runLubanPlatformSession({ runtime, tools, request: { requestId: 'disabled', appId: 'a' }, messages: [], provider: lookupProvider() });
  assert.equal(executed, 0);
});

test('Agent timeout bounds a stalled model and shutdown cancels active product runs', async t => {
  const { runtime, tools, update } = await fixture(t);
  await update({ timeoutMs: 1000 });
  const stalled = { async *stream() { await new Promise(() => {}); } };
  await assert.rejects(runLubanPlatformSession({ runtime, tools, request: { requestId: 'timeout' }, messages: [], provider: stalled }), /timed out/);
  assert.equal(runtime.service.runs.history('local')[0].status, 'run_cancelled');
  const pending = runLubanPlatformSession({ runtime, tools, request: { requestId: 'shutdown' }, messages: [], provider: stalled,
    onEvent: event => { if (event.type === 'run_started') runtime.service.runs.history('local'); } });
  // Wait for the model entry before closing the host, without relying on a timed sleep.
  const cancelRun = pending.catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  // Closing the host also drains runs submitted through the SDK entry point.
  await runtime.close();
  assert.match((await cancelRun).message, /cancelled/);
});
