import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import {
  createAppFromPackage,
  createRecord,
  addAiExecutionLog,
  addAiMessage,
  createAiSession,
  deleteApp,
  deleteRecord,
  exportAppPayload,
  getAiSession,
  getApp,
  getDb,
  getPackageFromApp,
  getRecordRelations,
  getSetting,
  importAppPayload,
  listRelationOptions,
  listApps,
  listRecords,
  setSetting,
  updateAiSession,
  updateAppMetadata,
  updateAppPackage,
  updateRecordRelations,
  updateRecord
} from './db.js';
import { generatePackageFromPrompt, generatePatchFromPrompt, generatePlanFromPrompt, planToPackage } from './ai.js';
import { buildPlanningPrompt, describePlan, understandAgentRequest } from './agent.js';
import { applyPatch, preparePackage } from './packageProtocol.js';
import { normalizeFieldId } from './ids.js';
import { runAction, toCsv } from './actions.js';
import { packageToZipPayload, zipPayloadToPackage } from './zip.js';
import { recordsToXlsx } from './xlsx.js';

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = join(process.cwd(), 'public');
const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith('/uploads/')) {
        serveUpload(res, url.pathname);
        return;
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, statusForError(error), { error: error.message, details: error.details || undefined });
    }
  });
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/apps') {
    sendJson(res, 200, { apps: listApps() });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/apps/generate') {
    const body = await readJson(req);
    const logs = ['收到创建需求', '读取 AI 配置', '生成软件包 JSON'];
    const settings = getSetting('ai') || {};
    const pkg = preparePackage(await generatePackageFromPrompt(body.prompt, settings));
    logs.push('软件包协议校验通过');
    const app = createAppFromPackage(pkg);
    logs.push('软件已安装到本地 SQLite');
    sendJson(res, 201, { appId: app.id, app, logs });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/apps/import') {
    const contentType = req.headers['content-type'] || '';
    let payload;
    if (contentType.includes('application/octet-stream')) {
      const buffer = await readBuffer(req);
      payload = zipPayloadToPackage(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    } else {
      payload = (await readJson(req)).package;
    }
    const app = importAppPayload(payload);
    sendJson(res, 201, { appId: app.id, app });
    return;
  }

  if (parts[1] === 'ai') {
    await handleAiApi(req, res, method, parts);
    return;
  }

  if (parts[1] === 'settings') {
    if (method === 'GET') {
      sendJson(res, 200, { ai: getSetting('ai') || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' } });
      return;
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      sendJson(res, 200, { ai: setSetting('ai', body.ai || {}) });
      return;
    }
  }

  if (parts[1] === 'apps' && parts[2]) {
    const appId = parts[2];
    const app = getApp(appId);
    if (!app) throw notFound('找不到应用。');

    if (method === 'GET' && parts.length === 3) {
      sendJson(res, 200, { app });
      return;
    }

    if (method === 'POST' && parts[3] === 'uploads') {
      const file = await saveUploadedFile(req, appId, url);
      sendJson(res, 201, { file });
      return;
    }

    if (method === 'DELETE' && parts.length === 3) {
      deleteApp(appId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'PUT' && parts.length === 3) {
      const body = await readJson(req);
      const nextApp = updateAppMetadata(appId, body);
      sendJson(res, 200, { app: nextApp });
      return;
    }

    if (method === 'PUT' && parts[3] === 'package') {
      const body = await readJson(req);
      const nextApp = updateAppPackage(appId, body.package);
      sendJson(res, 200, { app: nextApp });
      return;
    }

    if (parts[3] === 'tables') {
      await handleTablesApi(req, res, method, parts, app);
      return;
    }

    if (parts[3] === 'fields' && parts[4] && parts[5]) {
      const entityId = parts[4];
      const fieldId = parts[5];
      if (method === 'GET' && parts[6] === 'relation-options') {
        sendJson(res, 200, { options: listRelationOptions(appId, entityId, fieldId, url.searchParams.get('keyword') || '') });
        return;
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        sendJson(res, 200, { app: updateFieldInApp(app, entityId, fieldId, body.field || body) });
        return;
      }
      if (method === 'DELETE') {
        sendJson(res, 200, { app: deleteFieldInApp(app, entityId, fieldId) });
        return;
      }
    }

    if (method === 'POST' && parts[3] === 'modify') {
      const body = await readJson(req);
      const logs = ['收到修改需求', '读取当前软件包', '生成 Patch'];
      const settings = getSetting('ai') || {};
      const patch = await generatePatchFromPrompt(body.prompt, getPackageFromApp(app), settings);
      logs.push(`Patch 包含 ${patch.operations?.length || 0} 个操作`);
      const nextPackage = applyPatch(getPackageFromApp(app), patch);
      logs.push('Patch 应用并重新校验通过');
      const nextApp = updateAppPackage(appId, nextPackage);
      logs.push('软件新版本已保存');
      sendJson(res, 200, { summary: patch.summary || '已修改软件。', patch, app: nextApp, logs });
      return;
    }

    if (method === 'GET' && parts[3] === 'records') {
      sendJson(res, 200, { records: listRecords(appId, { entityId: url.searchParams.get('entity'), q: url.searchParams.get('q') }) });
      return;
    }

    if (method === 'POST' && parts[3] === 'records') {
      const body = await readJson(req);
      const entityId = body.entityId || app.schema.entities[0]?.id;
      sendJson(res, 201, { record: createRecord(appId, entityId, body.data || {}) });
      return;
    }

    if (method === 'PUT' && parts[3] === 'records' && parts[4]) {
      const body = await readJson(req);
      sendJson(res, 200, { record: updateRecord(parts[4], body.data || {}) });
      return;
    }

    if (method === 'DELETE' && parts[3] === 'records' && parts[4]) {
      deleteRecord(parts[4], { force: url.searchParams.get('force') === 'true' });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (parts[3] === 'records' && parts[4] && parts[5] === 'relations' && parts[6]) {
      if (method === 'GET') {
        sendJson(res, 200, { relations: getRecordRelations(parts[4], parts[6]) });
        return;
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        sendJson(res, 200, { relations: updateRecordRelations(parts[4], parts[6], body.targetRecordIds || []) });
        return;
      }
    }

    if (method === 'GET' && parts[3] === 'export.csv') {
      const records = listRecords(appId, { entityId: url.searchParams.get('entity') || undefined });
      const entity = app.schema.entities.find((item) => item.id === (url.searchParams.get('entity') || undefined));
      sendText(res, 200, toCsv(records, entity), 'text/csv; charset=utf-8', `${app.slug}.csv`);
      return;
    }

    if (method === 'GET' && parts[3] === 'export.xlsx') {
      const entityId = url.searchParams.get('entity') || undefined;
      const entity = app.schema.entities.find((item) => item.id === entityId) || app.schema.entities[0];
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean));
      const records = listRecords(appId, { entityId }).filter((record) => !ids.size || ids.has(record.id));
      const xlsx = recordsToXlsx(records, entity);
      sendBinary(res, 200, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${app.slug}.xlsx`);
      return;
    }

    if (method === 'GET' && parts[3] === 'export') {
      const payload = exportAppPayload(appId, url.searchParams.get('data') || 'structure');
      const zip = packageToZipPayload(payload);
      sendBinary(res, 200, zip, 'application/octet-stream', `${app.slug}.sgpkg`);
      return;
    }

    if (method === 'POST' && parts[3] === 'actions' && parts[4] && parts[5] === 'run') {
      sendJson(res, 200, await runAction(app, parts[4]));
      return;
    }
  }

  throw notFound('API 不存在。');
}

async function handleAiApi(req, res, method, parts) {
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

function executeAiPlan(session) {
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

async function handleTablesApi(req, res, method, parts, app) {
  if (method === 'GET' && parts.length === 4) {
    sendJson(res, 200, { tables: app.schema.entities });
    return;
  }
  if (method === 'POST' && parts.length === 4) {
    const body = await readJson(req);
    sendJson(res, 201, { app: createTableInApp(app, body) });
    return;
  }
  const entityId = parts[4];
  if (!entityId) throw notFound('表 API 不存在。');
  if (method === 'PATCH') {
    const body = await readJson(req);
    sendJson(res, 200, { app: updateTableInApp(app, entityId, body) });
    return;
  }
  if (method === 'DELETE') {
    sendJson(res, 200, { app: deleteTableInApp(app, entityId) });
    return;
  }
  if (parts[5] === 'fields') {
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到表。');
    if (method === 'GET') {
      sendJson(res, 200, { fields: entity.fields || [] });
      return;
    }
    if (method === 'POST') {
      const body = await readJson(req);
      sendJson(res, 201, { app: createFieldInApp(app, entityId, body.field || body) });
      return;
    }
  }
  throw notFound('表 API 不存在。');
}

function createTableInApp(app, body = {}) {
  const pkg = getPackageFromApp(app);
  const name = String(body.name || '').trim();
  if (!name) throw badRequest('表名不能为空。');
  const entityId = uniqueEntityId(pkg, body.id || name);
  pkg.schema.entities.push({
    id: entityId,
    name,
    description: body.description || '',
    fields: [{ id: 'name', label: '名称', type: 'text', required: true }]
  });
  pkg.ui.pages.push({ id: `${entityId}-list`, title: `${name}列表`, type: 'list', entity: entityId, features: ['create', 'edit', 'delete', 'search', 'export'] });
  return updateAppPackage(app.id, pkg);
}

function updateTableInApp(app, entityId, body = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if (body.name) entity.name = String(body.name).trim();
  if (body.description !== undefined) entity.description = String(body.description || '');
  for (const page of pkg.ui.pages.filter((item) => item.entity === entityId && body.name)) page.title = `${entity.name}列表`;
  return updateAppPackage(app.id, pkg);
}

function deleteTableInApp(app, entityId) {
  const references = app.schema.entities.flatMap((entity) =>
    (entity.fields || []).filter((field) => field.type === 'relation' && field.targetEntity === entityId).map((field) => `${entity.name}.${field.label}`)
  );
  if (references.length) {
    const error = new Error(`当前表被关联字段引用：${references.join('、')}`);
    error.status = 409;
    error.details = { references };
    throw error;
  }
  const pkg = getPackageFromApp(app);
  pkg.schema.entities = pkg.schema.entities.filter((entity) => entity.id !== entityId);
  pkg.ui.pages = pkg.ui.pages.filter((page) => page.entity !== entityId);
  getDb().prepare('DELETE FROM records WHERE appId = ? AND entityId = ?').run(app.id, entityId);
  return updateAppPackage(app.id, pkg);
}

function createFieldInApp(app, entityId, field = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  const label = String(field.label || field.name || '').trim();
  if (!label) throw badRequest('字段名不能为空。');
  const id = uniqueFieldId(entity, field.id || label);
  entity.fields.push({ ...field, id, label });
  return updateAppPackage(app.id, pkg);
}

function updateFieldInApp(app, entityId, fieldId, patch = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  const field = entity?.fields?.find((item) => item.id === fieldId);
  if (!field) throw notFound('找不到字段。');
  Object.assign(field, patch);
  return updateAppPackage(app.id, pkg);
}

function deleteFieldInApp(app, entityId, fieldId) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  entity.fields = entity.fields.filter((field) => field.id !== fieldId);
  getDb().prepare('DELETE FROM record_relations WHERE appId = ? AND sourceEntityId = ? AND fieldId = ?').run(app.id, entityId, fieldId);
  return updateAppPackage(app.id, pkg);
}

function uniqueEntityId(pkg, base) {
  const existing = new Set(pkg.schema.entities.map((entity) => entity.id));
  let id = normalizeFieldId(base, 'table');
  let index = 2;
  while (existing.has(id)) {
    id = `${normalizeFieldId(base, 'table')}_${index}`;
    index += 1;
  }
  return id;
}

function uniqueFieldId(entity, base) {
  const existing = new Set((entity.fields || []).map((field) => field.id));
  let id = normalizeFieldId(base, 'field');
  let index = 2;
  while (existing.has(id)) {
    id = `${normalizeFieldId(base, 'field')}_${index}`;
    index += 1;
  }
  return id;
}

async function saveUploadedFile(req, appId, url) {
  const originalName = safeOriginalName(url.searchParams.get('name') || req.headers['x-file-name'] || 'upload.bin');
  const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const bytes = await readBuffer(req);
  const appUploadDir = join(UPLOAD_DIR, appId);
  mkdirSync(appUploadDir, { recursive: true });
  const extension = safeExtension(originalName, mimeType);
  const storedName = `${randomUUID()}${extension}`;
  const filePath = join(appUploadDir, storedName);
  writeFileSync(filePath, bytes);
  return {
    name: originalName,
    url: `/uploads/${encodeURIComponent(appId)}/${encodeURIComponent(storedName)}`,
    mimeType,
    size: bytes.length
  };
}

function safeOriginalName(name) {
  return basename(String(name || 'upload.bin')).replace(/[^\w.\-\u4e00-\u9fa5 ]/g, '_').slice(0, 180) || 'upload.bin';
}

function safeExtension(name, mimeType) {
  const extension = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/.test(extension)) return extension;
  const mimeExtensions = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
  };
  return mimeExtensions[mimeType] || '.bin';
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

function serveUpload(res, pathname) {
  const requested = decodeURIComponent(pathname.replace(/^\/uploads\//, ''));
  const filePath = normalize(join(UPLOAD_DIR, requested));
  if (!filePath.startsWith(UPLOAD_DIR) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable'
  });
  res.end(readFileSync(filePath));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType, downloadName) {
  const headers = { 'content-type': contentType };
  if (downloadName) headers['content-disposition'] = `attachment; filename="${downloadName}"`;
  res.writeHead(status, headers);
  res.end(text);
}

function sendBinary(res, status, bytes, contentType, downloadName) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${downloadName}"`
  });
  res.end(Buffer.from(bytes));
}

async function readJson(req) {
  const text = Buffer.concat(await collect(req)).toString('utf8') || '{}';
  return JSON.parse(text);
}

async function readBuffer(req) {
  return Buffer.concat(await collect(req));
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function statusForError(error) {
  return error.status || (error.name === 'SyntaxError' ? 400 : 500);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAppServer().listen(PORT, () => {
    console.log(`Software Garden MVP running at http://localhost:${PORT}`);
  });
}
