import { getSetting, setSetting } from '../models/session.js';
import { getRuntimeSettings, runtimeSettingSchema, saveRuntimeSettings } from '../models/runtime-settings.js';
import { authSummary, clearAuthSession, saveAuthCredentials } from '../models/auth.js';
import { sendJson, readJson, notFound } from './_helpers.js';
import { ensurePlatformService } from '../agent/platform-service.js';
import { resolveLubanAgent } from '../agent/agent-resolver.js';

export async function handleSettingsApi(req, res, method, pathname = '/api/settings') {
  if (pathname === '/api/settings/platform') {
    const runtime = await ensurePlatformService();
    const store = runtime.service.store;
    await resolveLubanAgent({ store });
    const snapshot = () => ({ ...store.snapshot(), consoleUrl: runtime.url + '/models' });
    if (method === 'GET') { sendJson(res, 200, snapshot()); return; }
    if (method === 'PUT') {
      const body = await readJson(req);
      if (body.connection) await store.saveConnection(body.connection, store.snapshot().revision);
      if (body.agent) await store.saveAgent(body.agent, store.snapshot().revision);
      if (body.defaultAgentId) {
        await store.setDefaultAgent(body.defaultAgentId, store.snapshot().revision);
        const ai = getSetting('ai') || {};
        setSetting('ai', { ...ai, agentId: body.defaultAgentId });
      }
      sendJson(res, 200, snapshot());
      return;
    }
    throw notFound('API 不存在。');
  }
  if (method === 'GET') {
    const stored = getSetting('ai') || {};
    const ai = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1-mini',
      ...stored
    };
    sendJson(res, 200, {
      ai: { ...ai, apiKey: '', hasApiKey: Boolean(stored.apiKey) },
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
