import { clampPageLimit, countRecords, deleteRecordForApp, deleteRecordsForApp, getRecordRelations, listRecords, updateRecordRelations } from '../../models/record.js';
import { createRecordWithRules, updateRecordWithRules } from '../../services/rule-runtime.js';
import { sendJson, readJson, notFound, badRequest } from '../_helpers.js';

export async function handleRecordsApi(req, res, method, parts, app, appId, url, runtime) {
  if (parts[3] !== 'records') return false;

  if (parts[4] && parts[5] === 'relations' && parts[6]) {
    if (method === 'GET') {
      sendJson(res, 200, { relations: getRecordRelations(parts[4], parts[6], appId) });
      return true;
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      sendJson(res, 200, { relations: updateRecordRelations(parts[4], parts[6], body.targetRecordIds || [], appId) });
      return true;
    }
  }

  if (method === 'GET' && parts.length === 4) {
    const entityId = url.searchParams.get('entity');
    const limit = clampPageLimit(url.searchParams.get('limit'), runtime.paginationDefault);
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0);
    const options = { entityId: entityId || undefined };
    const query = url.searchParams.get('q') || '';
    const total = countRecords(appId, { ...options, q: query || undefined });
    const records = listRecords(appId, { ...options, q: query || undefined, limit, offset });
    const nextOffset = offset + records.length;
    sendJson(res, 200, { records, pagination: { offset, limit, total, nextOffset, hasMore: nextOffset < total } });
    return true;
  }

  if (method === 'POST' && parts[4] === 'bulk-delete') {
    const body = await readJson(req);
    sendJson(res, 200, { deletedCount: deleteRecordsForApp(appId, body.recordIds || [], { force: body.force === true }) });
    return true;
  }

  if (method === 'POST') {
    const body = await readJson(req);
    const entityId = body.entityId || app.schema.entities[0]?.id;
    if (!entityId) throw badRequest('请求缺少 entityId 且应用没有默认实体。');
    if (!app.schema.entities.some((entity) => entity.id === entityId)) throw notFound(`实体不存在：${entityId}`);
    sendJson(res, 201, createRecordWithRules(appId, entityId, body.data || {}, body._createdAt));
    return true;
  }

  if (method === 'PUT' && parts[4] && parts.length === 5) {
    const body = await readJson(req);
    sendJson(res, 200, updateRecordWithRules(appId, parts[4], body.data || {}));
    return true;
  }

  if (method === 'DELETE' && parts[4] && parts.length === 5) {
    deleteRecordForApp(appId, parts[4], { force: url.searchParams.get('force') === 'true' });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
