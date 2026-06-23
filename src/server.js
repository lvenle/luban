import { createServer } from 'node:http';
import { sendJson, statusForError, serveStatic, serveUpload, HttpError } from './routes/_helpers.js';
import { handleAiApi } from './routes/ai.js';
import { handleAppApi, handleGenerateApp, handleImportApp } from './routes/app.js';
import { handleRuntimeApi } from './routes/runtime.js';
import { handleSettingsApi } from './routes/settings.js';
import { initDb, closeDb } from './storage/db.js';

const PORT = Number(process.env.PORT || 5173);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 100);
const RATE_LIMIT_WINDOW = 60_000;

// Simple in-memory sliding-window rate limiter (per IP)
const rateBuckets = new Map();
let rateLimitCleanup = null;

function rateLimit(ip) {
  if (!rateLimitCleanup) {
    rateLimitCleanup = setInterval(() => {
      const cutoff = Date.now() - RATE_LIMIT_WINDOW * 2;
      for (const [key, entries] of rateBuckets) {
        const valid = entries.filter((t) => t > cutoff);
        if (valid.length) rateBuckets.set(key, valid);
        else rateBuckets.delete(key);
      }
    }, RATE_LIMIT_WINDOW).unref();
  }
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW;
  let entries = rateBuckets.get(ip);
  if (!entries) {
    entries = [];
    rateBuckets.set(ip, entries);
  }
  // Prune entries outside the current window
  while (entries.length && entries[0] <= cutoff) entries.shift();
  if (entries.length >= RATE_LIMIT_MAX) return false;
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
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith('/uploads/')) {
        serveUpload(res, url.pathname);
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
    if (method !== 'POST') throw new HttpError(404, 'API 不存在。');
    await handleGenerateApp(req, res);
    return;
  }

  if (url.pathname === '/api/apps/import') {
    if (method !== 'POST') throw new HttpError(404, 'API 不存在。');
    await handleImportApp(req, res);
    return;
  }

  if (url.pathname.startsWith('/api/apps/')) {
    await handleRuntimeApi(req, res, method, url);
    return;
  }

  throw new HttpError(404, 'API 不存在。');
}

const isMain = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith('/' + process.argv[1].split('/').pop())
);
if (isMain) {
  // On Render (free tier), the filesystem is ephemeral — every redeploy
  // wipes the SQLite database.  initDb() downloads the .sqlite file from
  // Supabase Storage (if configured) before the server starts, and sets
  // up a periodic backup timer so data survives redeploys.
  //
  // Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET
  initDb().then(() => {
    const server = createAppServer().listen(PORT, '0.0.0.0', () => {
      console.log(`Software Garden MVP running at http://localhost:${PORT}`);
    });

    // Graceful shutdown — upload the database to Supabase before exiting
    const shutdown = async (signal) => {
      console.log(`\n收到 ${signal}，正在关闭服务...`);
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
