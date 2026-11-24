import { appendFile, mkdir, readFile, open, rename, unlink, chmod, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { parse, stringify } from 'yaml';
import Ajv from 'ajv';
import { slimHistoryToConfigRevisions, slimConversationsToTable, slimModelDiagnosticsToTable, slimWechatEventsJsonlToDb, archiveMigratedFile } from './storage-migrations.js';
import { writeWechatEvents, readWechatEvents, readWechatEventsById, readWechatConversationEvents, pageWechatEvents, readConversations, writeConversation, readModelStatus, writeModelStatus } from './instance-runtime-storage.js';
import { normalizeHttpTool } from '../tools/http-json-tool.js';
import { persistMediaReferences } from '../media/persist-references.js';
import { VERSION_PATTERN, compareVersions } from '../skills/skill-format.js';
const outputSchemas = new Ajv({ allErrors: true, strict: false });

const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const skillIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const clone = value => structuredClone(value);
// Retain enough WeChat events for the console to page through recent history.
// The cap is enforced on every write so the instance file cannot grow forever.
const WECHAT_EVENT_LIMIT = 1000;
/** Retained per-conversation scheduler state; oldest conversations are trimmed first. */
const WECHAT_CONVERSATION_LIMIT = 200;
const WECHAT_PENDING_MESSAGE_LIMIT = 50;
const WECHAT_PENDING_REASONS = Object.freeze(['run_failed', 'send_failed', 'send_unknown']);
/**
 * 自动回复调度默认值。合并窗口的代价是回复会晚 coalesceQuietMs 才发出，
 * 换来"不刷屏 + 同一轮有上下文"。
 */
const WECHAT_SCHEDULER_DEFAULTS = Object.freeze({
  coalesceQuietMs: 2500,
  coalesceMaxMs: 8000,
  coalesceMaxMessages: 10,
  maxConcurrentReplies: 3,
  memoryTurns: 6,
  memoryBudgetChars: 24000,
});
const WECHAT_SCHEDULER_LIMITS = Object.freeze({
  coalesceQuietMs: [0, 60000],
  coalesceMaxMs: [0, 300000],
  coalesceMaxMessages: [1, 100],
  maxConcurrentReplies: [1, 20],
  memoryTurns: [0, 50],
  memoryBudgetChars: [0, 200000],
});
const WECHAT_PENDING_TEXT_MAX = 10000;

/** 补全缺省的调度参数；老实例文件因此不需要迁移。 */
function normalizeWechatSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const settings = { autoReply: source.autoReply === true };
  for (const [key, fallback] of Object.entries(WECHAT_SCHEDULER_DEFAULTS)) {
    settings[key] = Number.isInteger(source[key]) ? source[key] : fallback;
  }
  // 微信昵称没有可靠的本地读取途径（自我资料不在联系人表，配置是加密的），
  // 所以在控制台填一次即可；留空表示仍然显示 wxid。
  const accountName = typeof source.accountName === 'string' ? source.accountName.trim().slice(0, 50) : '';
  if (accountName) settings.accountName = accountName;
  return settings;
}

function clipText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** 未被成功回复的消息；内容自带一份，避免被事件缓冲淘汰后丢失。 */
function normalizeWechatPending(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!WECHAT_PENDING_REASONS.includes(value.reason)) return null;
  const messages = (Array.isArray(value.messages) ? value.messages : [])
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .slice(-WECHAT_PENDING_MESSAGE_LIMIT)
    .map(item => ({
      at: clipText(item.at, 40),
      sender: clipText(item.sender, 200),
      messageType: clipText(item.messageType, 20) || 'text',
      text: clipText(item.text, WECHAT_PENDING_TEXT_MAX) || '',
    }));
  return {
    since: clipText(value.since, 40),
    reason: value.reason,
    error: clipText(value.error, 2000),
    attemptedText: clipText(value.attemptedText, WECHAT_PENDING_TEXT_MAX),
    messages,
    eventIds: (Array.isArray(value.eventIds) ? value.eventIds : []).filter(id => typeof id === 'string' && id).slice(-WECHAT_PENDING_MESSAGE_LIMIT),
    attempts: Number.isInteger(value.attempts) && value.attempts > 0 ? value.attempts : 1,
    needsAttention: value.needsAttention === true,
  };
}

/** Agent Skill binding contains a stable package ID and optional immutable version only. */
function isValidSkillBinding(s) {
  if (typeof s === 'string') return !!s;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  if (!skillIdPattern.test(s.id || '')) return false;
  if (s.version !== undefined && typeof s.version !== 'string') return false;
  if (Object.keys(s).some(key => !['id', 'version'].includes(key))) return false;
  return true;
}

/**
 * 决议 10（Agent 侧）：Agent 版本模型与 Skill 同构。
 * 自建 Agent = { id, name, draft: <config>, versions: [{ version, publishedAt, note, snapshot: <config> }] }；
 * 通用助手使用相同的草稿/发布版本模型，但始终不可删除。
 * config 字段：system/connectionId/tools/skills/knowledge/params/maxTurns/timeoutMs/outputSchema/maxOutputRetries。
 * Agent 顶层 extensions 是产品集成声明，不属于版本化 prompt；它用于在底座界面标识产品注入的运行时扩展，
 * 并可携带受限的运行时提示词正文供底座执行器注入。
 */
const AGENT_CONFIG_KEYS = ['system', 'connectionId', 'tools', 'skills', 'knowledge', 'params', 'maxTurns', 'timeoutMs', 'outputSchema', 'maxOutputRetries'];
function pickAgentConfig(input = {}) {
  return {
    system: input.system || '',
    connectionId: input.connectionId || null,
    tools: clone(input.tools || []),
    skills: clone(input.skills || []),
    knowledge: clone(input.knowledge || []),
    params: clone(input.params || {}),
    maxTurns: input.maxTurns ?? 12,
    timeoutMs: input.timeoutMs ?? 180000,
    outputSchema: clone(input.outputSchema ?? null),
    maxOutputRetries: input.maxOutputRetries ?? 2,
  };
}
function normalizeAgentExtensions(input = []) {
  if (!Array.isArray(input)) throw Error('Invalid Agent extensions');
  if (input.length > 20) throw Error('Too many Agent extensions');
  return input.map(extension => {
    if (!extension || typeof extension !== 'object' || Array.isArray(extension)) throw Error('Invalid Agent extension');
    const id = String(extension.id || '').trim();
    const label = String(extension.label || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) || !label || label.length > 80) throw Error('Invalid Agent extension identity');
    const content = extension.content ?? extension.prompt;
    return {
      id,
      label,
      ...(extension.source ? { source: String(extension.source).slice(0, 80) } : {}),
      ...(extension.summary ? { summary: String(extension.summary).slice(0, 500) } : {}),
      ...(content !== undefined ? (() => {
        const value = String(content);
        if (value.length > 100000) throw Error('Agent extension content exceeds 100 KB');
        return { content: value };
      })() : {}),
      ...(extension.updatedAt ? { updatedAt: String(extension.updatedAt) } : {})
    };
  });
}
/** 取 Agent 的可编辑配置。 */
export function agentDraftOf(agent) {
  if (!agent) return null;
  return agent.draft || null;
}
function validateAgentFields(cfg, connections) {
  validateParams(cfg.params);
  if (cfg.outputSchema !== null && cfg.outputSchema !== undefined) {
    if (typeof cfg.outputSchema !== 'object' || Array.isArray(cfg.outputSchema)) throw Error('Output schema must be a JSON Schema object');
    if (Buffer.byteLength(JSON.stringify(cfg.outputSchema)) > 100000) throw Error('Output schema exceeds 100 KB');
    outputSchemas.compile(cfg.outputSchema);
  }
  if (typeof cfg.system !== 'string') throw Error('Agent prompt is required');
  if (cfg.connectionId && !connections.has(cfg.connectionId)) throw Error('Agent references a missing connection');
  if (!Number.isInteger(cfg.maxTurns) || cfg.maxTurns < 1 || cfg.maxTurns > 100) throw Error('Invalid Agent maxTurns');
  if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs < 1000 || cfg.timeoutMs > 3600000) throw Error('Invalid Agent timeout');
  for (const key of ['tools', 'knowledge']) {
    if (!Array.isArray(cfg[key]) || cfg[key].some(x => typeof x !== 'string' || !x)) throw Error(`Invalid Agent ${key}`);
  }
  // skills: 'skill-id' 或 { id, version? }（Agent 发布时快照版本号，如 xxx@v2.1）。
  if (!Array.isArray(cfg.skills) || cfg.skills.some(s => !isValidSkillBinding(s))) throw Error('Invalid Agent skills');
  if (cfg.maxOutputRetries !== undefined && (!Number.isInteger(cfg.maxOutputRetries) || cfg.maxOutputRetries < 0 || cfg.maxOutputRetries > 5)) throw Error('Invalid output retry limit');
}
/**
 * 迁移：扁平 Agent → { draft, versions: [v1.0 初始版本] }，保证线上行为不变。
 * 幂等：已有 draft 即视为已迁移。旧版内置助手转为可编辑草稿，不自动发布。
 */
