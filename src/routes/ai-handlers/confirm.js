import { readJson } from '../_helpers.js';
import { PENDING_CONFIRMS, rateLimitConfirm } from './confirm-state.js';

export async function handleChatConfirm(req, res) {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimitConfirm(clientIp)) {
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '确认请求过于频繁，请稍后再试。' }));
    return;
  }
  const body = await readJson(req);
  const confirmId = body.confirmId;
  if (!confirmId || !PENDING_CONFIRMS.has(confirmId)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '确认请求不存在或已超时。' }));
    return;
  }
  PENDING_CONFIRMS.get(confirmId).resolve?.(body.confirmed !== false);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true }));
}
