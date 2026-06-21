import { getPackageFromApp } from '../storage/db.js';
import { getApp, updateAppMetadata, updateAppPackage, exportAppPayload } from '../models/app.js';
import { createRecord, deleteRecord, getRecordRelations, listRecords, listRelationOptions, updateRecord, updateRecordRelations } from '../models/record.js';
import { getSetting } from '../models/session.js';
import { generatePatchFromPrompt } from '../ai/service.js';
import { applyPatch } from '../core/packageProtocol.js';
import { runAction } from '../services/actions.js';
import { toCsv } from '../utils/export.js';
import { packageToZipPayload } from '../utils/zip.js';
import { recordsToXlsx } from '../utils/xlsx.js';
import { createTableInApp, updateTableInApp, deleteTableInApp, clearTableRecordsInApp, importTableRecordsInApp, createFieldInApp, updateFieldInApp, deleteFieldInApp } from '../services/operations.js';
import { sendJson, sendText, sendBinary, readJson, requireFields, notFound, badRequest, saveUploadedFile } from './_helpers.js';

export async function handleRuntimeApi(req, res, method, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const appId = parts[2];

  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');

  if (method === 'DELETE' && parts.length === 3) {
    const { deleteApp } = await import('../models/app.js');
    deleteApp(appId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && parts.length === 3) {
    sendJson(res, 200, { app });
    return;
  }

  if (method === 'POST' && parts[3] === 'uploads') {
    const file = await saveUploadedFile(req, appId, url);
    sendJson(res, 201, { file });
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
    await handleTablesApi(req, res, method, parts, app, url);
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
    requireFields(body, ['prompt']);
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
    const entityId = url.searchParams.get('entity');
    const records = listRecords(appId, { entityId: entityId || undefined, q: url.searchParams.get('q') });
    sendJson(res, 200, { records });
    return;
  }

  if (method === 'POST' && parts[3] === 'records') {
    const body = await readJson(req);
    const entityId = body.entityId || app.schema.entities[0]?.id;
    if (!entityId) throw badRequest('请求缺少 entityId 且应用没有默认实体。');
    if (!app.schema.entities.some((entity) => entity.id === entityId)) throw notFound(`实体不存在：${entityId}`);
    sendJson(res, 201, { record: createRecord(appId, entityId, body.data || {}, body._createdAt) });
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
    const entityId = url.searchParams.get('entity') || app.schema.entities[0]?.id;
    if (!entityId) throw badRequest('没有可导出的实体。');
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到要导出的实体。');
    const records = listRecords(appId, { entityId });
    sendText(res, 200, toCsv(records, entity), 'text/csv; charset=utf-8', `${app.slug}.csv`);
    return;
  }

  if (method === 'GET' && parts[3] === 'export.xlsx') {
    const entityId = url.searchParams.get('entity') || app.schema.entities[0]?.id;
    if (!entityId) throw badRequest('没有可导出的实体。');
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到要导出的实体。');
    const ids = new Set((url.searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean));
    const records = listRecords(appId, { entityId }).filter((record) => !ids.size || ids.has(record.id));
    const xlsx = recordsToXlsx(records, entity);
    sendBinary(res, 200, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${app.slug}.xlsx`);
    return;
  }

  if (method === 'GET' && parts[3] === 'export') {
    const payload = await exportAppPayload(appId, url.searchParams.get('data') || 'structure');
    const zip = packageToZipPayload(payload);
    sendBinary(res, 200, zip, 'application/octet-stream', `${app.slug}.sgpkg`);
    return;
  }

  if (method === 'POST' && parts[3] === 'actions' && parts[4] && parts[5] === 'run') {
    sendJson(res, 200, await runAction(app, parts[4]));
    return;
  }

  throw notFound('API 不存在。');
}

async function handleTablesApi(req, res, method, parts, app, url) {
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
  if (parts[5] === 'records') {
    if (method === 'DELETE') {
      sendJson(res, 200, clearTableRecordsInApp(app, entityId));
      return;
    }
    throw notFound('表数据 API 不存在。');
  }
  if (parts[5] === 'import' && method === 'POST') {
    const fileName = decodeURIComponent(url.searchParams.get('name') || req.headers['x-file-name'] || 'import.csv');
    sendJson(res, 200, await importTableRecordsInApp(req, app, entityId, fileName));
    return;
  }
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
