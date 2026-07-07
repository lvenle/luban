import { getApp } from '../../models/app.js';
import { getSetting, getAiSession, createAiSession, updateAiSession, addAiMessage, addAiExecutionLog } from '../../models/session.js';
import { getToolDefinitions, getTool } from '../../ai/registry.js';
import { getRuntimeSettings } from '../../models/runtime-settings.js';
import { readJson } from '../_helpers.js';
import { buildMessages } from '../../services/ai/message-builder.js';
import { streamOpenAI, withTimeout } from '../../services/ai/stream-openai.js';
import { buildToolDisplayInfo, mergeBatchableToolCalls } from '../../services/ai/tool-display.js';
import { PENDING_CONFIRMS, rejectPendingConfirmsForSession, waitForConfirm } from './confirm-state.js';

const activeSSEConnections = new Map();
const activeStreamReaders = new Map();

function sseEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // ignore writes to destroyed streams
  }
}

function friendlyToolArgs(args, app) {
  const entities = app?.schema?.entities || [];
  const resolveName = (id) => {
    const entity = entities.find((item) => item.id === id);
    if (entity) return entity.name;
    for (const entityItem of entities) {
      const field = entityItem.fields?.find((item) => item.id === id);
      if (field) return field.label || field.id;
    }
    return id;
  };
  const friendlyArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'appId') { friendlyArgs[key] = value; continue; }
    if (key === 'entityId' || key === 'sourceEntityId' || key === 'targetEntityId' || key === 'fieldId') {
      friendlyArgs[key] = resolveName(value);
    } else {
      friendlyArgs[key] = value;
    }
  }
  return friendlyArgs;
}

function bindSseLifecycle(res, sessionId, keepalive, onClosed) {
  let closed = false;
  res.on('close', () => {
    clearInterval(keepalive);
    closed = true;
    if (activeStreamReaders.get(sessionId)) {
      activeStreamReaders.get(sessionId).abort();
      activeStreamReaders.delete(sessionId);
    }
    if (activeSSEConnections.get(sessionId)?.res === res) {
      activeSSEConnections.delete(sessionId);
    }
    rejectPendingConfirmsForSession(sessionId);
    onClosed();
  });
  return () => closed;
}

async function runToolCall({ tc, body, app, session, messages, res }) {
  const tool = getTool(tc.function.name);
  if (!tool) {
    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }) });
    sseEvent(res, 'tool_result', { id: tc.id, status: 'error', output: `Unknown tool: ${tc.function.name}` });
    return app;
  }

  let args;
  try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
  args.appId = body.appId || app?.id;
  if (body.pageId) args.pageId = body.pageId;

  if (tool.risk === 'high') {
    const confirmId = `${session.id}:${tc.id}`;
    PENDING_CONFIRMS.set(confirmId, { tool, args, sessionId: session.id, toolCallId: tc.id });
    sseEvent(res, 'tool_confirm', {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
      friendlyArgs: friendlyToolArgs(args, app),
      confirmId,
      display: buildToolDisplayInfo(tc.function.name, args, app)
    });

    const confirmResult = await waitForConfirm(confirmId);
    PENDING_CONFIRMS.delete(confirmId);
    if (!confirmResult) {
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'User rejected this operation' }) });
      sseEvent(res, 'tool_result', { id: tc.id, status: 'rejected', output: '用户已拒绝' });
      return app;
    }
  }

  sseEvent(res, 'tool_use', {
    id: tc.id,
    name: tc.function.name,
    arguments: args,
    display: buildToolDisplayInfo(tc.function.name, args, app)
  });

  try {
    addAiExecutionLog(session.id, `执行 ${tc.function.name}`, 'running', { toolName: tc.function.name, input: args });
    const result = await withTimeout(
      tool.handler(args, { app, session: getAiSession(session.id) }),
      getRuntimeSettings().aiStreamReadTimeoutMs,
      `工具 ${tc.function.name} 执行超时`
    );
    addAiExecutionLog(session.id, `执行 ${tc.function.name}`, 'success', { toolName: tc.function.name, output: result });
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
    const resultAppId = result?.appId || result?.id || args.appId;
    let nextApp = app;
    if (resultAppId) {
      const refreshed = getApp(resultAppId);
      if (refreshed) {
        nextApp = refreshed;
        updateAiSession(session.id, { appId: refreshed.id });
      }
    }
    sseEvent(res, 'tool_result', {
      id: tc.id,
      status: 'success',
      output: result,
      display: buildToolDisplayInfo(tc.function.name, args, nextApp, result)
    });
    return nextApp;
  } catch (error) {
    addAiExecutionLog(session.id, `执行 ${tc.function.name}`, 'failed', { toolName: tc.function.name, error: error.message });
    messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: error.message }) });
    sseEvent(res, 'tool_result', { id: tc.id, status: 'error', output: error.message });
    return app;
  }
}

