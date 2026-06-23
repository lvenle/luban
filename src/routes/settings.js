import { getSetting, setSetting } from '../models/session.js';
import { sendJson, readJson, notFound } from './_helpers.js';

export async function handleSettingsApi(req, res, method) {
  if (method === 'GET') {
    const ai = getSetting('ai') || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' };
    sendJson(res, 200, { ai: { ...ai, apiKey: '', hasApiKey: Boolean(ai.apiKey) } });
    return;
  }
  if (method === 'PUT') {
    const body = await readJson(req);
    const current = getSetting('ai') || {};
    const incoming = body.ai || {};
    const next = { ...current, ...incoming };
    if (incoming.clearApiKey) next.apiKey = '';
    else if (!incoming.apiKey) next.apiKey = current.apiKey || '';
    delete next.clearApiKey;
    const saved = setSetting('ai', next);
    sendJson(res, 200, { ai: { ...saved, apiKey: '', hasApiKey: Boolean(saved.apiKey) } });
    return;
  }
  throw notFound('API 不存在。');
}
