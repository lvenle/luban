import { getSetting } from '../models/session.js';
import { generatePackageFromPrompt } from '../ai/service.js';
import { preparePackage } from '../core/packageProtocol.js';
import { createAppFromPackage, listApps, moveApp } from '../models/app.js';
import { importAppPayload } from '../services/package-transfer.js';
import { zipPayloadToPackage } from '../utils/zip.js';
import { sendJson, readJson, readBuffer, requireFields, notFound } from './_helpers.js';

export async function handleAppApi(req, res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { apps: listApps() });
    return;
  }
  throw notFound('API 不存在。');
}

export async function handleAppOrder(req, res, method) {
  if (method !== 'PUT') throw notFound('API 不存在。');
  const body = await readJson(req);
  requireFields(body, ['appId', 'targetId']);
  sendJson(res, 200, { apps: moveApp(body.appId, body.targetId, body.position === 'after' ? 'after' : 'before') });
}

export async function handleGenerateApp(req, res) {
  const body = await readJson(req);
  requireFields(body, ['prompt']);
  const logs = ['收到创建需求', '读取 AI 配置', '生成软件包 JSON'];
  const settings = getSetting('ai') || {};
  const pkg = preparePackage(await generatePackageFromPrompt(body.prompt, settings));
  logs.push('软件包协议校验通过');
  const app = createAppFromPackage(pkg);
  logs.push('软件已安装到本地 SQLite');
  sendJson(res, 201, { appId: app.id, app, logs });
}

export async function handleImportApp(req, res) {
  const contentType = req.headers['content-type'] || '';
  let payload;
  if (contentType.includes('application/octet-stream')) {
    const buffer = await readBuffer(req);
    payload = zipPayloadToPackage(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  } else {
    payload = (await readJson(req)).package;
  }
  const app = await importAppPayload(payload);
  sendJson(res, 201, { appId: app.id, app });
}
