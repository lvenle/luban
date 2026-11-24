const TOOL_NAME = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

import Ajv from 'ajv';
const schemas = new Ajv({ allErrors: true, strict: false });

/** 决议 28/33：工具来源维度。MCP 工具只能由 MCP 同步产生，不可直接注册。 */
export const TOOL_SOURCES = ['platform', 'business', 'mcp', 'wechat'];
export const TOOL_SOURCE_LABEL = { platform: '平台自建', business: '企业业务', mcp: 'MCP', wechat: '微信' };

/**
 * Tool 统一错误 Contract（决议 31，与 Skill 错误 Contract 对齐）：
 * { error_code, message, retryable }。错误以 Error 形式抛出，同时携带这三个字段。
 */
export function toolError(error_code, message, { retryable = false } = {}) {
  const error = new Error(message);
  error.error_code = error_code;
  error.retryable = retryable;
  return error;
}

/** 把任意错误折叠为 Tool 错误 Contract 的纯数据形状。 */
export function toToolErrorContract(error) {
  return {
    error_code: error?.error_code || 'tool_execution_failed',
    message: String(error?.message ?? error),
    retryable: error?.retryable === true
  };
}

function assertToolDefinition(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    throw new TypeError('tool must be an object');
  }
  if (typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name)) {
    throw new TypeError('tool.name must be a namespaced identifier');
  }
  if (typeof tool.execute !== 'function') throw new TypeError('tool.execute must be a function');
  if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
    throw new TypeError('tool.inputSchema must be an object');
  }
  if (tool.timeoutMs !== undefined &&
      (!Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs <= 0)) {
    throw new TypeError('tool.timeoutMs must be a positive safe integer');
  }
  if (tool.configSchema !== undefined && (typeof tool.configSchema !== 'object' || tool.configSchema === null || Array.isArray(tool.configSchema))) {
    throw new TypeError('tool.configSchema must be a JSON Schema object');
  }
  if (tool.group !== undefined && typeof tool.group !== 'string') {
    throw new TypeError('tool.group must be a string');
  }
  if (tool.secretFields !== undefined && (!Array.isArray(tool.secretFields) || tool.secretFields.some(f => typeof f !== 'string' || !f))) {
    throw new TypeError('tool.secretFields must be an array of non-empty strings');
  }
  if (tool.source !== undefined && !TOOL_SOURCES.includes(tool.source)) {
    throw new TypeError(`tool.source must be one of: ${TOOL_SOURCES.join(', ')}`);
  }
  if (tool.source === 'mcp' && tool.fromSync !== true) {
    throw new TypeError('MCP 工具只能由 MCP 同步产生，不可直接注册');
  }
  if (tool.description !== undefined && typeof tool.description !== 'string') {
    throw new TypeError('tool.description must be a string');
  }
  if (tool.instructions !== undefined && typeof tool.instructions !== 'string') {
    throw new TypeError('tool.instructions must be a string');
  }
  if (tool.enabled !== undefined && typeof tool.enabled !== 'boolean') {
    throw new TypeError('tool.enabled must be a boolean');
  }
}

function defaultInstructions(tool, description) {
  const properties = tool.inputSchema?.properties || {};
  const names = Object.keys(properties);
  if (!names.length) return `无需提供输入参数。仅在任务确实需要此工具能力时调用。工具用途：${description}`;
  const required = new Set(tool.inputSchema?.required || []);
  const fields = names.map(name => {
    const field = properties[name] || {};
    const type = field.type || (field.enum ? 'enum' : 'object');
    const choices = Array.isArray(field.enum) ? `；可选值：${field.enum.join('、')}` : '';
    const note = typeof field.description === 'string' && field.description.trim() ? `；${field.description.trim()}` : '';
    return `- ${name}（${required.has(name) ? '必填' : '可选'}，${type}${choices}${note}）`;
  });
  return `调用时严格按以下输入参数提供数据，不要添加未声明字段：\n${fields.join('\n')}\n仅在任务需要此工具用途时调用：${description}`;
}

function documentedTool(tool) {
  const description = tool.description?.trim() || `用于执行 ${tool.name} 所描述的操作。`;
  const supplied = tool.instructions?.trim();
  const instructions = supplied && supplied !== description ? supplied : defaultInstructions(tool, description);
  return { ...tool, description, instructions };
}

export class ToolRegistry {
  #tools = new Map();
  #running = new Map();
  #validators = new Map();
  #configValidators = new Map();

