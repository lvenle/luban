import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpClient } from './client.js';
import { toolError } from '../tools/registry.js';
import { archiveMigratedFile } from '../settings/storage-migrations.js';
import { persistMediaReferences } from '../media/persist-references.js';

const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
const TRANSPORTS = ['stdio', 'http'];

/** Redact secret values: keep key names, drop values. */
function redactSecrets(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v ? '••••••' : v;
  return out;
}

/**
 * 上游工具名 → 注册名片段：小写、非法字符转连字符，保证首字母开头。
 * 注册名形如 mcp.<tool>，冲突时追加来源后缀（决议 30）。
 */
function sanitizeToolSegment(name) {
  let s = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^[-_]+/, '');
  if (!/^[a-z]/.test(s)) s = 't-' + s;
  return (s || 'tool').slice(0, 48);
}

const INVALID_REASON_TEXT = {
  disconnected: '服务断连', removed: '工具已下架', disabled: '服务已停用', deleted: '服务已删除'
};

function validateServer(input, isUpdate = false) {
  const out = {};
  if (!isUpdate || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) throw new Error('名称不能为空且不超过 120 字符');
    out.name = input.name.trim();
  }
  if (!isUpdate || input.transport !== undefined) {
    if (!TRANSPORTS.includes(input.transport)) throw new Error('传输类型必须是 stdio 或 http');
    out.transport = input.transport;
  }
  const transport = out.transport ?? input.transport;
  if (transport === 'stdio' && (!isUpdate || input.command !== undefined)) {
    if (typeof input.command !== 'string' || !input.command.trim()) throw new Error('stdio 传输需要 command');
    out.command = input.command.trim();
  }
  if (transport === 'http' && (!isUpdate || input.url !== undefined)) {
    if (typeof input.url !== 'string' || !/^https?:\/\/.+/.test(input.url.trim())) throw new Error('http 传输需要有效的 URL');
    out.url = input.url.trim();
  }
  if (input.args !== undefined) {
    if (!Array.isArray(input.args) || input.args.some(a => typeof a !== 'string')) throw new Error('args 必须是字符串数组');
    out.args = input.args;
  }
  if (input.env !== undefined) {
    if (!input.env || typeof input.env !== 'object' || Array.isArray(input.env)) throw new Error('env 必须是对象');
    for (const [k, v] of Object.entries(input.env)) if (typeof v !== 'string') throw new Error(`env.${k} 必须是字符串`);
    out.env = { ...input.env };
  }
  if (input.headers !== undefined) {
    if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) throw new Error('headers 必须是对象');
    for (const [k, v] of Object.entries(input.headers)) if (typeof v !== 'string') throw new Error(`headers.${k} 必须是字符串`);
    out.headers = { ...input.headers };
  }
  if (input.cwd !== undefined) {
    if (input.cwd !== '' && typeof input.cwd !== 'string') throw new Error('cwd 必须是字符串');
    out.cwd = input.cwd;
  }
  if (input.timeoutMs !== undefined) {
    const t = Number(input.timeoutMs);
    if (!Number.isInteger(t) || t < 1000 || t > 300000) throw new Error('超时必须在 1000–300000 毫秒之间');
    out.timeoutMs = t;
  }
  if (input.enabled !== undefined) out.enabled = !!input.enabled;
  return out;
}

/**
 * MCP server registry. Configs persist to <directory>/.mcp/servers.json (0600).
 * Secrets (env/headers values) are never echoed back, logged, or exported.
 *
 * 决议 28–31：MCP 侧只管连接与同步。syncServer() 把上游工具同步进 ToolRegistry
 * （同步键 = server-id + tool-name），同步记录持久化到 .mcp/sync.json（0600，
 * 不含任何密钥）。工具的启用/停用统一在 Tool 侧管理。
 */
export class McpManager {
  constructor(directory, {database=null}={}) {
    this.db=database;
    this.directory = directory;
    this.file = join(directory, '.mcp', 'servers.json');
    this.syncFile = join(directory, '.mcp', 'sync.json');
    this.servers = [];
    this.status = new Map(); // id -> {status, lastConnected, lastError, toolCount}
    this.syncTools = new Map(); // syncKey(JSON [serverId, toolName]) -> 同步记录
  }

