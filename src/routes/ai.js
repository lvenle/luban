import { discoverTools } from '../ai/registry.js';
import { handleChat } from './ai-handlers/chat.js';
import { handleChatConfirm } from './ai-handlers/confirm.js';
import { handleGenerateOptions } from './ai-handlers/options.js';
import { handleSessionsApi } from './ai-handlers/sessions.js';

discoverTools();

export { buildToolDisplayInfo, mergeBatchableToolCalls } from '../services/ai/tool-display.js';

export async function handleAiApi(req, res, method, parts, url) {
  if (handleSessionsApi(res, method, parts, url)) return;
  if (await handleGenerateOptions(req, res, method, parts)) return;
  if (await handleChat(req, res, method, parts)) return;

  if (method === 'POST' && parts[2] === 'chat' && parts[3] === 'confirm') {
    await handleChatConfirm(req, res);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'AI API 不存在。' }));
}
