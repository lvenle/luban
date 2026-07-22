import { authStatus, clearAuthSession, createAuthSession, verifyAuthCredentials } from '../models/auth.js';
import { sendJson, readJson, notFound } from './_helpers.js';

export async function handleAuthApi(req, res, method, parts) {
  const action = parts[2] || '';
  if (method === 'GET' && action === 'status') {
    sendJson(res, 200, authStatus(req));
    return;
  }
  if (method === 'POST' && action === 'login') {
    const body = await readJson(req);
    const ok = await verifyAuthCredentials(body.username, body.password);
    if (!ok) {
      sendJson(res, 401, { error: '用户名或密码不正确。' });
      return;
    }
    const username = String(body.username || '').trim();
    createAuthSession(res, username);
    sendJson(res, 200, { ...authStatus(req), authenticated: true, username });
    return;
  }
  if (method === 'POST' && action === 'logout') {
    clearAuthSession(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }
  throw notFound('API 不存在。');
}