  async prepare() {
    await mkdir(join(this.directory, '.mcp'), { recursive: true, mode: 0o700 });
    try {
      const raw = await readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      this.servers = Array.isArray(data.servers) ? data.servers.filter(s => s && validId(s.id)) : [];
    } catch(error) { if(error.code!=='ENOENT')throw error;this.servers = []; }
    for (const s of this.servers) {
      if (!this.status.has(s.id)) this.status.set(s.id, { status: s.enabled === false ? 'disabled' : 'disconnected', lastConnected: null, lastError: null, toolCount: 0 });
    }
    await this.#loadSync();
  }

  async #save() {
    await mkdir(join(this.directory, '.mcp'), { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify({ version: 1, servers: this.servers }, null, 2), { mode: 0o600 });
    try { await chmod(this.file, 0o600); } catch {}
  }

  /** 同步记录只含名称/描述/上游 Schema/状态，不含密钥，可安全持久化。 */
  async #loadSync() {
    if(this.db && this.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get('p5-mcp-runtime')) {
      for(const row of this.db.prepare('SELECT sync_key,record FROM mcp_tool_snapshots').all())this.syncTools.set(row.sync_key,JSON.parse(row.record));
      for(const row of this.db.prepare('SELECT server_id,record FROM mcp_diagnostics').all()) {
        const saved=JSON.parse(row.record);
        if(this.servers.some(s=>s.id===row.server_id))this.status.set(row.server_id,{...saved,status:this.servers.find(s=>s.id===row.server_id).enabled===false?'disabled':'disconnected'});
      }
      archiveMigratedFile(this.syncFile);
      return;
    }
    try {
      const raw = await readFile(this.syncFile, 'utf8');
      const data = JSON.parse(raw);
      const tools = data && typeof data === 'object' && data.tools ? data.tools : {};
      for (const [key, rec] of Object.entries(tools)) {
        if (rec && typeof rec === 'object' && rec.registeredName && rec.serverId && rec.toolName) this.syncTools.set(key, rec);
      }
    } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(this.db) {
      this.db.exec('SAVEPOINT import_mcp_runtime');
      try {
        await this.#saveSync();
        this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('p5-mcp-runtime',new Date().toISOString());
        this.db.exec('RELEASE import_mcp_runtime');
      } catch(error) {this.db.exec('ROLLBACK TO import_mcp_runtime; RELEASE import_mcp_runtime');throw error;}
      archiveMigratedFile(this.syncFile);
    }
  }

  async #saveSync() {
    if(this.db) {
      this.db.exec('SAVEPOINT save_mcp_snapshots');
      try {
        this.db.exec('DELETE FROM mcp_tool_snapshots');
        const insert=this.db.prepare('INSERT INTO mcp_tool_snapshots VALUES(?,?,?,?)');
        for(const [key,record] of this.syncTools)insert.run(key,record.serverId,JSON.stringify(record),new Date().toISOString());
        this.db.exec('RELEASE save_mcp_snapshots');
      } catch(error) {this.db.exec('ROLLBACK TO save_mcp_snapshots; RELEASE save_mcp_snapshots');throw error;}
      return;
    }
    await mkdir(join(this.directory, '.mcp'), { recursive: true, mode: 0o700 });
    await writeFile(this.syncFile, JSON.stringify({ version: 1, tools: Object.fromEntries(this.syncTools) }, null, 2), { mode: 0o600 });
    try { await chmod(this.syncFile, 0o600); } catch {}
  }

  /** Public list: secrets redacted, runtime status attached. */
  list() {
    return this.servers.map(s => ({
      id: s.id, name: s.name, transport: s.transport,
      command: s.transport === 'stdio' ? s.command : undefined,
      args: s.transport === 'stdio' ? s.args : undefined,
      url: s.transport === 'http' ? s.url : undefined,
      cwd: s.cwd || undefined,
      timeoutMs: s.timeoutMs || 30000,
      enabled: s.enabled !== false,
      envKeys: Object.keys(s.env || {}),
      env: redactSecrets(s.env),
      headers: redactSecrets(s.headers),
      status: this.status.get(s.id) || { status: 'disconnected', lastConnected: null, lastError: null, toolCount: 0 }
    }));
  }

  #full(id) {
    const s = this.servers.find(x => x.id === id);
    if (!s) throw new Error('MCP 服务不存在');
    return s;
  }

  async add(input) {
    const v = validateServer(input);
    const server = { id: 'mcp-' + randomUUID().slice(0, 8), enabled: true, timeoutMs: 30000, args: [], env: {}, headers: {}, ...v };
    // Merge defaults for fields validateServer may have omitted
    if (server.transport === 'stdio' && input.args) server.args = input.args;
    this.servers.push(server);
    this.status.set(server.id, { status: 'disconnected', lastConnected: null, lastError: null, toolCount: 0 });
    await this.#save();
    return this.list().find(s => s.id === server.id);
  }

  async update(id, input) {
    const s = this.#full(id);
    const v = validateServer({ ...s, ...input }, true);
    // For secrets: only overwrite keys that are provided and non-redacted.
    // A value of '••••••' means "keep existing".
    for (const field of ['env', 'headers']) {
      if (v[field]) {
        const merged = { ...(s[field] || {}) };
        for (const [k, val] of Object.entries(v[field])) {
          if (val === '••••••') continue;
          if (val === '') delete merged[k];
          else merged[k] = val;
        }
        v[field] = merged;
      }
    }
    Object.assign(s, v);
    if (s.enabled === false) {
      this.#setStatus(id, { status: 'disabled' });
      // 决议 30：服务停用 → 其同步工具标记"来源已失效"，保留配置
      await this.#markServerTools(id, 'disabled', 'MCP 服务已停用').catch(() => {});
    }
    else if (this.status.get(id)?.status === 'disabled') this.#setStatus(id, { status: 'disconnected' });
    await this.#save();
    return this.list().find(x => x.id === id);
  }

  async remove(id) {
    this.#full(id);
    // 决议 30：服务删除 → 同步工具标记"来源已失效"，保留配置与同步记录
    await this.#markServerTools(id, 'deleted', 'MCP 服务已删除').catch(() => {});
    this.servers = this.servers.filter(s => s.id !== id);
    this.status.delete(id);
    await this.#save();
    return { ok: true };
  }

  #setStatus(id, patch) {
    this.status.set(id, { ...this.status.get(id), ...patch });
    if(this.db)this.db.prepare(`INSERT INTO mcp_diagnostics VALUES(?,?,?) ON CONFLICT(server_id)
      DO UPDATE SET record=excluded.record,updated_at=excluded.updated_at`).run(id,JSON.stringify(this.status.get(id)),new Date().toISOString());
  }

  /** Real MCP initialize handshake and tools/list discovery. Updates status; never throws secrets. */
  async test(id) {
    const s = this.#full(id);
    if (s.enabled === false) throw new Error('服务已停用，请先启用');
    const client = new McpClient(s);
    this.#setStatus(id, { status: 'connecting', lastError: null });
    try {
      const info = await client.connect({ timeoutMs: s.timeoutMs });
      const tools = await client.listTools({ timeoutMs: s.timeoutMs });
      await client.close();
      this.#setStatus(id, { status: 'connected', lastConnected: new Date().toISOString(), lastError: null, toolCount: tools.length, tools });
      return { ok: true, serverInfo: info?.serverInfo || null, protocolVersion: info?.protocolVersion || null, tools };
    } catch (e) {
      await client.close().catch(() => {});
      const msg = String(e.message || e).slice(0, 300);
      this.#setStatus(id, { status: 'error', lastError: msg });
      // 决议 30：连通性探明失败 → 同步工具标记"来源已失效"（断连）
      await this.#markServerTools(id, 'disconnected', '连接失败：' + msg).catch(() => {});
      throw e;
    }
  }

  /** Real tools/list discovery. Caches tool list in memory status. */
  async refreshTools(id) {
    const s = this.#full(id);
    if (s.enabled === false) throw new Error('服务已停用，请先启用');
    const client = new McpClient(s);
    this.#setStatus(id, { status: 'connecting', lastError: null });
    try {
      await client.connect({ timeoutMs: s.timeoutMs });
      const tools = await client.listTools({ timeoutMs: s.timeoutMs });
      await client.close();
      this.#setStatus(id, { status: 'connected', lastConnected: new Date().toISOString(), lastError: null, toolCount: tools.length, tools });
      return { tools };
    } catch (e) {
      await client.close().catch(() => {});
      this.#setStatus(id, { status: 'error', lastError: String(e.message || e).slice(0, 300) });
      throw e;
    }
  }

  cachedTools(id) {
    return this.status.get(id)?.tools || [];
  }

  /** Real tools/call for the test playground. */
  async callTool(id, name, args) {
    const s = this.#full(id);
    if (s.enabled === false) throw new Error('服务已停用，请先启用');
    const client = new McpClient(s);
    try {
      await client.connect({ timeoutMs: s.timeoutMs });
      const result = await client.callTool(name, args, { timeoutMs: s.timeoutMs });
      await client.close();
      this.#setStatus(id, { status: 'connected', lastConnected: new Date().toISOString(), lastError: null });
      // Truncate huge outputs for the playground display.
      const text = JSON.stringify(result);
      return text.length > 20000 ? JSON.parse(text.slice(0, 20000)) : result;
    } catch (e) {
      await client.close().catch(() => {});
      this.#setStatus(id, { status: 'error', lastError: String(e.message || e).slice(0, 300) });
      throw e;
    }
  }

  // ================= 决议 28–31：MCP → Tool 同步 =================

  /**
   * 立即同步（决议 33）：连接服务、拉取上游工具列表，按同步键
   * server-id + tool-name 写入 ToolRegistry。返回新增/更新/失效统计，
   * 命名冲突的条目在 suffixed 中明示（不静默覆盖）。
   */
  async syncServer(id, registry) {
    const s = this.#full(id);
    if (s.enabled === false) throw new Error('服务已停用，请先启用');
    if (!registry || typeof registry.register !== 'function') throw new Error('同步需要 ToolRegistry');
    const client = new McpClient(s);
    this.#setStatus(id, { status: 'connecting', lastError: null });
    let upstream;
    try {
      await client.connect({ timeoutMs: s.timeoutMs });
      upstream = await client.listTools({ timeoutMs: s.timeoutMs });
      await client.close();
    } catch (e) {
      await client.close().catch(() => {});
      const msg = String(e.message || e).slice(0, 300);
      this.#setStatus(id, { status: 'error', lastError: msg });
      await this.#markServerTools(id, 'disconnected', '连接失败：' + msg).catch(() => {});
      throw e;
    }
    const seen = new Set();
    let added = 0, updated = 0, removed = 0;
    const suffixed = [];
    const now = new Date().toISOString();
    for (const t of upstream) {
      const key = JSON.stringify([id, t.name]);
      seen.add(key);
      let rec = this.syncTools.get(key);
      if (!rec) {
        const registeredName = this.#allocateSyncedName(t.name, id, registry);
        rec = {
          serverId: id, serverName: s.name, toolName: t.name, registeredName,
          description: String(t.description || ''),
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' },
          enabled: true, sourceStatus: 'ok', invalidReason: null, invalidDetail: null, lastSyncAt: now
        };
        this.syncTools.set(key, rec);
        added++;
        if (registeredName !== `mcp.${sanitizeToolSegment(t.name)}`) suffixed.push({ tool: t.name, registeredName });
      } else {
        rec.serverName = s.name;
        rec.description = String(t.description || '');
        rec.inputSchema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' };
        rec.sourceStatus = 'ok'; rec.invalidReason = null; rec.invalidDetail = null; rec.lastSyncAt = now;
        updated++;
      }
      this.#registerSyncedTool(rec, registry, s);
    }
    // 决议 30：上游已下架的工具 → 标记"来源已失效"，保留配置与注册项
    for (const [key, rec] of this.syncTools) {
      if (rec.serverId === id && !seen.has(key) && rec.sourceStatus !== 'source_invalid') {
        rec.sourceStatus = 'source_invalid'; rec.invalidReason = 'removed'; rec.invalidDetail = '该工具已从服务上游下架';
        this.#registerSyncedTool(rec, registry, s);
        removed++;
      }
    }
    await this.#saveSync();
    this.#setStatus(id, { status: 'connected', lastConnected: now, lastError: null, toolCount: upstream.length });
    return {
      ok: true, serverId: id, synced: upstream.length, added, updated, removed, suffixed,
      tools: upstream.map(t => ({ name: t.name, description: String(t.description || ''), registeredName: this.syncTools.get(JSON.stringify([id, t.name]))?.registeredName || null }))
    };
  }

  /**
   * 服务启动时从持久化同步记录恢复工具注册（决议 30：保留配置）。
   * 不做全量拨测：可达性在下一次同步/调用时探明；服务不存在/已停用则
   * 直接标记来源失效。
   */
  async restoreSyncedTools(registry) {
    if (!registry || typeof registry.register !== 'function') return { restored: 0 };
    let restored = 0;
    for (const rec of this.syncTools.values()) {
      const server = this.servers.find(x => x.id === rec.serverId);
      if (!server) { rec.sourceStatus = 'source_invalid'; rec.invalidReason = 'deleted'; rec.invalidDetail = 'MCP 服务已删除'; }
      else if (server.enabled === false) { rec.sourceStatus = 'source_invalid'; rec.invalidReason = 'disabled'; rec.invalidDetail = 'MCP 服务已停用'; }
      else if (rec.sourceStatus !== 'source_invalid') { rec.sourceStatus = 'ok'; rec.invalidReason = null; rec.invalidDetail = null; }
      try { this.#registerSyncedTool(rec, registry, server); restored++; }
      catch { /* 单个注册失败不阻断启动 */ }
    }
    await this.#saveSync();
    return { restored };
  }

  /**
   * 决议 28：MCP 同步工具的启用/停用统一走 Tool 侧。调用方（平台服务）
   * 在更新 registry 的同时调用本方法，把开关状态写回同步记录。
   */
  async setToolEnabled(registeredName, enabled) {
    const rec = [...this.syncTools.values()].find(r => r.registeredName === registeredName);
    if (!rec) throw new Error('MCP 同步工具不存在：' + registeredName);
    rec.enabled = !!enabled;
    await this.#saveSync();
    return { ok: true, name: registeredName, enabled: rec.enabled };
  }

  /** 决议 29：MCP 页"工具"Tab 的只读同步视图数据。 */
  syncView() {
    const items = [...this.syncTools.values()].map(rec => {
      const server = this.servers.find(x => x.id === rec.serverId);
      let sourceStatus = rec.sourceStatus, invalidReason = rec.invalidReason, invalidDetail = rec.invalidDetail || null;
      if (!server) { sourceStatus = 'source_invalid'; invalidReason = 'deleted'; invalidDetail = 'MCP 服务已删除'; }
      else if (server.enabled === false) { sourceStatus = 'source_invalid'; invalidReason = 'disabled'; invalidDetail = 'MCP 服务已停用'; }
      return {
        serverId: rec.serverId, serverName: server?.name || rec.serverName, toolName: rec.toolName,
        registeredName: rec.registeredName, description: rec.description, enabled: rec.enabled !== false,
        sourceStatus, invalidReason, invalidDetail,
        invalidReasonText: sourceStatus === 'source_invalid' ? (INVALID_REASON_TEXT[invalidReason] || invalidReason || '来源已失效') : '',
        lastSyncAt: rec.lastSyncAt, upstream: true
      };
    });
    items.sort((a, b) => String(a.serverName).localeCompare(String(b.serverName), 'zh') || String(a.toolName).localeCompare(String(b.toolName)));
    return { items };
  }

  /** 分配注册名：mcp.<tool>；被占用时加来源后缀 --<serverId>，仍冲突则追加序号。 */
  #allocateSyncedName(toolName, serverId, registry) {
    const exists = name => {
      try { return registry.listCapabilities().some(t => t.name === name); }
      catch { return false; }
    };
    const base = `mcp.${sanitizeToolSegment(toolName)}`;
    if (!exists(base)) return base;
    const serverSeg = sanitizeToolSegment(serverId);
    let candidate = `${base}--${serverSeg}`;
    let n = 2;
    while (exists(candidate)) candidate = `${base}--${serverSeg}-${n++}`;
    return candidate;
  }

  /**
   * 把一条同步记录注册进 ToolRegistry。
   * 决议 31：inputSchema 取上游定义（只读，mcp.upstream 标记）；输出按 MCP
   * 内容块信封处理；错误走 Tool 统一错误 Contract。
   */
  #registerSyncedTool(rec, registry, server) {
    try { registry.unregister(rec.registeredName); }
    catch (e) { throw new Error(`同步工具 ${rec.registeredName} 失败：${e.message}`); }
    registry.register({
      name: rec.registeredName,
      source: 'mcp',
      fromSync: true,
      description: rec.description || `MCP 工具 ${rec.toolName}`,
      inputSchema: rec.inputSchema && typeof rec.inputSchema === 'object' ? rec.inputSchema : { type: 'object' },
      timeoutMs: server?.timeoutMs || 30000,
      enabled: rec.enabled !== false,
      mcp: {
        serverId: rec.serverId, serverName: rec.serverName, toolName: rec.toolName,
        upstream: true, status: rec
      },
      execute: (input, ctx) => this.#callSyncedTool(rec, input, ctx)
    });
  }

  async #callSyncedTool(rec, input, ctx = {}) {
    const server = this.servers.find(x => x.id === rec.serverId);
    if (!server) throw toolError('tool_source_unavailable', `MCP 工具「${rec.toolName}」来源已失效（服务已删除），配置已保留但不可调用`, { retryable: false });
    if (server.enabled === false) throw toolError('tool_source_unavailable', `MCP 工具「${rec.toolName}」来源已失效（服务已停用），配置已保留但不可调用`, { retryable: false });
    if (rec.sourceStatus === 'source_invalid') {
      throw toolError('tool_source_unavailable',
        `MCP 工具「${rec.toolName}」来源已失效（${INVALID_REASON_TEXT[rec.invalidReason] || '未知原因'}），配置已保留但不可调用`,
        { retryable: rec.invalidReason === 'disconnected' });
    }
    const client = new McpClient(server);
    const { signal } = ctx;
    const onAbort = () => client.close().catch(() => {});
    if (signal) {
      if (signal.aborted) await client.close().catch(() => {});
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      signal?.throwIfAborted();
      await client.connect({ timeoutMs: server.timeoutMs });
      const result = await client.callTool(rec.toolName, input && typeof input === 'object' ? input : {}, { timeoutMs: server.timeoutMs });
      return persistMediaReferences(result,this.directory);
    } catch (e) {
      if (e && e.error_code) throw e;
      const msg = String(e?.message || e).slice(0, 300);
      if (/超时|timeout|ECONNREFUSED|启动失败|进程退出|连接已关闭|HTTP \d|fetch failed/i.test(msg)) {
        await this.#markServerTools(rec.serverId, 'disconnected', '调用失败：' + msg).catch(() => {});
      }
      throw toolError('mcp_tool_error', `MCP 工具「${rec.toolName}」调用失败：${msg}`, { retryable: true });
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      await client.close().catch(() => {});
    }
  }

  /** 把某服务的所有同步工具标记为来源失效（保留配置与同步记录）。 */
  async #markServerTools(serverId, invalidReason, invalidDetail) {
    let changed = false;
    for (const rec of this.syncTools.values()) {
      if (rec.serverId === serverId && rec.sourceStatus !== 'source_invalid') {
        rec.sourceStatus = 'source_invalid'; rec.invalidReason = invalidReason; rec.invalidDetail = invalidDetail || null;
        changed = true;
      }
    }
    if (changed) await this.#saveSync();
  }
}
