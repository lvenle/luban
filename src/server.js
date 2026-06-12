import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import {
  createAppFromPackage,
  createRecord,
  deleteApp,
  deleteRecord,
  exportAppPayload,
  getApp,
  getPackageFromApp,
  getSetting,
  importAppPayload,
  listApps,
  listRecords,
  setSetting,
  updateAppMetadata,
  updateAppPackage,
  updateRecord
} from './db.js';
import { generatePackageFromPrompt, generatePatchFromPrompt } from './ai.js';
import { applyPatch, preparePackage } from './packageProtocol.js';
import { runAction, toCsv } from './actions.js';
import { packageToZipPayload, zipPayloadToPackage } from './zip.js';
import { recordsToXlsx } from './xlsx.js';

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = join(process.cwd(), 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export function createAppServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
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
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/apps') {
    sendJson(res, 200, { apps: listApps() });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/apps/generate') {
    const body = await readJson(req);
    const logs = ['收到创建需求', '读取 AI 配置', '生成软件包 JSON'];
    const settings = getSetting('ai') || {};
    const pkg = preparePackage(await generatePackageFromPrompt(body.prompt, settings));
    logs.push('软件包协议校验通过');
    const app = createAppFromPackage(pkg);
    logs.push('软件已安装到本地 SQLite');
    sendJson(res, 201, { appId: app.id, app, logs });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/apps/import') {
    const contentType = req.headers['content-type'] || '';
    let payload;
    if (contentType.includes('application/octet-stream')) {
      const buffer = await readBuffer(req);
      payload = zipPayloadToPackage(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    } else {
      payload = (await readJson(req)).package;
    }
    const app = importAppPayload(payload);
    sendJson(res, 201, { appId: app.id, app });
    return;
  }

  if (parts[1] === 'settings') {
    if (method === 'GET') {
      sendJson(res, 200, { ai: getSetting('ai') || { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini' } });
      return;
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      sendJson(res, 200, { ai: setSetting('ai', body.ai || {}) });
      return;
    }
  }

  if (parts[1] === 'apps' && parts[2]) {
    const appId = parts[2];
    const app = getApp(appId);
    if (!app) throw notFound('找不到应用。');

    if (method === 'GET' && parts.length === 3) {
      sendJson(res, 200, { app });
      return;
    }

    if (method === 'DELETE' && parts.length === 3) {
      deleteApp(appId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'PUT' && parts.length === 3) {
      const body = await readJson(req);
      const nextApp = updateAppMetadata(appId, body);
      sendJson(res, 200, { app: nextApp });
      return;
    }

    if (method === 'PUT' && parts[3] === 'package') {
      const body = await readJson(req);
      const nextApp = updateAppPackage(appId, body.package);
      sendJson(res, 200, { app: nextApp });
      return;
    }

    if (method === 'POST' && parts[3] === 'modify') {
      const body = await readJson(req);
      const logs = ['收到修改需求', '读取当前软件包', '生成 Patch'];
      const settings = getSetting('ai') || {};
      const patch = await generatePatchFromPrompt(body.prompt, getPackageFromApp(app), settings);
      logs.push(`Patch 包含 ${patch.operations?.length || 0} 个操作`);
      const nextPackage = applyPatch(getPackageFromApp(app), patch);
      logs.push('Patch 应用并重新校验通过');
      const nextApp = updateAppPackage(appId, nextPackage);
      logs.push('软件新版本已保存');
      sendJson(res, 200, { summary: patch.summary || '已修改软件。', patch, app: nextApp, logs });
      return;
    }

    if (method === 'GET' && parts[3] === 'records') {
      sendJson(res, 200, { records: listRecords(appId, { entityId: url.searchParams.get('entity'), q: url.searchParams.get('q') }) });
      return;
    }

    if (method === 'POST' && parts[3] === 'records') {
      const body = await readJson(req);
      const entityId = body.entityId || app.schema.entities[0]?.id;
      sendJson(res, 201, { record: createRecord(appId, entityId, body.data || {}) });
      return;
    }

    if (method === 'PUT' && parts[3] === 'records' && parts[4]) {
      const body = await readJson(req);
      sendJson(res, 200, { record: updateRecord(parts[4], body.data || {}) });
      return;
    }

    if (method === 'DELETE' && parts[3] === 'records' && parts[4]) {
      deleteRecord(parts[4]);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && parts[3] === 'export.csv') {
      const records = listRecords(appId, { entityId: url.searchParams.get('entity') || undefined });
      sendText(res, 200, toCsv(records), 'text/csv; charset=utf-8', `${app.slug}.csv`);
      return;
    }

    if (method === 'GET' && parts[3] === 'export.xlsx') {
      const entityId = url.searchParams.get('entity') || undefined;
      const entity = app.schema.entities.find((item) => item.id === entityId) || app.schema.entities[0];
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map((id) => id.trim()).filter(Boolean));
      const records = listRecords(appId, { entityId }).filter((record) => !ids.size || ids.has(record.id));
      const xlsx = recordsToXlsx(records, entity);
      sendBinary(res, 200, xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${app.slug}.xlsx`);
      return;
    }

    if (method === 'GET' && parts[3] === 'export') {
      const payload = exportAppPayload(appId, url.searchParams.get('data') || 'structure');
      const zip = packageToZipPayload(payload);
      sendBinary(res, 200, zip, 'application/octet-stream', `${app.slug}.sgpkg`);
      return;
    }

    if (method === 'POST' && parts[3] === 'actions' && parts[4] && parts[5] === 'run') {
      sendJson(res, 200, await runAction(app, parts[4]));
      return;
    }
  }

  throw notFound('API 不存在。');
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType, downloadName) {
  const headers = { 'content-type': contentType };
  if (downloadName) headers['content-disposition'] = `attachment; filename="${downloadName}"`;
  res.writeHead(status, headers);
  res.end(text);
}

function sendBinary(res, status, bytes, contentType, downloadName) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${downloadName}"`
  });
  res.end(Buffer.from(bytes));
}

async function readJson(req) {
  const text = Buffer.concat(await collect(req)).toString('utf8') || '{}';
  return JSON.parse(text);
}

async function readBuffer(req) {
  return Buffer.concat(await collect(req));
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function statusForError(error) {
  return error.status || (error.name === 'SyntaxError' ? 400 : 500);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAppServer().listen(PORT, () => {
    console.log(`Software Garden MVP running at http://localhost:${PORT}`);
  });
}
