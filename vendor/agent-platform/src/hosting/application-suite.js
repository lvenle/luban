import { withApplicationIdentity } from './request-context.js';
import { createServer } from 'node:http';
import { normalizeWebBase } from './web-base.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const css = `*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#172033;font:15px system-ui,-apple-system,"PingFang SC",sans-serif}main{max-width:1100px;margin:9vh auto;padding:24px}h1{font-size:32px;margin:0 0 12px}p{color:#69778e;line-height:1.8}.badge{display:inline-block;background:#e9f8ef;color:#27834d;padding:6px 11px;border-radius:20px;margin-bottom:22px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:32px 0}.card{display:flex;flex-direction:column;gap:14px;padding:26px;border:1px solid #e1e7f1;border-radius:16px;background:white;color:inherit;text-decoration:none;box-shadow:0 6px 24px #17203305;transition:transform .15s,border-color .15s}.card:hover{transform:translateY(-3px);border-color:#6292eb}.card h2{font-size:22px;margin:0}.card p{margin:0;min-height:82px}.enter{color:#2563eb;font-weight:600}.number{font-size:13px;color:#8b98ac}footer{border-top:1px solid #e1e7f1;padding-top:18px;color:#7b8799;font-size:13px}@media(max-width:720px){main{margin:3vh auto}.grid{grid-template-columns:1fr}.card p{min-height:0}}`;
function home(applications) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 工作台</title><link rel="stylesheet" href="/suite.css"></head><body><main><span class="badge">统一服务 · 已就绪</span><h1>AI 工作台</h1><p>从这里进入底座、智能微信和 AI-DB。</p><section class="grid">${applications.map((app,index)=>`<a class="card" href="${app.mount}/"><span class="number">0${index+1}</span><h2>${escape(app.title)}</h2><p>${escape(app.description || '')}</p><span class="enter">进入应用 →</span></a>`).join('')}</section><footer>统一入口 · 应用数据与配置各自独立</footer></main></body></html>`;
}

/** Compose HTTP handlers in one process, without opening per-application ports. */
export async function serveApplicationSuite({ applications, port = 5190, homePath = null, handlers = [], trustedProxyHosts = [], identityService = null }) {
  if (!Array.isArray(applications) || !applications.length) throw Error('At least one application is required');
  const ids=new Set(), mounts=new Set(), claims=[];
  for (const app of applications) {
    normalizeWebBase(app.mount + '/');
    if (!app.mount || app.mount === '/' || !/^[a-z][a-z0-9-]*$/.test(app.id || '') || ids.has(app.id) || mounts.has(app.mount) || typeof app.create !== 'function') throw Error('Invalid or duplicate application');
    const routes=[{path:app.mount,prefix:true},...(app.apiPrefixes||[]).map(path=>({path,prefix:true})),...(app.rootPrefixes||[]).map(path=>({path:path.replace(/\/$/,''),prefix:true})),...(app.rootPaths||[]).map(path=>({path,prefix:false}))];
    for(const route of routes) {
      if(!/^\/(?!\/)[a-zA-Z0-9/_.-]+$/.test(route.path))throw Error('Invalid application route');
      for(const claim of claims)if(claim.id!==app.id && (route.path===claim.path || claim.prefix && route.path.startsWith(claim.path+'/') || route.prefix && claim.path.startsWith(route.path+'/')))throw Error('Application routes overlap: '+app.id+' and '+claim.id);
      claims.push({...route,id:app.id});
    }
    ids.add(app.id);mounts.add(app.mount);
  }
  if(homePath !== null && (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(homePath) || !applications.some(app=>homePath.startsWith(app.mount+'/'))))throw Error('Homepage must belong to a mounted application');
  const active=[];
  let server, closing;
  async function dispose() {
    const errors=[];
    for(const app of [...active].reverse())try{await app.runtime.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Application shutdown failed');
  }
  try {
    for(const definition of applications) {
      const runtime=await definition.create();
      active.push({...definition,runtime});
      if (!runtime?.server?.listeners('request').length || typeof runtime.close !== 'function' || runtime.server.listening) throw Error('Application must provide an unbound HTTP server and close(): '+definition.id);
    }
    server=createServer(async (req,res)=>{
      const json=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
      try {
      const host=`127.0.0.1:${req.socket.localPort}`;
      const localOrigin='http://'+host;
      const forwardedHost=String(req.headers['x-forwarded-host']||'').toLowerCase();
      const forwardedOrigin=String(req.headers.origin||'');
      const trustedProxy=trustedProxyHosts.includes(forwardedHost) && req.headers.host?.toLowerCase()===forwardedHost && req.headers['x-forwarded-proto']==='https' && (!forwardedOrigin || forwardedOrigin===`https://${forwardedHost}`);
      const localRequest=req.headers.host===host && (!forwardedOrigin || forwardedOrigin===localOrigin);
      if(!localRequest && !trustedProxy)return json(403,{error:'Local origin or trusted HTTPS proxy required'});
      if(trustedProxy){req.headers.host=host;if(forwardedOrigin)req.headers.origin=localOrigin;}
      let url;
      try{url=new URL(req.url,'http://'+host);}catch{return json(400,{error:'Invalid URL'});}
      if(identityService && await identityService.handle(req,res,url.pathname)) return;
      if(req.method==='GET' && url.pathname==='/healthz')return json(200,{status:'ok',applications:active.map(app=>({id:app.id,path:app.mount+'/',status:'ready'}))});
      for (const route of handlers) {
        if (url.pathname === route.prefix || url.pathname.startsWith(route.prefix + '/')) {
          req.url = url.pathname.slice(route.prefix.length) + url.search;
          return route.handle(req, res, req.url.split('?')[0]);
        }
      }
      if(req.method==='GET' && url.pathname==='/' && homePath){res.writeHead(302,{location:homePath+url.search,'cache-control':'no-store'});return res.end();}
      if(req.method==='GET' && ['/', '/applications', '/suite.css'].includes(url.pathname)) {
        const stylesheet=url.pathname==='/suite.css';
        res.writeHead(200,{'content-type':stylesheet?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
        return res.end(stylesheet?css:home(active));
      }
      for(const app of active) {
        if(url.pathname===app.mount) {res.writeHead(308,{location:app.mount+'/'+url.search});return res.end();}
        const mounted=url.pathname.startsWith(app.mount+'/');
        const rootRoute=(app.apiPrefixes||[]).some(prefix=>url.pathname===prefix || url.pathname.startsWith(prefix+'/')) || (app.rootPrefixes||[]).some(prefix=>url.pathname.startsWith(prefix)) || (app.rootPaths||[]).includes(url.pathname);
        if(!mounted && !rootRoute)continue;
        let identity = null;
        if(identityService) {
          identity = identityService.authenticate(req);
          if(!identity) {
            if(url.pathname.includes('/api/'))return json(401,{error:'请先登录企业工作台'});
            res.writeHead(302,{location:'/auth/login?next='+encodeURIComponent(url.pathname+url.search),'cache-control':'no-store'});return res.end();
          }
          if(!identityService.authorize(identity,app.id,'use'))return json(403,{error:'当前用户无权使用此应用'});
        }
        req.url=(mounted?url.pathname.slice(app.mount.length):url.pathname)+url.search;
        // Preserve the real socket and headers: each product still enforces its own origin/auth policy.
        if(identity)withApplicationIdentity(identity,app.id,()=>app.runtime.server.emit('request',req,res));
        else app.runtime.server.emit('request',req,res);
        return;
      }
      json(404,{error:'Application route not found'});
      } catch(error) { if(!res.headersSent)json(500,{error:'组合应用请求失败'});else res.end(); }
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  } catch(error) {
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    await dispose().catch(()=>{});
    throw error;
  }
  return {server,applications:active,url:'http://127.0.0.1:'+server.address().port,
    close(){return closing ||= (async()=>{const stopped=new Promise(resolve=>server.close(resolve));try{await dispose();}finally{await stopped;}})();}
  };
}
