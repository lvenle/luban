import { getDb, rowToApp } from '../db.js';
import { getApp } from './app.js';
import { createId } from '../ids.js';

function now() {
  return new Date().toISOString();
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

export function listRecords(appId, options = {}) {
  const conditions = ['appId = ?'];
  const params = [appId];
  if (options.entityId) {
    conditions.push('entityId = ?');
    params.push(options.entityId);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM records WHERE ${conditions.join(' AND ')} ORDER BY createdAt ASC, rowid ASC`)
    .all(...params);
  let records = rows.map((row) => ({
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  if (options.q) {
    const q = String(options.q).toLowerCase();
    records = records.filter((record) => JSON.stringify(record.data).toLowerCase().includes(q));
  }
  return options.hydrateRelations === false ? records : hydrateRelationValues(appId, records);
}

export function createRecord(appId, entityId, data, customCreatedAt) {
  const app = getApp(appId);
  if (!app) throw notFoundError('找不到应用。');
  if (!app.schema.entities.some((entity) => entity.id === entityId)) throw validationError(`实体不存在：${entityId}`);
  const { data: cleanData, relations } = splitRelationData(app, entityId, data);
  const id = createId('rec');
  const createdAt = customCreatedAt || now();
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
  const dataChanged = JSON.stringify(existing.data || {}) !== nextJson;
  const relationsChanged = relationsChangedSince(recordId, relations);
  if (!dataChanged && !relationsChanged) return existing;
  if (dataChanged) {
    getDb()
      .prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?')
      .run(nextJson, now(), recordId);
  }
  if (relationsChanged) {
    setRecordRelationValues(existing.appId, existing.entityId, recordId, relations);
  }
  return getRecord(recordId);
}

function relationsChangedSince(recordId, relations) {
  const existingRows = getDb()
    .prepare('SELECT fieldId, targetRecordId FROM record_relations WHERE sourceRecordId = ? ORDER BY sortOrder ASC')
    .all(recordId);
  const existing = existingRows.map((row) => `${row.fieldId}:${row.targetRecordId}`);
  const incoming = relations.flatMap((r) => r.targetIds.map((targetId) => `${r.field.id}:${targetId}`));
  if (existing.length !== incoming.length) return true;
  return existing.some((key, index) => key !== incoming[index]);
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
    if (!target) continue;
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
