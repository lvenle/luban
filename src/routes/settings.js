import { getSetting, setSetting } from '../models/session.js';
import { sendJson, readJson, notFound } from './_helpers.js';

export async function handleSettingsApi(req, res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { ai: getSetting('ai') || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' } });
    return;
  }
  if (method === 'PUT') {
    const body = await readJson(req);
    sendJson(res, 200, { ai: setSetting('ai', body.ai || {}) });
    return;
  }
  throw notFound('API 不存在。');
}
