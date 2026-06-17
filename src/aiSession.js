import { createId } from './ids.js';
import { getDb } from './db.js';

function now() {
  return new Date().toISOString();
}

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export function createAiSession({ appId = null, status = 'idle', currentPlan = null } = {}) {
  const id = createId('ais');
  const createdAt = now();
  getDb()
    .prepare('INSERT INTO ai_sessions (id, appId, status, currentPlanJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, status, currentPlan ? JSON.stringify(currentPlan) : null, createdAt, createdAt);
  return getAiSession(id);
}

export function getAiSession(id) {
  const row = getDb().prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    status: row.status,
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
        .prepare('SELECT * FROM ai_sessions WHERE appId IS NULL ORDER BY updatedAt DESC LIMIT ?')
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
  if (!existing) throw notFoundError('找不到 AI 会话。');
  const status = patch.status || existing.status;
  const appId = patch.appId === undefined ? existing.appId : patch.appId;
  const currentPlan = patch.currentPlan === undefined ? existing.currentPlan : patch.currentPlan;
  getDb()
    .prepare('UPDATE ai_sessions SET appId = ?, status = ?, currentPlanJson = ?, updatedAt = ? WHERE id = ?')
    .run(appId, status, currentPlan ? JSON.stringify(currentPlan) : null, now(), id);
  return getAiSession(id);
}

export function addAiMessage(sessionId, role, content, structuredContent = null) {
  getDb()
    .prepare('INSERT INTO ai_messages (id, sessionId, role, content, structuredContentJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(createId('aim'), sessionId, role, content || '', structuredContent ? JSON.stringify(structuredContent) : null, now());
}

export function clearAiSessions(appId) {
  const database = getDb();
  const sessions = appId
    ? database.prepare('SELECT id FROM ai_sessions WHERE appId = ?').all(appId)
    : database.prepare('SELECT id FROM ai_sessions WHERE appId IS NULL').all();
  const ids = sessions.map((s) => s.id);
  if (!ids.length) return { deletedCount: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const result = database.prepare(`DELETE FROM ai_sessions WHERE id IN (${placeholders})`).run(...ids);
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
