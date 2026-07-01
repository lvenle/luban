import { getPackageFromApp, withTransaction } from '../storage/db.js';
import { createAppFromPackage, getApp } from '../models/app.js';
import { createRecord, listRecords } from '../models/record.js';
import { notFound } from '../core/errors.js';

export function exportAppPayload(appId, dataMode = 'structure') {
  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');
  const payload = getPackageFromApp(app);
  if (dataMode === 'sample' || dataMode === 'all') {
    payload.sampleData = listRecords(appId).map((record) => ({
      entityId: record.entityId,
      data: record.data
    }));
  }
  return payload;
}

export function importAppPayload(payload) {
  const sampleData = Array.isArray(payload?.sampleData) ? payload.sampleData : [];
  return withTransaction(() => {
    const app = createAppFromPackage(payload);
    for (const record of sampleData) createRecord(app.id, record.entityId, record.data);
    return app;
  });
}
