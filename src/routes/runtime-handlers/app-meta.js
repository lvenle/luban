import { updateAppMetadata, updateAppPackage } from '../../models/app.js';
import { sendJson, readJson, saveUploadedFile } from '../_helpers.js';

export async function handleAppMetaApi(req, res, method, parts, app, appId, url) {
  if (method === 'DELETE' && parts.length === 3) {
    const { deleteApp } = await import('../../models/app.js');
    deleteApp(appId);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (method === 'GET' && parts.length === 3) {
    sendJson(res, 200, { app });
    return true;
  }

  if (method === 'POST' && parts[3] === 'uploads') {
    const file = await saveUploadedFile(req, appId, url);
    sendJson(res, 201, { file });
    return true;
  }

  if (method === 'PUT' && parts.length === 3) {
    const body = await readJson(req);
    const nextApp = updateAppMetadata(appId, body);
    sendJson(res, 200, { app: nextApp });
    return true;
  }

  if (method === 'PUT' && parts[3] === 'package') {
    const body = await readJson(req);
    const nextApp = updateAppPackage(appId, body.package, { expectedUpdatedAt: body.expectedUpdatedAt });
    sendJson(res, 200, { app: nextApp });
    return true;
  }

  return false;
}
