import { getDb, getPackageFromApp, withTransaction } from '../storage/db.js';
import { updateAppPackage } from '../models/app.js';
import { createRecord } from '../models/record.js';
import { normalizeFieldId } from '../core/ids.js';
import { preparePackage } from '../core/packageProtocol.js';
import { importRowsFromFile } from '../utils/importData.js';
import { formulaDependents, renameFormulaBinding } from '../core/formula.js';
import { readBuffer } from '../routes/_helpers.js';

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

export function createTableInApp(app, body = {}) {
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
  pkg.ui.pages.push({ id: `${entityId}-list`, title: `${name}列表`, type: 'list', entity: entityId, navKind: 'table', features: ['create', 'edit', 'delete', 'search', 'export'], views: [{ id: 'default', name: '全部记录', type: 'list' }] });
  return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
}

export function updateTableInApp(app, entityId, body = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if (body.name) entity.name = String(body.name).trim();
  if (body.description !== undefined) entity.description = String(body.description || '');
  for (const page of pkg.ui.pages.filter((item) => item.entity === entityId && body.name)) page.title = `${entity.name}列表`;
  return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
}

export function deleteTableInApp(app, entityId) {
  const entity = app.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if ((app.schema.entities || []).length <= 1) throw badRequest('至少保留一张表。');
  const references = listActualTableReferences(app, entityId);
  if (references.length) {
    const labels = references.map((reference) => `${reference.sourceEntityName}.${reference.fieldLabel}`);
    const error = new Error(`当前表的数据正在被其他表引用：${labels.join('、')}`);
    error.status = 409;
    error.details = { references };
    throw error;
  }
  const pkg = getPackageFromApp(app);
  pkg.schema.entities = pkg.schema.entities.filter((entity) => entity.id !== entityId);
  for (const sourceEntity of pkg.schema.entities) {
    sourceEntity.fields = (sourceEntity.fields || []).filter((field) => !(field.type === 'relation' && field.targetEntity === entityId));
  }
  pkg.ui.pages = pkg.ui.pages.filter((page) => page.entity !== entityId);
  preparePackage(pkg);
  return withTransaction((database) => {
    database.prepare('DELETE FROM record_relations WHERE appId = ? AND (sourceEntityId = ? OR targetEntityId = ?)').run(app.id, entityId, entityId);
    database.prepare('DELETE FROM records WHERE appId = ? AND entityId = ?').run(app.id, entityId);
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  });
}

export function clearTableRecordsInApp(app, entityId) {
  const entity = app.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  const references = listActualTableReferences(app, entityId);
  if (references.length) {
    const labels = references.map((reference) => `${reference.sourceEntityName}.${reference.fieldLabel}`);
    const error = new Error(`当前表的数据正在被其他表引用：${labels.join('、')}`);
    error.status = 409;
    error.details = { references };
    throw error;
  }
  return withTransaction((database) => {
    database.prepare('DELETE FROM record_relations WHERE appId = ? AND (sourceEntityId = ? OR targetEntityId = ?)').run(app.id, entityId, entityId);
    const deleted = database.prepare('DELETE FROM records WHERE appId = ? AND entityId = ?').run(app.id, entityId);
    return { ok: true, deletedCount: deleted.changes };
  });
}

export async function importTableRecordsInApp(req, app, entityId, fileName) {
  const entity = app.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  const buffer = await readBuffer(req);
  if (!buffer.length) throw badRequest('导入文件不能为空。');
  const rows = importRowsFromFile(buffer, entity, fileName);
  if (!rows.length) throw badRequest('没有找到可导入的数据。请确认第一行是表头，且表头与字段名一致。');
  const records = withTransaction(() => rows.map((data) => createRecord(app.id, entityId, data)));
  return { ok: true, importedCount: records.length, recordIds: records.map((record) => record.id) };
}

function listActualTableReferences(app, entityId) {
  const rows = getDb().prepare(`
    SELECT sourceEntityId, fieldId, COUNT(*) AS count
    FROM record_relations
    WHERE appId = ? AND targetEntityId = ? AND sourceEntityId <> ?
    GROUP BY sourceEntityId, fieldId
    ORDER BY count DESC
  `).all(app.id, entityId, entityId);
  return rows.map((row) => {
    const sourceEntity = app.schema.entities.find((item) => item.id === row.sourceEntityId);
    const field = sourceEntity?.fields?.find((item) => item.id === row.fieldId);
    return {
      sourceEntityId: row.sourceEntityId,
      sourceEntityName: sourceEntity?.name || row.sourceEntityId,
      fieldId: row.fieldId,
      fieldLabel: field?.label || row.fieldId,
      count: row.count
    };
  });
}

export function createFieldInApp(app, entityId, field = {}) {
  return createFieldsInApp(app, entityId, [field]);
}