  register(tool) {
    assertToolDefinition(tool);
    tool = documentedTool(tool);
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    const validate = schemas.compile(structuredClone(tool.inputSchema));
    this.#validators.set(tool.name, validate);
    if (tool.configSchema) {
      try { this.#configValidators.set(tool.name, schemas.compile(structuredClone(tool.configSchema))); }
      catch (e) { throw new TypeError(`tool.configSchema is not a valid JSON Schema: ${e.message}`); }
    }
    // fromSync 是同步管道的内部标记，不进入对外能力视图
    const { fromSync, ...rest } = tool;
    this.#tools.set(tool.name, Object.freeze({
      risk: 'read',
      idempotent: false,
      timeoutMs: 30_000,
      source: 'platform',
      enabled: true,
      ...rest
    }));
    return () => this.unregister(tool.name);
  }

  replace(tool) {
    assertToolDefinition(tool);
    tool = documentedTool(tool);
    if (!this.#tools.has(tool.name)) throw Error(`Tool not found: ${tool.name}`);
    if ([...this.#running.values()].some(run => run.name === tool.name)) throw Error(`Cannot edit running tool: ${tool.name}`);
    const validate = schemas.compile(structuredClone(tool.inputSchema));
    const configValidate = tool.configSchema ? schemas.compile(structuredClone(tool.configSchema)) : null;
    const { fromSync, ...rest } = tool;
    this.#validators.set(tool.name, validate);
    if (configValidate) this.#configValidators.set(tool.name, configValidate);
    else this.#configValidators.delete(tool.name);
    this.#tools.set(tool.name, Object.freeze({ risk: 'read', idempotent: false, timeoutMs: 30_000, source: 'platform', enabled: true, ...rest }));
    return this.listCapabilities().find(item => item.name === tool.name);
  }

  /**
   * 决议 28：启用/停用是 Tool 注册表的统一管理面（含 MCP 同步来的工具）。
   * MCP 工具的开关状态由 McpManager 另行持久化，调用方需同时更新两处。
   */
  setEnabled(name, enabled) {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    const next = Object.freeze({ ...tool, enabled: !!enabled });
    this.#tools.set(name, next);
    const { execute, healthCheck, ...capability } = next;
    return structuredClone(capability);
  }

  registerProvider(provider) {
    if (!provider || typeof provider.listTools !== 'function') {
      throw new TypeError('provider.listTools must be a function');
    }
    const unregister = provider.listTools().map(tool => this.register(tool));
    return () => unregister.reverse().forEach(remove => remove());
  }

  unregister(name) {
    if ([...this.#running.values()].some(run => run.name === name)) {
      throw new Error(`Cannot unregister running tool: ${name}`);
    }
    this.#validators.delete(name);
    this.#configValidators.delete(name);
    return this.#tools.delete(name);
  }

  /** Validate instance-level tool configuration against the tool's configSchema. */
  validateToolConfig(name, config) {
    if (!this.#tools.has(name)) throw new Error(`Tool not found: ${name}`);
    const validate = this.#configValidators.get(name);
    if (!validate) {
      if (config !== null && config !== undefined) throw new Error(`Tool ${name} has no configurable options`);
      return;
    }
    if (config === null || config === undefined) throw new Error(`Tool ${name} requires configuration`);
    if (!validate(config)) throw new Error(`Invalid tool configuration: ${schemas.errorsText(validate.errors)}`);
  }

  listCapabilities() {
    return [...this.#tools.values()].map(({ execute, healthCheck, ...tool }) => structuredClone(tool));
  }

  async execute({ callId, name, input, allowedTools, signal, userText, waitForCleanup = false }) {
    if (typeof callId !== 'string' || !callId) throw new TypeError('callId is required');
    if (this.#running.has(callId)) throw new Error(`Tool call already running: ${callId}`);
    const tool = this.#tools.get(name);
    if (!tool) throw toolError('tool_not_found', `Tool not found: ${name}`);
    if (tool.enabled === false) throw toolError('tool_disabled', `Tool disabled: ${name}`);
    if (!new Set(allowedTools ?? []).has(name)) throw toolError('tool_not_allowed', `Tool not allowed: ${name}`);
    signal?.throwIfAborted();
    const validate = this.#validators.get(name);
    if (!validate(input)) {
      const error = new TypeError(`Invalid tool input: ${schemas.errorsText(validate.errors)}`);
      error.code = 'invalid_tool_input';
      error.error_code = 'invalid_tool_input';
      error.retryable = false;
      throw error;
    }

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Tool execution timed out')), tool.timeoutMs);
    const run = { name, controller };
    this.#running.set(callId, run);
    let onAbort, work;
    try {
      const aborted = new Promise((_, reject) => {
        onAbort = () => {
          const error = new Error(controller.signal.reason?.message || 'Tool execution cancelled');
          error.code = 'tool_interrupted';
          error.error_code = 'tool_interrupted';
          error.retryable = false;
          // Cancellation cannot prove that an external write did not happen.
          error.outcome = tool.risk === 'read' ? 'cancelled' : 'unknown';
          reject(error);
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      work = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return tool.execute(input, { callId, signal: controller.signal, userText });
      });
      return await Promise.race([work, aborted]);
    } catch (error) {
      if (waitForCleanup && work) {
        try { const output = await work; if (controller.signal.aborted) {error.completedOutput = output;error.outcome=output?.ack===false||output?.ack==='unknown'||output?.isError||output?.is_error?'unknown':'confirmed';} } catch {}
      }
      // 决议 31：执行错误统一折叠为 Tool 错误 Contract；已带 error_code / 中断信号的直接透出。
      if (error && (error.error_code || error.code === 'tool_interrupted' || error.name === 'AbortError')) {
        if (!error.error_code) { error.error_code = 'tool_interrupted'; error.retryable = false; }
        throw error;
      }
      throw toolError('tool_execution_failed', error?.message || String(error), { retryable: true });
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', abort);
      this.#running.delete(callId);
    }
  }

  cancel(callId, reason = new Error('Tool call cancelled')) {
    const run = this.#running.get(callId);
    if (!run) return false;
    run.controller.abort(reason);
    return true;
  }

  async healthCheck() {
    const results = [];
    for (const tool of this.#tools.values()) {
      try {
        const detail = typeof tool.healthCheck === 'function' ? await tool.healthCheck() : null;
        results.push({ name: tool.name, healthy: true, detail });
      } catch (error) {
        results.push({ name: tool.name, healthy: false, error: error.message });
      }
    }
    return results;
  }
}
