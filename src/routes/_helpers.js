import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PUBLIC_DIR = join(process.cwd(), 'public');
const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads');
const JSON_LIMIT = 2 * 1024 * 1024;
export const FILE_LIMIT = 20 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

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

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function sendText(res, status, text, contentType, downloadName) {
  const headers = { 'content-type': contentType };
  if (downloadName) headers['content-disposition'] = `attachment; filename="${downloadName}"`;
  res.writeHead(status, headers);
  res.end(text);
}

export function sendBinary(res, status, bytes, contentType, downloadName) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${downloadName}"`
  });
  res.end(Buffer.from(bytes));
}

export async function readJson(req) {
  const text = Buffer.concat(await collect(req, JSON_LIMIT)).toString('utf8') || '{}';
  return JSON.parse(text);
}

export async function readBuffer(req, maxBytes = FILE_LIMIT) {
  return Buffer.concat(await collect(req, maxBytes));
}

function collect(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBytes) { req.resume?.(); reject(payloadTooLarge(maxBytes)); return; }
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) { failed = true; reject(payloadTooLarge(maxBytes)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

function payloadTooLarge(maxBytes) {
  const error = new Error(`请求内容过大，最大允许 ${Math.floor(maxBytes / 1024 / 1024)} MB。`);
  error.status = 413;
  return error;
}

export function notFound(message) {
  return new HttpError(404, message);
}

export function badRequest(message) {
  return new HttpError(400, message);
}

export function statusForError(error) {
  return error.status || (error.name === 'SyntaxError' ? 400 : 500);
}

export function requireFields(body, requiredFields) {
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      throw badRequest(`请求缺少必填字段：${field}`);
    }
  }
}

export async function saveUploadedFile(req, appId, url) {
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

export function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${requested}`);
  if (!isInside(PUBLIC_DIR, filePath) || !existsSync(filePath)) {
    if (pathname.startsWith('/app/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(PUBLIC_DIR, 'index.html')));
      return;
    }
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

export function serveUpload(res, pathname) {
  let requested = '';
  try { requested = decodeURIComponent(pathname.replace(/^\/uploads\//, '')); } catch { return sendText(res, 400, 'Bad path', 'text/plain; charset=utf-8'); }
  const filePath = resolve(UPLOAD_DIR, requested);
  if (!isInside(UPLOAD_DIR, filePath) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    ...(safeInlineExtension(extname(filePath)) ? {} : { 'content-disposition': `attachment; filename="${basename(filePath)}"` })
  });
  res.end(readFileSync(filePath));
}

function isInside(root, filePath) {
  const path = relative(root, filePath);
  return path === '' || (!path.startsWith('..') && !path.includes(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function safeInlineExtension(extension) {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf'].includes(String(extension).toLowerCase());
}

export function serveIndexHtml(res) {
  const filePath = join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(filePath));
}
