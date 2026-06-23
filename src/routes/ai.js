import { getPackageFromApp } from '../storage/db.js';
import { getApp, createAppFromPackage } from '../models/app.js';
import { getRecord } from '../models/record.js';
import { getSetting, getAiSession, createAiSession, listAiSessions, updateAiSession, addAiMessage, addAiExecutionLog } from '../models/session.js';
import { chatCompletionsUrl, generatePlanFromPrompt, planToPackage } from '../ai/service.js';
import { buildPlanningPrompt, describePlan, understandAgentRequest } from '../ai/agent.js';
import { applyPatch, preparePackage } from '../core/packageProtocol.js';
import { getToolDefinitions, getTool, discoverTools } from '../ai/registry.js';
import { readJson } from './_helpers.js';

discoverTools();

const PENDING_CONFIRMS = new Map();

function sseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Read a chunk from a ReadableStream reader with a per-read timeout.
 * If no data arrives within timeoutMs, rejects so the caller can propagate an error.
 * This prevents the AI assistant from hanging silently when the AI provider stalls mid-stream.
 */
function readWithTimeout(reader, timeoutMs = 120_000) {
  const read = reader.read();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AI 响应超时：长时间未收到数据')), timeoutMs)
  );
  return Promise.race([read, timeout]);
}

/**
 * Race a promise against a timeout. If the promise doesn't settle within timeoutMs,
 * rejects with the given error message. Used to prevent tool handlers from hanging.
 */
function withTimeout(promise, timeoutMs, errorMessage) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

async function* streamOpenAI(settings, messages, tools) {
  const payload = {
    model: settings.model || 'gpt-4.1-mini',
    messages,
    tools: tools.length ? tools : undefined,
    stream: true
  };
  const url = chatCompletionsUrl(settings.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AI 请求失败：${response.status} ${text}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await readWithTimeout(reader);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          yield parsed;
        } catch { /* skip malformed chunks */ }
      }
    }
  }
}

function buildMessages(session, userMessage, context = '', app = null) {
  let systemContent = `You are Software Garden's AI assistant. You help users build and manage their apps.

You have access to tools that let you create new apps, modify the app schema, manage pages, and work with data.

Guidelines:
- Always respond in the same language as the user's message
- When users ask to create or modify things, use the appropriate tools instead of just describing what to do
- When the user asks to create a new app and no app is currently open, use create_app exactly once. It already creates the complete tables, fields, pages, and actions; do not follow it with add_entity, add_field, or add_page in the same request.
- Minimize tool calls. Batch same-type changes whenever the tool accepts an array. In particular, add every field for one table with one add_field call using fields[].
- For high-risk operations (creating/deleting entities, fields, pages, records), the system will ask the user to confirm
- After executing tools, summarize what was done
- When the user's request is ambiguous, ask clarifying questions before using tools`;

  if (app) {
    const entityDescs = (app.schema?.entities || []).map((entity) => {
      const fields = (entity.fields || []).map((field) => {
        const opts = field.options ? field.options.map((o) => o.label || o.value || o).join(', ') : '';
        return `  - ${field.label || field.id} (${field.id}): ${field.type}${opts ? ` [options: ${opts}]` : ''}`;
      }).join('\n');
      return `Entity: ${entity.name} (${entity.id})\nFields:\n${fields}`;
    }).join('\n\n');
    systemContent += `\n\n## Current App\nApp ID: ${app.id}\nApp Name: ${app.name}\n\n## App Schema\n${entityDescs || 'No entities yet'}`;
  }

  if (context) {
    systemContent += `\n\n## Current Context\nThe user is currently looking at: ${context}`;
  }

  const msgs = [{ role: 'system', content: systemContent }];
  for (const msg of session.messages || []) {
    msgs.push({ role: msg.role, content: msg.content || '' });
  }
  msgs.push({ role: 'user', content: userMessage });
  return msgs;
}

