import { getSetting, setSetting } from '../models/session.js';
import { getRuntimeSettings, runtimeSettingSchema, saveRuntimeSettings } from '../models/runtime-settings.js';
import { authSummary, clearAuthSession, saveAuthCredentials } from '../models/auth.js';
import { sendJson, readJson, notFound } from './_helpers.js';

export async function handleSettingsApi(req, res, method) {
  if (method === 'GET') {
    const ai = getSetting('ai') || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' };
    sendJson(res, 200, {
      ai: { ...ai, apiKey: '', hasApiKey: Boolean(ai.apiKey) },
      auth: authSummary(),
      runtime: getRuntimeSettings(),
      runtimeSchema: runtimeSettingSchema()
    });
    return;
  }
  if (method === 'PUT') {
    const body = await readJson(req);
    let savedAi = getSetting('ai') || {};
    let savedAuth = authSummary();
    if (body.ai) {
      const current = getSetting('ai') || {};
      const incoming = body.ai || {};
      const next = { ...current, ...incoming };
      if (incoming.clearApiKey) next.apiKey = '';
      else if (!incoming.apiKey) next.apiKey = current.apiKey || '';
      delete next.clearApiKey;
      savedAi = setSetting('ai', next);
    }
    if (body.auth) {
      savedAuth = await saveAuthCredentials(body.auth);
      clearAuthSession(req, res);
    }
    const savedRuntime = body.runtime ? saveRuntimeSettings(body.runtime) : getRuntimeSettings();
    sendJson(res, 200, {
      ai: { ...savedAi, apiKey: '', hasApiKey: Boolean(savedAi.apiKey) },
      auth: savedAuth,
      runtime: savedRuntime,
      runtimeSchema: runtimeSettingSchema()
    });
    return;
  }
  throw notFound('API 不存在。');
}
