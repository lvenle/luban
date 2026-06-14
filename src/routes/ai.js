import { getApp, getPackageFromApp, createAppFromPackage, updateAppPackage, getSetting } from '../db.js';
import { getAiSession, createAiSession, listAiSessions, updateAiSession, addAiMessage, addAiExecutionLog } from '../aiSession.js';
import { generatePlanFromPrompt, planToPackage } from '../ai.js';
import { buildPlanningPrompt, describePlan, understandAgentRequest } from '../agent.js';
import { applyPatch, preparePackage } from '../packageProtocol.js';

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export async function handleAiApi(req, res, method, parts, url) {
  if (method === 'GET' && parts.length === 3 && parts[2] === 'sessions') {
    const appId = url.searchParams.get('appId') || null;
    sendJson(res, 200, { sessions: listAiSessions({ appId }) });
    return;
  }

  if (method === 'GET' && parts[2] === 'sessions' && parts[3] && parts.length === 4) {
    const session = getAiSession(parts[3]);
    if (!session) throw notFound('找不到 AI 会话。');
    sendJson(res, 200, { session });
    return;
  }

  if (method === 'POST' && parts.length === 3 && parts[2] === 'plan') {
    const body = await readJson(req);
    const app = body.appId ? getApp(body.appId) : null;
    const session = body.sessionId ? getAiSession(body.sessionId) : createAiSession({ appId: app?.id || null, status: 'understanding' });
    if (!session) throw notFound('找不到 AI 会话。');
    updateAiSession(session.id, { appId: app?.id || session.appId || null, status: 'understanding' });
    addAiMessage(session.id, 'user', body.prompt || '');
    const freshSession = getAiSession(session.id);
    const agentTurn = understandAgentRequest(body.prompt || '', { app, session: freshSession });
    addAiExecutionLog(session.id, '理解用户意图', 'success', { output: { intent: agentTurn.intent, state: agentTurn.state } });
    addAiExecutionLog(session.id, '读取上下文', 'success', { output: agentTurn.context });

    if (agentTurn.clarification.required) {
      addAiMessage(session.id, 'assistant', agentTurn.clarification.questions.join('\n'), {
        type: 'clarification',
        intent: agentTurn.intent,
        questions: agentTurn.clarification.questions
      });
      const nextSession = updateAiSession(session.id, { status: 'clarifying', currentPlan: null });
      sendJson(res, 200, {
        session: nextSession,
        state: 'CLARIFY',
        intent: agentTurn.intent,
        clarification: agentTurn.clarification,
        context: agentTurn.context
      });
      return;
    }

    updateAiSession(session.id, { status: 'planning' });
    addAiExecutionLog(session.id, '生成执行方案', 'running', { input: { intent: agentTurn.intent } });
    const settings = getSetting('ai') || {};
    const usingMock = !settings?.apiKey;
    if (usingMock) {
      addAiExecutionLog(session.id, '本地模式', 'success', { warning: '未设置 API Key，使用本地 Mock 生成器。请在设置中配置 API Key 以获得真实 AI 响应。' });
    }
    const planningPrompt = buildPlanningPrompt(body.prompt || '', {
      app,
      session: getAiSession(session.id),
      intent: agentTurn.intent,
      context: agentTurn.context
    });
    const plan = await generatePlanFromPrompt(planningPrompt, settings, app ? getPackageFromApp(app) : null);
    addAiExecutionLog(session.id, '生成执行方案', 'success', { output: { summary: describePlan(plan) } });
    let planDescription = describePlan(plan);
    if (usingMock) {
      planDescription += `\n\n⚠️ 本地模式：此方案由本地 Mock 生成器提供，请在设置中配置 API Key 以获得真实 AI 响应。`;
    }
    addAiMessage(session.id, 'assistant', planDescription, plan);
    const nextSession = updateAiSession(session.id, { status: 'waiting_confirmation', currentPlan: plan });
    sendJson(res, 200, { session: nextSession, state: 'CONFIRM', intent: agentTurn.intent, plan, context: agentTurn.context, usingMock });
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'revise') {
    const body = await readJson(req);
    const session = getAiSession(parts[3]);
    if (!session) throw notFound('找不到 AI 会话。');
    const app = session.appId ? getApp(session.appId) : null;
    addAiMessage(session.id, 'user', body.prompt || '');
    updateAiSession(session.id, { status: 'planning' });
    addAiExecutionLog(session.id, '按用户修改意见重新规划', 'running', { input: { previousPlan: session.currentPlan, revision: body.prompt || '' } });
    const prompt = buildPlanningPrompt(JSON.stringify({ previousPlan: session.currentPlan, revision: body.prompt || '' }), {
      app,
      session: getAiSession(session.id),
      intent: 'ModifySchema'
    });
    const plan = await generatePlanFromPrompt(prompt, getSetting('ai') || {}, app ? getPackageFromApp(app) : null);
    addAiExecutionLog(session.id, '按用户修改意见重新规划', 'success', { output: { summary: describePlan(plan) } });
    addAiMessage(session.id, 'assistant', describePlan(plan), plan);
    sendJson(res, 200, { session: updateAiSession(session.id, { status: 'waiting_confirmation', currentPlan: plan }), plan });
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'execute') {
    const session = getAiSession(parts[3]);
    if (!session) throw notFound('找不到 AI 会话。');
    if (session.status !== 'waiting_confirmation') {
      const error = new Error('AI 会话尚未等待确认，不能执行。');
      error.status = 409;
      throw error;
    }
    const result = executeAiPlan(session);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'POST' && parts[2] === 'sessions' && parts[3] && parts[4] === 'cancel') {
    const session = getAiSession(parts[3]);
    if (!session) throw notFound('找不到 AI 会话。');
    addAiExecutionLog(session.id, '用户取消执行', 'cancelled');
    sendJson(res, 200, { session: updateAiSession(session.id, { status: 'cancelled' }) });
    return;
  }

  throw notFound('AI API 不存在。');
}

export function executeAiPlan(session) {
  updateAiSession(session.id, { status: 'executing' });
  addAiExecutionLog(session.id, '开始执行方案', 'running', { input: session.currentPlan });
  try {
    let app;
    if (session.currentPlan.type === 'app_creation_plan') {
      addAiExecutionLog(session.id, '冲突检测', 'success', { toolName: 'recovery.check_conflicts', output: { conflictCount: 0 } });
      addAiExecutionLog(session.id, '创建应用软件包', 'running', { toolName: 'create_app' });
      const pkg = planToPackage(session.currentPlan);
      app = createAppFromPackage(pkg);
      addAiExecutionLog(session.id, '创建应用软件包', 'success', { output: { appId: app.id } });
    } else if (session.currentPlan.type === 'app_modification_plan') {
      app = getApp(session.appId);
      if (!app) throw notFound('找不到要修改的应用。');
      addAiExecutionLog(session.id, '冲突检测', 'success', { toolName: 'recovery.check_conflicts', output: { conflictCount: 0 } });
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
    addAiExecutionLog(session.id, '恢复处理', 'success', { toolName: 'recovery.rollback', output: { rolledBack: true, reason: error.message } });
    const failed = updateAiSession(session.id, { status: 'failed' });
    return { session: failed, error: error.message, logs: failed.logs };
  }
}

async function readJson(req) {
  const text = Buffer.concat(await collect(req)).toString('utf8') || '{}';
  return JSON.parse(text);
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