const LEGACY_TOOL_IDS = Object.freeze({
  'pi.read': 'workspace.read_file', 'pi.bash': 'runtime.exec',
  'pi.edit': 'workspace.edit_file', 'pi.write': 'workspace.write_file'
});
const migrateSkillConfig = config => ({ ...config,
  tools: [...new Set((config.tools || []).map(name => LEGACY_TOOL_IDS[name] || name))],
  skills: (config.skills || []).map(skill => typeof skill === 'string' ? skill : ({ id: skill.id, ...(skill.version ? { version: skill.version } : {}) }))
});
function migrateAgent(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return a;
  if (a.draft && typeof a.draft === 'object') {
    const migrated = { ...a, draft: migrateSkillConfig(a.draft), versions: (a.versions || []).map(version => ({ ...version, snapshot: version.snapshot ? migrateSkillConfig(version.snapshot) : version.snapshot })) };
    if (a.id === 'coding-assistant') {
      for (const config of [migrated.draft, ...migrated.versions.map(version => version.snapshot).filter(Boolean)]) {
        config.system = String(config.system || '').replace(/pi 工具/g, '平台提供的工作区和执行工具').replace(/pi\./g, '通用工作区工具');
      }
    }
    return migrated;
  }
  const { id, name } = a;
  const draft = migrateSkillConfig(pickAgentConfig(a));
  if (id === 'assistant' && a.version === 'builtin') return { id, name, draft, versions: [] };
  if (id === 'coding-assistant') draft.system = String(draft.system || '').replace(/pi 工具/g, '平台提供的工作区和执行工具').replace(/pi\./g, '通用工作区工具');
  const snapshot = migrateSkillConfig(clone(draft));
  return { id, name, ...(typeof a.description === 'string' ? { description: a.description } : {}), draft, versions: [{ version: 'v1.0', publishedAt: new Date().toISOString(), note: '初始版本（自动迁移）', snapshot: { ...snapshot, ...(typeof a.description === 'string' ? { description: a.description } : {}) } }] };
}
/**
 * Restrict a credentials-bearing file to the current user.
 * Fail closed: a credentials file we cannot secure must not be left readable.
 */
