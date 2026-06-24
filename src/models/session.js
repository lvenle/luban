import { getDb } from '../storage/db.js';
import { createId } from '../core/ids.js';
import { notFound } from '../routes/_helpers.js';

function now() {
  return new Date().toISOString();
}

export function createAiSession({ appId = null, status = 'idle', currentPlan = null, type = 'create' } = {}) {
  const id = createId('ais');
  const createdAt = now();
  getDb()
    .prepare('INSERT INTO ai_sessions (id, appId, status, currentPlanJson, type, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, appId, status, currentPlan ? JSON.stringify(currentPlan) : null, type, createdAt, createdAt);
  return getAiSession(id);
}

export function getAiSession(id) {
  const row = getDb().prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    status: row.status,
    type: row.type || 'create',
    currentPlan: row.currentPlanJson ? JSON.parse(row.currentPlanJson) : null,
    messages: getDb()
      .prepare('SELECT * FROM ai_messages WHERE sessionId = ? ORDER BY createdAt ASC')
      .all(row.id)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        structuredContent: message.structuredContentJson ? JSON.parse(message.structuredContentJson) : null,
        createdAt: message.createdAt
      })),
    logs: getDb()
      .prepare('SELECT * FROM ai_execution_logs WHERE sessionId = ? ORDER BY createdAt ASC')
      .all(row.id)
      .map((log) => ({
        id: log.id,
        stepName: log.stepName,
        toolName: log.toolName,
        status: log.status,
        input: log.inputJson ? JSON.parse(log.inputJson) : null,
        output: log.outputJson ? JSON.parse(log.outputJson) : null,
        error: log.error,
        createdAt: log.createdAt
      })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listAiSessions({ appId = null, limit = 20 } = {}) {
  const database = getDb();
  const rows = appId
    ? database
        .prepare('SELECT * FROM ai_sessions WHERE appId = ? ORDER BY updatedAt DESC LIMIT ?')
        .all(appId, limit)
    : database
        .prepare("SELECT * FROM ai_sessions WHERE type = 'create' ORDER BY updatedAt DESC LIMIT ?")
        .all(limit);
  return rows.map((row) => {
    const message = database
      .prepare('SELECT content, role FROM ai_messages WHERE sessionId = ? AND role = ? ORDER BY createdAt ASC LIMIT 1')
      .get(row.id, 'user');
    const messageCount = database
      .prepare('SELECT COUNT(*) AS count FROM ai_messages WHERE sessionId = ?')
      .get(row.id)?.count || 0;
    return {
      id: row.id,
      appId: row.appId,
      status: row.status,
      type: row.type || 'create',
      currentPlan: row.currentPlanJson ? JSON.parse(row.currentPlanJson) : null,
      messageCount,
      preview: message?.content || '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  });
}

export function updateAiSession(id, patch = {}) {
  const existing = getAiSession(id);
  if (!existing) throw notFound('找不到 AI 会话。');
  const status = patch.status || existing.status;
  const appId = patch.appId === undefined ? existing.appId : patch.appId;
  const currentPlan = patch.currentPlan === undefined ? existing.currentPlan : patch.currentPlan;
  const type = patch.type || existing.type;
  getDb()
    .prepare('UPDATE ai_sessions SET appId = ?, status = ?, currentPlanJson = ?, type = ?, updatedAt = ? WHERE id = ?')
    .run(appId, status, currentPlan ? JSON.stringify(currentPlan) : null, type, now(), id);
  return getAiSession(id);
}

export function addAiMessage(sessionId, role, content, structuredContent = null) {
  getDb()
    .prepare('INSERT INTO ai_messages (id, sessionId, role, content, structuredContentJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(createId('aim'), sessionId, role, content || '', structuredContent ? JSON.stringify(structuredContent) : null, now());
}

export function clearAiSessions(appId, excludeSessionId) {
  const database = getDb();
  const excludeSql = excludeSessionId ? ' AND id != ?' : '';
  const excludeParams = excludeSessionId ? [excludeSessionId] : [];
  if (appId) {
    database.prepare(`DELETE FROM ai_execution_logs WHERE sessionId IN (SELECT id FROM ai_sessions WHERE appId = ?${excludeSql})`).run(appId, ...excludeParams);
    database.prepare(`DELETE FROM ai_messages WHERE sessionId IN (SELECT id FROM ai_sessions WHERE appId = ?${excludeSql})`).run(appId, ...excludeParams);
    const result = database.prepare(`DELETE FROM ai_sessions WHERE appId = ?${excludeSql}`).run(appId, ...excludeParams);
    return { deletedCount: result.changes };
  }
  database.prepare(`DELETE FROM ai_execution_logs WHERE sessionId IN (SELECT id FROM ai_sessions WHERE type = 'create'${excludeSql})`).run(...excludeParams);
  database.prepare(`DELETE FROM ai_messages WHERE sessionId IN (SELECT id FROM ai_sessions WHERE type = 'create'${excludeSql})`).run(...excludeParams);
  const result = database.prepare(`DELETE FROM ai_sessions WHERE type = 'create'${excludeSql}`).run(...excludeParams);
  return { deletedCount: result.changes };
}

export function addAiExecutionLog(sessionId, stepName, status, options = {}) {
  getDb()
    .prepare(`
      INSERT INTO ai_execution_logs (id, sessionId, stepName, toolName, status, inputJson, outputJson, error, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      createId('ail'),
      sessionId,
      stepName,
      options.toolName || '',
      status,
      options.input ? JSON.stringify(options.input) : null,
      options.output ? JSON.stringify(options.output) : null,
      options.error || null,
      now()
    );
}

export function getSetting(key) {
  const row = getDb().prepare('SELECT valueJson FROM settings WHERE key = ?').get(key);
  const stored = row ? JSON.parse(row.valueJson) : null;

  // AI settings: environment variables override DB-stored values.
  // This allows Render (or any Docker/CI deployment) to configure the AI provider
  // without relying on the SQLite database, which is ephemeral on Render.
  if (key === 'ai') {
    const envOverrides = {};
    if (process.env.AI_API_KEY) envOverrides.apiKey = process.env.AI_API_KEY;
    if (process.env.AI_BASE_URL) envOverrides.baseUrl = process.env.AI_BASE_URL;
    if (process.env.AI_MODEL) envOverrides.model = process.env.AI_MODEL;
    if (Object.keys(envOverrides).length) {
      return { ...(stored || {}), ...envOverrides };
    }
  }

  return stored;
}

export function setSetting(key, value) {
  getDb()
    .prepare(`
      INSERT INTO settings (key, valueJson, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt
    `)
    .run(key, JSON.stringify(value), now());
  return value;
}
