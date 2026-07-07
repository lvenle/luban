import { getApp } from '../models/app.js';
import { getRuntimeSettings } from '../models/runtime-settings.js';
import { notFound } from './_helpers.js';
import { handleActionsApi } from './runtime-handlers/actions.js';
import { handleAiFieldApi } from './runtime-handlers/ai-field.js';
import { handleAppMetaApi } from './runtime-handlers/app-meta.js';
import { handleExportsApi } from './runtime-handlers/exports.js';
import { handleRecordsApi } from './runtime-handlers/records.js';
import { handleRulesApi } from './runtime-handlers/rules.js';
import { handleFieldsApi, handleTablesApi } from './runtime-handlers/tables.js';

export async function handleRuntimeApi(req, res, method, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const appId = parts[2];
  const runtime = getRuntimeSettings();

  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');

  if (await handleAppMetaApi(req, res, method, parts, app, appId, url)) return;
  if (await handleAiFieldApi(req, res, method, parts, appId)) return;
  if (await handleTablesApi(req, res, method, parts, app, url)) return;
  if (await handleFieldsApi(req, res, method, parts, app, appId, url)) return;
  if (await handleRulesApi(req, res, method, parts, app, appId, url, runtime)) return;
  if (await handleRecordsApi(req, res, method, parts, app, appId, url, runtime)) return;
  if (await handleExportsApi(res, method, parts, app, appId, url)) return;
  if (await handleActionsApi(res, method, parts, app)) return;

  throw notFound('API 不存在。');
}