export async function handleChat(req, res, method, parts) {
  if (method !== 'POST' || parts.length !== 3 || parts[2] !== 'chat') return false;

  const body = await readJson(req);
  const settings = getSetting('ai') || {};
  if (!settings.apiKey) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请在设置中配置 API Key 后再使用 AI 助理。' }));
    return true;
  }

  let app = body.appId ? getApp(body.appId) : null;
  const isCreateSession = !body.appId;
  const session = (body.sessionId && getAiSession(body.sessionId)) || createAiSession({ appId: app?.id || null, status: 'idle', type: isCreateSession ? 'create' : 'modify' });
  updateAiSession(session.id, { appId: app?.id || session.appId || null });
  addAiMessage(session.id, 'user', body.message || '');

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });

  sseEvent(res, 'session_id', { sessionId: session.id });

  const existingSSE = activeSSEConnections.get(session.id);
  if (existingSSE) {
    try { existingSSE.res.end(); } catch {}
  }
  activeSSEConnections.set(session.id, { res, sessionId: session.id });

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(keepalive); }
  }, 30000);
  let sseClosed = false;
  const isClosed = bindSseLifecycle(res, session.id, keepalive, () => { sseClosed = true; });

  try {
    const tools = getToolDefinitions();
    let messages = buildMessages(getAiSession(session.id), body.message, body.context, app);
    let turnContent = '';
    const streamAbort = new AbortController();
    activeStreamReaders.set(session.id, streamAbort);

    for (let iteration = 0; iteration < 20; iteration++) {
      const deltaCollector = [];
      let toolCalls = [];

      for await (const chunk of streamOpenAI(settings, messages, tools, streamAbort.signal)) {
        if (isClosed()) break;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          turnContent += delta.content;
          sseEvent(res, 'content_delta', { content: delta.content });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!deltaCollector[tc.index]) deltaCollector[tc.index] = { id: tc.id || '', function: { name: '', arguments: '' } };
              if (tc.id) deltaCollector[tc.index].id = tc.id;
              if (tc.function?.name) deltaCollector[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) deltaCollector[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (isClosed()) break;
      toolCalls = mergeBatchableToolCalls(deltaCollector.filter(Boolean));

      if (!toolCalls.length) {
        addAiMessage(session.id, 'assistant', turnContent || '');
        updateAiSession(session.id, { status: 'completed', appId: app?.id || session.appId || null });
        sseEvent(res, 'message_end', { appId: app?.id || session.appId || null });
        clearInterval(keepalive);
        res.end();
        return true;
      }

      messages.push({ role: 'assistant', content: turnContent || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) });
      if (turnContent) addAiMessage(session.id, 'assistant', turnContent);

      for (const tc of toolCalls) {
        app = await runToolCall({ tc, body, app, session, messages, res });
      }

      turnContent = '';
    }

    addAiMessage(session.id, 'assistant', turnContent || '已达到最大迭代次数');
    sseEvent(res, 'message_end', { error: 'max_iterations', appId: app?.id || session.appId || null });
  } catch (error) {
    sseEvent(res, 'error', { message: error.message });
    addAiExecutionLog(session.id, '对话出错', 'failed', { error: error.message });
  }

  clearInterval(keepalive);
  try { res.end(); } catch {}
  activeStreamReaders.delete(session.id);
  return true;
}
