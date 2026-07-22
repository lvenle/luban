import { createServer } from 'node:http';
import { sendJson, statusForError, serveStatic, serveUpload, HttpError } from './routes/_helpers.js';
import { handleAiApi } from './routes/ai.js';
import { handleAppApi, handleAppOrder, handleGenerateApp, handleImportApp } from './routes/app.js';
import { handleRuntimeApi } from './routes/runtime.js';
import { handleSettingsApi } from './routes/settings.js';
import { handleAuthApi } from './routes/auth.js';
import { handleSamplesApi } from './routes/samples.js';
import { initDb, closeDb } from './storage/db.js';
import { getApp } from './models/app.js';
import { getRuntimeSettings } from './models/runtime-settings.js';
import { requireAuthenticated } from './models/auth.js';
import { startScheduledTaskRunner, stopScheduledTaskRunner } from './services/scheduled-task-runner.js';

const APP_VERSION = '2026.06.25';
const PORT = Number(process.env.PORT || 5173);
const DESKTOP_TOKEN = process.env.LUBAN_DESKTOP_TOKEN || '';

// Simple in-memory sliding-window rate limiter (per IP)
const rateBuckets = new Map();
let rateLimitCleanup = null;

function rateLimit(ip) {
  const settings = getRuntimeSettings();
  const maxRequests = Number(process.env.RATE_LIMIT_MAX || settings.apiRateLimitMax);
  const windowMs = settings.rateLimitWindowMs;
  if (!rateLimitCleanup) {
    rateLimitCleanup = setInterval(() => {
      const cutoff = Date.now() - getRuntimeSettings().rateLimitWindowMs * 2;
      for (const [key, entries] of rateBuckets) {
        const valid = entries.filter((t) => t > cutoff);
        if (valid.length) rateBuckets.set(key, valid);
        else rateBuckets.delete(key);
      }
    }, getRuntimeSettings().rateLimitWindowMs).unref();
  }
  const now = Date.now();
  const cutoff = now - windowMs;
  let entries = rateBuckets.get(ip);
  if (!entries) {
    entries = [];
    rateBuckets.set(ip, entries);
  }
  // Prune entries outside the current window
  while (entries.length && entries[0] <= cutoff) entries.shift();
  if (entries.length >= maxRequests) return false;
  entries.push(now);
  return true;
}


function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('x-xss-protection', '1; mode=block');
  res.setHeader('referrer-policy', 'same-origin');
  // CSP: unsafe-inline for style + event handlers; connect-src for AI API
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; font-src 'self' data:"
  );
}

export function serveHtmlPreview(req, res, pathname) {
  if (req.method !== 'GET') throw new HttpError(404, '预览地址不存在。');
  const match = pathname.match(/^\/html-preview\/([^/]+)\/([^/]+)\/?$/);
  if (!match) throw new HttpError(404, '预览地址不存在。');
  let appId;
  let pageId;
  try {
    appId = decodeURIComponent(match[1]);
    pageId = decodeURIComponent(match[2]);
  } catch {
    throw new HttpError(400, '预览地址无效。');
  }
  const app = getApp(appId);
  if (!app) throw new HttpError(404, '软件不存在。');
  const page = app.ui?.pages?.find((item) => item.id === pageId && item.navKind === 'webpage');
  if (!page) throw new HttpError(404, '网页不存在。');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups; default-src http: https: data: blob:; script-src http: https: 'unsafe-inline' 'unsafe-eval' blob:; style-src http: https: 'unsafe-inline'; img-src http: https: data: blob:; font-src http: https: data:; connect-src http: https:"
  });
  res.end(String(page.content || ''));
}

function logRequest(method, pathname, status, duration, userAgent) {
  const entry = { method, pathname, status, duration };
  if (status >= 500) entry.level = 'error';
  console.log(JSON.stringify(entry));
}

