import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const cookieName = 'ai_suite_session';
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const loginPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>企业工作台登录</title></head><body><main><h1>企业工作台</h1><form><label>用户名<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button>登录</button><p role="alert"></p></form></main><script type="module" src="/auth/login.js"></script></body></html>`;
const loginScript = `document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;const button=form.querySelector('button');button.disabled=true;try{const response=await fetch('/api/identity/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:form.username.value,password:form.password.value})});const body=await response.json();if(!response.ok)throw Error(body.error||'登录失败');const next=new URLSearchParams(location.search).get('next')||'/applications';const target=new URL(next,location.origin);location.assign(target.origin===location.origin?target.pathname+target.search+target.hash:'/applications');}catch(error){form.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}});`;

/** One enterprise space per deployment. External SSO can later implement the same host contract. */
export async function createEnterpriseIdentity({ database, scopeId = 'enterprise', bootstrapUser, bootstrapPassword, secureCookies = false, sessionTtlMs = 8 * 60 * 60 * 1000 } = {}) {
  if (!database || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1000 || !/^[\w-]{1,80}$/.test(scopeId)) throw Error('Identity database and scope are required');
  await mkdir(dirname(database), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(database);
  await chmod(database, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS enterprise_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,scope_id TEXT NOT NULL,grants TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS enterprise_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES enterprise_users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);`);
  const attempts = new Map();
  let closed = false;
  const publicIdentity = row => Object.freeze({ userId: row.id, username: row.username, role: row.role, scopeId: row.scope_id, grants: Object.freeze(JSON.parse(row.grants)) });
  async function createUser({ username, password, role = 'member', grants = [] }) {
    if (!/^[\w.@-]{1,80}$/.test(username || '') || typeof password !== 'string' || password.length < 8 || password.length > 1024 || !['admin','member'].includes(role) || !Array.isArray(grants) || grants.some(value => !/^[a-z][a-z0-9-]*:(use|manage|knowledge)$/.test(value))) throw Error('Invalid enterprise user or grants');
    const salt = randomBytes(16).toString('hex');
    const hash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
    const id = randomUUID();
    db.prepare('INSERT INTO enterprise_users(id,username,password,role,scope_id,grants) VALUES(?,?,?,?,?,?)').run(id,username,`${salt}:${hash}`,role,scopeId,JSON.stringify(grants));
    return publicIdentity(db.prepare('SELECT * FROM enterprise_users WHERE id=?').get(id));
  }
  function authenticate(req) {
    const token = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const row = db.prepare('SELECT u.* FROM enterprise_sessions s JOIN enterprise_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0 AND u.scope_id=?').get(tokenHash(token),Date.now(),scopeId);
    return row ? publicIdentity(row) : null;
  }
  function authorize(identity, applicationId, action = 'use') {
    if (!identity || identity.scopeId !== scopeId) return false;
    const user = db.prepare('SELECT * FROM enterprise_users WHERE id=? AND scope_id=? AND disabled=0').get(identity.userId, scopeId);
    if (!user) return false;
    const grants = JSON.parse(user.grants);
    return user.role === 'admin' || grants.includes(`${applicationId}:${action}`) || grants.includes(`${applicationId}:manage`);
  }
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  async function handle(req, res, path) {
    if (!['/auth/login','/auth/login.js','/api/identity/login','/api/identity/logout','/api/identity/me'].includes(path)) return false;
    const send = (status, body) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8','cache-control':'no-store' });res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && ['/auth/login','/auth/login.js'].includes(path)) {
        res.writeHead(200, { 'content-type':path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self'; frame-ancestors 'none'" });
        res.end(path.endsWith('.js') ? loginScript : loginPage); return true;
      }
      if (req.method === 'GET' && path === '/api/identity/me') { const identity=authenticate(req);send(identity?200:401,identity?{identity}:{error:'请先登录'});return true; }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { send(400,{error:'JSON POST required'});return true; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { send(403,{error:'Origin rejected'});return true; }
      if (path === '/api/identity/logout') {
        const token=String(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(token)db.prepare('DELETE FROM enterprise_sessions WHERE token_hash=?').run(tokenHash(token));
        res.setHeader('set-cookie',cookie('',0));send(200,{ok:true});return true;
      }
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192){send(413,{error:'请求过大'});return true;}}
      const input=JSON.parse(text||'{}');
      const ip=req.socket.remoteAddress||'unknown', now=Date.now();
      const recent=(attempts.get(ip)||[]).filter(at=>at>now-300000);
      if(recent.length>=10){send(429,{error:'登录尝试过多，请稍后再试'});return true;}
      if(attempts.size>1000)attempts.delete(attempts.keys().next().value);attempts.set(ip,[...recent,now]);
      if(typeof input.password!=='string'||input.password.length>1024){send(401,{error:'用户名或密码不正确'});return true;}
      const row=db.prepare('SELECT * FROM enterprise_users WHERE username=? AND scope_id=? AND disabled=0').get(String(input.username||''),scopeId);
      const [salt,expected]=row?.password.split(':')||['invalid','00'.repeat(64)];
      const actual=Buffer.from(await scrypt(input.password,salt,64)),expectedBytes=Buffer.from(expected,'hex');
      if(!row||actual.length!==expectedBytes.length||!timingSafeEqual(actual,expectedBytes)){send(401,{error:'用户名或密码不正确'});return true;}
      const token=randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM enterprise_sessions WHERE expires_at<=?').run(now);
      db.prepare('INSERT INTO enterprise_sessions VALUES(?,?,?)').run(tokenHash(token),row.id,now+sessionTtlMs);
      res.setHeader('set-cookie',cookie(token,Math.floor(sessionTtlMs/1000)));send(200,{identity:publicIdentity(row)});return true;
    } catch(error) {send(400,{error:error instanceof SyntaxError?'Invalid JSON':'身份请求失败'});return true;}
  }
  try {
    if (db.prepare('SELECT 1 FROM enterprise_users WHERE scope_id != ? LIMIT 1').get(scopeId)) throw Error('身份数据库属于其他企业空间');
    if (!db.prepare('SELECT 1 FROM enterprise_users LIMIT 1').get()) {
      if (!bootstrapUser || !bootstrapPassword) throw Error('首次企业启动须配置 AI_SUITE_ADMIN_USER 和 AI_SUITE_ADMIN_PASSWORD');
      await createUser({ username: bootstrapUser, password: bootstrapPassword, role: 'admin' });
    }
    return { authenticate, authorize, handle, createUser, close(){if(!closed){closed=true;db.close();}} };
  } catch(error) {db.close();throw error;}
}

/** Explicit local development mode: retain application ownership without a login session. */
export function createLocalEnterpriseIdentity() {
  const identity = Object.freeze({userId:'local',username:'local',role:'admin',scopeId:'enterprise',grants:Object.freeze([])});
  return {
    authenticate:()=>identity,
    authorize:current=>current?.userId===identity.userId && current.scopeId===identity.scopeId && current.role===identity.role,
    async handle(req,res,path) {
      if(req.method==='GET' && path==='/auth/login') {
        res.writeHead(302,{location:'/platform/conversation','cache-control':'no-store'});res.end();return true;
      }
      if(req.method==='GET' && path==='/api/identity/me') {
        res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({identity}));return true;
      }
      return false;
    },
    close(){}
  };
}
