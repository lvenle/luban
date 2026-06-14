import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import {
  createAppFromPackage,
  createRecord,
  deleteApp,
  deleteRecord,
  exportAppPayload,
  getApp,
  getDb,
  getPackageFromApp,
  getRecordRelations,
  getSetting,
  importAppPayload,
  listRelationOptions,
  listApps,
  listRecords,
  setSetting,
  updateAppMetadata,
  updateAppPackage,
  updateRecordRelations,
  updateRecord
} from './db.js';
import { generatePackageFromPrompt, generatePatchFromPrompt } from './ai.js';
import { applyPatch, preparePackage } from './packageProtocol.js';
import { normalizeFieldId } from './ids.js';
import { handleAiApi } from './routes/ai.js';
import { runAction } from './actions.js';
import { toCsv } from './utils/export.js';
import { packageToZipPayload, zipPayloadToPackage } from './zip.js';
import { recordsToXlsx } from './xlsx.js';
import {
  createTableInApp,
  updateTableInApp,
  deleteTableInApp,
  clearTableRecordsInApp,
  importTableRecordsInApp,
  createFieldInApp,
  updateFieldInApp,
  deleteFieldInApp,
  uniqueFieldId
} from './operations.js';

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = join(process.cwd(), 'public');
const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
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
    requireFields(body, ['prompt']);
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

  if (parts[1] === 'ai') {
    await handleAiApi(req, res, method, parts, url);
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

    if (method === 'POST' && parts[3] === 'uploads') {
      const file = await saveUploadedFile(req, appId, url);
      sendJson(res, 201, { file });
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

    if (parts[3] === 'tables') {
      await handleTablesApi(req, res, method, parts, app, url);
      return;
    }

    if (parts[3] === 'fields' && parts[4] && parts[5]) {
      const entityId = parts[4];
      const fieldId = parts[5];
      if (method === 'GET' && parts[6] === 'relation-options') {
        sendJson(res, 200, { options: listRelationOptions(appId, entityId, fieldId, url.searchParams.get('keyword') || '') });
        return;
      }
      if (method === 'PATCH') {
        const body = await readJson(req);
        sendJson(res, 200, { app: updateFieldInApp(app, entityId, fieldId, body.field || body) });
        return;
      }
      if (method === 'DELETE') {
        sendJson(res, 200, { app: deleteFieldInApp(app, entityId, fieldId) });
        return;
      }
    }

    if (method === 'POST' && parts[3] === 'modify') {
      const body = await readJson(req);
      requireFields(body, ['prompt']);
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
      const entityId = url.searchParams.get('entity');
      const records = entityId ? listRecords(appId, { entityId, q: url.searchParams.get('q') }) : [];
      sendJson(res, 200, { records });
      return;
    }

    if (method === 'POST' && parts[3] === 'records') {
      const body = await readJson(req);
      const entityId = body.entityId || app.schema.entities[0]?.id;
      if (!entityId) throw badRequest('请求缺少 entityId 且应用没有默认实体。');
      if (!app.schema.entities.some((entity) => entity.id === entityId)) throw notFound(`实体不存在：${entityId}`);
      sendJson(res, 201, { record: createRecord(appId, entityId, body.data || {}) });
      return;
    }

    if (method === 'PUT' && parts[3] === 'records' && parts[4]) {
      const body = await readJson(req);
      sendJson(res, 200, { record: updateRecord(parts[4], body.data || {}) });
      return;
    }

    if (method === 'DELETE' && parts[3] === 'records' && parts[4]) {
      deleteRecord(parts[4], { force: url.searchParams.get('force') === 'true' });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (parts[3] === 'records' && parts[4] && parts[5] === 'relations' && parts[6]) {
      if (method === 'GET') {
        sendJson(res, 200, { relations: getRecordRelations(parts[4], parts[6]) });
        return;
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        sendJson(res, 200, { relations: updateRecordRelations(parts[4], parts[6], body.targetRecordIds || []) });
        return;
      }
    }

    if (method === 'GET' && parts[3] === 'export.csv') {
      const entityId = url.searchParams.get('entity') || app.schema.entities[0]?.id;
      if (!entityId) throw badRequest('没有可导出的实体。');
      const entity = app.schema.entities.find((item) => item.id === entityId);
      if (!entity) throw notFound('找不到要导出的实体。');
      const records = listRecords(appId, { entityId });
      sendText(res, 200, toCsv(records, entity), 'text/csv; charset=utf-8', `${app.slug}.csv`);
      return;
    }

    if (method === 'GET' && parts[3] === 'export.xlsx') {
      const entityId = url.searchParams.get('entity') || app.schema.entities[0]?.id;
      if (!entityId) throw badRequest('没有可导出的实体。');
      const entity = app.schema.entities.find((item) => item.id === entityId);
      if (!entity) throw notFound('找不到要导出的实体。');
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

async function handleTablesApi(req, res, method, parts, app, url) {
  if (method === 'GET' && parts.length === 4) {
    sendJson(res, 200, { tables: app.schema.entities });
    return;
  }
  if (method === 'POST' && parts.length === 4) {
    const body = await readJson(req);
    sendJson(res, 201, { app: createTableInApp(app, body) });
    return;
  }
  const entityId = parts[4];
  if (!entityId) throw notFound('表 API 不存在。');
  if (parts[5] === 'records') {
    if (method === 'DELETE') {
      sendJson(res, 200, clearTableRecordsInApp(app, entityId));
      return;
    }
    throw notFound('表数据 API 不存在。');
  }
  if (parts[5] === 'import' && method === 'POST') {
    const fileName = decodeURIComponent(url.searchParams.get('name') || req.headers['x-file-name'] || 'import.csv');
    sendJson(res, 200, await importTableRecordsInApp(req, app, entityId, fileName));
    return;
  }
  if (method === 'PATCH') {
    const body = await readJson(req);
    sendJson(res, 200, { app: updateTableInApp(app, entityId, body) });
    return;
  }
  if (method === 'DELETE') {
    sendJson(res, 200, { app: deleteTableInApp(app, entityId) });
    return;
  }
  if (parts[5] === 'fields') {
    const entity = app.schema.entities.find((item) => item.id === entityId);
    if (!entity) throw notFound('找不到表。');
    if (method === 'GET') {
      sendJson(res, 200, { fields: entity.fields || [] });
      return;
    }
    if (method === 'POST') {
      const body = await readJson(req);
      sendJson(res, 201, { app: createFieldInApp(app, entityId, body.field || body) });
      return;
    }
  }
  throw notFound('表 API 不存在。');
}

async function saveUploadedFile(req, appId, url) {
  const originalName = safeOriginalName(url.searchParams.get('name') || req.headers['x-file-name'] || 'upload.bin');
  const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const bytes = await readBuffer(req);
  const appUploadDir = join(UPLOAD_DIR, appId);
  mkdirSync(appUploadDir, { recursive: true });
  const extension = safeExtension(originalName, mimeType);
  const storedName = `${randomUUID()}${extension}`;
  const filePath = join(appUploadDir, storedName);
  writeFileSync(filePath, bytes);
  return {
    name: originalName,
    url: `/uploads/${encodeURIComponent(appId)}/${encodeURIComponent(storedName)}`,
    mimeType,
    size: bytes.length
  };
}

function safeOriginalName(name) {
  return basename(String(name || 'upload.bin')).replace(/[^\w.\-\u4e00-\u9fa5 ]/g, '_').slice(0, 180) || 'upload.bin';
}

function safeExtension(name, mimeType) {
  const extension = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/.test(extension)) return extension;
  const mimeExtensions = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
  };
  return mimeExtensions[mimeType] || '.bin';
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

function serveUpload(res, pathname) {
  const requested = decodeURIComponent(pathname.replace(/^\/uploads\//, ''));
  const filePath = normalize(join(UPLOAD_DIR, requested));
  if (!filePath.startsWith(UPLOAD_DIR) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable'
  });
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

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function statusForError(error) {
  return error.status || (error.name === 'SyntaxError' ? 400 : 500);
}

function requireFields(body, requiredFields) {
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      throw badRequest(`请求缺少必填字段：${field}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAppServer().listen(PORT, () => {
    console.log(`Software Garden MVP running at http://localhost:${PORT}`);
  });
}
