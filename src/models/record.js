import { getDb, rowToApp, withTransaction, triggerBackup } from '../storage/db.js';
import { getApp } from './app.js';
import { createId } from '../core/ids.js';
import { calculateFormulaFields } from '../core/formula.js';
import { notFound, badRequest } from '../core/errors.js';
import { isSingleChoiceField, isMultiChoiceField, isRelationField, isFormulaField, isTemporalField, isFileLikeField } from '../core/fieldTypeHelpers.js';
import { allocateAutoNumberValues } from './auto-number.js';

function now() {
  return new Date().toISOString();
}

export function listRecords(appId, options = {}) {
  const conditions = ['appId = ?'];
  const params = [appId];
  const app = getApp(appId);
  if (options.entityId) {
    conditions.push('entityId = ?');
    params.push(options.entityId);
  }
  const limit = options.limit === undefined ? null : clampPageLimit(options.limit);
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  if (options.q) {
    const search = recordSearchCondition(app, options.entityId, options.q);
    conditions.push(search.sql);
    params.push(...search.params);
  }
  const pagination = limit === null ? '' : ' LIMIT ? OFFSET ?';
  if (limit !== null) params.push(limit, offset);
  const rows = getDb()
    .prepare(`SELECT * FROM records WHERE ${conditions.join(' AND ')} ORDER BY createdAt ASC, rowid ASC${pagination}`)
    .all(...params);
  let records = rows.map((row) => ({
    id: row.id,
    appId: row.appId,
    entityId: row.entityId,
    data: JSON.parse(row.dataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
  if (options.hydrateRelations !== false) records = hydrateRelationValues(appId, records);
  records = records.map((record) => calculateRecordFormulas(record));
  if (options.q) {
    const q = String(options.q).toLowerCase();
    records = records.filter((record) => recordSearchText(app, record).includes(q));
  }
  return records;
}

function recordSearchText(app, record) {
  const entity = app?.schema?.entities?.find((item) => item.id === record.entityId);
  const values = [JSON.stringify(record.data)];
  for (const field of entity?.fields || []) {
    const value = record.data?.[field.id];
    if (isSingleChoiceField(field)) {
      const option = (field.options || []).find((item) => item.id === value || item.label === value);
      if (option) values.push(option.label);
    }
    if (isMultiChoiceField(field)) {
      for (const id of Array.isArray(value) ? value : []) {
        const option = (field.options || []).find((item) => item.id === id || item.label === id);
        if (option) values.push(option.label);
      }
    }
  }
  return values.join(' ').toLowerCase();
}

export function countRecords(appId, options = {}) {
  const conditions = ['appId = ?'];
  const params = [appId];
  if (options.entityId) { conditions.push('entityId = ?'); params.push(options.entityId); }
  if (options.q) {
    const search = recordSearchCondition(getApp(appId), options.entityId, options.q);
    conditions.push(search.sql);
    params.push(...search.params);
  }
  return getDb().prepare(`SELECT COUNT(*) AS count FROM records WHERE ${conditions.join(' AND ')}`).get(...params).count;
}

function recordSearchCondition(app, entityId, query) {
  const q = String(query || '').toLowerCase();
  const patterns = [`%${escapeLike(q)}%`];
  const entities = (app?.schema?.entities || []).filter((entity) => !entityId || entity.id === entityId);
  for (const entity of entities) {
    for (const field of entity.fields || []) {
      if (!isSingleChoiceField(field) && !isMultiChoiceField(field)) continue;
      for (const option of field.options || []) {
        if (!String(option.label || '').toLowerCase().includes(q)) continue;
        const fieldId = escapeLike(JSON.stringify(String(field.id)).slice(1, -1));
        const optionId = escapeLike(JSON.stringify(String(option.id)).slice(1, -1));
        patterns.push(`%"${fieldId}":%"${optionId}"%`);
      }
    }
  }
  return {
    sql: `(${patterns.map(() => "LOWER(dataJson) LIKE ? ESCAPE '\\'").join(' OR ')})`,
    params: [...new Set(patterns)]
  };
}

function escapeLike(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

export function clampPageLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(1000, Number.isFinite(parsed) ? parsed : fallback));
}

export function createRecord(appId, entityId, data, customCreatedAt, options = {}) {
  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');
  if (!app.schema.entities.some((entity) => entity.id === entityId)) throw badRequest(`实体不存在：${entityId}`);
  const entity = app.schema.entities.find((item) => item.id === entityId);
  const validated = validateRecordData(entity, data, { mode: 'create' });
  const { data: cleanData, relations } = splitRelationData(app, entityId, validated);
  const id = createId('rec');
  const createdAt = validTimestamp(customCreatedAt) || now();
  withTransaction((database) => {
    const numberedData = allocateAutoNumberValues(database, appId, entity, cleanData);
    database.prepare('INSERT INTO records (id, appId, entityId, dataJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, appId, entityId, JSON.stringify(numberedData || {}), createdAt, createdAt);
    setRecordRelationValues(appId, entityId, id, relations);
  });
  if (!options.skipBackup) triggerBackup();
  return calculateRecordFormulas(getRecord(id));
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

export function getRecordForApp(appId, recordId) {
  const record = getRecord(recordId);
  if (!record || record.appId !== appId) return null;
  return record;
}

export function updateRecord(recordId, data, options = {}) {
  const existing = getRecord(recordId);
  if (!existing) return null;
  const app = getApp(existing.appId);
  const entity = app?.schema?.entities?.find((item) => item.id === existing.entityId);
  const validated = validateRecordData(entity, data, { mode: 'update' });
  for (const field of entity?.fields || []) {
    if (field.type === 'autoNumber' && Object.prototype.hasOwnProperty.call(existing.data || {}, field.id)) {
      validated[field.id] = existing.data[field.id];
    }
  }
  const { data: cleanData, relations } = splitRelationData(app, existing.entityId, validated);
  const nextJson = JSON.stringify(cleanData || {});
  const dataChanged = JSON.stringify(existing.data || {}) !== nextJson;
  const relationsChanged = relationsChangedSince(recordId, relations);
  if (!dataChanged && !relationsChanged) return existing;
  withTransaction((database) => {
    if (dataChanged) database.prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?').run(nextJson, now(), recordId);
    if (relationsChanged) setRecordRelationValues(existing.appId, existing.entityId, recordId, relations);
  });
  if (!options.skipBackup) triggerBackup();
  return calculateRecordFormulas(getRecord(recordId));
}

export function updateRecordForApp(appId, recordId, data, options = {}) {
  if (!getRecordForApp(appId, recordId)) throw notFound('找不到记录。');
  return updateRecord(recordId, data, options);
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
  const result = withTransaction(() => {
    database.prepare("DELETE FROM rule_record_states WHERE sourceRecordId = ? AND state = 'waiting'").run(recordId);
    database.prepare('DELETE FROM record_relations WHERE sourceRecordId = ? OR targetRecordId = ?').run(recordId, recordId);
    return database.prepare('DELETE FROM records WHERE id = ?').run(recordId).changes > 0;
  });
  triggerBackup();
  return result;
}

export function deleteRecordForApp(appId, recordId, options = {}) {
  if (!getRecordForApp(appId, recordId)) throw notFound('找不到记录。');
  return deleteRecord(recordId, options);
}

export function deleteRecordsForApp(appId, recordIds = [], options = {}) {
  const ids = [...new Set(recordIds.map(String))];
  if (!ids.length) return 0;
  if (ids.length > 1000) throw badRequest('单次最多删除 1000 条记录。');
  const count = withTransaction(() => {
    for (const id of ids) if (!getRecordForApp(appId, id)) throw notFound(`找不到记录：${id}`);
    for (const id of ids) deleteRecord(id, options);
    return ids.length;
  });
  triggerBackup();
  return count;
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
    .filter((option) => !q || option.displayValue.toLowerCase().includes(q))
    .slice(0, 1000);
}

export function getRecordRelations(recordId, fieldId, appId = '') {
  const record = appId ? getRecordForApp(appId, recordId) : getRecord(recordId);
  if (!record) throw notFound('找不到记录。');
  const app = getApp(record.appId);
  const field = relationField(app, record.entityId, fieldId);
  return relationRowsFor(record.appId, [recordId], fieldId).map((row) => ({
    targetRecordId: row.targetRecordId,
    displayValue: displayTargetRecord(app, field, row.targetRecordId)
  }));
}

export function updateRecordRelations(recordId, fieldId, targetRecordIds = [], appId = '') {
  const record = appId ? getRecordForApp(appId, recordId) : getRecord(recordId);
  if (!record) throw notFound('找不到记录。');
  const app = getApp(record.appId);
  const field = relationField(app, record.entityId, fieldId);
  withTransaction(() => setSingleRecordRelation(record.appId, record.entityId, recordId, field, normalizeTargetIds(targetRecordIds, field)));
  return getRecordRelations(recordId, fieldId, record.appId);
}

export function validateRecordData(entity, data = {}, options = {}) {
  if (!entity) throw badRequest('找不到记录对应的表。');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('记录数据必须是对象。');
  data = normalizeRecordDataKeys(entity, data);
  const fields = new Map((entity.fields || []).map((field) => [field.id, field]));
  const normalized = {};
  for (const field of entity.fields || []) {
    if (isFormulaField(field) || field.type === 'autoNumber') continue;
    const present = Object.prototype.hasOwnProperty.call(data, field.id);
    const value = present ? data[field.id] : undefined;
    if (!present) continue;
    normalized[field.id] = validateFieldValue(field, value);
  }
  return normalized;
}

export function normalizeRecordDataKeys(entity, data = {}) {
  const fields = new Map((entity.fields || []).map((field) => [field.id, field]));
  const aliases = new Map();
  for (const field of entity.fields || []) {
    for (const alias of [field.label, field.name, field.displayName]) {
      const key = String(alias || '').trim();
      if (!key || key === field.id) continue;
      // 跳过与另一字段 ID 冲突的别名——ID 匹配优先级更高，
      // 避免字段 label 恰好等于另一字段 id 时导致数据写入错误字段
      if (fields.has(key)) continue;
      const matches = aliases.get(key) || [];
      matches.push(field);
      aliases.set(key, matches);
    }
  }

  const normalized = {};
  const unknown = [];
  for (const [rawKey, value] of Object.entries(data)) {
    const key = String(rawKey).trim();
    const direct = fields.get(key);
    const matches = direct ? [direct] : aliases.get(key) || [];
    if (!matches.length) {
      unknown.push(rawKey);
      continue;
    }
    if (matches.length > 1) throw badRequest(`字段名称「${rawKey}」不唯一，请使用字段 ID。`);
    const fieldId = matches[0].id;
    if (Object.prototype.hasOwnProperty.call(normalized, fieldId)
      && JSON.stringify(normalized[fieldId]) !== JSON.stringify(value)) {
      throw badRequest(`字段「${matches[0].label || fieldId}」被重复赋值。`);
    }
    normalized[fieldId] = value;
  }
  if (unknown.length) throw badRequest(`记录包含不存在的字段：${unknown.join('、')}`);
  return normalized;
}

function validateFieldValue(field, value) {
  if (isEmptyValue(value)) return value;
  if (field.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw badRequest(`字段「${field.label}」必须是数值。`);
    return number;
  }
  if (isTemporalField(field)) {
    if (Number.isNaN(Date.parse(value))) throw badRequest(`字段「${field.label}」必须是有效日期。`);
    return String(value);
  }
  if (field.type === 'url') {
    const url = String(value).trim();
    let parsed;
    try { parsed = new URL(url); } catch { throw badRequest(`字段「${field.label}」必须是有效链接。`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest(`字段「${field.label}」只支持 http 或 https 链接。`);
    return url;
  }
  if (isSingleChoiceField(field)) {
    const id = String(value?.optionId || value?.id || value);
    const option = (field.options || []).find((item) => item.id === id || item.label === id);
    if (!option) throw badRequest(`字段「${field.label}」包含无效选项。`);
    return option.id;
  }
  if (isMultiChoiceField(field)) {
    if (!Array.isArray(value)) throw badRequest(`字段「${field.label}」必须是选项数组。`);
    const ids = value.map((item) => String(item?.optionId || item?.id || item));
    const normalized = ids.map((id) => (field.options || []).find((option) => option.id === id || option.label === id)?.id);
    if (normalized.some((id) => !id)) throw badRequest(`字段「${field.label}」包含无效选项。`);
    return [...new Set(normalized)];
  }
  if (isRelationField(field)) return value;
  if (isFileLikeField(field)) {
    if (typeof value !== 'object' || Array.isArray(value) || !value.url) throw badRequest(`字段「${field.label}」必须是有效文件。`);
    return value;
  }
  return String(value);
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function validTimestamp(value) {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

function splitRelationData(app, entityId, data = {}) {
  const fields = entityFields(app, entityId).filter((field) => isRelationField(field));
  const relationIds = new Set(fields.map((field) => field.id));
  const formulaIds = new Set(entityFields(app, entityId).filter((field) => isFormulaField(field)).map((field) => field.id));
  const cleanData = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!relationIds.has(key) && !formulaIds.has(key)) cleanData[key] = normalizeStoredValue(value);
  }
  const relations = fields
    .filter((field) => Object.prototype.hasOwnProperty.call(data || {}, field.id))
    .map((field) => ({ field, targetIds: normalizeTargetIds(data[field.id], field) }));
  return { data: cleanData, relations };
}

function calculateRecordFormulas(record) {
  if (!record) return record;
  const app = getApp(record.appId);
  const entity = app?.schema?.entities?.find((item) => item.id === record.entityId);
  if (!entity) return record;
  const calculated = calculateFormulaFields(entity, record.data, {
    timeZone: app.manifest?.timezone || 'Asia/Shanghai'
  });
  return { ...record, data: calculated.data, formulaErrors: calculated.formulaErrors };
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
  const app = getApp(appId);
  const reciprocalField = findReciprocalRelationField(app, sourceEntityId, field);
  const previousTargetIds = database
    .prepare('SELECT targetRecordId FROM record_relations WHERE sourceRecordId = ? AND fieldId = ?')
    .all(sourceRecordId, field.id)
    .map((row) => row.targetRecordId);

  const targets = targetRecordIds.map((targetRecordId) => {
    const target = getRecord(targetRecordId);
    if (!target || target.appId !== appId || target.entityId !== field.targetEntity) {
      throw badRequest(`关联字段 ${field.label || field.id} 选择了无效记录。`);
    }
    return target;
  });

  database.prepare('DELETE FROM record_relations WHERE sourceRecordId = ? AND fieldId = ?').run(sourceRecordId, field.id);
  if (reciprocalField) {
    const removeReciprocal = database.prepare(`
      DELETE FROM record_relations
      WHERE sourceRecordId = ? AND fieldId = ? AND targetRecordId = ?
    `);
    for (const previousTargetId of previousTargetIds) {
      removeReciprocal.run(previousTargetId, reciprocalField.id, sourceRecordId);
    }
  }

  const insert = database.prepare(`
    INSERT INTO record_relations (
      id, appId, sourceEntityId, sourceRecordId, fieldId, targetEntityId, targetRecordId, sortOrder, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  targets.forEach((target, index) => {
    const targetRecordId = target.id;
    insert.run(createId('rel'), appId, sourceEntityId, sourceRecordId, field.id, field.targetEntity, targetRecordId, index, now());
    if (reciprocalField) syncReciprocalRelation({
      database,
      appId,
      sourceEntityId,
      sourceRecordId,
      field,
      targetRecordId,
      reciprocalField
    });
  });
}

function findReciprocalRelationField(app, sourceEntityId, field) {
  const targetEntity = app?.schema?.entities?.find((entity) => entity.id === field.targetEntity);
  if (!targetEntity) return null;
  const candidates = (targetEntity.fields || []).filter((candidate) =>
    isRelationField(candidate) && candidate.targetEntity === sourceEntityId
  );
  const configuredId = field.reciprocalFieldId
    || field.inverseFieldId
    || field.config?.reciprocalFieldId
    || field.config?.inverseFieldId;
  if (configuredId) return candidates.find((candidate) => candidate.id === configuredId) || null;
  if (field.bidirectional === false || field.config?.bidirectional === false) return null;
  return candidates.length === 1 ? candidates[0] : null;
}

function syncReciprocalRelation({ database, appId, sourceEntityId, sourceRecordId, field, targetRecordId, reciprocalField }) {
  if (!reciprocalField.multiple) {
    const displaced = database.prepare(`
      SELECT targetRecordId FROM record_relations
      WHERE sourceRecordId = ? AND fieldId = ? AND targetRecordId <> ?
    `).all(targetRecordId, reciprocalField.id, sourceRecordId);
    database.prepare('DELETE FROM record_relations WHERE sourceRecordId = ? AND fieldId = ?').run(targetRecordId, reciprocalField.id);
    const removeDisplacedForward = database.prepare(`
      DELETE FROM record_relations
      WHERE sourceRecordId = ? AND fieldId = ? AND targetRecordId = ?
    `);
    for (const row of displaced) removeDisplacedForward.run(row.targetRecordId, field.id, targetRecordId);
  }
  const nextSortOrder = database.prepare(`
    SELECT COALESCE(MAX(sortOrder), -1) + 1 AS value
    FROM record_relations WHERE sourceRecordId = ? AND fieldId = ?
  `).get(targetRecordId, reciprocalField.id).value;
  database.prepare(`
    INSERT OR IGNORE INTO record_relations (
      id, appId, sourceEntityId, sourceRecordId, fieldId, targetEntityId, targetRecordId, sortOrder, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId('rel'), appId, field.targetEntity, targetRecordId, reciprocalField.id,
    sourceEntityId, sourceRecordId, nextSortOrder, now()
  );
}

function hydrateRelationValues(appId, records) {
  if (!records.length) return records;
  const app = getApp(appId);
  if (!app) return records;
  const sourceIds = records.map((record) => record.id);
  const fieldsByEntity = new Map((app.schema.entities || []).map((entity) => [entity.id, entity.fields || []]));
  const rows = relationRowsFor(appId, sourceIds);
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
      if (isRelationField(field)) data[field.id] = grouped.get(`${record.id}:${field.id}`) || [];
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
  const field = entityFields(app, entityId).find((item) => item.id === fieldId && isRelationField(item));
  if (!field) throw notFound('找不到关联字段。');
  return field;
}
