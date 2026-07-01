import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError, notFound, badRequest } from '../core/errors.js';

export { notFound, badRequest } from '../core/errors.js';

const PUBLIC_DIR = join(process.cwd(), 'public');
const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads');
const JSON_LIMIT = 2 * 1024 * 1024;
export const FILE_LIMIT = 20 * 1024 * 1024;

export class HttpError extends AppError {}

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
    if (declared > maxBytes) { req.destroy(); reject(payloadTooLarge(maxBytes)); return; }
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) { failed = true; req.destroy(); reject(payloadTooLarge(maxBytes)); return; }
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
  const extension = safeExtension(originalName, mimeType);
  // 验证文件内容（magic bytes）是否与扩展名一致，防止恶意文件伪装
  const contentType = detectContentType(extension, bytes);
  if (!contentType.valid) {
    const error = new Error(`文件内容与扩展名不匹配，请上传正确格式的文件。`);
    error.status = 400;
    throw error;
  }
  const appUploadDir = join(UPLOAD_DIR, appId);
  mkdirSync(appUploadDir, { recursive: true });
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

const MAGIC_BYTES = {
  '.png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  '.jpg': [[0xFF, 0xD8, 0xFF]],
  '.jpeg': [[0xFF, 0xD8, 0xFF]],
  '.gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  '.webp': [[0x52, 0x49, 0x46, 0x46], [0x57, 0x45, 0x42, 0x50]], // RIFF + WEBP at offset 0 and 8
  '.pdf': [[0x25, 0x50, 0x44, 0x46]]
};

function detectContentType(extension, bytes) {
  const signatures = MAGIC_BYTES[extension];
  if (!signatures) return { valid: true, detectedType: extension }; // 未知类型不做校验
  // 对于 WebP 需要检查 RIFF 头 + WEBP 标识（offset 8）
  if (extension === '.webp') {
    if (bytes.length < 12) return { valid: false, detectedType: 'unknown' };
    const riff = bytes.slice(0, 4).every((b, i) => b === signatures[0][i]);
    const webp = bytes.slice(8, 12).every((b, i) => b === signatures[1][i]);
    return { valid: riff && webp, detectedType: riff && webp ? 'image/webp' : 'unknown' };
  }
  const match = signatures.some((sig) =>
    bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b)
  );
  return { valid: match, detectedType: match ? extension : 'unknown' };
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
  const isRuleSpaRoute = pathname === '/rules'
    || pathname === '/rules/'
    || pathname === '/rules/ai-config'
    || pathname === '/rules/ai-config/'
    || /^\/rules\/[^/.]+\/?$/.test(pathname);
  if (pathname.startsWith('/app/') || isRuleSpaRoute) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(PUBLIC_DIR, 'index.html')));
    return;
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${requested}`);
  if (!isInside(PUBLIC_DIR, filePath) || !existsSync(filePath)) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-cache, no-store, must-revalidate'
  });
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