export async function handleAiApi(req, res, method, parts, url) {
  if (method === 'GET' && parts.length === 3 && parts[2] === 'sessions') {
    const appId = url.searchParams.get('appId') || null;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sessions: listAiSessions({ appId }) }));
    return;
  }

  if (method === 'GET' && parts[2] === 'sessions' && parts[3] && parts.length === 4) {
    const session = getAiSession(parts[3]);
    if (!session) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ session }));
    return;
  }

  if (method === 'POST' && parts.length === 3 && parts[2] === 'chat') {
    const body = await readJson(req);
    const settings = getSetting('ai') || {};
    if (!settings.apiKey) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '请在设置中配置 API Key 后再使用 AI 助理。' }));
      return;
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

    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(keepalive); }
    }, 30000);
    res.on('close', () => clearInterval(keepalive));

    try {
      const tools = getToolDefinitions();
      let messages = buildMessages(getAiSession(session.id), body.message, body.context, app);
      let turnContent = '';

      for (let iteration = 0; iteration < 20; iteration++) {
        const deltaCollector = [];
        let toolCalls = [];

        for await (const chunk of streamOpenAI(settings, messages, tools)) {
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

        toolCalls = mergeBatchableToolCalls(deltaCollector.filter(Boolean));

        if (!toolCalls.length) {
          addAiMessage(session.id, 'assistant', turnContent || '');
          updateAiSession(session.id, { status: 'completed', appId: app?.id || session.appId || null });
          sseEvent(res, 'message_end', { appId: app?.id || session.appId || null });
          clearInterval(keepalive);
          res.end();
          return;
        }

        messages.push({ role: 'assistant', content: turnContent || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) });

        for (const tc of toolCalls) {
          const tool = getTool(tc.function.name);
          if (!tool) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: `Unknown tool: ${tc.function.name}` }) });
            sseEvent(res, 'tool_result', { id: tc.id, status: 'error', output: `Unknown tool: ${tc.function.name}` });
            continue;
          }

          let args;
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          args.appId = body.appId || app?.id;

          if (tool.risk === 'high') {
            const confirmId = `${session.id}:${tc.id}`;
            PENDING_CONFIRMS.set(confirmId, { tool, args, sessionId: session.id, toolCallId: tc.id });
            const entities = app?.schema?.entities || [];
            const resolveName = (id) => {
              const e = entities.find((e) => e.id === id);
              if (e) return e.name;
              for (const e of entities) {
                const f = e.fields?.find((f) => f.id === id);
                if (f) return f.label || f.id;
              }
              return id;
            };
            const friendlyArgs = {};
            for (const [key, value] of Object.entries(args)) {
              if (key === 'appId') { friendlyArgs[key] = value; continue; }
              if (key === 'entityId' || key === 'sourceEntityId' || key === 'targetEntityId') {
                friendlyArgs[key] = resolveName(value);
              } else if (key === 'fieldId') {
                friendlyArgs[key] = resolveName(value);
              } else {
                friendlyArgs[key] = value;
              }
            }
            sseEvent(res, 'tool_confirm', {
              id: tc.id,
              name: tc.function.name,
              arguments: args,
              friendlyArgs,
              confirmId,
              display: buildToolDisplayInfo(tc.function.name, args, app)
            });

            const confirmResult = await waitForConfirm(confirmId);
            PENDING_CONFIRMS.delete(confirmId);
            if (!confirmResult) {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'User rejected this operation' }) });
              sseEvent(res, 'tool_result', { id: tc.id, status: 'rejected', output: '用户已拒绝' });
              continue;
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
              120_000,
              `工具 ${tc.function.name} 执行超时（120秒）`
            );
            addAiExecutionLog(session.id, `执行 ${tc.function.name}`, 'success', { toolName: tc.function.name, output: result });
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
            const resultAppId = result?.appId || result?.id || args.appId;
            if (resultAppId) {
              const refreshed = getApp(resultAppId);
              if (refreshed) {
                app = refreshed;
                updateAiSession(session.id, { appId: refreshed.id });
              }
            }
            sseEvent(res, 'tool_result', {
              id: tc.id,
              status: 'success',
              output: result,
              display: buildToolDisplayInfo(tc.function.name, args, app, result)
            });
          } catch (error) {
            addAiExecutionLog(session.id, `执行 ${tc.function.name}`, 'failed', { toolName: tc.function.name, error: error.message });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: error.message }) });
            sseEvent(res, 'tool_result', { id: tc.id, status: 'error', output: error.message });
          }
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
    return;
  }

  if (method === 'POST' && parts[2] === 'chat' && parts[3] === 'confirm') {
    const body = await readJson(req);
    const confirmId = body.confirmId;
    if (!confirmId || !PENDING_CONFIRMS.has(confirmId)) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '确认请求不存在或已超时。' }));
      return;
    }
    PENDING_CONFIRMS.get(confirmId).resolve?.(body.confirmed !== false);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'POST' && parts.length === 3 && parts[2] === 'plan') {
    res.setHeader('x-deprecated', 'true');
    const body = await readJson(req);
    const app = body.appId ? getApp(body.appId) : null;
    const session = body.sessionId ? getAiSession(body.sessionId) : createAiSession({ appId: app?.id || null, status: 'understanding' });
    if (!session) { res.writeHead(404); res.end('{}'); return; }
    updateAiSession(session.id, { appId: app?.id || session.appId || null, status: 'understanding' });
    addAiMessage(session.id, 'user', body.prompt || '');
    const freshSession = getAiSession(session.id);
    const agentTurn = understandAgentRequest(body.prompt || '', { app, session: freshSession });
    addAiExecutionLog(session.id, '理解用户意图', 'success', { output: { intent: agentTurn.intent, state: agentTurn.state } });
    addAiExecutionLog(session.id, '读取上下文', 'success', { output: agentTurn.context });
    if (agentTurn.clarification.required) {
      addAiMessage(session.id, 'assistant', agentTurn.clarification.questions.join('\n'), { type: 'clarification', intent: agentTurn.intent, questions: agentTurn.clarification.questions });
      const nextSession = updateAiSession(session.id, { status: 'clarifying', currentPlan: null });
      sendJson(res, 200, { session: nextSession, state: 'CLARIFY', intent: agentTurn.intent, clarification: agentTurn.clarification, context: agentTurn.context });
      return;
    }
    updateAiSession(session.id, { status: 'planning' });
    addAiExecutionLog(session.id, '生成执行方案', 'running', { input: { intent: agentTurn.intent } });
    const settings = getSetting('ai') || {};
    const planningPrompt = buildPlanningPrompt(body.prompt || '', { app, session: getAiSession(session.id), intent: agentTurn.intent, context: agentTurn.context });
    const plan = await generatePlanFromPrompt(planningPrompt, settings, app ? getPackageFromApp(app) : null);
    addAiExecutionLog(session.id, '生成执行方案', 'success', { output: { summary: describePlan(plan) } });
    addAiMessage(session.id, 'assistant', describePlan(plan), plan);
    const nextSession = updateAiSession(session.id, { status: 'waiting_confirmation', currentPlan: plan });
    sendJson(res, 200, { session: nextSession, state: 'CONFIRM', intent: agentTurn.intent, plan, context: agentTurn.context });
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'revise') {
    res.setHeader('x-deprecated', 'true');
    const body = await readJson(req);
    const session = getAiSession(parts[3]);
    if (!session) { res.writeHead(404); res.end('{}'); return; }
    const app = session.appId ? getApp(session.appId) : null;
    addAiMessage(session.id, 'user', body.prompt || '');
    updateAiSession(session.id, { status: 'planning' });
    addAiExecutionLog(session.id, '按用户修改意见重新规划', 'running', { input: { previousPlan: session.currentPlan, revision: body.prompt || '' } });
    const prompt = buildPlanningPrompt(JSON.stringify({ previousPlan: session.currentPlan, revision: body.prompt || '' }), { app, session: getAiSession(session.id), intent: 'ModifySchema' });
    const plan = await generatePlanFromPrompt(prompt, getSetting('ai') || {}, app ? getPackageFromApp(app) : null);
    addAiExecutionLog(session.id, '按用户修改意见重新规划', 'success', { output: { summary: describePlan(plan) } });
    addAiMessage(session.id, 'assistant', describePlan(plan), plan);
    sendJson(res, 200, { session: updateAiSession(session.id, { status: 'waiting_confirmation', currentPlan: plan }), plan });
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'execute') {
    res.setHeader('x-deprecated', 'true');
    const session = getAiSession(parts[3]);
    if (!session) { res.writeHead(404); res.end('{}'); return; }
    if (session.status !== 'waiting_confirmation') { res.writeHead(409); res.end(JSON.stringify({ error: 'AI 会话尚未等待确认。' })); return; }
    const result = executeLegacyPlan(session);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'cancel') {
    res.setHeader('x-deprecated', 'true');
    const session = getAiSession(parts[3]);
    if (!session) { res.writeHead(404); res.end('{}'); return; }
    addAiExecutionLog(session.id, '用户取消执行', 'cancelled');
    sendJson(res, 200, { session: updateAiSession(session.id, { status: 'cancelled' }) });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'AI API 不存在。' }));
}