export function createFieldsInApp(app, entityId, fields = []) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if (!Array.isArray(fields) || !fields.length) throw badRequest('至少提供一个字段。');
  for (const field of fields) {
    const label = String(field?.label || field?.name || '').trim();
    if (!label) throw badRequest('字段名不能为空。');
    const id = uniqueFieldId(entity, field.id || label);
    entity.fields.push({ ...field, id, label });
  }
  return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
}

export function updateFieldInApp(app, entityId, fieldId, patch = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  const field = entity?.fields?.find((item) => item.id === fieldId);
  if (!field) throw notFound('找不到字段。');
  const dependents = formulaDependents(entity, fieldId);
  if (patch.type && patch.type !== field.type && dependents.length) throw formulaDependencyError(field, dependents, '修改类型');
  if (patch.type && patch.type !== field.type) {
    const hasValues = getDb().prepare('SELECT dataJson FROM records WHERE appId = ? AND entityId = ?').all(app.id, entityId)
      .some((row) => {
        const value = JSON.parse(row.dataJson)?.[fieldId];
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
      });
    if (hasValues) {
      const error = new Error(`字段「${field.label}」已有数据，不能直接修改类型。请先清空或迁移该字段数据。`);
      error.status = 409;
      throw error;
    }
  }
  if (patch.label && patch.label !== field.label) {
    for (const formulaField of entity.fields) renameFormulaBinding(formulaField, fieldId, String(patch.label).trim());
  }
  const allowed = ['label', 'type', 'options', 'required', 'format', 'formula', 'placeholder'];
  Object.assign(field, Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key))));
  return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
}

export function deleteFieldInApp(app, entityId, fieldId) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  const field = entity.fields.find((item) => item.id === fieldId);
  if (!field) throw notFound('找不到字段。');
  const dependents = formulaDependents(entity, fieldId);
  if (dependents.length) throw formulaDependencyError(field, dependents, '删除');
  const references = packageFieldReferences(pkg, entityId, fieldId);
  if (references.length) {
    const error = new Error(`不能删除字段「${field.label}」，以下配置正在引用它：${references.map((item) => item.label).join('、')}`);
    error.status = 409;
    error.details = { fieldId, references };
    throw error;
  }
  entity.fields = entity.fields.filter((field) => field.id !== fieldId);
  preparePackage(pkg);
  return withTransaction((database) => {
    database.prepare('DELETE FROM record_relations WHERE appId = ? AND sourceEntityId = ? AND fieldId = ?').run(app.id, entityId, fieldId);
    const rows = database.prepare('SELECT id, dataJson FROM records WHERE appId = ? AND entityId = ?').all(app.id, entityId);
    const update = database.prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE id = ?');
    for (const row of rows) {
      const data = JSON.parse(row.dataJson);
      if (!Object.prototype.hasOwnProperty.call(data, fieldId)) continue;
      delete data[fieldId];
      update.run(JSON.stringify(data), new Date().toISOString(), row.id);
    }
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  });
}

function packageFieldReferences(pkg, entityId, fieldId) {
  const references = [];
  for (const page of pkg.ui?.pages || []) {
    if (page.entity !== entityId) continue;
    if (page.chart?.groupBy === fieldId || page.chart?.value === fieldId) references.push({ type: 'chart', id: page.id, label: `页面「${page.title}」图表` });
    for (const view of page.views || []) {
      const used = view.quadrant?.fieldId === fieldId
        || Object.values(view.gantt || {}).includes(fieldId)
        || (view.filters || []).some((item) => item.field === fieldId)
        || (view.sorts || []).some((item) => item.field === fieldId)
        || view.group?.field === fieldId;
      if (used) references.push({ type: 'view', id: view.id, label: `视图「${view.name}」` });
    }
  }
  for (const action of pkg.actions?.actions || []) {
    if (JSON.stringify(action).includes(`"${fieldId}"`)) references.push({ type: 'action', id: action.id, label: `操作「${action.name}」` });
  }
  return references;
}

function formulaDependencyError(field, dependents, action) {
  const error = new Error(`不能${action}字段「${field.label}」，以下公式正在引用它：${dependents.map((item) => item.label).join('、')}`);
  error.status = 409;
  error.details = { fieldId: field.id, formulaFields: dependents.map((item) => ({ id: item.id, label: item.label })) };
  return error;
}

export function uniqueEntityId(pkg, base) {
  const existing = new Set(pkg.schema.entities.map((entity) => entity.id));
  let id = normalizeFieldId(base, 'table');
  let index = 2;
  while (existing.has(id)) {
    id = `${normalizeFieldId(base, 'table')}_${index}`;
    index += 1;
  }
  return id;
}

export function uniqueFieldId(entity, base) {
  const existing = new Set((entity.fields || []).map((field) => field.id));
  let id = normalizeFieldId(base, 'field');
  let index = 2;
  while (existing.has(id)) {
    id = `${normalizeFieldId(base, 'field')}_${index}`;
    index += 1;
  }
  return id;
}
