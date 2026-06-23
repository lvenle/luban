import { createServer } from 'node:http';
import { sendJson, statusForError, serveStatic, serveUpload, notFound } from './routes/_helpers.js';
import { handleAiApi } from './routes/ai.js';
import { handleAppApi, handleGenerateApp, handleImportApp } from './routes/app.js';
import { handleRuntimeApi } from './routes/runtime.js';
import { handleSettingsApi } from './routes/settings.js';

const PORT = Number(process.env.PORT || 5173);

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith('/uploads/')) {
        serveUpload(res, url.pathname);
        return;
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, statusForError(error), { error: error.message, details: error.details || undefined });
    }
  });
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith('/api/ai/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    await handleAiApi(req, res, method, parts, url);
    return;
  }

  if (url.pathname.startsWith('/api/settings')) {
    await handleSettingsApi(req, res, method);
    return;
  }

  if (url.pathname === '/api/apps') {
    await handleAppApi(req, res, method, url);
    return;
  }

  if (url.pathname === '/api/apps/generate') {
    if (method !== 'POST') throw notFound('API 不存在。');
    await handleGenerateApp(req, res);
    return;
  }

  if (url.pathname === '/api/apps/import') {
    if (method !== 'POST') throw notFound('API 不存在。');
    await handleImportApp(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/apps/')) {
    await handleRuntimeApi(req, res, method, url);
    return;
  }

  throw notFound('API 不存在。');
}

const isMain = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith('/' + process.argv[1].split('/').pop())
);
if (isMain) {
  createAppServer().listen(PORT, '0.0.0.0', () => {
    console.log(`Software Garden MVP running at http://localhost:${PORT}`);
  });
}
