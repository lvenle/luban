import { getSetting } from '../../models/session.js';
import { generateOptions } from '../../ai/service.js';
import { readJson, sendJson } from '../_helpers.js';

export async function handleGenerateOptions(req, res, method, parts) {
  if (method !== 'POST' || parts[2] !== 'generate-options') return false;

  const body = await readJson(req);
  const settings = getSetting('ai') || {};
  const prompt = [String(body.label || '').trim(), String(body.context || '').trim()].filter(Boolean).join('·');
  if (!prompt) {
    sendJson(res, 400, { error: '请提供字段名称。' });
    return true;
  }
  try {
    const options = await generateOptions(prompt, settings);
    sendJson(res, 200, { options });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
  return true;
}
