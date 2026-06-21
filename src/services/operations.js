import { getDb, getPackageFromApp } from '../storage/db.js';
import { updateAppPackage } from '../models/app.js';
import { createRecord } from '../models/record.js';
import { normalizeFieldId } from '../core/ids.js';
import { importRowsFromFile } from '../utils/importData.js';

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
  pkg.ui.pages.push({ id: `${entityId}-list`, title: `${name}列表`, type: 'list', entity: entityId, navKind: 'table', features: ['create', 'edit', 'delete', 'search', 'export'] });
  return updateAppPackage(app.id, pkg);
}

export function updateTableInApp(app, entityId, body = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if (body.name) entity.name = String(body.name).trim();
  if (body.description !== undefined) entity.description = String(body.description || '');
  for (const page of pkg.ui.pages.filter((item) => item.entity === entityId && body.name)) page.title = `${entity.name}列表`;
  return updateAppPackage(app.id, pkg);
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
  getDb().prepare('DELETE FROM record_relations WHERE appId = ? AND (sourceEntityId = ? OR targetEntityId = ?)').run(app.id, entityId, entityId);
  getDb().prepare('DELETE FROM records WHERE appId = ? AND entityId = ?').run(app.id, entityId);
  return updateAppPackage(app.id, pkg);
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
  const database = getDb();
  database.prepare('DELETE FROM record_relations WHERE appId = ? AND (sourceEntityId = ? OR targetEntityId = ?)').run(app.id, entityId, entityId);
  const deleted = database.prepare('DELETE FROM records WHERE appId = ? AND entityId = ?').run(app.id, entityId);
  return { ok: true, deletedCount: deleted.changes };
}

export async function importTableRecordsInApp(req, app, entityId, fileName) {
  const entity = app.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  const buffer = await readBuffer(req);
  if (!buffer.length) throw badRequest('导入文件不能为空。');
  const rows = importRowsFromFile(buffer, entity, fileName);
  if (!rows.length) throw badRequest('没有找到可导入的数据。请确认第一行是表头，且表头与字段名一致。');
  const records = rows.map((data) => createRecord(app.id, entityId, data));
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
  return updateAppPackage(app.id, pkg);
}

export function updateFieldInApp(app, entityId, fieldId, patch = {}) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  const field = entity?.fields?.find((item) => item.id === fieldId);
  if (!field) throw notFound('找不到字段。');
  Object.assign(field, patch);
  return updateAppPackage(app.id, pkg);
}

export function deleteFieldInApp(app, entityId, fieldId) {
  const pkg = getPackageFromApp(app);
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw notFound('找不到表。');
  if (!entity.fields.some((field) => field.id === fieldId)) throw notFound('找不到字段。');
  entity.fields = entity.fields.filter((field) => field.id !== fieldId);
  getDb().prepare('DELETE FROM record_relations WHERE appId = ? AND sourceEntityId = ? AND fieldId = ?').run(app.id, entityId, fieldId);
  return updateAppPackage(app.id, pkg);
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
