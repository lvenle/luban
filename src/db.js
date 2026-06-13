import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createId, slugify } from './ids.js';
import { preparePackage } from './packageProtocol.js';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

let db;

export function getDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
  }
  return db;
}

export function resetDbForTests(path) {
  if (db) db.close();
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      manifestJson TEXT NOT NULL,
      schemaJson TEXT NOT NULL,
      uiJson TEXT NOT NULL,
      actionsJson TEXT NOT NULL,
      promptsJson TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      appId TEXT NOT NULL,
      entityId TEXT NOT NULL,
      dataJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS record_relations (
      id TEXT PRIMARY KEY,
      appId TEXT NOT NULL,
      sourceEntityId TEXT NOT NULL,
      sourceRecordId TEXT NOT NULL,
      fieldId TEXT NOT NULL,
      targetEntityId TEXT NOT NULL,
      targetRecordId TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      UNIQUE(sourceRecordId, fieldId, targetRecordId),
      FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (sourceRecordId) REFERENCES records(id) ON DELETE CASCADE,
      FOREIGN KEY (targetRecordId) REFERENCES records(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_record_relations_source ON record_relations(sourceRecordId, fieldId);
    CREATE INDEX IF NOT EXISTS idx_record_relations_target ON record_relations(targetRecordId);
    CREATE INDEX IF NOT EXISTS idx_record_relations_app ON record_relations(appId);

    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      appId TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      currentPlanJson TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (appId) REFERENCES apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      structuredContentJson TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(sessionId);

    CREATE TABLE IF NOT EXISTS ai_execution_logs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      stepName TEXT NOT NULL,
      toolName TEXT,
      status TEXT NOT NULL,
      inputJson TEXT,
      outputJson TEXT,
      error TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_logs_session ON ai_execution_logs(sessionId);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      appId TEXT,
      title TEXT,
      messagesJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      valueJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

function now() {
  return new Date().toISOString();
}

function rowToApp(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    manifest: JSON.parse(row.manifestJson),
    schema: JSON.parse(row.schemaJson),
    ui: JSON.parse(row.uiJson),
    actions: JSON.parse(row.actionsJson),
    prompts: row.promptsJson ? JSON.parse(row.promptsJson) : undefined,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function appToPackage(app) {
  return {
    manifest: app.manifest,
    schema: app.schema,
    ui: app.ui,
    actions: app.actions,
    prompts: app.prompts || {}
  };
}

export function getPackageFromApp(app) {
  return appToPackage(app);
}

export function uniqueSlug(baseSlug) {
  const database = getDb();
  const base = slugify(baseSlug, 'app');
  let candidate = base;
  let index = 2;
  while (database.prepare('SELECT id FROM apps WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createAppFromPackage(pkg, options = {}) {
  const database = getDb();
  const clean = preparePackage(pkg);
  const id = createId('app');
  const createdAt = now();
  const slug = uniqueSlug(options.slug || clean.manifest.id || clean.manifest.name);
  database.prepare(`
    INSERT INTO apps (
      id, slug, name, description, icon, manifestJson, schemaJson, uiJson,
      actionsJson, promptsJson, version, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    slug,
    clean.manifest.name,
    clean.manifest.description || '',
    clean.manifest.icon || '',
    JSON.stringify(clean.manifest),
    JSON.stringify(clean.schema),
    JSON.stringify(clean.ui),
    JSON.stringify(clean.actions),
    JSON.stringify(clean.prompts || {}),
    clean.manifest.version || '1.0.0',
    createdAt,
    createdAt
  );
  return getApp(id);
}

export function updateAppPackage(appId, pkg) {
  const database = getDb();
  const clean = preparePackage(pkg);
  const updatedAt = now();
  database.prepare(`
    UPDATE apps SET
      name = ?, description = ?, icon = ?, manifestJson = ?, schemaJson = ?,
      uiJson = ?, actionsJson = ?, promptsJson = ?, version = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    clean.manifest.name,
    clean.manifest.description || '',
    clean.manifest.icon || '',
    JSON.stringify(clean.manifest),
    JSON.stringify(clean.schema),
    JSON.stringify(clean.ui),
    JSON.stringify(clean.actions),
    JSON.stringify(clean.prompts || {}),
    clean.manifest.version || '1.0.0',
    updatedAt,
    appId
  );
  return getApp(appId);
}

export function updateAppMetadata(appId, metadata = {}) {
  const app = getApp(appId);
  if (!app) return null;
  const pkg = appToPackage(app);
  const name = String(metadata.name || '').trim();
  const category = String(metadata.category || '').trim();
  const description = metadata.description === undefined ? null : String(metadata.description || '').trim();
  if (name) pkg.manifest.name = name;
  if (category) pkg.manifest.category = category;
  if (description !== null) pkg.manifest.description = description;
  return updateAppPackage(appId, pkg);
}

export function listApps() {
  return getDb()
    .prepare('SELECT * FROM apps ORDER BY updatedAt DESC')
    .all()
    .map(rowToApp);
}

export function getApp(id) {
  return rowToApp(getDb().prepare('SELECT * FROM apps WHERE id = ?').get(id));
}

export function deleteApp(id) {
  return getDb().prepare('DELETE FROM apps WHERE id = ?').run(id).changes > 0;
}

export function listRecords(appId, options = {}) {
  const rows = getDb()
    .prepare('SELECT * FROM records WHERE appId = ? ORDER BY createdAt ASC, rowid ASC')
    .all(appId);
  let records = rows.map((row) => ({
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  if (options.entityId) records = records.filter((record) => record.entityId === options.entityId);
  if (options.q) {
    const q = String(options.q).toLowerCase();
    records = records.filter((record) => JSON.stringify(record.data).toLowerCase().includes(q));
  }
  return options.hydrateRelations === false ? records : hydrateRelationValues(appId, records);
}

export function createRecord(appId, entityId, data) {
  const app = getApp(appId);
  const { data: cleanData, relations } = splitRelationData(app, entityId, data);
  const id = createId('rec');
  const createdAt = now();
  getDb()
    .prepare('INSERT INTO records (id, appId, entityId, dataJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, entityId, JSON.stringify(cleanData || {}), createdAt, createdAt);
  setRecordRelationValues(appId, entityId, id, relations);
  return getRecord(id);
}

export function getRecord(id) {
  const row = getDb().prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function updateRecord(recordId, data) {
  const existing = getRecord(recordId);
  if (!existing) return null;
  const app = getApp(existing.appId);
  const { data: cleanData, relations } = splitRelationData(app, existing.entityId, data);
  const nextJson = JSON.stringify(cleanData || {});
  if (JSON.stringify(existing.data || {}) !== nextJson) {
    getDb()
      .prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?')
      .run(nextJson, now(), recordId);
  }
  setRecordRelationValues(existing.appId, existing.entityId, recordId, relations);
  return getRecord(recordId);
}

export function deleteRecord(recordId, options = {}) {
  const database = getDb();
  const referenceCount = countRecordReferences(recordId);
  if (referenceCount > 0 && !options.force) {
    const error = new Error(`当前记录已被 ${referenceCount} 条记录引用。`);
    error.status = 409;
    error.details = { referenceCount };
    throw error;
  }
  database.prepare('DELETE FROM record_relations WHERE sourceRecordId = ? OR targetRecordId = ?').run(recordId, recordId);
  return database.prepare('DELETE FROM records WHERE id = ?').run(recordId).changes > 0;
}

export function countRecordReferences(recordId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM record_relations WHERE targetRecordId = ?')
    .get(recordId).count;
}

export function listRelationOptions(appId, sourceEntityId, fieldId, keyword = '') {
  const app = getApp(appId);
  const field = relationField(app, sourceEntityId, fieldId);
  const records = listRecords(appId, { entityId: field.targetEntity, hydrateRelations: false });
  const q = String(keyword || '').toLowerCase();
  return records
    .map((record) => ({
      recordId: record.id,
      displayValue: relationDisplayValue(app, field, record)
    }))
    .filter((option) => !q || option.displayValue.toLowerCase().includes(q));
}

export function getRecordRelations(recordId, fieldId) {
  const record = getRecord(recordId);
  if (!record) throw notFoundError('找不到记录。');
  const app = getApp(record.appId);
  const field = relationField(app, record.entityId, fieldId);
  return relationRowsFor(record.appId, [recordId], fieldId).map((row) => ({
    targetRecordId: row.targetRecordId,
    displayValue: displayTargetRecord(app, field, row.targetRecordId)
  }));
}

export function updateRecordRelations(recordId, fieldId, targetRecordIds = []) {
  const record = getRecord(recordId);
  if (!record) throw notFoundError('找不到记录。');
  const app = getApp(record.appId);
  const field = relationField(app, record.entityId, fieldId);
  setSingleRecordRelation(record.appId, record.entityId, recordId, field, normalizeTargetIds(targetRecordIds, field));
  return getRecordRelations(recordId, fieldId);
}

export function getSetting(key) {
  const row = getDb().prepare('SELECT valueJson FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.valueJson) : null;
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

export function exportAppPayload(appId, dataMode = 'structure') {
  const app = getApp(appId);
  if (!app) throw new Error('找不到应用。');
  const payload = appToPackage(app);
  if (dataMode === 'sample' || dataMode === 'all') {
    payload.sampleData = listRecords(appId).map((record) => ({
      entityId: record.entityId,
      data: record.data
    }));
  }
  return payload;
}

export function importAppPayload(payload) {
  const sampleData = Array.isArray(payload.sampleData) ? payload.sampleData : [];
  const app = createAppFromPackage(payload);
  for (const record of sampleData) {
    createRecord(app.id, record.entityId, record.data);
  }
  return app;
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

function splitRelationData(app, entityId, data = {}) {
  const fields = entityFields(app, entityId).filter((field) => field.type === 'relation');
  const relationIds = new Set(fields.map((field) => field.id));
  const cleanData = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!relationIds.has(key)) cleanData[key] = normalizeStoredValue(value);
  }
  const relations = fields
    .filter((field) => Object.prototype.hasOwnProperty.call(data || {}, field.id))
    .map((field) => ({ field, targetIds: normalizeTargetIds(data[field.id], field) }));
  return { data: cleanData, relations };
}

function normalizeStoredValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'optionId' in value) return value.optionId;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'optionIds' in value) return value.optionIds;
  return value;
}

function normalizeTargetIds(value, field) {
  const raw = Array.isArray(value)
    ? value
    : value?.targetRecordIds || value?.relations || value?.targetRecordId || value?.recordId || value;
  const ids = (Array.isArray(raw) ? raw : [raw])
    .map((item) => item?.targetRecordId || item?.recordId || item)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return field.multiple ? [...new Set(ids)] : ids.slice(0, 1);
}

function setRecordRelationValues(appId, entityId, recordId, relations) {
  for (const relation of relations) {
    setSingleRecordRelation(appId, entityId, recordId, relation.field, relation.targetIds);
  }
}

function setSingleRecordRelation(appId, sourceEntityId, sourceRecordId, field, targetRecordIds) {
  const database = getDb();
  database.prepare('DELETE FROM record_relations WHERE sourceRecordId = ? AND fieldId = ?').run(sourceRecordId, field.id);
  const insert = database.prepare(`
    INSERT INTO record_relations (
      id, appId, sourceEntityId, sourceRecordId, fieldId, targetEntityId, targetRecordId, sortOrder, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  targetRecordIds.forEach((targetRecordId, index) => {
    const target = getRecord(targetRecordId);
    if (!target || target.appId !== appId || target.entityId !== field.targetEntity) {
      throw validationError(`关联字段 ${field.label || field.id} 选择了无效记录。`);
    }
    insert.run(createId('rel'), appId, sourceEntityId, sourceRecordId, field.id, field.targetEntity, targetRecordId, index, now());
  });
}

function hydrateRelationValues(appId, records) {
  if (!records.length) return records;
  const app = getApp(appId);
  if (!app) return records;
  const sourceIds = records.map((record) => record.id);
  const fieldsByEntity = new Map((app.schema.entities || []).map((entity) => [entity.id, entity.fields || []]));
  const rows = relationRowsFor(appId, sourceIds);
  if (!rows.length) return records;
  const targetIds = [...new Set(rows.map((row) => row.targetRecordId))];
  const targetRecords = recordsByIds(targetIds);
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.sourceRecordId}:${row.fieldId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    const sourceFields = fieldsByEntity.get(row.sourceEntityId) || [];
    const field = sourceFields.find((item) => item.id === row.fieldId);
    const target = targetRecords.get(row.targetRecordId);
    grouped.get(key).push({
      targetRecordId: row.targetRecordId,
      displayValue: relationDisplayValue(app, field, target)
    });
  }
  return records.map((record) => {
    const data = { ...record.data };
    for (const field of fieldsByEntity.get(record.entityId) || []) {
      if (field.type === 'relation') data[field.id] = grouped.get(`${record.id}:${field.id}`) || [];
    }
    return { ...record, data };
  });
}

function relationRowsFor(appId, sourceRecordIds, fieldId = '') {
  if (!sourceRecordIds.length) return [];
  const placeholders = sourceRecordIds.map(() => '?').join(',');
  const params = [appId, ...sourceRecordIds];
  const fieldClause = fieldId ? ' AND fieldId = ?' : '';
  if (fieldId) params.push(fieldId);
  return getDb()
    .prepare(`
      SELECT * FROM record_relations
      WHERE appId = ? AND sourceRecordId IN (${placeholders})${fieldClause}
      ORDER BY sortOrder ASC, createdAt ASC
    `)
    .all(...params);
}

function recordsByIds(ids) {
  if (!ids.length) return new Map();
  const rows = getDb()
    .prepare(`SELECT * FROM records WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  return new Map(rows.map((row) => [row.id, { ...row, data: JSON.parse(row.dataJson) }]));
}

function displayTargetRecord(app, field, targetRecordId) {
  const target = getRecord(targetRecordId);
  return relationDisplayValue(app, field, target);
}

function displayRecordValue(value) {
  if (Array.isArray(value)) return value.map((item) => item.displayValue || item.label || item).join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.optionId || '';
  if (value === true) return '是';
  if (value === false) return '否';
  return String(value ?? '');
}

function relationDisplayValue(app, field, targetRecord) {
  if (!targetRecord) return '';
  const targetEntity = app?.schema?.entities?.find((entity) => entity.id === field?.targetEntity);
  const displayField = resolveRelationDisplayField(targetEntity, field, targetRecord.data || {});
  const value = displayField ? targetRecord.data?.[displayField.id] : firstRecordValue(targetRecord.data || {});
  return displayRecordValue(value) || targetRecord.id;
}

function resolveRelationDisplayField(targetEntity, relation, data = {}) {
  const fields = (targetEntity?.fields || []).filter((field) => field.type !== 'relation');
  const configured = fields.find((field) => field.id === relation?.displayField);
  if (configured && hasDisplayValue(data[configured.id])) return configured;
  const preferred = fields.find((field) => ['name', 'title'].includes(field.id) && hasDisplayValue(data[field.id]));
  if (preferred) return preferred;
  const labelPreferred = fields.find((field) => /名称|标题|姓名|名字|name|title/i.test(`${field.label || ''} ${field.id || ''}`) && hasDisplayValue(data[field.id]));
  if (labelPreferred) return labelPreferred;
  const textField = fields.find((field) => ['text', 'textarea', 'richText', 'select'].includes(field.type) && hasDisplayValue(data[field.id]));
  if (textField) return textField;
  return fields.find((field) => hasDisplayValue(data[field.id])) || configured || fields[0] || null;
}

function hasDisplayValue(value) {
  return !(value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0));
}

function firstRecordValue(data = {}) {
  return Object.values(data).find(hasDisplayValue);
}

function entityFields(app, entityId) {
  return app?.schema?.entities?.find((entity) => entity.id === entityId)?.fields || [];
}

function relationField(app, entityId, fieldId) {
  const field = entityFields(app, entityId).find((item) => item.id === fieldId && item.type === 'relation');
  if (!field) throw notFoundError('找不到关联字段。');
  return field;
}

function notFoundError(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