export function createAppServer() {
  return createServer(async (req, res) => {
    const start = Date.now();
    let status = 200;
    let logged = false;
    const logLater = () => {
      if (logged) return;
      logged = true;
      const duration = Date.now() - start;
      logRequest(req.method || 'GET', new URL(req.url, `http://${req.headers.host}`).pathname, status, duration, req.headers['user-agent'] || '');
    };

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // 静态资源和上传不走 API 异常日志
      if (url.pathname.startsWith('/api/') || url.pathname === '/') {
        securityHeaders(res);
      }

      if (DESKTOP_TOKEN && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/html-preview/'))) {
        if (req.headers['x-luban-desktop-token'] !== DESKTOP_TOKEN) {
          status = 403;
          sendJson(res, 403, { error: '无权访问本地应用服务。' });
          return;
        }
      }

      // Rate limit for API routes (health check exempt)
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        if (!rateLimit(clientIp)) {
          status = 429;
          sendJson(res, 429, { error: '请求过于频繁，请稍后再试。' });
          return;
        }
      }

      if (url.pathname.startsWith('/api/')) {
        if (!isAuthExemptApi(req.method || 'GET', url.pathname)) requireAuthenticated(req);
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith('/uploads/')) {
        requireAuthenticated(req);
        serveUpload(res, url.pathname);
        return;
      }
      if (url.pathname.startsWith('/html-preview/')) {
        requireAuthenticated(req);
        serveHtmlPreview(req, res, url.pathname);
        return;
      }
      // Static files — only CSP headers for HTML
      if (url.pathname.endsWith('.html') || url.pathname === '/') {
        securityHeaders(res);
      }
      serveStatic(res, url.pathname);
    } catch (error) {
      status = statusForError(error);
      if (status >= 500) {
        console.error(`[ERROR] ${req.method} ${new URL(req.url, `http://${req.headers.host}`).pathname}:`, error.stack || error.message);
      }
      sendJson(res, status, { error: error.message, details: error.details || undefined });
    } finally {
      // Capture actual status from response if available
      if (res.statusCode && res.statusCode !== 200) status = res.statusCode;
      logLater();
    }
  });
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/version') {
    sendJson(res, 200, { version: APP_VERSION });
    return;
  }

  if (url.pathname.startsWith('/api/auth/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    await handleAuthApi(req, res, method, parts);
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

  if (url.pathname === '/api/samples' || url.pathname === '/api/samples/import') {
    await handleSamplesApi(req, res, method, url);
    return;
  }

  if (url.pathname === '/api/apps') {
    await handleAppApi(req, res, method, url);
    return;
  }

  if (url.pathname === '/api/apps/generate') {
    if (method !== 'POST') throw new HttpError(404, 'API 不存在。');
    await handleGenerateApp(req, res);
    return;
  }

  if (url.pathname === '/api/apps/import') {
    if (method !== 'POST') throw new HttpError(404, 'API 不存在。');
    await handleImportApp(req, res);
    return;
  }

  if (url.pathname === '/api/apps/order') {
    await handleAppOrder(req, res, method);
    return;
  }

  if (url.pathname.startsWith('/api/apps/')) {
    await handleRuntimeApi(req, res, method, url);
    return;
  }

  throw new HttpError(404, 'API 不存在。');
}

function isAuthExemptApi(method, pathname) {
  return (method === 'GET' && pathname === '/api/health')
    || (method === 'GET' && pathname === '/api/version')
    || pathname.startsWith('/api/auth/');
}

const isMain = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith('/' + process.argv[1].split('/').pop())
);
if (isMain) {
  // On server deployments (Render, etc.) with SUPABASE_URL and SUPABASE_SERVICE_KEY
  // configured, the SQLite database is synced to Supabase Storage so data survives
  // redeploys.  Locally (no env vars), everything works with the local SQLite file.
  initDb().then(() => {
    startScheduledTaskRunner();
    const server = createAppServer().listen(PORT, '0.0.0.0', () => {
      console.log(`luban-ai MVP running at http://localhost:${PORT}`);
    });

    // Graceful shutdown — upload the database to Supabase before exiting
    const shutdown = async (signal) => {
      console.log(`\n收到 ${signal}，正在关闭服务...`);
      stopScheduledTaskRunner();
      server.close(() => {
        closeDb().then(() => process.exit(0)).catch(() => process.exit(1));
      });
      // Force exit after 8 seconds if closeDb hangs
      setTimeout(() => process.exit(1), 8_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }).catch((err) => {
    console.error('[fatal] Failed to initialize database:', err);
    process.exit(1);
  });
}
