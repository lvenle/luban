import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };

/** Persistent device-pairing and leased task gateway. Mount only behind HTTPS. */
export function createDeviceGateway({
  database,
  pairingCode,
  leaseMs = 30_000,
  pairingCodeTtlMs = 15 * 60_000,
  maxPairingAttempts = 10,
  pairingLockoutMs = 15 * 60_000,
  requireTLS = true,
  now = Date.now,
}) {
  if (typeof pairingCode !== 'string' || pairingCode.length < 24) throw Error('设备配对码至少需要 24 个字符');
  if (!Number.isInteger(pairingCodeTtlMs) || pairingCodeTtlMs < 1_000) throw Error('配对码有效期至少为 1000 毫秒');
  if (!Number.isInteger(maxPairingAttempts) || maxPairingAttempts < 1 || maxPairingAttempts > 100) throw Error('配对失败次数上限必须在 1 到 100 之间');
  if (!Number.isInteger(pairingLockoutMs) || pairingLockoutMs < 1_000) throw Error('配对锁定时长至少为 1000 毫秒');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last_seen INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pairing_codes(code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, consumed_at INTEGER, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(device_id TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(device_id,event_id));
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, device_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, method TEXT NOT NULL, params TEXT NOT NULL, state TEXT NOT NULL, lease_id TEXT, lease_until INTEGER, result TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, UNIQUE(device_id,idempotency_key));`);
  const pairingCodeHash = hash(pairingCode);
  db.prepare('INSERT OR IGNORE INTO pairing_codes(code_hash,expires_at) VALUES(?,?)').run(pairingCodeHash, now() + pairingCodeTtlMs);
  const pairingState = db.prepare('SELECT * FROM pairing_codes WHERE code_hash=?');
  const recordPairingFailure = db.prepare('UPDATE pairing_codes SET failed_attempts=?,locked_until=? WHERE code_hash=? AND consumed_at IS NULL');
  const consumePairingCode = db.prepare('UPDATE pairing_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL');
  const insertDevice = db.prepare('INSERT INTO devices(id,name,token_hash,created,last_seen) VALUES(?,?,?,?,?)');
  const lookupDevice = db.prepare('SELECT * FROM devices WHERE token_hash=? AND revoked=0');
  const activeDeviceById = db.prepare('SELECT id FROM devices WHERE id=? AND revoked=0');
  const insertTask = db.prepare("INSERT OR IGNORE INTO tasks(id,device_id,idempotency_key,method,params,state,created,updated) VALUES(?,?,?,?,?,'queued',?,?)");
  const taskByIdempotency = db.prepare('SELECT * FROM tasks WHERE device_id=? AND idempotency_key=?');
  const taskById = db.prepare('SELECT * FROM tasks WHERE id=? AND device_id=?');
  const updateSeen = db.prepare('UPDATE devices SET last_seen=? WHERE id=?');
  const enqueueLease = db.prepare("UPDATE tasks SET state='leased',lease_id=?,lease_until=?,updated=? WHERE id=? AND state='queued'");
  const requeueExpired = db.prepare("UPDATE tasks SET state='queued',lease_id=NULL,lease_until=NULL,updated=? WHERE device_id=? AND state='leased' AND lease_until<?");
  const nextTask = db.prepare("SELECT * FROM tasks WHERE device_id=? AND state='queued' ORDER BY created LIMIT 1");
  const finishTask = db.prepare("UPDATE tasks SET state='completed',result=?,updated=? WHERE id=? AND device_id=? AND state='leased' AND lease_id=?");
  const cancelQueuedTasks = db.prepare("UPDATE tasks SET state='cancelled',result=?,updated=? WHERE device_id=? AND state='queued'");
  const cancelLeasedTasks = db.prepare("UPDATE tasks SET state='cancelled',lease_id=NULL,lease_until=NULL,result=?,updated=? WHERE device_id=? AND state='leased'");
  const cancellation = (outcome, message) => JSON.stringify({ ok:false, outcome, error:message });
  const api = async (req, res, pathname) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (requireTLS && !req.socket.encrypted && req.headers['x-forwarded-proto'] !== 'https') return json(res, 400, { error: 'HTTPS is required' });
    let raw = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) return json(res, 413, { error: 'Request too large' }); raw += chunk; }
    let input;
    try { input = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    if (pathname === '/v1/pair') {
      if (typeof input.deviceName !== 'string' || !input.deviceName.trim() || input.deviceName.length > 120) return json(res, 400, { error: 'Invalid device name' });
      const timestamp = now();
      const state = pairingState.get(pairingCodeHash);
      if (!state || timestamp >= state.expires_at) return json(res, 410, { error: 'Pairing code expired' });
      if (state.consumed_at !== null) return json(res, 409, { error: 'Pairing code already used; configure a new code' });
      if (state.locked_until > timestamp) return json(res, 429, { error: 'Pairing temporarily locked' });
      if (!equal(hash(String(input.pairingCode || '')), pairingCodeHash)) {
        const attempts = state.locked_until && state.locked_until <= timestamp ? 0 : state.failed_attempts;
        const nextAttempts = attempts + 1;
        const lockedUntil = nextAttempts >= maxPairingAttempts ? timestamp + pairingLockoutMs : 0;
        recordPairingFailure.run(nextAttempts, lockedUntil, pairingCodeHash);
        return lockedUntil ? json(res, 429, { error: 'Pairing temporarily locked' }) : json(res, 401, { error: 'Invalid pairing code' });
      }
      const id = `dev_${randomBytes(12).toString('hex')}`; const token = randomBytes(32).toString('base64url');
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = pairingState.get(pairingCodeHash);
        if (!current || timestamp >= current.expires_at) { db.exec('ROLLBACK'); return json(res, 410, { error: 'Pairing code expired' }); }
        if (current.consumed_at !== null) { db.exec('ROLLBACK'); return json(res, 409, { error: 'Pairing code already used; configure a new code' }); }
        if (current.locked_until > timestamp) { db.exec('ROLLBACK'); return json(res, 429, { error: 'Pairing temporarily locked' }); }
        consumePairingCode.run(timestamp, pairingCodeHash);
        insertDevice.run(id, input.deviceName.trim(), hash(token), timestamp, timestamp);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 201, { deviceId: id, token });
    }
    const bearer = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(req.headers.authorization || '');
    const device = bearer && lookupDevice.get(hash(bearer[1]));
    if (!device) return json(res, 401, { error: 'Invalid device credential' });
    updateSeen.run(now(), device.id);
    if (pathname === '/v1/poll') {
      db.exec('BEGIN IMMEDIATE');
      try {
        requeueExpired.run(now(), device.id, now());
        const task = nextTask.get(device.id);
        if (!task) { db.exec('COMMIT'); return json(res, 200, { task: null }); }
        const leaseId = randomBytes(18).toString('base64url'); const expires = now() + leaseMs;
        const claimed = enqueueLease.run(leaseId, expires, now(), task.id).changes === 1;
        db.exec('COMMIT');
        return json(res, 200, { task: claimed ? { id: task.id, method: task.method, params: JSON.parse(task.params), leaseId, leaseUntil: expires } : null });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (pathname === '/v1/event') {
      if (typeof input.event?.eventId !== 'string' || input.event.eventId.length > 240) return json(res, 400, { error: 'A stable eventId is required' });
      db.prepare('INSERT OR IGNORE INTO events(device_id,event_id,body,created) VALUES(?,?,?,?)').run(device.id, input.event.eventId, JSON.stringify(input.event), now());
      return json(res, 202, { accepted: true, eventId: input.event.eventId });
    }
    if (pathname === '/v1/result') {
      if (typeof input.taskId !== 'string' || typeof input.leaseId !== 'string') return json(res, 400, { error: 'Invalid task receipt' });
      const changed = finishTask.run(JSON.stringify(input.result ?? null), now(), input.taskId, device.id, input.leaseId).changes;
      return changed ? json(res, 200, { ok: true }) : json(res, 409, { error: 'Task lease expired or already completed' });
    }
    return json(res, 404, { error: 'Not found' });
  };
  return {
    async handle(req, res, pathname) { return api(req, res, pathname); },
    submit({ deviceId, idempotencyKey, method, params = {} }) {
      if (typeof deviceId !== 'string' || !activeDeviceById.get(deviceId)) {
        const error = new Error('Device is missing or revoked');
        error.code = 'device_unavailable';
        throw error;
      }
      if (!/^[A-Za-z0-9._:-]{1,160}$/.test(idempotencyKey || '')) throw Error('A stable idempotency key is required');
      if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(method || '')) throw Error('Invalid method');
      const timestamp = now(); const id = `task_${randomBytes(12).toString('hex')}`;
      insertTask.run(id, deviceId, idempotencyKey, method, JSON.stringify(params), timestamp, timestamp);
      const task = taskByIdempotency.get(deviceId, idempotencyKey);
      if (!task) throw Error('Device task could not be queued');
      return { id: task.id, state: task.state, result: task.result ? JSON.parse(task.result) : null };
    },
    listEvents({ deviceId, limit = 100 }) { return db.prepare('SELECT event_id AS eventId,body,created FROM events WHERE device_id=? ORDER BY created LIMIT ?').all(deviceId, Math.min(500, Math.max(1, limit))).map(row => ({ ...JSON.parse(row.body), receivedAt: row.created })); },
    ackEvent({ deviceId, eventId }) { return db.prepare('DELETE FROM events WHERE device_id=? AND event_id=?').run(deviceId, eventId).changes === 1; },
    getTask({ deviceId, taskId }) { const task = taskById.get(taskId, deviceId); return task && { id: task.id, state: task.state, result: task.result ? JSON.parse(task.result) : null }; },
    revoke(deviceId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const changed = db.prepare('UPDATE devices SET revoked=1 WHERE id=? AND revoked=0').run(deviceId).changes === 1;
        if (changed) {
          const timestamp = now();
          cancelQueuedTasks.run(cancellation('not_started', '设备撤销前任务尚未领取，未在本机执行'), timestamp, deviceId);
          cancelLeasedTasks.run(cancellation('unknown', '设备在任务租约期间被撤销，操作可能已经执行'), timestamp, deviceId);
        }
        db.exec('COMMIT');
        return changed;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    listDevices() { return db.prepare('SELECT id,name,created,last_seen,revoked FROM devices ORDER BY created').all(); },
    close() { db.close(); },
  };
}

/** Local-shell administration interface; deliberately does not expose HTTP routes. */
export function openDeviceGatewayAdmin({ database }) {
  if (!database || !existsSync(database)) throw Error(`设备网关数据库不存在：${database || '(未指定)'}`);
  const db = new DatabaseSync(database);
  const getDevice = db.prepare('SELECT id FROM devices WHERE id=?');
  const cancelQueuedTasks = db.prepare("UPDATE tasks SET state='cancelled',result=?,updated=? WHERE device_id=? AND state='queued'");
  const cancelLeasedTasks = db.prepare("UPDATE tasks SET state='cancelled',lease_id=NULL,lease_until=NULL,result=?,updated=? WHERE device_id=? AND state='leased'");
  const requireDevice = deviceId => {
    if (typeof deviceId !== 'string' || !deviceId.trim()) throw Error('deviceId is required');
    if (!getDevice.get(deviceId)) throw Error(`Unknown device: ${deviceId}`);
    return deviceId;
  };
  return {
    listDevices() {
      return db.prepare('SELECT id,name,created,last_seen AS lastSeen,revoked FROM devices ORDER BY created').all();
    },
    listEvents({ deviceId, limit = 100 } = {}) {
      const id = requireDevice(deviceId);
      const boundedLimit = Math.min(500, Math.max(1, Math.floor(Number(limit) || 100)));
      return db.prepare('SELECT event_id AS eventId,body,created FROM events WHERE device_id=? ORDER BY created LIMIT ?')
        .all(id, boundedLimit).map(row => ({ ...JSON.parse(row.body), receivedAt: row.created }));
    },
    ackEvent({ deviceId, eventId } = {}) {
      const id = requireDevice(deviceId);
      if (typeof eventId !== 'string' || !eventId.trim()) throw Error('eventId is required');
      return db.prepare('DELETE FROM events WHERE device_id=? AND event_id=?').run(id, eventId).changes === 1;
    },
    revoke(deviceId) {
      const id = requireDevice(deviceId);
      db.exec('BEGIN IMMEDIATE');
      try {
        const changed = db.prepare('UPDATE devices SET revoked=1 WHERE id=? AND revoked=0').run(id).changes === 1;
        if (changed) {
          const timestamp = Date.now();
          cancelQueuedTasks.run(JSON.stringify({ ok:false, outcome:'not_started', error:'设备撤销前任务尚未领取，未在本机执行' }), timestamp, id);
          cancelLeasedTasks.run(JSON.stringify({ ok:false, outcome:'unknown', error:'设备在任务租约期间被撤销，操作可能已经执行' }), timestamp, id);
        }
        db.exec('COMMIT');
        return changed;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}

/** Queue a browser API call for execution by the paired local Smart WeChat service. */
export function createSmartWechatDeviceProxy({ gateway, deviceId, timeoutMs = 120_000, now = Date.now }) {
  if (!gateway || !deviceId) throw Error('paired device gateway and deviceId are required');
  return async (req, res, path) => {
    const reply = (status, value) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }); res.end(JSON.stringify(value)); };
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)) return reply(405, {error:'Method not allowed'});
    let raw = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if(size > 1024*1024) return reply(413,{error:'Request too large'}); raw += chunk; }
    let input = {};
    try { if(raw) input = JSON.parse(raw); } catch { return reply(400,{error:'Invalid JSON'}); }
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return reply(400,{error:'Invalid local service path'});
    const idempotency = req.headers['idempotency-key'];
    let task;
    try {
      task = gateway.submit({ deviceId, idempotencyKey:`api:${idempotency || randomUUID()}`, method:'smartWechatApi', params:{method:req.method,path:path+new URL(req.url,'http://localhost').search,input} });
    } catch (error) {
      if (error?.code === 'device_unavailable') return reply(410,{error:'本机智能微信设备已撤销或不存在'});
      throw error;
    }
    const deadline=now()+timeoutMs;
    while(now()<deadline) {
      const current=gateway.getTask({deviceId,taskId:task.id});
      if(current?.state==='completed') {
        if(!current.result?.ok) return reply(502,{error:current.result?.error||'本机智能微信请求失败'});
        const response = current.result.value;
        if (response?.__smartWechatHttp === 1 && Number.isInteger(response.status) && response.status >= 200 && response.status <= 599) {
          return reply(response.status, response.body);
        }
        return reply(200,current.result.value);
      }
      if(current?.state==='cancelled') return reply(410,{error:current.result?.error||'本机智能微信设备已撤销',outcome:current.result?.outcome||'unknown',taskId:task.id});
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    return reply(504,{error:'本机智能微信暂时未响应；请求结果可能待确认',taskId:task.id});
  };
}
