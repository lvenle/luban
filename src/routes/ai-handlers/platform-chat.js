import { randomUUID } from 'node:crypto';
import { getApp } from '../../models/app.js';
import {
  getSetting, getAiSession, createAiSession, updateAiSession,
  addAiMessage, addAiExecutionLog
} from '../../models/session.js';
import { getTools } from '../../ai/registry.js';
import { readJson } from '../_helpers.js';
import { buildMessages } from '../../services/ai/message-builder.js';
import { buildToolDisplayInfo } from '../../services/ai/tool-display.js';
import { runLubanPlatformSession } from '../../agent/session-adapter.js';
import { LUBAN_TOOL_NAMES } from '../../agent/runtime-adapter.js';
import { PENDING_CONFIRMS, waitForConfirm, rejectPendingConfirmsForSession } from './confirm-state.js';

const legacyByPlatformName = Object.fromEntries(
  Object.entries(LUBAN_TOOL_NAMES).map(([legacy, platform]) => [platform, legacy])
);

function sseEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function handlePlatformChat(req, res, method, parts) {
  if (method !== 'POST' || parts.length !== 3 || parts[2] !== 'platform-chat') return false;
  const body = await readJson(req);
  const settings = getSetting('ai') || {};
  if (!settings.apiKey) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请在设置中配置 API Key 后再使用 AI 助理。' }));
    return true;
  }

  let app = body.appId ? getApp(body.appId) : null;
  const session = (body.sessionId && getAiSession(body.sessionId)) || createAiSession({
    appId: app?.id || null, status: 'idle', type: app ? 'modify' : 'create'
  });
  const built = buildMessages(getAiSession(session.id), body.message, body.context, app);
  const system = built[0]?.role === 'system' ? built.shift().content : '';
  updateAiSession(session.id, { appId: app?.id || session.appId || null, status: 'running' });
  addAiMessage(session.id, 'user', body.message || '');

  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache',
    connection: 'keep-alive', 'x-accel-buffering': 'no'
  });
  sseEvent(res, 'session_id', { sessionId: session.id, runtime: 'agent-platform' });

  const controller = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) controller.abort(new Error('客户端已断开'));
    rejectPendingConfirmsForSession(session.id);
  });
  let content = '';
  try {
    const tools = getTools();
    if (!tools.length) throw new Error('鲁班工具尚未完成注册');
    const result = await runLubanPlatformSession({
      request: {
        requestId: `req_${randomUUID()}`,
        runId: `run_${randomUUID()}`,
        appId: app?.id || null,
        pageId: body.pageId || null
      },
      settings, messages: built, system, tools, signal: controller.signal,
      requestApproval: async ({ callId, name, input, signal }) => {
        const confirmId = `${session.id}:${callId}`;
        const legacyName = legacyByPlatformName[name] || name;
        PENDING_CONFIRMS.set(confirmId, { sessionId: session.id, toolCallId: callId });
        sseEvent(res, 'tool_confirm', {
          id: callId, name, arguments: input, confirmId,
          display: buildToolDisplayInfo(legacyName, input, app)
        });
        if (signal.aborted) return false;
        const allowed = await waitForConfirm(confirmId);
        PENDING_CONFIRMS.delete(confirmId);
        return allowed;
      },
      onExecution: (event) => addAiExecutionLog(
        session.id,
        `执行 ${event.legacyName}`,
        event.status,
        { toolName: event.name, input: event.input, output: event.output, error: event.error }
      ),
      onEvent: (event) => {
        if (event.type === 'text_delta') {
          content += event.payload.delta;
          sseEvent(res, 'content_delta', { content: event.payload.delta });
        } else if (event.type === 'tool_started') {
          const legacyName = legacyByPlatformName[event.payload.name] || event.payload.name;
          sseEvent(res, 'tool_use', {
            id: event.payload.call_id, name: event.payload.name,
            arguments: event.payload.input,
            display: buildToolDisplayInfo(legacyName, event.payload.input, app)
          });
        } else if (event.type === 'tool_completed') {
          sseEvent(res, 'tool_result', {
            id: event.payload.call_id,
            status: event.payload.error ? 'error' : 'success',
            output: event.payload.error || event.payload.output
          });
        }
      }
    });
    addAiMessage(session.id, 'assistant', content || result.output || '');
    const createdAppId = [...result.messages].reverse().find((message) =>
      message.role === 'tool' && message.content?.includes('"appId"')
    );
    if (createdAppId) {
      try { app = getApp(JSON.parse(createdAppId.content).appId) || app; } catch {}
    }
    updateAiSession(session.id, { status: 'completed', appId: app?.id || session.appId || null });
    sseEvent(res, 'message_end', { appId: app?.id || session.appId || null, runtime: 'agent-platform' });
  } catch (error) {
    updateAiSession(session.id, { status: controller.signal.aborted ? 'cancelled' : 'failed' });
    addAiExecutionLog(session.id, '统一 Runtime 对话出错', 'failed', { error: error.message });
    sseEvent(res, 'error', { message: error.message, runtime: 'agent-platform' });
  } finally {
    finished = true;
    rejectPendingConfirmsForSession(session.id);
    try { res.end(); } catch {}
  }
  return true;
}
