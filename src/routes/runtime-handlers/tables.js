import { listRelationOptions } from '../../models/record.js';
import { createTableInApp, updateTableInApp, deleteTableInApp, clearTableRecordsInApp, importTableRecordsInApp, createFieldInApp, updateFieldInApp, deleteFieldInApp } from '../../services/operations.js';
import { sendJson, readJson, readBuffer, notFound } from '../_helpers.js';

export async function handleFieldsApi(req, res, method, parts, app, appId, url) {
  if (!(parts[3] === 'fields' && parts[4] && parts[5])) return false;

  const entityId = parts[4];
  const fieldId = parts[5];
  if (method === 'GET' && parts[6] === 'relation-options') {
    sendJson(res, 200, { options: listRelationOptions(appId, entityId, fieldId, url.searchParams.get('keyword') || '') });
    return true;
  }
  if (method === 'PATCH') {
    const body = await readJson(req);
    sendJson(res, 200, { app: updateFieldInApp(app, entityId, fieldId, body.field || body) });
    return true;
  }
  if (method === 'DELETE') {
    sendJson(res, 200, { app: deleteFieldInApp(app, entityId, fieldId) });
    return true;
  }
  return false;
}

export async function handleTablesApi(req, res, method, parts, app, url) {
  if (parts[3] !== 'tables') return false;

  if (method === 'GET' && parts.length === 4) {
    sendJson(res, 200, { tables: app.schema.entities });
    return true;
  }
  if (method === 'POST' && parts.length === 4) {
    const body = await readJson(req);
    sendJson(res, 201, { app: createTableInApp(app, body) });
    return true;
  }
  const entityId = parts[4];
  if (!entityId) throw notFound('表 API 不存在。');
  if (parts[5] === 'records') {
    if (method === 'DELETE') {
      sendJson(res, 200, clearTableRecordsInApp(app, entityId));
      return true;
    }
    throw notFound('表数据 API 不存在。');
  }
  if (parts[5] === 'import' && method === 'POST') {
    const fileName = decodeURIComponent(url.searchParams.get('name') || req.headers['x-file-name'] || 'import.csv');
    sendJson(res, 200, await importTableRecordsInApp(await readBuffer(req), app, entityId, fileName));
    return true;
  }
  if (method === 'PATCH') {
    const body = await readJson(req);
    sendJson(res, 200, { app: updateTableInApp(app, entityId, body) });
    return true;
  }
  if (method === 'DELETE') {
    sendJson(res, 200, { app: deleteTableInApp(app, entityId) });
    return true;
  }
  if (parts[5] === 'fields') {
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到表。');
    if (method === 'GET') {
      sendJson(res, 200, { fields: entity.fields || [] });
      return true;
    }
    if (method === 'POST') {
      const body = await readJson(req);
      sendJson(res, 201, { app: createFieldInApp(app, entityId, body.field || body) });
      return true;
    }
  }
  throw notFound('表 API 不存在。');
}