export function mergeBatchableToolCalls(toolCalls) {
  const merged = [];
  const addFieldGroups = new Map();
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name !== 'add_field') {
      merged.push(toolCall);
      continue;
    }
    let args;
    try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch { args = {}; }
    const key = String(args.entityId || '');
    if (!key) {
      merged.push(toolCall);
      continue;
    }
    const fields = Array.isArray(args.fields) && args.fields.length
      ? args.fields
      : [{ id: args.id, label: args.label, type: args.type, options: args.options, required: args.required, formula: args.formula }];
    const existing = addFieldGroups.get(key);
    if (existing) {
      existing.args.fields.push(...fields);
      existing.toolCall.function.arguments = JSON.stringify(existing.args);
      continue;
    }
    const mergedArgs = { appId: args.appId, entityId: args.entityId, fields };
    const mergedCall = { ...toolCall, function: { ...toolCall.function, arguments: JSON.stringify(mergedArgs) } };
    addFieldGroups.set(key, { toolCall: mergedCall, args: mergedArgs });
    merged.push(mergedCall);
  }
  return merged;
}

export function buildToolDisplayInfo(toolName, args = {}, app = null, result = null) {
  const labels = {
    create_app: '创建应用', add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
    add_page: '添加页面', add_view: '添加视图', add_record: '添加记录', add_action: '添加操作', update_entity: '修改表',
    update_field: '修改字段', update_record: '修改记录', remove_entity: '删除表',
    remove_field: '删除字段', remove_page: '删除页面', delete_record: '删除记录',
    query_data: '查询数据', design_form: '设计表单', create_view: '创建视图'
  };
  const entities = app?.schema?.entities || [];
  const entityId = args.entityId || args.sourceEntityId || '';
  const entity = entities.find((item) => item.id === entityId);
  const targetEntity = entities.find((item) => item.id === args.targetEntityId);
  const field = entity?.fields?.find((item) => item.id === args.fieldId);
  const fieldLabels = Array.isArray(args.fields)
    ? args.fields.map((item) => item?.label || item?.name || item?.id).filter(Boolean)
    : [args.label || field?.label].filter(Boolean);
  const details = [];
  const appName = result?.name || app?.name;
  if (appName) details.push(appName);
  if (entity?.name) details.push(entity.name);
  if (targetEntity?.name && targetEntity.id !== entity?.id) details.push(`关联 ${targetEntity.name}`);
  if (fieldLabels.length) details.push(fieldLabels.join('、'));
  else if (args.title || args.name) details.push(args.title || args.name);
  return { title: labels[toolName] || toolName, detail: details.join(' · ') };
}

