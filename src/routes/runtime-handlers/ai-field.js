import { getSetting } from '../../models/session.js';
import { generateFieldContent } from '../../ai/service.js';
import { updateRecordWithRules } from '../../services/rule-runtime.js';
import { sendJson, readJson, requireFields } from '../_helpers.js';

export async function handleAiFieldApi(req, res, method, parts, appId) {
  if (method !== 'POST' || parts[3] !== 'ai-field') return false;

  const body = await readJson(req);
  requireFields(body, ['recordId', 'fieldId', 'prompt']);
  const settings = getSetting('ai') || {};
  if (!settings.apiKey) {
    sendJson(res, 200, { result: `(mock) AI 结果` });
    return true;
  }
  const result = await generateFieldContent(body.prompt, settings);
  if (body.fieldId) {
    const data = { [body.fieldId]: result };
    updateRecordWithRules(appId, body.recordId, data);
  }
  sendJson(res, 200, { result });
  return true;
}
