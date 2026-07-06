import { listSamples, importSamples } from '../samples/library.js';
import { sendJson, readJson, notFound, badRequest } from './_helpers.js';

export async function handleSamplesApi(req, res, method, url) {
  if (method === 'GET' && url.pathname === '/api/samples') {
    sendJson(res, 200, { samples: listSamples() });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/samples/import') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
    if (!ids.length) throw badRequest('请选择要导入的样例。');
    const imported = importSamples(ids);
    sendJson(res, 201, { imported });
    return;
  }
  throw notFound('API 不存在。');
}