export async function secureFile(path, { platform = process.platform, run = defaultRun } = {}) {
  if (platform === 'win32') {
    const user = process.env.USERNAME || process.env.USER;
    if (!user) throw Error('Windows 用户名未知，无法收紧凭据文件 ACL');
    await run('icacls', [path, '/inheritance:r']);
    await run('icacls', [path, '/grant:r', `${user}:(R,W)`]);
    return;
  }
  await chmod(path, 0o600);
}
function defaultRun(file, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(file, args, error => error ? reject(error) : resolvePromise());
  });
}
function validateParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('Invalid model parameters');
  for (const key of Object.keys(params)) if (!['temperature', 'topP', 'maxTokens', 'stop'].includes(key)) throw Error(`Unsupported model parameter: ${key}`);
  for (const [key, max] of [['temperature', 2], ['topP', 1]]) if (params[key] !== undefined && (typeof params[key] !== 'number' || !Number.isFinite(params[key]) || params[key] < 0 || params[key] > max)) throw Error(`Invalid ${key}`);
  if (params.maxTokens !== undefined && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens < 1)) throw Error('Invalid maxTokens');
  if (params.stop !== undefined && !(typeof params.stop === 'string' || (Array.isArray(params.stop) && params.stop.every(s => typeof s === 'string')))) throw Error('Invalid stop sequences');
}
function validate(config) {
  if (config.schemaVersion !== 1 || !Number.isSafeInteger(config.revision) || config.revision < 0) throw Error('Invalid instance configuration version');
  if (!Array.isArray(config.connections) || !Array.isArray(config.agents)) throw Error('Invalid instance configuration');
  if (!config.secrets || typeof config.secrets !== 'object' || Array.isArray(config.secrets) || !Array.isArray(config.history)) throw Error('Invalid instance storage');
  for (const [connectionId, s] of Object.entries(config.modelStatus || {})) {
    if (!idPattern.test(connectionId) || typeof s !== 'object' || s === null || Array.isArray(s)) throw Error('Invalid model status entry');
    if (s.health !== undefined) {
      if (typeof s.health !== 'object' || s.health === null || !['ok', 'failed', 'unknown'].includes(s.health.status)) throw Error('Invalid model health status');
      if (s.health.checkedAt !== null && s.health.checkedAt !== undefined && typeof s.health.checkedAt !== 'string') throw Error('Invalid health check time');
    }
    if (s.failureCount !== undefined && (!Number.isInteger(s.failureCount) || s.failureCount < 0)) throw Error('Invalid model failure count');
  }
  if (config.modelCards !== undefined && (typeof config.modelCards !== 'object' || config.modelCards === null || Array.isArray(config.modelCards))) throw Error('Invalid model card storage');
  if (config.toolConfigs !== undefined && (typeof config.toolConfigs !== 'object' || config.toolConfigs === null || Array.isArray(config.toolConfigs))) throw Error('Invalid tool configuration storage');
  if (!Array.isArray(config.customTools)) throw Error('Invalid custom tool storage');
  const customNames = new Set();
  for (const entry of config.customTools) {
    const tool = normalizeHttpTool(entry);
    if (entry.type !== 'http-json' || customNames.has(tool.name)) throw Error('Invalid or duplicate custom tool');
    customNames.add(tool.name);
  }
function validateWechatSettings(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Invalid wechat settings');
  if (typeof value.autoReply !== 'boolean') throw Error('Invalid wechat settings');
  if (value.accountName !== undefined && (typeof value.accountName !== 'string' || value.accountName.length > 50)) throw Error('Invalid wechat account name');
  for (const [key, [min, max]] of Object.entries(WECHAT_SCHEDULER_LIMITS)) {
    const setting = value[key];
    if (setting === undefined) continue;
    if (!Number.isInteger(setting) || setting < min || setting > max) throw Error(`Invalid wechat setting ${key}`);
  }
}

  if (config.wechat !== undefined) {
    if (typeof config.wechat !== 'object' || config.wechat === null || Array.isArray(config.wechat)) throw Error('Invalid wechat storage');
    if (!Array.isArray(config.wechat.contacts)) throw Error('Invalid wechat contacts');
    for (const c of config.wechat.contacts) {
      if (typeof c !== 'object' || c === null || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) throw Error('Invalid wechat contact');
      if (c.replyEnabled !== undefined && typeof c.replyEnabled !== 'boolean') throw Error('Invalid wechat contact replyEnabled');
    }
    const ws = config.wechat.settings;
    if (ws !== undefined) validateWechatSettings(ws);
    const conversations = config.wechat.conversations;
    if (conversations !== undefined) {
      if (typeof conversations !== 'object' || conversations === null || Array.isArray(conversations)) throw Error('Invalid wechat conversations');
      const entries = Object.entries(conversations);
      if (entries.length > WECHAT_CONVERSATION_LIMIT) throw Error('Invalid wechat conversations');
      for (const [chatId, entry] of entries) {
        if (!chatId || chatId.length > 200) throw Error('Invalid wechat conversation id');
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw Error('Invalid wechat conversation');
        if (entry.sessionId !== undefined && entry.sessionId !== null && typeof entry.sessionId !== 'string') throw Error('Invalid wechat conversation sessionId');
        if (entry.pending !== undefined && entry.pending !== null) {
          if (typeof entry.pending !== 'object' || Array.isArray(entry.pending)) throw Error('Invalid wechat pending');
          if (!WECHAT_PENDING_REASONS.includes(entry.pending.reason)) throw Error('Invalid wechat pending reason');
          if (entry.pending.messages !== undefined && !Array.isArray(entry.pending.messages)) throw Error('Invalid wechat pending messages');
          if (entry.pending.eventIds !== undefined && !Array.isArray(entry.pending.eventIds)) throw Error('Invalid wechat pending eventIds');
        }
      }
    }
  }
  for (const [connectionId, cards] of Object.entries(config.modelCards || {})) {
    if (!idPattern.test(connectionId) || typeof cards !== 'object' || cards === null || Array.isArray(cards)) throw Error('Invalid model card storage');
    for (const [modelId, card] of Object.entries(cards)) {
      if (typeof modelId !== 'string' || !modelId || modelId.length > 200) throw Error('Invalid model card entry');
      validateModelCard(card);
    }
  }
  const connections = new Set();
  for (const c of config.connections) {
    if (!idPattern.test(c.id) || connections.has(c.id)) throw Error('Invalid or duplicate connection ID');
    connections.add(c.id);
    validateParams(c.params);
    if (!['openai-compatible', 'anthropic'].includes(c.provider)) throw Error('Unsupported model provider');
    if (typeof c.enabled !== 'boolean') throw Error('Invalid connection enabled flag');
    if (typeof c.model !== 'string' || !c.model.trim()) throw Error('Model ID is required');
    if (c.baseUrl && !['https:', 'http:'].includes(new URL(c.baseUrl).protocol)) throw Error('Invalid model URL');
    if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 600000) throw Error('Invalid connection timeout');
  }
  if (config.defaultConnectionId && !connections.has(config.defaultConnectionId)) throw Error('Default connection does not exist');
  const agents = new Set();
  for (const a of config.agents) {
    if (!idPattern.test(a.id) || agents.has(a.id)) throw Error('Invalid or duplicate Agent ID');
    agents.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim()) throw Error('Agent name is required');
    if (a.version !== undefined) throw Error('Invalid Agent version field (did you mean a published version?)');
    normalizeAgentExtensions(a.extensions || []);
    if (!a.draft || typeof a.draft !== 'object' || Array.isArray(a.draft)) throw Error('Invalid Agent draft');
    validateAgentFields(a.draft, connections);
    if (!Array.isArray(a.versions)) throw Error('Invalid Agent versions');
    const seen = new Set();
    for (const v of a.versions) {
      if (!v || typeof v !== 'object' || !VERSION_PATTERN.test(v.version || '') || seen.has(v.version)) throw Error('Invalid Agent version entry');
      seen.add(v.version);
      if (typeof v.publishedAt !== 'string' || !v.publishedAt) throw Error('Invalid Agent version publish time');
      if (v.note !== undefined && typeof v.note !== 'string') throw Error('Invalid Agent version note');
      if (!v.snapshot || typeof v.snapshot !== 'object' || Array.isArray(v.snapshot)) throw Error('Invalid Agent version snapshot');
      validateAgentFields(v.snapshot, connections);
    }
  }
  const applicationIds = new Set();
  for (const app of config.applicationInstances || []) {
    if (!idPattern.test(app.id || '') || applicationIds.has(app.id)) throw Error('Invalid or duplicate application instance');
    applicationIds.add(app.id);
    if (!idPattern.test(app.appType || '') || typeof app.name !== 'string' || !app.name.trim()) throw Error('Invalid application identity');
    const agent = config.agents.find(item => item.id === app.primaryAgentId);
    if (!agent || agent.origin !== 'builtin' || agent.ownerApplicationInstanceId !== app.id) throw Error('Invalid application assistant binding');
  }
  for (const agent of config.agents) {
    if (agent.ownerApplicationInstanceId && !applicationIds.has(agent.ownerApplicationInstanceId)) throw Error('Unknown assistant application');
  }
  // 决议 27："默认 Agent"是指针，须指向存在的 Agent；prepare() 已做缺省归一。
  if (config.defaultAgentId !== undefined && config.defaultAgentId !== null && !agents.has(config.defaultAgentId)) throw Error('Default Agent does not exist');
}

const CAPABILITY_KEYS = ['tools', 'vision', 'structuredOutput', 'streaming'];
function validateModelCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw Error('Invalid model card');
  if (typeof card.id !== 'string' || !card.id) throw Error('Invalid model card id');
  if (!card.capabilities || typeof card.capabilities !== 'object') throw Error('Invalid model card capabilities');
  for (const key of CAPABILITY_KEYS) {
    if (![true, false, null].includes(card.capabilities[key])) throw Error(`Invalid model capability: ${key}`);
  }
  for (const key of Object.keys(card.capabilities)) {
    if (!CAPABILITY_KEYS.includes(key)) throw Error(`Unknown model capability: ${key}`);
  }
  if (card.paramOverrides !== undefined && (typeof card.paramOverrides !== 'object' || card.paramOverrides === null || Array.isArray(card.paramOverrides))) throw Error('Invalid model param overrides');
}

