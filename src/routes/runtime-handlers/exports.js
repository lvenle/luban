import { listRecords } from '../../models/record.js';
import { toCsv } from '../../utils/export.js';
import { packageToZipPayload } from '../../utils/zip.js';
import { recordsToXlsx } from '../../utils/xlsx.js';
import { exportAppPayload } from '../../services/package-transfer.js';
import { sendText, sendBinary, badRequest, notFound } from '../_helpers.js';

export async function handleExportsApi(res, method, parts, app, appId, url) {
  if (method === 'GET' && parts[3] === 'export.csv') {
    const entityId = url.searchParams.get('entity') || app.schema.entities[0]?.id;
    if (!entityId) throw badRequest('没有可导出的实体。');
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到要导出的实体。');
    const records = listRecords(appId, { entityId });
    sendText(res, 200, toCsv(records, entity), 'text/csv; charset=utf-8', `${app.slug}.csv`);
    return true;
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
    return true;
  }

  if (method === 'GET' && parts[3] === 'export') {
    const payload = await exportAppPayload(appId, url.searchParams.get('data') || 'structure');
    const zip = packageToZipPayload(payload);
    sendBinary(res, 200, zip, 'application/octet-stream', `${app.slug}.sgpkg`);
    return true;
  }

  return false;
}
