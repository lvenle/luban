import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Minimal MCP client: stdio + Streamable HTTP transports.
 * Speaks JSON-RPC 2.0: initialize -> notifications/initialized -> tools/list, tools/call.
 * No external dependencies.
 */
export class McpClient {
  constructor(server, { fetchImpl = globalThis.fetch } = {}) {
    this.server = server;
    this.fetch = fetchImpl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect({ timeoutMs = 30000 } = {}) {
    const timeout = Math.min(Math.max(timeoutMs || 30000, 1000), 120000);
    if (this.server.transport === 'stdio') await this.#connectStdio(timeout);
    else if (this.server.transport === 'http') await this.#connectHttp(timeout);
    else throw new Error(`不支持的传输类型: ${this.server.transport}`);
    const result = await this.#request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-platform', version: '1.0.0' }
    }, timeout);
    // Best-effort initialized notification; servers must not require a response.
    try { await this.#notify('notifications/initialized', {}); } catch {}
    return { protocolVersion: result?.protocolVersion, serverInfo: result?.serverInfo };
  }

  async listTools({ timeoutMs = 30000 } = {}) {
    const timeout = Math.min(Math.max(timeoutMs || 30000, 1000), 120000);
    const result = await this.#request('tools/list', {}, timeout);
    return (result?.tools || []).map(t => ({
      name: String(t.name || ''),
      description: String(t.description || ''),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }
    })).filter(t => t.name);
  }

  async callTool(name, args = {}, { timeoutMs = 60000 } = {}) {
    const timeout = Math.min(Math.max(timeoutMs || 60000, 1000), 300000);
    if (!name || typeof name !== 'string') throw new Error('工具名称无效');
    return this.#request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }, timeout);
  }

  async ping({ timeoutMs = 10000 } = {}) {
    await this.#request('ping', {}, Math.min(Math.max(timeoutMs || 10000, 1000), 30000));
    return true;
  }

  async close() {
    for (const [, entry] of this.pending) entry.reject(new Error('连接已关闭'));
    this.pending.clear();
    if (this.proc) {
      const proc = this.proc; this.proc = null;
      proc.kill();
      await delay(200).catch(() => {});
      if (!proc.killed) try { proc.kill('SIGKILL'); } catch {}
    }
  }

  // ---- stdio transport ----
  async #connectStdio(timeout) {
    const { command, args = [], env = {}, cwd } = this.server;
    if (!command || typeof command !== 'string') throw new Error('stdio 传输需要 command');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error(`stdio 启动超时（${timeout}ms）：${command}`)); }, timeout);
      let proc;
      try {
        proc = spawn(command, Array.isArray(args) ? args : [], {
          env: { ...process.env, ...env },
          cwd: cwd || process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (e) { clearTimeout(timer); reject(e); return; }
      proc.on('error', err => { clearTimeout(timer); reject(new Error(`stdio 启动失败：${err.message}`)); });
      // Wait for the process to stay alive briefly; MCP servers speak only after initialize.
      proc.on('spawn', () => { clearTimeout(timer); resolve(); });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
      proc.on('exit', (code, signal) => {
        if (this.proc === proc) { this.proc = null; this.#failAll(new Error(`MCP 服务进程退出（code=${code}, signal=${signal}）${stderr ? '：' + stderr.slice(-500) : ''}`)); }
      });
      this.proc = proc;
      this.buffer = '';
      proc.stdout.on('data', d => this.#onStdioData(d));
    });
  }

  #onStdioData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.#onMessage(msg);
    }
  }

  #sendStdio(obj) {
    if (!this.proc) throw new Error('stdio 连接未建立');
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  // ---- Streamable HTTP transport ----
  async #connectHttp(timeout) {
    const { url, headers = {} } = this.server;
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('http 传输需要有效的 URL');
    this.httpUrl = url;
    this.httpHeaders = headers && typeof headers === 'object' ? headers : {};
    this.httpTimeout = timeout;
  }

  async #httpRpc(obj) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeout || 30000);
    try {
      const res = await this.fetch(this.httpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...this.httpHeaders },
        body: JSON.stringify(obj),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}：${await res.text().catch(() => '')}`.slice(0, 300));
      const text = await res.text();
      // Support both plain JSON and SSE-wrapped JSON-RPC responses.
      const payload = text.includes('data:')
        ? text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean).pop()
        : text;
      const msg = JSON.parse(payload || text);
      this.#onMessage(msg);
    } finally { clearTimeout(timer); }
  }

  // ---- JSON-RPC ----
  #request(method, params, timeout) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP 请求超时（${method}，${timeout}ms）`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const obj = { jsonrpc: '2.0', id, method, params };
      try {
        if (this.server.transport === 'stdio') this.#sendStdio(obj);
        else this.#httpRpc(obj).catch(e => this.#onMessage({ jsonrpc: '2.0', id, error: { message: e.message } }));
      } catch (e) {
        this.pending.delete(id); clearTimeout(timer); reject(e);
      }
    });
  }

  #notify(method, params) {
    const obj = { jsonrpc: '2.0', method, params };
    if (this.server.transport === 'stdio') this.#sendStdio(obj);
    else return this.#httpRpc(obj).catch(() => {});
  }

  #onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      this.pending.delete(msg.id); clearTimeout(timer);
      if (msg.error) reject(new Error(`MCP 错误：${msg.error.message || JSON.stringify(msg.error)}`.slice(0, 500)));
      else resolve(msg.result);
    }
    // Server notifications/requests are ignored (no handler needed for management).
  }

  #failAll(err) {
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(err); }
    this.pending.clear();
  }
}