/** One instance service owns writes. Secrets never appear in public snapshots/history. */
export class InstanceStore {
  #state; #queue = Promise.resolve();
  #database = null;
  #modelSource = null;
  #wechatEvents;
  #wechatEventsLoaded;
  /** Fields customers cannot change; set from the product policy. */
  lockedFields = { agent: [], connection: [] };
  constructor(directory, { productId = 'standalone', allowForeignProduct = false, database = null, modelSource = null } = {}) {
    this.directory = resolve(directory); this.productId = productId; this.allowForeignProduct = allowForeignProduct;
    this.#database = database;
    this.#modelSource = modelSource;
    this.path = join(this.directory, 'instance.yaml');
    // JSONL is the legacy import/file-adapter path only. Production runtime
    // events use the injected shared SQLite connection, independently of YAML.
    this.wechatEventsPath = join(this.directory, 'wechat-events.jsonl');
    this.#wechatEvents = [];
    this.#wechatEventsLoaded = false;
  }
  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.#state = parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#state = { schemaVersion: 1, revision: 0, productId: this.productId, defaultConnectionId: null, defaultAgentId: 'assistant', connections: [], agents: [{ id: 'assistant', name: '通用助手', draft: pickAgentConfig({ system: '根据真实工具结果回答，资料不足时明确说明。' }), versions: [] }], secrets: {}, history: [], modelCards: {}, modelStatus: {}, toolConfigs: {}, customTools: [], wechat: { contacts: [], settings: { autoReply: false }, events: [] } };
      await this.#write(this.#state);
    }
    // Tolerate state written before these sections existed.
    const hasRuntimeFields=['history','modelCards','modelStatus'].some(key=>Object.hasOwn(this.#state,key))
      ||Boolean(this.#state.wechat && ['events','conversations'].some(key=>Object.hasOwn(this.#state.wechat,key)));
    this.#state.applicationInstances ??= [];
    this.#state.history ??= [];
    this.#state.modelCards ??= {}; this.#state.toolConfigs ??= {}; this.#state.customTools ??= []; this.#state.modelStatus ??= {};
    this.#state.wechat ??= { contacts: [], settings: { autoReply: false } };
    if (!Array.isArray(this.#state.wechat.contacts)) this.#state.wechat.contacts = [];
    // Legacy embedded events are imported below; never written back into YAML.
    var legacyWechatEvents = Array.isArray(this.#state.wechat.events) ? this.#state.wechat.events : [];
    if (this.#state.wechat.events !== undefined) delete this.#state.wechat.events;
    // Tolerate files written under an older, larger retention cap.
    this.#state.wechat.settings = normalizeWechatSettings(this.#state.wechat.settings);
    if (!this.#state.wechat.conversations || typeof this.#state.wechat.conversations !== 'object' || Array.isArray(this.#state.wechat.conversations)) this.#state.wechat.conversations = {};
    // 默认 Agent 是指针，老版本文件缺省指向通用助手；缺失时补种默认草稿。
    if (!this.#state.agents.some(a => a.id === 'assistant')) {
      this.#state.agents.unshift({ id: 'assistant', name: '通用助手', draft: pickAgentConfig({ system: '根据真实工具结果回答，资料不足时明确说明。' }), versions: [] });
    }
    if (typeof this.#state.defaultAgentId !== 'string' || !this.#state.agents.some(a => a.id === this.#state.defaultAgentId)) {
      this.#state.defaultAgentId = 'assistant';
    }
    // 决议 36：启用开关是连接配置的一部分；老版本文件缺省视为启用。
    for (const c of this.#state.connections) if (typeof c.enabled !== 'boolean') c.enabled = true;
    // 决议 10（Agent 侧）：扁平 Agent 自动迁移为"草稿 + 初始 v1.0 已发布版本"；幂等，可重复执行。
    this.#state.agents = this.#state.agents.map(migrateAgent);
    // 把 normalize 阶段保存下来的旧 events 一次性搬到 JSONL，然后落一次盘把
    // instance.yaml 里的 events 块一并清掉（state.wechat.events 已被 delete）。
    // 这是唯一一次重写 instance.yaml 的 4MB YAML —— 之后 events 不再进 state，
    // #write 只写几 KB 的设置/agents/connections，不再因为每条事件触发全量重写。
    if (!this.#database) await this.#loadWechatEventsFromDisk();
    if (!this.#database && legacyWechatEvents.length) {
      await this.#appendWechatEventsInternal(legacyWechatEvents, /*mergeOnly*/true);
      await this.#write(this.#state);
    }
    validate(this.#state);
    if (!this.allowForeignProduct && this.#state.productId !== this.productId) throw Error('Instance belongs to a different product');
    if (this.#database) {
      await copyFile(this.path,this.path+'.pre-sqlite',constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await secureFile(this.path+'.pre-sqlite');
      this.#database.exec('SAVEPOINT import_instance_runtime');
      try {
        slimHistoryToConfigRevisions({db:this.#database,state:this.#state});
        slimConversationsToTable({db:this.#database,state:this.#state});
        slimModelDiagnosticsToTable({db:this.#database,state:this.#state});
        slimWechatEventsJsonlToDb({db:this.#database,jsonlPath:this.wechatEventsPath,initialEvents:legacyWechatEvents});
        this.#database.exec('RELEASE import_instance_runtime');
      } catch(error) {
        this.#database.exec('ROLLBACK TO import_instance_runtime; RELEASE import_instance_runtime');
        throw error;
      }
      this.#wechatEvents = readWechatEvents(this.#database, WECHAT_EVENT_LIMIT);
      this.#state.history = []; this.#state.modelCards = {}; this.#state.modelStatus = {};
      this.#state.wechat.conversations = {};
      if(hasRuntimeFields)await this.#write(this.#state);
      archiveMigratedFile(this.wechatEventsPath);
    }
    await secureFile(this.path);
    return this;
  }
  /** Attach trusted product storage methods without exposing mutable state over HTTP. */
  installExtension(factory) {
    const store = this;
    const context = {
      directory: this.directory,
      get state() { return store.#state; },
      set state(value) { store.#state = value; },
      get database() { return store.#database; },
      enqueue: task => store.#enqueue(task),
      mutate: (revision, task) => store.#mutate(revision, task),
      write: value => store.#write(value)
    };
    const api = factory(context);
    for (const [name, fn] of Object.entries(api)) {
      if (name in this || typeof fn !== 'function') throw Error('Invalid or duplicate product storage method: ' + name);
    }
    Object.assign(this, api);
    return api;
  }
  get modelsManaged() { return Boolean(this.#modelSource); }
  snapshot() {
    const { secrets, history, ...publicConfig } = clone(this.#state);
    publicConfig.connections = publicConfig.connections.map(c => {
      // API Key 永不进入快照；只暴露是否已配置。健康/失败计数为运行观测值，随快照只读展示。
      const status = this.connectionStatus(c.id);
      return { ...c, credentialConfigured: Boolean(secrets[c.id]), health: status.health, failureCount: status.failureCount, usable: status.usable, unusableReason: status.reason };
    });
    if(this.#modelSource) {const shared=this.#modelSource.snapshot();publicConfig.connections=shared.connections;publicConfig.defaultConnectionId=shared.defaultConnectionId;publicConfig.modelsManaged=true;}
    return publicConfig;
  }
  /** Install the built-in coding preset once; this is bootstrap, not a user edit. */
  async ensureCodingAssistant() {
    return this.#enqueue(async () => {
      if (this.#state.agents.some(agent => agent.id === 'coding-assistant')) return false;
      const next = clone(this.#state);
      next.agents.push({
        id: 'coding-assistant',
        name: '编程助手',
        description: '在当前工作区内阅读、修改和验证代码；写入与命令执行受产品确认策略保护。',
        draft: pickAgentConfig({
          system: '你是一个严谨的编程助手。先阅读并理解当前工作区的代码与项目约定，再给出简明计划并完成用户明确要求的修改。只能通过当前提供并授权的工作区与执行工具操作，不得假装执行成功。文件读写路径必须位于当前工作区内；运行命令前解释其影响，避免破坏性或超出任务范围的操作。对不确定的需求先说明假设，完成后运行相关测试并报告结果。',
          tools: ['workspace.read_file', 'runtime.exec', 'workspace.edit_file', 'workspace.write_file'],
          maxTurns: 24,
          timeoutMs: 600000,
        }),
        versions: [],
      });
      validate(next);
      await this.#write(next);
      this.#state = next;
      return true;
    });
  }
  history() {
    if (this.#database) return this.#database.prepare('SELECT snapshot FROM config_revisions ORDER BY revision').all().map(r=>JSON.parse(r.snapshot));
    return clone(this.#state.history);
  }
  resolveConnection(id) {
    if(this.#modelSource)return this.#modelSource.resolveConnection();
    if (!this.#state.connections.length) throw Error('尚未配置任何模型连接，请先创建连接');
    const connection = this.#state.connections.find(c => c.id === (id || this.#state.defaultConnectionId));
    if (!connection) {
      if (!this.#state.defaultConnectionId) throw Error('尚未设置默认模型连接，请先将一个连接设为默认');
      throw Error('请先选择模型连接');
    }
    const apiKey = this.#state.secrets[connection.id];
    if (!apiKey) throw Error('请先配置此连接的 API Key');
    return { ...clone(connection), apiKey };
  }
  /**
   * 决议 36：连接可用性 = 启用(人工开关) 且 健康(未探测失败) 且 已配置密钥。
   * 健康从未探测(unknown)视为可用——探测失败前不应阻断使用。
   */
  connectionStatus(id) {
    if(this.#modelSource)return this.#modelSource.connectionStatus(id);
    const c = this.#state.connections.find(x => x.id === id);
    if (!c) return { id, usable: false, reason: '模型连接不存在' };
    const entry = this.#database ? readModelStatus(this.#database,id) : (this.#state.modelStatus || {})[id] || {};
    const health = entry.health || { status: 'unknown', checkedAt: null };
    let reason = null;
    if (c.enabled === false) reason = '连接已人工停用';
    else if (health.status === 'failed') reason = '最近一次健康探测失败' + (health.checkedAt ? `（${health.checkedAt}）` : '');
    else if (!this.#state.secrets[id]) reason = '未配置 API Key';
    return { id, name: c.name, enabled: c.enabled !== false, keyConfigured: Boolean(this.#state.secrets[id]), health, failureCount: entry.failureCount || 0, usable: reason === null, reason };
  }
  /** 决议 34：设为默认是显式操作；不存在取消默认。 */
  setDefaultConnection(id, revision) {
    if(this.#modelSource)throw Error('模型由企业底座统一管理');
    return this.#mutate(revision, state => {
      if (!state.connections.some(c => c.id === id)) throw Error('模型连接不存在');
      state.defaultConnectionId = id;
    });
  }
  /** Agent 的实际生效连接：未指定则继承默认（决议 35）。取草稿配置（线上以后续版本解析为准）。 */
  effectiveConnectionId(agentId) {
    if(this.#modelSource)return this.#modelSource.snapshot().defaultConnectionId;
    const agent = this.#state.agents.find(a => a.id === agentId);
    if (!agent) throw Error('Agent not found');
    const cfg = agentDraftOf(agent);
    return cfg.connectionId || this.#state.defaultConnectionId || null;
  }
  /** 决议 37/40：使用范围查询——引用该连接的 Agent（直连/继承默认），供删除保护与跳转使用。 */
  connectionUsage(id) {
    const conn = this.#state.connections.find(c => c.id === id);
    if (!conn) throw Error('模型连接不存在');
    const isDefault = this.#state.defaultConnectionId === id;
    const agents = this.#state.agents
      .filter(a => { const cfg = agentDraftOf(a); return cfg.connectionId === id || (!cfg.connectionId && isDefault); })
      .map(a => ({ id: a.id, name: a.name, binding: agentDraftOf(a).connectionId === id ? 'direct' : 'default', warning: conn.enabled === false }));
    return { connectionId: id, name: conn.name, isDefault, enabled: conn.enabled !== false, agentCount: agents.length, agents };
  }
  /** Diagnostic cache: persisted per connection+model, never bumps revision or enters history. */
  modelCard(connectionId, modelId) {
    if(this.#modelSource)return this.#modelSource.modelCard(connectionId,modelId);
    if (this.#database) { const r=this.#database.prepare('SELECT card FROM model_diagnostics WHERE connection_id=? AND model_id=?').get(connectionId,modelId); return r?.card?JSON.parse(r.card):null; }
    return clone(this.#state.modelCards?.[connectionId]?.[modelId] ?? null);
  }
  saveModelCard(connectionId, modelId, card) {
    if(this.#modelSource)throw Error('模型由企业底座统一管理');
    return this.#enqueue(async () => {
      if (!this.#state.connections.some(c => c.id === connectionId)) throw Error('Model connection not found');
      if (typeof modelId !== 'string' || !modelId || modelId.length > 200) throw Error('Invalid model id');
      validateModelCard({ ...card, id: modelId });
      if (this.#database) {
        const value={...clone(card),id:modelId,updatedAt:new Date().toISOString()};
        this.#database.prepare(`INSERT INTO model_diagnostics(connection_id,model_id,card,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(connection_id,model_id) DO UPDATE SET card=excluded.card,updated_at=excluded.updated_at`).run(connectionId,modelId,JSON.stringify(value),value.updatedAt);
        return value;
      }
      const next = clone(this.#state);
      next.modelCards[connectionId] ??= {};
      next.modelCards[connectionId][modelId] = { ...clone(card), id: modelId, updatedAt: new Date().toISOString() };
      await this.#write(next); this.#state = next;
      return this.modelCard(connectionId, modelId);
    });
  }
  /**
   * 运行观测值（决议 36/38）：健康探测结果与失败计数。
   * 刻意不走 #mutate——不 bump revision、不进 history（与 modelCards 同例）。
   */
  recordConnectionHealth(id, status) {
    if(this.#modelSource)return this.#modelSource.recordConnectionHealth(id,status);
    return this.#enqueue(async () => {
      if (!['ok', 'failed'].includes(status)) throw Error('Invalid health status');
      if (!this.#state.connections.some(c => c.id === id)) throw Error('模型连接不存在');
      if (this.#database) {
        const entry=readModelStatus(this.#database,id);
        entry.health={status,checkedAt:new Date().toISOString()}; writeModelStatus(this.#database,id,entry); return entry;
      }
      const next = clone(this.#state);
      next.modelStatus ??= {};
      const entry = next.modelStatus[id] ?? { failureCount: 0 };
      next.modelStatus[id] = { ...entry, health: { status, checkedAt: new Date().toISOString() } };
      await this.#write(next); this.#state = next;
      return clone(next.modelStatus[id]);
    });
  }
  /** 决议 38：运行时调用失败只累计计数，绝不自动改健康状态。 */
  recordModelFailure(id) {
    if(this.#modelSource)return this.#modelSource.recordModelFailure(id);
    return this.#enqueue(async () => {
      if (!this.#state.connections.some(c => c.id === id)) throw Error('模型连接不存在');
      if (this.#database) {
        const entry=readModelStatus(this.#database,id); entry.failureCount++; writeModelStatus(this.#database,id,entry); return entry;
      }
      const next = clone(this.#state);
      next.modelStatus ??= {};
      const entry = next.modelStatus[id] ?? { failureCount: 0 };
      next.modelStatus[id] = { ...entry, failureCount: (entry.failureCount || 0) + 1 };
      await this.#write(next); this.#state = next;
      return clone(next.modelStatus[id]);
    });
  }
  /** Full config for internal execution: public part merged with secrets. Secrets never appear in snapshots/history. */
  toolConfig(name, secretFields = []) {
    const stored = this.#state.toolConfigs?.[name];
    if (stored === undefined || stored === null) return clone(stored ?? null);
    const merged = { ...clone(stored) };
    for (const field of secretFields) {
      const value = this.#state.secrets[`tool:${name}:${field}`];
      if (value !== undefined) merged[field] = value;
    }
    return merged;
  }
  /** Public config only: safe for API responses and history. */
  toolPublicConfig(name) { return clone(this.#state.toolConfigs?.[name] ?? null); }
  customTools() { return clone(this.#state.customTools); }
  saveCustomTool(input, revision) {
    const tool = normalizeHttpTool(input);
    return this.#mutate(revision, state => {
      const index = state.customTools.findIndex(item => item.name === tool.name);
      if (index < 0) state.customTools.push(tool);
      else state.customTools[index] = tool;
    });
  }
  toolSecretsConfigured(name, secretFields = []) {
    const out = {};
    for (const field of secretFields) out[field] = this.#state.secrets[`tool:${name}:${field}`] !== undefined;
    return out;
  }
  saveToolConfig(name, config, revision, secretFields = [], { clearSecrets = false } = {}) {
    return this.#mutate(revision, state => {
      if (typeof name !== 'string' || !name) throw Error('Invalid tool name');
      if (config !== null && (typeof config !== 'object' || Array.isArray(config))) throw Error('Invalid tool configuration');
      const publicConfig = clone(config);
      if (clearSecrets || publicConfig === null) {
        for (const field of secretFields) delete state.secrets[`tool:${name}:${field}`];
      }
      if (publicConfig) for (const field of secretFields) {
        const value = publicConfig[field];
        // 空值表示保留已有密钥，不覆盖；只有非空值才写入
        if (value !== undefined && value !== '') state.secrets[`tool:${name}:${field}`] = String(value);
        delete publicConfig[field];
      }
      state.toolConfigs[name] = publicConfig;
    });
  }
  #enqueue(job) {
    const run = this.#queue.then(job);
    this.#queue = run.catch(() => {}); return run;
  }
  #mutate(expectedRevision, change, { current = false } = {}) {
    return this.#enqueue(async () => {
      if (!current && expectedRevision !== this.#state.revision) { const e = Error('配置已变化，请重新加载'); e.code = 'revision_conflict'; throw e; }
      const next = clone(this.#state); const changed = await change(next);
      if (changed === false) return this.snapshot();
      validate(next);
      // History keeps user configuration only: secrets, diagnostic model cards and
      // volatile model status (health/failure counts) are excluded.
      const { secrets, history, modelCards, modelStatus, ...before } = this.#state;
      if (this.#database) {
        const trimmed=clone(before); if(trimmed.wechat){ delete trimmed.wechat.conversations; delete trimmed.wechat.events; }
        this.#database.prepare('INSERT OR REPLACE INTO config_revisions VALUES(?,?,?)').run(trimmed.revision,JSON.stringify(trimmed),new Date().toISOString());
        this.#database.exec('DELETE FROM config_revisions WHERE revision NOT IN (SELECT revision FROM config_revisions ORDER BY revision DESC LIMIT 200)');
        next.history=[];
      } else next.history = [...history, clone(before)].slice(-30);
      next.revision++;
      await this.#write(next); this.#state = next;
      return this.snapshot();
    });
  }
  #assertUnlocked(kind, existing, input) {
    for (const field of this.lockedFields[kind] || []) {
      if (existing && JSON.stringify(existing[field]) !== JSON.stringify(input[field] ?? existing[field])) {
        throw Error(`配置项被产品锁定，不能修改：${field}`);
      }
      if (!existing && input[field] !== undefined) throw Error(`配置项被产品锁定，不能设置：${field}`);
    }
  }
  saveConnection(input, revision) {
    if(this.#modelSource)throw Error('模型由企业底座统一管理');
    return this.#mutate(revision, state => {
      const id = input.id || randomUUID();
      const existing = state.connections.find(c => c.id === id);
      this.#assertUnlocked('connection', existing, input);
      const c = { id, name: input.name || id, provider: input.provider, model: input.model, baseUrl: input.baseUrl || '', timeoutMs: input.timeoutMs ?? 60000, params: clone(input.params || {}), enabled: input.enabled === undefined ? (existing?.enabled ?? true) : Boolean(input.enabled) };
      state.connections = [...state.connections.filter(c=>c.id!==id), c];
      if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw Error('Invalid credential');
      if (input.clearKey) delete state.secrets[id];
      else if (input.apiKey) state.secrets[id] = input.apiKey;
      if (!state.defaultConnectionId || input.isDefault) state.defaultConnectionId = id;
    });
  }
  deleteConnection(id, revision, { successorId } = {}) {
    if(this.#modelSource)throw Error('模型由企业底座统一管理');
    return this.#mutate(revision, state => {
      const conn = state.connections.find(c => c.id === id);
      if (!conn) throw Error('模型连接不存在');
      // 决议 37：删除被显式绑定的连接先阻断，并点名引用方。
      // 仅"继承默认"的 Agent（草稿 connectionId 为空）不阻断：它们跟随默认指针，删除默认时由接任者接管。
      const referencing = state.agents.filter(a => agentDraftOf(a)?.connectionId === id);
      if (referencing.length) throw Error(`连接正在被 ${referencing.length} 个 Agent 使用（${referencing.map(a => a.name).join('、')}），请先重新绑定`);
      // 决议 34：默认连接是唯一的非空指针，删除默认必须先指定接任者。
      if (state.defaultConnectionId === id) {
        if (!successorId) throw Error('该连接是默认连接，删除前必须先指定接任者：先将其他连接设为默认，或在删除时指定接任者');
        if (successorId === id) throw Error('接任者不能是被删除的连接本身');
        if (!state.connections.some(c => c.id === successorId)) throw Error('指定的接任者连接不存在');
        state.defaultConnectionId = successorId;
      }
      state.connections = state.connections.filter(c=>c.id!==id); delete state.secrets[id];
      delete state.modelCards[id]; // 诊断卡片随连接一起清理，不留孤儿
      if (state.modelStatus) delete state.modelStatus[id];
    });
  }
  /**
   * 决议 10（Agent 侧）：保存 = 写草稿。草稿修改不影响已发布版本；发布后才生效到线上。
   * 输入为扁平字段（与控制台表单一致），写入 agent.draft；保留已有已发布版本。
   */
  saveAgent(input, revision) {
    return this.#mutate(revision, state => {
      const id = input.id || randomUUID();
      const existing = state.agents.find(x => x.id === id);
      if (!existing && input.version === 'builtin') throw Error('版本标识 builtin 为内置通用助手保留');
      const existingFlat = existing ? { id: existing.id, name: existing.name, ...existing.draft } : null;
      this.#assertUnlocked('agent', existingFlat, input);
      const draft = pickAgentConfig(input);
      if (typeof input.name !== 'string' || !input.name.trim()) throw Error('Agent name is required');
      if (existing) {
        existing.name = input.name;
        existing.description = typeof input.description === 'string' ? input.description.slice(0, 500) : '';
        existing.draft = draft;
      } else {
        state.agents = [...state.agents.filter(x => x.id !== id), { id, name: input.name, description: typeof input.description === 'string' ? input.description.slice(0, 500) : '', extensions: [], draft, versions: [] }];
      }
    });
  }
  /** Trusted host bootstrap only. Registration and binding are one queued atomic write. */
  ensureApplicationAssistant({ id, appType, name, agent, adoptLegacy = false }) {
    return this.#mutate(undefined, state => {
      state.applicationInstances ??= [];
      const app = state.applicationInstances.find(item => item.id === id);
      if (app) {
        if (app.appType !== appType || app.primaryAgentId !== agent.id) throw Error('Application identity or assistant binding conflict');
        return false;
      }
      let existing = state.agents.find(item => item.id === agent.id);
      if (existing?.ownerApplicationInstanceId && existing.ownerApplicationInstanceId !== id) throw Error('Assistant belongs to another application');
      if (existing && !existing.ownerApplicationInstanceId && !adoptLegacy) throw Error('Existing assistant requires explicit host migration');
      if (!existing) {
        existing = { id: agent.id, name: agent.name, description: agent.description || '', draft: pickAgentConfig(agent), versions: [], extensions: [] };
        state.agents.push(existing);
      }
      existing.origin = 'builtin';
      existing.ownerApplicationInstanceId = id;
      state.applicationInstances.push({ id, appType, name, primaryAgentId: existing.id });
    }, { current: true });
  }
  /** Frontend edits and admin edits share the same store, revision and validation. */
  saveApplicationSettings(applicationInstanceId, { connection, system, knowledge }, revision) {
    return this.#mutate(revision, state => {
      const app = state.applicationInstances?.find(item => item.id === applicationInstanceId);
      if (!app) throw Error('Application instance is not registered');
      const agent = state.agents.find(item => item.id === app.primaryAgentId);
      if (system !== undefined) {
        if (typeof system !== 'string') throw Error('Invalid assistant prompt');
        this.#assertUnlocked('agent', agent.draft, { system });
        agent.draft.system = system;
      }
      if (knowledge !== undefined) {
        if (!Array.isArray(knowledge) || knowledge.some(id => typeof id !== 'string' || !/^[\w-]+$/.test(id)) || new Set(knowledge).size !== knowledge.length) throw Error('Invalid assistant knowledge libraries');
        this.#assertUnlocked('agent', agent.draft, { knowledge });
        agent.draft.knowledge = [...knowledge];
      }
      if (connection && this.#modelSource) throw Error('模型由企业底座统一管理');
      if (connection) {
        const effectiveId = agent.draft.connectionId || state.defaultConnectionId;
        if (connection.id && connection.id !== effectiveId) throw Error('Cannot edit another model connection');
        const id = effectiveId || randomUUID();
        const existing = state.connections.find(item => item.id === id);
        this.#assertUnlocked('connection', existing, connection);
        const next = {
          id, name: connection.name || existing?.name || `${app.name || '助手'}模型`,
          provider: connection.provider || existing?.provider || 'openai-compatible',
          model: connection.model ?? existing?.model ?? '',
          baseUrl: connection.baseUrl ?? existing?.baseUrl ?? '',
          timeoutMs: existing?.timeoutMs ?? 60000,
          params: clone(existing?.params || {}), enabled: existing?.enabled ?? true
        };
        if (connection.apiKey !== undefined && typeof connection.apiKey !== 'string') throw Error('Invalid credential');
        if (connection.apiKey) state.secrets[id] = connection.apiKey;
        state.connections = [...state.connections.filter(item => item.id !== id), next];
        agent.draft.connectionId = id;
        if (!state.defaultConnectionId) state.defaultConnectionId = id;
      }
    });
  }
  getApplicationAssistant(applicationInstanceId, version = 'draft') {
    const app = this.#state.applicationInstances?.find(item => item.id === applicationInstanceId);
    if (!app) throw Error('Application instance is not registered');
    const agent = this.#state.agents.find(item => item.id === app.primaryAgentId);
    if (!agent || agent.ownerApplicationInstanceId !== app.id) throw Error('Application assistant binding is invalid');
    return { ...this.resolveAgent(agent.id, version), applicationInstanceId: app.id, origin: 'builtin' };
  }
  /** 产品适配器登记当前运行时扩展；扩展声明不进入 Agent 发布版本。 */
  setAgentExtensions(id, extensions = [], revision) {
    return this.#mutate(revision, state => {
      const agent = state.agents.find(item => item.id === id);
      if (!agent) throw Error('Agent 不存在：' + id);
      agent.extensions = normalizeAgentExtensions(extensions);
    });
  }
  /**
   * 决议 10/11（Agent 侧）：发布不可变版本。校验草稿 → 冻结 Skill 绑定快照
   * （resolveSkill 由调用方注入，缺省要求草稿无 Skill 绑定）→ 快照入 versions。
   * 决议 12：绑定的 Skill 已停用时阻断发布并点名（由 resolveSkill 抛出）。
   */
  publishAgent(id, version, { note = '', resolveSkill } = {}, revision) {
    if (!VERSION_PATTERN.test(version || '')) throw Error('发布版本号须为 vX.Y 格式（如 v2.1）。');
    return this.#mutate(revision, async state => {
      const agent = state.agents.find(a => a.id === id);
      if (!agent) throw Error('Agent 不存在：' + id);
      if (agent.versions.some(v => v.version === version)) throw Error(`版本 ${version} 已发布（不可变），请使用新的版本号。`);
      let skills = agent.draft.skills;
      if (skills.length && typeof resolveSkill === 'function') {
        try { skills = await resolveSkill(skills); }
        catch (e) { throw Error(`发布被阻断：${e.message}`); }
      }
      const snapshot = { name: agent.name, ...(agent.description ? { description: agent.description } : {}), ...clone(agent.draft), skills: clone(skills) };
      agent.versions.push({ version, publishedAt: new Date().toISOString(), note: String(note).slice(0, 200), snapshot });
      agent.versions.sort((a, b) => compareVersions(a.version, b.version));
    });
  }
  /** 已发布版本列表（不含快照内容），附 latest 标记；与 Skill listVersions 同构。 */
  listAgentVersions(id) {
    const agent = this.#state.agents.find(a => a.id === id);
    if (!agent) throw Error('Agent 不存在：' + id);
    const versions = agent.versions.map(v => ({ version: v.version, publishedAt: v.publishedAt, note: v.note }));
    const latest = versions.map(v => v.version).sort(compareVersions).pop();
    return versions.map(v => ({ ...v, latest: v.version === latest }));
  }
  /**
   * 决议 10（Agent 侧）：回滚 = 基于历史版本建新草稿，不删历史。
   * 把某已发布版本的快照内容恢复为草稿，用户确认后再发布为新版本号。
   */
  rollbackAgent(id, fromVersion, revision) {
    return this.#mutate(revision, state => {
      const agent = state.agents.find(a => a.id === id);
      if (!agent) throw Error('Agent 不存在：' + id);
      const v = fromVersion === 'latest'
        ? [...agent.versions].sort((a,b) => compareVersions(a.version,b.version)).at(-1)
        : agent.versions.find(v => v.version === fromVersion);
      if (!v) throw Error(`Agent 版本不存在：${id}@${fromVersion}`);
      if (v.snapshot.name) agent.name = v.snapshot.name;
      agent.description = v.snapshot.description || '';
      const snap = clone(v.snapshot); delete snap.name;
      delete snap.description;
      agent.draft = snap;
    });
  }
  /**
   * 解析 Agent 生效配置（扁平）。未发布过的通用助手默认使用其草稿，便于开箱即用。
   */
  resolveAgent(id, versionRef) {
    const agent = this.#state.agents.find(a => a.id === id);
    if (!agent) throw Error('必须绑定 Agent 才能对话（未找到 Agent：' + id + '）');
    const ref = versionRef || 'latest';
    const extensionMeta = agent.extensions?.length ? { extensions: clone(agent.extensions) } : {};
    if (ref === 'draft') return { id: agent.id, name: agent.name, ...(agent.description ? { description: agent.description } : {}), ...extensionMeta, version: 'draft', ...clone(agent.draft) };
    const versions = [...agent.versions].sort((a, b) => compareVersions(a.version, b.version));
    let target = null;
    if (ref === 'latest' || ref === 'online') target = versions[versions.length - 1] || null;
    else target = versions.find(v => v.version === ref) || null;
    if (!target) {
      if ((ref === 'latest' || ref === 'online') && !versions.length && agent.id === 'assistant') return { id: agent.id, name: agent.name, ...extensionMeta, version: 'draft', ...clone(agent.draft) };
      if ((ref === 'latest' || ref === 'online') && !versions.length) throw Error(`Agent「${agent.name}」尚未发布任何版本，请先发布`);
      throw Error(`Agent 版本不存在：${id}@${ref}`);
    }
    return { id: agent.id, name: agent.name, ...(target.snapshot.description ? { description: target.snapshot.description } : {}), ...extensionMeta, version: target.version, ...clone(target.snapshot) };
  }
  /**
   * 决议 11（Agent 侧）：草稿 Skill 绑定可升级。把某绑定的快照版本更新到 Skill 最新版；
   * 只改草稿，已发布版本不受影响，须重走发布流程才生效到线上。
   * resolveLatest 由调用方注入（如 skills.bindingUpgrades）。
   */
  upgradeDraftSkillBinding(id, skillId, revision, { resolveLatest } = {}) {
    return this.#mutate(revision, async state => {
      const agent = state.agents.find(a => a.id === id);
      if (!agent) throw Error('Agent 不存在：' + id);
      if (typeof resolveLatest !== 'function') throw Error('升级需要 Skill 服务');
      const upgrades = await resolveLatest(agent.draft.skills);
      const up = upgrades.find(u => u.id === skillId);
      if (!up || !up.upgradable) throw Error(`Skill ${skillId} 无可用升级`);
      agent.draft.skills = agent.draft.skills.map(s => {
        const sid = typeof s === 'string' ? s : s.id;
        if (sid !== skillId) return s;
        const base = typeof s === 'string' ? { id: s } : { ...s };
        base.version = up.latest;
        return base;
      });
    });
  }
  deleteAgent(id, revision) {
    return this.#mutate(revision, s => {
      if (s.agents.some(a => a.id === id && a.ownerApplicationInstanceId) || ['assistant', 'coding-assistant'].includes(id) || s.agents.some(a => a.id === id && a.version === 'builtin')) throw Error('系统内置 Agent 不可删除');
      s.agents = s.agents.filter(a => a.id !== id);
      // 决议 27：被指向的自建 Agent 被删除时，默认指针回落到内置通用助手。
      if (s.defaultAgentId === id) s.defaultAgentId = 'assistant';
    });
  }
  /** 决议 27：读默认 Agent 指针；指针悬空时回落到内置通用助手。 */
  getDefaultAgent() {
    const agent = this.#state.agents.find(a => a.id === this.#state.defaultAgentId)
      || this.#state.agents.find(a => a.id === 'assistant');
    return clone(agent || null);
  }
  /** 决议 27：任何自建 Agent（含内置）可设为默认；须指向存在的 Agent。 */
  setDefaultAgent(id, revision) {
    return this.#mutate(revision, state => {
      if (!state.agents.some(a => a.id === id)) throw Error('Agent 不存在：' + id);
      state.defaultAgentId = id;
    });
  }
  async #appendWechatEventsInternal(list, mergeOnly) {
    if (!Array.isArray(list) || !list.length) return;
    if (!this.#wechatEventsLoaded) await this.#loadWechatEventsFromDisk();
    const existing = new Set(this.#wechatEvents.map(e => e?.eventId).filter(Boolean));
    const toWrite = [];
    for (const raw of list) {
      const stored = clone(raw);
      if (!stored.eventId) continue;
      if (mergeOnly && existing.has(stored.eventId)) continue;
      toWrite.push(stored);
    }
    if (!toWrite.length) return;
    const lines = toWrite.map(e => JSON.stringify(e)).join('\n') + '\n';
    await mkdir(dirname(this.wechatEventsPath), { recursive: true, mode: 0o700 });
    await appendFile(this.wechatEventsPath, lines, 'utf8');
    // 更新内存缓存：去重（后写覆盖前写），按写入顺序追加，再截断。
    const map = new Map();
    for (const e of this.#wechatEvents) if (e?.eventId) map.set(e.eventId, e);
    for (const e of toWrite) map.set(e.eventId, e);
    this.#wechatEvents = [...map.values()].slice(-WECHAT_EVENT_LIMIT);
  }
  async #loadWechatEventsFromDisk() {
    this.#wechatEventsLoaded = true;
    let raw = '';
    try { raw = await readFile(this.wechatEventsPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!raw) return;
    const lines = raw.split('\n');
    // 同一 eventId 多次出现时，文件里最后那行是最新版本。
    const byId = new Map();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event && event.eventId) byId.set(event.eventId, { event, index: i });
    }
    if (!byId.size) return;
    // 取文件里行号最大的 WECHAT_EVENT_LIMIT 条（即「最近」的事件）。
    const ordered = [...byId.values()].sort((a, b) => a.index - b.index);
    const kept = ordered.slice(-WECHAT_EVENT_LIMIT);
    this.#wechatEvents = kept.map(entry => clone(entry.event));
  }
  exportAgent(id) {
    const agent = this.#state.agents.find(a => a.id === id);
    if (!agent) throw Error('Agent not found');
    // 导出草稿配置（扁平便携格式）；已发布版本不随导出走，导入后为新草稿。
    const cfg = agentDraftOf(agent);
    const { connectionId, version: _v, ...portable } = { id: agent.id, name: agent.name, ...clone(cfg) };
    return { format: 'agent-platform-agent', version: 1, agent: portable, requiresConnectionBinding: true };
  }
  importAgent(document, { connectionId, revision }) {
    if (document?.format !== 'agent-platform-agent' || document.version !== 1 || !document.agent || typeof document.agent !== 'object' || Array.isArray(document.agent)) throw Error('Invalid Agent export format');
    if (!connectionId || !this.#state.connections.some(c => c.id === connectionId)) throw Error('请明确选择当前实例的模型连接');
    // Import is a new Agent. Never silently replace a same-ID local configuration.
    // 导出内置助手再导入时剥离 builtin 标记：副本是普通自建 Agent，不继承只读身份。
    const { version: _builtin, ...portable } = document.agent;
    return this.saveAgent({ ...portable, id: randomUUID(), connectionId }, revision);
  }
  restore(targetRevision, expectedRevision) {
    return this.#mutate(expectedRevision, state => {
      const entry = this.#database ? this.history().find(x=>x.revision===targetRevision) : state.history.find(x=>x.revision===targetRevision);
      if (!entry) throw Error('配置历史不存在');
      if (entry.connections.some(c=>!state.secrets[c.id])) throw Error('历史配置引用的凭据已不存在，请重新绑定');
      for (const key of ['connections','agents','defaultConnectionId','defaultAgentId','toolConfigs','customTools']) state[key]=clone(entry[key] ?? (key === 'defaultAgentId' ? 'assistant' : key === 'customTools' ? [] : undefined));
      // 历史条目可能含旧扁平 Agent：恢复时同样走迁移，保证形状一致。
      state.agents = state.agents.map(migrateAgent);
    });
  }
  async #write(state) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    let file;
    try {
      file = await open(temporary, 'wx', 0o600);
      const stored=clone(state);
      if(this.#database) {
        delete stored.history;delete stored.modelCards;delete stored.modelStatus;
        if(stored.wechat){delete stored.wechat.events;delete stored.wechat.conversations;}
      }
      await file.writeFile(stringify(stored), 'utf8'); await file.sync(); await file.close(); file=null;
      await secureFile(temporary);
      await rename(temporary, this.path);
    } finally { if(file)await file.close(); await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
  }
}

export function mergeModelParams({ defaults = {}, modelCard = {}, connection = {}, agent = {} }) {
  return { ...defaults, ...modelCard, ...connection, ...agent };
}
