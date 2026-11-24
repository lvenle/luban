import { applicationRequestContext, applicationRunOwner, requireApplicationManager } from '../hosting/request-context.js';
import { normalizeWebBase, normalizeApplicationLinks, documentWithBase } from '../hosting/web-base.js';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { askKnowledge } from './knowledge-workspace.js';
import { createPlatformService } from './platform-service.js';

/** 最小 multipart/form-data 解析：只取名为 file 的文件字段。 */
function parseMultipartFile(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(contentType || '');
  if (!m) throw new Error('缺少 multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  let start = buffer.indexOf(boundary);
  if (start < 0) throw new Error('multipart 格式无效');
  start += boundary.length;
  if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) throw new Error('未找到文件字段');
  if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
  const headerEnd = buffer.indexOf('\r\n\r\n', start);
  if (headerEnd < 0) throw new Error('multipart 头部无效');
  const headers = buffer.toString('latin1', start, headerEnd);
  if (!/name="file"/.test(headers)) throw new Error('未找到文件字段');
  const fn = /filename="([^"]*)"/.exec(headers);
  const filename = fn ? fn[1].split(/[\\/]/).pop() : '';
  if (!filename) throw new Error('未找到文件名');
  const dataStart = headerEnd + 4;
  let dataEnd = buffer.indexOf(boundary, dataStart);
  if (dataEnd < 0) throw new Error('multipart 结尾无效');
  if (buffer[dataEnd - 2] === 0x0d && buffer[dataEnd - 1] === 0x0a) dataEnd -= 2;
  return { filename, bytes: buffer.subarray(dataStart, dataEnd) };
}

