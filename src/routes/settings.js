import { requireApplicationManager } from '@xiaoya/agent-platform/hosting/context';
import { getSetting, setSetting } from '../models/session.js';
import { getRuntimeSettings, runtimeSettingSchema, saveRuntimeSettings } from '../models/runtime-settings.js';
import { authSummary, clearAuthSession, saveAuthCredentials } from '../models/auth.js';
import { sendJson, readJson, notFound, badRequest } from './_helpers.js';
import { ensurePlatformService } from '../agent/platform-service.js';
import { resolveLubanAgent, resolveLubanBusinessAgent } from '../agent/agent-resolver.js';

export async function handleSettingsApi(req, res, method, pathname = '/api/settings') {
  if (['/api/settings/platform','/api/settings/business'].includes(pathname)) {
    requireApplicationManager();
    const business=pathname.endsWith('/business');
    const runtime = await ensurePlatformService();
    const store = runtime.service.store;
    const assistant = await (business?resolveLubanBusinessAgent({store}):resolveLubanAgent({store}));
    const snapshot = () => ({ ...store.snapshot(), settingsEndpoint:pathname, applicationInstanceId: assistant.applicationInstanceId, applicationAssistantId: assistant.id, consoleUrl: runtime.consoleUrl || (runtime.url ? runtime.url + '/models' : null), hostMode: runtime.kind || 'enterprise' });
    if (method === 'GET') { sendJson(res, 200, snapshot()); return; }
    if (method === 'PUT') {
      requireApplicationManager();
      const body = await readJson(req);
      if(store.modelsManaged&&body.connection)throw badRequest('模型由企业底座统一管理，请在平台后台配置');
      if (body.defaultAgentId && body.defaultAgentId !== assistant.id) throw badRequest('不能更换鲁班应用助手');
      if (body.agent && body.agent.id !== assistant.id) throw badRequest('不能修改其他应用的助手');
      if (body.revision !== store.snapshot().revision) throw badRequest('配置已变化，请重新打开助手设置');
      // Validate all requested fields before writing either configuration.
      const current = store.resolveAgent(assistant.id, 'draft');
      if (body.agent) {
        const allowed = new Set(['id', 'system', 'name', 'description', ...Object.keys(current)]);
        if (Object.keys(body.agent).some(key => !allowed.has(key))) throw badRequest('不支持的助手设置');
      }
      await store.saveApplicationSettings(assistant.applicationInstanceId, {
        connection: body.connection,
        system: body.agent?.system
      }, body.revision);
      // Adopt the application binding after an explicit frontend save, retaining the old choice.
      if(!business) {
      const ai = getSetting('ai') || {};
      setSetting('ai', {
        ...ai,
        ...(ai.agentId && ai.agentId !== assistant.id ? { legacyAgentSelection: { agentId: ai.agentId, agentVersion: ai.agentVersion || null } } : {}),
        agentId: assistant.id, agentVersion: 'draft'
      });
      }
      sendJson(res, 200, snapshot());
      return;
    }
    throw notFound('API 不存在。');
  }
  if (method === 'GET') {
    const runtime=await ensurePlatformService();
    if(runtime.service.store.modelsManaged){sendJson(res,200,{modelsManaged:true,auth:authSummary(),runtime:getRuntimeSettings(),runtimeSchema:runtimeSettingSchema()});return;}
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
    requireApplicationManager();
    const body = await readJson(req);
    if(body.ai&&(await ensurePlatformService()).service.store.modelsManaged)throw badRequest('模型由企业底座统一管理');
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
