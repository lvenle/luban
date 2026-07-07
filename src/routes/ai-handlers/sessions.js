import { getAiSession, listAiSessions } from '../../models/session.js';

export function handleSessionsApi(res, method, parts, url) {
  if (method === 'GET' && parts.length === 3 && parts[2] === 'sessions') {
    const appId = url.searchParams.get('appId') || null;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sessions: listAiSessions({ appId }) }));
    return true;
  }

  if (method === 'GET' && parts[2] === 'sessions' && parts[3] && parts.length === 4) {
    const session = getAiSession(parts[3]);
    if (!session) { res.writeHead(404); res.end('{}'); return true; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ session }));
    return true;
  }

  return false;
}