export async function servePlatform({ directory, port = 5190, authorizeRequest, consolePages, consoleMode = 'full', publicBasePath = '/', applicationLinks = [], workbenchNavigation = null, assistantRegistry = null, knowledgeEnabled = true, listen = true, ...options }) {
  normalizeWebBase(publicBasePath);
  applicationLinks = normalizeApplicationLinks(applicationLinks);
  const productId = options.productId || 'standalone';
  const service = await createPlatformService({ directory, ...options });
  const defaultUiDirectory = resolve(fileURLToPath(new URL('../../ui-vue/dist/', import.meta.url)));
  const adminUiDirectory = resolve(fileURLToPath(new URL('../../ui-vue/admin-dist/', import.meta.url)));
  const uiDistDirectory = consoleMode === 'admin' && existsSync(resolve(adminUiDirectory, 'index.html')) ? adminUiDirectory : defaultUiDirectory;
  let adminBundle = false;
  if (consoleMode === 'admin') {
    try { adminBundle = JSON.parse(readFileSync(resolve(uiDistDirectory, 'console-manifest.json'), 'utf8')).mode === 'admin'; } catch { /* fail closed when only the full product UI exists */ }
  }
  const server = createServer(async (req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const expectedHost = `127.0.0.1:${req.socket.localPort}`;
      if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return send(403, { error: 'Local origin required' });
      if (authorizeRequest && !await authorizeRequest(req)) return send(403, { error: 'Host authorization required' });
      if (req.method === 'GET' && req.url.split('?')[0] === '/healthz') return send(200, { status: 'ok' });
      if (/^\/(?:app-assets)(?:\/|$)/.test(new URL(req.url, `http://${expectedHost}`).pathname)) return send(404, { error: 'Not found' });
      // SPA 兜底：除 API 与静态资源外，所有 GET 都返回应用外壳，交给前端路由。
      // 这里原本是手写白名单，新增页签一旦忘记同步，刷新页面就会 404。
      const isApiPath = req.url.startsWith('/api/agent/v1');
      if (consoleMode === 'admin' && !adminBundle && !isApiPath) return send(503, { error: '后台控制台尚未构建，请运行 npm run ui:build:admin' });
      if (req.method === 'GET' && !isApiPath && !req.url.startsWith('/assets/')) {
        const pathname = new URL(req.url, `http://${expectedHost}`).pathname;
        const section = pathname.split('/')[1];
        if (consolePages && pathname !== '/' && !consolePages.includes(section)) return send(404, { error: 'Page not included in this console' });
        const vueIndex = resolve(uiDistDirectory, 'index.html');
        if (existsSync(vueIndex)) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(documentWithBase(readFileSync(vueIndex, 'utf8'), publicBasePath, applicationLinks, workbenchNavigation || {platformBase:publicBasePath,wechatHref:applicationLinks.find(link=>link.name==='智能微信')?.href||'http://127.0.0.1:8793/',dbHref:applicationLinks.find(link=>link.name==='AI-DB')?.href||'http://127.0.0.1:8790/'})); return;
        }
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('Vue 控制台尚未构建，请先运行 npm run ui:build。'); return;
      }
      if (req.method === 'GET' && req.url.startsWith('/assets/')) {
        const assetName = req.url.split('?')[0].slice('/assets/'.length);
        const asset = resolve(uiDistDirectory, 'assets', assetName);
        if (existsSync(asset)) {
          const type = asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(readFileSync(asset)); return;
        }
      }
      if (!req.url.startsWith('/api/agent/v1/')) return send(404, { error: 'Not found' });
      const apiPath = req.url.slice('/api/agent/v1'.length).split('?')[0];
      if (/^\/(?:apps|app-api)(?:\/|$)/.test(apiPath)) return send(404, { error: 'Not found' });
      if (req.method === 'POST' && apiPath === '/skills/upload') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { chunks.push(chunk); size += chunk.length; if (size > 6 * 1024 * 1024) return send(413, { error: '文件太大（最多 5 MB）' }); }
        const buffer = Buffer.concat(chunks);
        try {
          const file = parseMultipartFile(buffer, req.headers['content-type']);
          const output = await service.handle('POST', '/skills/upload', { __file: { filename: file.filename, dataBase64: file.bytes.toString('base64') } });
          return send(200, output);
        } catch (error) { return send(400, { error: error.message }); }
      }
      let body = '';
      const maxBodyBytes = apiPath === '/prompts/import' ? 20 * 1024 * 1024 : req.method === 'POST' && /^\/libraries\/[\w-]+\/import$/.test(apiPath) ? 15 * 1024 * 1024 : apiPath === '/chat/attachments/image' ? 8 * 1024 * 1024 : apiPath === '/chat/attachments/extract' ? 15 * 1024 * 1024 : 1024 * 1024;
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > maxBodyBytes) return send(413, { error: apiPath.startsWith('/chat/attachments') ? '附件请求过大' : apiPath === '/prompts/import' ? '提示词导入文件过大（上限 20 MB）' : maxBodyBytes > 1024 * 1024 ? '知识库上传请求过大（文件上限 10 MB）' : 'Request too large' });
      }
      if (body && !req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required' });
      const input = body ? JSON.parse(body) : {};
      if(!knowledgeEnabled && /^\/(libraries|knowledge)(?:\/|$)/.test(apiPath))return send(404,{error:'本部署未启用知识库'});
      if(assistantRegistry && apiPath==='/application-assistants' && req.method==='GET')return send(200,assistantRegistry.list());
      const applicationAssistantMatch=apiPath.match(/^\/application-assistants\/([\w-]+)$/);
      if(assistantRegistry && applicationAssistantMatch){if(req.method==='GET')return send(200,assistantRegistry.get(applicationAssistantMatch[1]));if(req.method==='PUT')return send(200,await assistantRegistry.save(applicationAssistantMatch[1],input));return send(405,{error:'Method not allowed'})}
      if (applicationRequestContext() && !['GET','HEAD'].includes(req.method) && !/^\/(runs(?:\/|$)|sessions(?:\/|$)|chat\/attachments\/)/.test(apiPath) && apiPath !== '/knowledge/ask' && !/^\/prompts\/[\w-]+\/(run|preview)$/.test(apiPath)) requireApplicationManager();
      const output = req.method === 'POST' && apiPath === '/knowledge/ask'
        ? await askKnowledge(service, { ...input, owner: applicationRunOwner() })
        : await service.handle(req.method, req.url.slice('/api/agent/v1'.length), input, { productId, owner: applicationRunOwner() });
      if (output === undefined) return send(404, { error: 'Not found' });
      if(apiPath==='/instance' && output?.capabilities){output.capabilities.applicationAggregation=Boolean(assistantRegistry);output.capabilities.knowledge=knowledgeEnabled;output.capabilities.prompts=true;}
      send(200, output);
    } catch (error) { send(error.status || (['revision_conflict','request_conflict'].includes(error.code) ? 409 : 400), { error: error.message }); }
  });
  try { if (listen) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await service.close(); throw error; }
  let closingPromise;
  return { server, service, url: listen ? `http://127.0.0.1:${server.address().port}` : null, close() {
    closingPromise ||= (async () => { const stopped = server.listening ? new Promise(r => server.close(r)) : Promise.resolve(); try { await service.close(); } finally { await stopped; } })();
    return closingPromise;
  } };
}

export function defaultAgentWorkspaceRoot({ platform = process.platform, home = homedir(), cwd = process.cwd() } = {}) {
  return platform === 'darwin' ? join(home, 'Documents', 'xiaoya', 'platform') : cwd;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  const arg = (name, fallback) => flags.includes(name) ? flags[flags.indexOf(name) + 1] : fallback;
  const explicitWorkspace = arg('--workspace', null);
  const workspaceRoot = resolve(explicitWorkspace || defaultAgentWorkspaceRoot());
  if (!explicitWorkspace) await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  const parentPid = Number(arg('--parent-pid', '0'));
  const app = await servePlatform({
    directory: resolve(arg('--instance', './.agent-instance')),
    port: Number(arg('--port', '5190')),
    workspaceRoot,
    productId: arg('--product-id', 'standalone'),
    allowForeignProduct: flags.includes('--allow-foreign-product'),
    installWorkspaceTools: !flags.includes('--no-workspace-tools'),
    installPiTools: !flags.includes('--no-pi-tools')
  });
  console.log(`Agent Platform: ${app.url}\nAgent workspace: ${workspaceRoot}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  if (parentPid > 0) setInterval(() => { try { process.kill(parentPid, 0); } catch { close(); } }, 2000).unref();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, close);
}
