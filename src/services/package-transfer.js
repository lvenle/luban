import { getPackageFromApp, withTransaction } from '../storage/db.js';
import { createAppFromPackage, getApp } from '../models/app.js';
import { createRecord, listRecords, updateRecord } from '../models/record.js';
import { createRule, listRules } from '../models/rule.js';
import { notFound } from '../core/errors.js';

export function exportAppPayload(appId, dataMode = 'structure') {
  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');
  const payload = getPackageFromApp(app);
  if (dataMode === 'sample' || dataMode === 'all') {
    payload.sampleData = listRecords(appId).map((record) => ({
      id: record.id,
      entityId: record.entityId,
      data: record.data
    }));
    payload.businessRules = listRules(appId).map((rule) => ({
      name: rule.name,
      description: rule.description,
      status: rule.status,
      sourceText: rule.sourceText,
      businessIntentJson: rule.businessIntentJson,
      schemaMappingJson: rule.schemaMappingJson,
      contractJson: rule.contractJson
    }));
  }
  return payload;
}

export function importAppPayload(payload) {
  const sampleData = Array.isArray(payload?.sampleData) ? payload.sampleData : [];
  const businessRules = Array.isArray(payload?.businessRules) ? payload.businessRules : [];
  return withTransaction(() => {
    const app = createAppFromPackage(payload);
    const recordIds = new Map();
    for (const [index, record] of sampleData.entries()) {
      const entity = app.schema.entities.find((item) => item.id === record.entityId);
      if (!entity) continue;
      const relationFields = new Set((entity.fields || []).filter((field) => field.type === 'relation').map((field) => field.id));
      const data = Object.fromEntries(Object.entries(record.data || {}).filter(([fieldId]) => !relationFields.has(fieldId)));
      const created = createRecord(app.id, record.entityId, data, undefined, { skipBackup: true });
      recordIds.set(record.id || `sample-${index}`, created.id);
    }
    for (const [index, record] of sampleData.entries()) {
      const createdId = recordIds.get(record.id || `sample-${index}`);
      if (!createdId) continue;
      const data = mapImportedRelations(record.data || {}, recordIds);
      updateRecord(createdId, data, { skipBackup: true });
    }
    for (const rule of businessRules) createRule({ ...rule, appId: app.id });
    return app;
  });
}

function mapImportedRelations(data, recordIds) {
  return Object.fromEntries(Object.entries(data).map(([fieldId, value]) => [fieldId, mapRelationValue(value, recordIds)]));
}

function mapRelationValue(value, recordIds) {
  if (!Array.isArray(value)) return value;
  if (!value.some((item) => item && typeof item === 'object' && (item.targetRecordId || item.recordId))) return value;
  return value
    .map((item) => recordIds.get(item.targetRecordId || item.recordId))
    .filter(Boolean);
}