function executeLegacyPlan(session) {
  updateAiSession(session.id, { status: 'executing' });
  addAiExecutionLog(session.id, '开始执行方案', 'running', { input: session.currentPlan });
  try {
    let app;
    if (session.currentPlan.type === 'app_creation_plan') {
      addAiExecutionLog(session.id, '创建应用软件包', 'running', { toolName: 'create_app' });
      const pkg = planToPackage(session.currentPlan);
      app = createAppFromPackage_legacy(pkg);
      addAiExecutionLog(session.id, '创建应用软件包', 'success', { output: { appId: app.id } });
    } else if (session.currentPlan.type === 'app_modification_plan') {
      app = getApp(session.appId);
      if (!app) throw new Error('找不到要修改的应用。');
      addAiExecutionLog(session.id, '应用 Patch', 'running', { toolName: 'apply_patch', input: session.currentPlan.patch });
      const nextPackage = applyPatch(getPackageFromApp(app), session.currentPlan.patch);
      app = updateAppPackage(app.id, nextPackage);
      addAiExecutionLog(session.id, '应用 Patch', 'success', { output: { appId: app.id } });
    } else {
      throw new Error(`不支持的 AI 方案类型：${session.currentPlan.type}`);
    }
    addAiExecutionLog(session.id, '执行完成', 'success');
    const nextSession = updateAiSession(session.id, { status: 'completed', appId: app.id });
    return { session: nextSession, appId: app.id, app, logs: nextSession.logs };
  } catch (error) {
    addAiExecutionLog(session.id, '执行失败', 'failed', { error: error.message });
    const failed = updateAiSession(session.id, { status: 'failed' });
    return { session: failed, error: error.message, logs: failed.logs };
  }
}

function createAppFromPackage_legacy(pkg) {
  return createAppFromPackage(pkg);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function waitForConfirm(confirmId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 60000);
    PENDING_CONFIRMS.set(confirmId, {
      ...PENDING_CONFIRMS.get(confirmId),
      resolve: (value) => { clearTimeout(timeout); resolve(value); }
    });
  });
}
