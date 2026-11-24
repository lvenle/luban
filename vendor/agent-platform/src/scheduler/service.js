import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'node:crypto';

/**
 * 定时任务调度器（底座）。
 *
 * 决议 v18 §九（41–45）：
 * - 41 失败策略四件套：重试次数 + 退避（固定间隔 / 指数退避 + 最大延迟上限）
 *      + 单次执行超时 + 失败告警（站内通知 / webhook URL）。
 * - 42 并发三选一：上次执行未完成时新触发 → 跳过（默认）/ 排队 / 并行；
 *      默认跳过并记录「因上次未完成而跳过」。
 * - 43 执行指令 = 首条用户消息注入，Agent system prompt 不变；
 *      Skill 目标通过通用 Agent Runtime 加载 Skill 内容并执行。
 * - 44 结果处理：仅保存 / 发送通知（选通知时必须指定通知方式）；无「创建任务」选项。
 * - 45 调度预览扩展失败策略摘要；新建支持 Cron（校验合法性）；执行对象显示名称；
 *      时区完整列表。
 *
 * 安全：
 * - webhook URL 等敏感配置永不进入 audit/日志；webhook 发送失败只记 audit，
 *   不影响主流程、不抛错。
 * - Agent / Skill 的真实执行器必须由宿主显式注入（agentRunner / skillRunner），
 *   未注入时执行明确报错，绝不暗装 Mock。
 */

export const SKIP_REASON = '因上次未完成而跳过';
const CONCURRENCY_MODES = ['skip', 'queue', 'parallel'];
const NOTIFY_CHANNELS = ['internal', 'webhook'];
const TARGET_TYPES = ['product_handler', 'agent', 'skill'];

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} is required`);
  return value;
}

function assertValidTimezone(timezone) {
  if (timezone == null || timezone === '') return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error(`时区无效：${timezone}`);
  }
}

/** 完整 IANA 时区列表（决议 45：时区用完整列表）。 */
export function listTimezones() {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    if (Array.isArray(zones) && zones.length) {
      const sorted = [...zones].sort();
      // 'UTC' 不在 supportedValuesOf 结果中，但它是合法时区且为调度器缺省值，置顶
      if (!sorted.includes('UTC')) sorted.unshift('UTC');
      return sorted;
    }
  } catch { /* 回退到常用列表 */ }
  return ['UTC', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Tokyo',
    'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Australia/Sydney'];
}

/** 校验 Cron 表达式合法性（决议 45：新建流程支持 Cron 表达式并校验）。 */
export function validateCronExpression(expression, timezone = 'UTC') {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('Cron 表达式不能为空');
  assertValidTimezone(timezone);
  try {
    CronExpressionParser.parse(expression.trim(), { tz: timezone || 'UTC' });
  } catch (error) {
    throw new Error(`Cron 表达式无效：${error.message}`);
  }
  return expression.trim();
}

function nextOccurrence(trigger, after) {
  const current = new Date(after);
  if (trigger.type === 'once') return trigger.at && new Date(trigger.at) > current ? new Date(trigger.at) : null;
  if (trigger.type === 'interval') {
    if (!Number.isSafeInteger(trigger.every_ms) || trigger.every_ms <= 0) {
      throw new TypeError('trigger.every_ms must be a positive safe integer');
    }
    return new Date(current.getTime() + trigger.every_ms);
  }
  if (trigger.type === 'cron') {
    required(trigger.expression, 'trigger.expression');
    return CronExpressionParser.parse(trigger.expression, {
      currentDate: current,
      tz: trigger.timezone ?? 'UTC'
    }).next().toDate();
  }
  throw new Error(`Unsupported trigger type: ${trigger.type}`);
}

/** 预览用：接下来 N 次触发时间（ISO 字符串）。 */
export function nextOccurrences(trigger, after, count = 3) {
  const safe = Math.min(Math.max(Number.isSafeInteger(count) ? count : 3, 1), 20);
  if (trigger.type === 'interval') {
    if (!Number.isSafeInteger(trigger.every_ms) || trigger.every_ms <= 0) {
      throw new TypeError('trigger.every_ms must be a positive safe integer');
    }
    const base = new Date(after).getTime();
    return Array.from({ length: safe }, (_, index) => new Date(base + trigger.every_ms * (index + 1)).toISOString());
  }
  const out = [];
  let cursor = new Date(after);
  for (let index = 0; index < safe; index += 1) {
    const next = nextOccurrence(trigger, cursor);
    if (!next) break;
    out.push(next.toISOString());
    cursor = new Date(next.getTime() + 1);
  }
  return out;
}

function validateTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') throw new TypeError('schedule.trigger is required');
  if (!['once', 'interval', 'cron'].includes(trigger.type)) throw new Error(`Unsupported trigger type: ${trigger.type}`);
  if (trigger.type === 'once') required(trigger.at, 'trigger.at');
  if (trigger.type === 'interval' && (!Number.isSafeInteger(trigger.every_ms) || trigger.every_ms <= 0)) {
    throw new TypeError('trigger.every_ms must be a positive safe integer');
  }
  if (trigger.type === 'cron') {
    trigger.expression = validateCronExpression(trigger.expression, trigger.timezone ?? 'UTC');
    trigger.timezone = trigger.timezone ?? 'UTC';
  }
  return trigger;
}

function validateTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('schedule.target is required');
  if (!TARGET_TYPES.includes(target.type)) {
    throw new Error(`schedule.target.type 不支持：${target.type}（可选 ${TARGET_TYPES.join(' / ')}）`);
  }
  if (target.type === 'product_handler') required(target.handler, 'schedule.target.handler');
  if (target.type === 'agent') required(target.agent_id, 'schedule.target.agent_id');
  if (target.type === 'skill') {
    required(target.skill_id, 'schedule.target.skill_id');
    // 决议 11 精神：Task→Skill 也支持版本钉选（默认 latest，即最新发布版）
    if (target.skill_version !== undefined && target.skill_version !== null
        && (typeof target.skill_version !== 'string' || !/^(latest|v\d+\.\d+)$/.test(target.skill_version))) {
      throw new Error('schedule.target.skill_version 非法，应为 latest 或 vX.Y');
    }
  }
  return target;
}

/**
 * 通知配置归一化（失败告警 / 结果通知共用）。
 * 站内通知与 webhook 二选一、可多选；选通知必须指定通知方式（决议 44）。
 */
function normalizeNotify(notify, field) {
  if (notify == null) return null;
  if (typeof notify !== 'object' || Array.isArray(notify)) throw new Error(`${field} 必须是对象`);
  const channels = notify.channels ?? [];
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error(`${field} 至少选择一种通知方式（站内通知 / webhook）`);
  }
  for (const channel of channels) {
    if (!NOTIFY_CHANNELS.includes(channel)) throw new Error(`${field} 包含未知通知方式：${channel}`);
  }
  let webhookUrl = null;
  if (channels.includes('webhook')) {
    webhookUrl = String(notify.webhook_url ?? '').trim();
    if (!/^https?:\/\/[^/\s]+/i.test(webhookUrl)) throw new Error(`${field}.webhook_url 选择 webhook 时必须填写合法的 http(s) 地址`);
  }
  return { channels: [...new Set(channels)], webhook_url: webhookUrl };
}

/** 失败策略归一化（决议 41）。 */
function normalizePolicy(policy) {
  const input = (policy && typeof policy === 'object') ? policy : {};
  const maxRetries = input.max_retries ?? 0;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error('policy.max_retries 必须是非负整数');
  const backoffInput = (input.backoff && typeof input.backoff === 'object') ? input.backoff : {};
  const strategy = backoffInput.strategy ?? 'exponential';
  if (!['fixed', 'exponential'].includes(strategy)) throw new Error("policy.backoff.strategy 必须是 'fixed'（固定间隔）或 'exponential'（指数退避）");
  const intervalMs = backoffInput.interval_ms ?? 1000;
  const maxDelayMs = backoffInput.max_delay_ms ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error('policy.backoff.interval_ms 必须是正整数（毫秒）');
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs <= 0) throw new Error('policy.backoff.max_delay_ms 必须是正整数（毫秒）');
  let executionTimeoutMs = null;
  if (input.execution_timeout_ms != null && input.execution_timeout_ms !== '') {
    if (!Number.isSafeInteger(input.execution_timeout_ms) || input.execution_timeout_ms <= 0) {
      throw new Error('policy.execution_timeout_ms 必须是正整数（毫秒），留空表示不限制');
    }
    executionTimeoutMs = input.execution_timeout_ms;
  }
  let concurrency = input.concurrency ?? 'skip';
  if (concurrency === 'skip_if_running') concurrency = 'skip'; // 兼容旧值
  if (!CONCURRENCY_MODES.includes(concurrency)) {
    throw new Error(`policy.concurrency 必须是 ${CONCURRENCY_MODES.join(' / ')}（默认 skip：跳过）`);
  }
  const alert = normalizeNotify(input.alert, 'policy.alert');
  const handling = input.result?.handling ?? 'save_only';
  if (!['save_only', 'notify'].includes(handling)) throw new Error("policy.result.handling 必须是 'save_only'（仅保存）或 'notify'（发送通知）");
  let notify = null;
  if (handling === 'notify') {
    notify = normalizeNotify(input.result?.notify, 'policy.result.notify');
    if (!notify) throw new Error('结果处理选择「发送通知」时必须指定通知方式（站内通知 / webhook）');
  }
  return {
    max_retries: maxRetries,
    backoff: { strategy, interval_ms: intervalMs, max_delay_ms: maxDelayMs },
    execution_timeout_ms: executionTimeoutMs,
    concurrency,
    alert,
    result: { handling, notify }
  };
}

/** 运行时兜底：直接读库的老记录也可能缺少归一化 policy。 */
function runtimePolicy(schedule) {
  const stored = (schedule.policy && typeof schedule.policy === 'object') ? schedule.policy : {};
  return {
    max_retries: stored.max_retries ?? 0,
    backoff: {
      strategy: stored.backoff?.strategy ?? 'exponential',
      interval_ms: stored.backoff?.interval_ms ?? 1000,
      max_delay_ms: stored.backoff?.max_delay_ms ?? 60_000
    },
    execution_timeout_ms: stored.execution_timeout_ms ?? null,
    concurrency: stored.concurrency === 'skip_if_running' ? 'skip' : (stored.concurrency ?? 'skip'),
    alert: stored.alert ?? null,
    result: stored.result ?? { handling: 'save_only', notify: null }
  };
}

/**
 * 计算第 failedAttempts 次失败后的退避延迟（毫秒）。
 * fixed：每次固定间隔；exponential：interval * 2^(n-1)；两者都受 max_delay_ms 上限约束。
 */
export function computeBackoffMs(policy, failedAttempts) {
  const backoff = (policy && policy.backoff) || {};
  const strategy = backoff.strategy ?? 'exponential';
  const interval = backoff.interval_ms ?? 1000;
  const maxDelay = backoff.max_delay_ms ?? 60_000;
  const attempts = Math.max(1, Number.isSafeInteger(failedAttempts) ? failedAttempts : 1);
  const raw = strategy === 'fixed' ? interval : interval * 2 ** (attempts - 1);
  return Math.min(maxDelay, Math.floor(raw));
}

function validateExecution(schedule) {
  const execution = (schedule.execution && typeof schedule.execution === 'object') ? schedule.execution : {};
  if (['agent', 'skill'].includes(schedule.target?.type)) {
    if (typeof execution.instruction !== 'string' || !execution.instruction.trim()) {
      throw new Error('Agent / Skill 任务必须填写执行指令（execution.instruction），该指令作为首条用户消息传入运行时');
    }
  }
  return { instruction: typeof execution.instruction === 'string' ? execution.instruction : '' };
}

function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') throw new TypeError('schedule must be an object');
  required(schedule.id, 'schedule.id');
  required(schedule.product_id, 'schedule.product_id');
  if (schedule.name != null && (typeof schedule.name !== 'string' || !schedule.name.trim())) {
    throw new Error('schedule.name 为空时请省略');
  }
  validateTrigger(schedule.trigger);
  validateTarget(schedule.target);
  const normalized = structuredClone(schedule);
  normalized.policy = normalizePolicy(schedule.policy);
  normalized.execution = validateExecution(normalized);
  return normalized;
}

/* ---------- 调度预览（决议 45：失败策略摘要一目了然，执行对象显示名称） ---------- */

function formatDurationMs(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) return String(ms);
  if (ms === 0) return '0 毫秒';
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} 天`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} 小时`;
  if (ms % 60_000 === 0) return `${ms / 60_000} 分钟`;
  if (ms % 1000 === 0) return `${ms / 1000} 秒`;
  return `${ms} 毫秒`;
}

function describeTrigger(trigger) {
  if (!trigger) return '未设置';
  if (trigger.type === 'once') return `一次性 · ${trigger.at}`;
  if (trigger.type === 'interval') return `每 ${formatDurationMs(trigger.every_ms)}`;
  if (trigger.type === 'cron') return `Cron「${trigger.expression}」· 时区 ${trigger.timezone ?? 'UTC'}`;
  return String(trigger.type);
}

function describeTarget(target, targetName) {
  if (!target) return '未设置';
  const label = targetName || null;
  if (target.type === 'agent') return `Agent「${label ?? target.agent_id}」`;
  if (target.type === 'skill') {
    const ver = target.skill_version && target.skill_version !== 'latest' ? `@${target.skill_version}` : '';
    return `Skill「${label ?? target.skill_id}${ver}」`;
  }
  if (target.type === 'product_handler') return `产品处理器 ${target.handler}`;
  return String(target.type);
}

function describeChannels(notify) {
  if (!notify || !notify.channels?.length) return '未配置';
  return notify.channels.map(channel => (channel === 'internal' ? '站内通知' : 'webhook')).join('、');
}

function describeFailurePolicy(policy) {
  const backoff = policy.backoff;
  const strategyText = backoff.strategy === 'fixed'
    ? `固定间隔 ${formatDurationMs(backoff.interval_ms)}`
    : `指数退避（基数 ${formatDurationMs(backoff.interval_ms)}，上限 ${formatDurationMs(backoff.max_delay_ms)})`;
  const retryText = policy.max_retries > 0 ? `重试 ${policy.max_retries} 次` : '不重试';
  const timeoutText = policy.execution_timeout_ms ? `单次超时 ${formatDurationMs(policy.execution_timeout_ms)}` : '单次执行不限制超时';
  return `${retryText} · ${strategyText} · ${timeoutText} · 失败告警：${describeChannels(policy.alert)}`;
}

function describeConcurrency(concurrency) {
  if (concurrency === 'queue') return '上次未完成时排队（合并为一次补跑）';
  if (concurrency === 'parallel') return '允许并行执行';
  return '上次未完成时跳过';
}

function describeResult(result) {
  if (result?.handling === 'notify') return `发送通知（${describeChannels(result.notify)}）`;
  return '仅保存';
}

/**
 * 调度预览：触发器、执行对象（显示名称）、失败策略摘要、并发、结果处理一目了然。
 * targetName 由调用方按 Agent/Skill 名解析后传入；不传则回退显示 ID。
 */
export function previewSchedule(schedule, { targetName = null, after = new Date(), occurrenceCount = 3 } = {}) {
  if (!schedule || typeof schedule !== 'object') throw new TypeError('schedule must be an object');
  const policy = runtimePolicy(schedule);
  return {
    id: schedule.id,
    name: schedule.name ?? null,
    enabled: schedule.enabled !== false,
    target: describeTarget(schedule.target, targetName),
    trigger: describeTrigger(schedule.trigger),
    next: nextOccurrences(schedule.trigger, after, occurrenceCount),
    failure: describeFailurePolicy(policy),
    concurrency: describeConcurrency(policy.concurrency),
    result: describeResult(policy.result),
    instruction: ['agent', 'skill'].includes(schedule.target?.type) ? (schedule.execution?.instruction ?? '') : null
  };
}

/* ---------- 服务 ---------- */

export class SchedulerService {
  #handlers = new Map();
  #running = new Set();
  #queued = new Map();
  #timer = null;
  #executions = new Set();
  #controllers = new Set();
  #closing = false;

  constructor({ store, onAudit = () => {}, now = () => new Date(), agentRunner = null, skillRunner = null, notifier = null, fetchImpl = null } = {}) {
    if (!store || typeof store.list !== 'function' || typeof store.upsert !== 'function') {
      throw new TypeError('scheduler store is required');
    }
    this.store = store;
    this.onAudit = onAudit;
    this.now = now;
    // 真实执行器必须显式注入；未注入时执行明确报错，绝不暗装 Mock。
    this.agentRunner = agentRunner;
    this.skillRunner = skillRunner;
    this.notifier = notifier;
    this.fetchImpl = fetchImpl;
  }

  registerProductHandler(productId, handler) {
    required(productId, 'productId');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (this.#handlers.has(productId)) throw new Error(`Product handler already registered: ${productId}`);
    this.#handlers.set(productId, handler);
    return () => this.#handlers.delete(productId);
  }

  async list() {
    return this.store.list();
  }

  async get(id) {
    return this.store.get(id);
  }

  async remove(id) {
    const removed = await this.store.remove(id);
    if (removed) this.onAudit({ type: 'schedule_removed', schedule_id: id });
    return removed;
  }

  async create(input) {
    const schedule = validateSchedule(input);
    if (await this.store.get(schedule.id)) throw new Error(`Schedule already exists: ${schedule.id}`);
    const now = this.now();
    schedule.enabled = schedule.enabled !== false;
    schedule.created_at = schedule.created_at ?? now.toISOString();
    schedule.updated_at = now.toISOString();
    schedule.next_run_at = schedule.next_run_at ?? nextOccurrence(schedule.trigger, new Date(now.getTime() - 1))?.toISOString() ?? null;
    schedule.retry_count = 0;
    await this.store.upsert(schedule);
    this.onAudit({ type: 'schedule_created', schedule_id: schedule.id });
    return schedule;
  }

  async update(id, patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('patch must be an object');
    const existing = await this.store.get(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    const merged = { ...structuredClone(existing), ...structuredClone(patch), id, product_id: existing.product_id };
    const validated = validateSchedule(merged);
    validated.created_at = existing.created_at;
    validated.updated_at = this.now().toISOString();
    if (patch.trigger !== undefined) {
      validated.next_run_at = nextOccurrence(validated.trigger, new Date(this.now().getTime() - 1))?.toISOString() ?? null;
      delete validated.pending_occurrence;
      delete validated.resume_next_run_at;
      validated.retry_count = 0;
    }
    if (patch.enabled !== undefined) validated.enabled = patch.enabled !== false;
    await this.store.upsert(validated);
    this.onAudit({ type: 'schedule_updated', schedule_id: id });
    return validated;
  }

  /** 手动立即触发一次（受并发策略约束）。 */
  async triggerNow(id, at = this.now()) {
    const schedule = await this.store.get(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);
    if (!schedule.enabled) throw new Error('任务已停用，无法手动触发');
    delete schedule.pending_occurrence;
    schedule.next_run_at = at.toISOString();
    await this.store.upsert(schedule);
    return this.#run(schedule, at);
  }

  async runDue(at = this.now()) {
    const due = (await this.store.list()).filter(schedule =>
      schedule.enabled && schedule.next_run_at && new Date(schedule.next_run_at) <= at
    );
    return Promise.all(due.map(schedule => this.#run(schedule, at)));
  }

  start(pollMs = 30_000) {
    if (this.#timer) return;
    if (!Number.isSafeInteger(pollMs) || pollMs <= 0) throw new TypeError('pollMs must be positive');
    this.#timer = setInterval(() => {
      this.runDue().catch(error => this.onAudit({ type: 'scheduler_tick_failed', error: error.message }));
    }, pollMs);
    this.#timer.unref?.();
    void this.runDue();
  }

  stop() {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  async #run(schedule, at) {
    if(this.#closing)return {scheduleId:schedule.id,status:'skipped',reason:'service_closing'};
    const policy = runtimePolicy(schedule);
    // 产品处理器缺失不是执行失败：保持原语义，不消费本次触发，等待下次 tick
    if (schedule.target?.type === 'product_handler' && !this.#handlers.has(schedule.product_id)) {
      this.onAudit({ type: 'schedule_handler_missing', schedule_id: schedule.id });
      return { scheduleId: schedule.id, status: 'handler_missing' };
    }
    if (this.#running.has(schedule.id)) {
      if (policy.concurrency === 'queue') {
        if (!this.#queued.has(schedule.id)) {
          this.#queued.set(schedule.id, true);
          this.onAudit({ type: 'schedule_queued', schedule_id: schedule.id });
        }
        return { scheduleId: schedule.id, status: 'queued' };
      }
      if (policy.concurrency === 'parallel') {
        // 允许并行：直接进入执行
      } else {
        // 默认 skip：原子记录「因上次未完成而跳过」，不与执行中的写入互相覆盖
        await this.store.mutate(schedule.id, current => ({
          ...current,
          last_skip_reason: SKIP_REASON,
          last_skipped_at: at.toISOString()
        }));
        this.onAudit({ type: 'schedule_skipped_running', schedule_id: schedule.id, reason: SKIP_REASON });
        return { scheduleId: schedule.id, status: 'skipped', reason: SKIP_REASON };
      }
    }
    this.#running.add(schedule.id);
    try {
      const outcome = await this.#trackedExecution(schedule, at);
      if (!this.#closing && this.#queued.has(schedule.id)) {
        this.#queued.delete(schedule.id);
        const fresh = await this.store.get(schedule.id);
        if (fresh && fresh.enabled) {
          // 排队模式：触发期间到达的多次触发合并为一次补跑（仍在持有运行标记期间执行，
          // 避免标记释放窗口被其他触发抢入导致重复执行）。补跑按实际执行时间计为一次
          // 新的触发，避免重复执行同一 occurrence。
          fresh.next_run_at = this.now().toISOString();
          delete fresh.pending_occurrence;
          const followup = await this.#trackedExecution(fresh, this.now());
          return { ...outcome, queued_followup: followup };
        }
      }
      return outcome;
    } finally {
      this.#running.delete(schedule.id);
    }
  }

  async drain() {
    this.#closing=true;this.stop();this.#queued.clear();
    for(const controller of this.#controllers)controller.abort(new Error('服务正在关闭'));
    await Promise.allSettled([...this.#executions]);
  }
  #trackedExecution(schedule,at) {
    const promise=this.#execute(schedule,at);this.#executions.add(promise);
    promise.finally(()=>this.#executions.delete(promise)).catch(()=>{});return promise;
  }
  async #execute(schedule, at) {
    const policy = runtimePolicy(schedule);
    const occurrence = schedule.pending_occurrence ?? schedule.next_run_at;
    if (!schedule.pending_occurrence) {
      const next = schedule.trigger.type === 'once' ? null : nextOccurrence(schedule.trigger, at);
      schedule.pending_occurrence = occurrence;
      schedule.resume_next_run_at = next?.toISOString() ?? null;
    }
    schedule.next_run_at = null;
    schedule.last_started_at = at.toISOString();
    schedule.updated_at = at.toISOString();
    delete schedule.last_skip_reason;
    await this.store.upsert(schedule);
    const controller = new AbortController();
    this.#controllers.add(controller);
    if(this.#closing)controller.abort(new Error('服务正在关闭'));
    const event = {
      event_id: randomUUID(),
      schedule_id: schedule.id,
      product_id: schedule.product_id,
      target: structuredClone(schedule.target),
      // 兼容旧产品 handler：product_handler 目标保留顶层 handler 字段
      handler: schedule.target.type === 'product_handler' ? schedule.target.handler : undefined,
      business_payload: structuredClone(schedule.business_payload ?? {}),
      scheduled_at: occurrence,
      idempotency_key: `${schedule.id}:${occurrence}`,
      signal: controller.signal
    };
    this.onAudit({ type: 'schedule_started', schedule_id: schedule.id, event_id: event.event_id, target_type: schedule.target.type });
    const timeoutMs = policy.execution_timeout_ms;
    let timeoutId = null;
    const dispatchWork = this.#dispatch(schedule, event);
    let rejectAbort;
    const aborted=new Promise((_,reject)=>{
      rejectAbort=()=>reject(controller.signal.reason);
      if(controller.signal.aborted)rejectAbort();else controller.signal.addEventListener('abort',rejectAbort,{once:true});
    });
    const dispatchPromise = Promise.race([dispatchWork,aborted]);
    // 超时后底层执行可能仍在继续：其结果不再采用，避免未处理拒绝；
    // 已发生的副作用以实际为准（调用方按 signal 协作取消）。
    dispatchPromise.catch(() => {});
    try {
      let result;
      if (timeoutMs) {
        const timeoutError = new Error(`单次执行超时（已执行 ${formatDurationMs(timeoutMs)}）`);
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
          }, timeoutMs);
        });
        result = await Promise.race([dispatchPromise, timeoutPromise]);
      } else {
        result = await dispatchPromise;
      }
      schedule.last_completed_at = this.now().toISOString();
      schedule.last_run = { status: 'completed', at: schedule.last_completed_at };
      schedule.retry_count = 0;
      schedule.next_run_at = schedule.resume_next_run_at;
      schedule.enabled = Boolean(schedule.next_run_at);
      delete schedule.pending_occurrence;
      delete schedule.resume_next_run_at;
      delete schedule.last_error;
      await this.store.upsert(schedule);
      this.onAudit({ type: 'schedule_completed', schedule_id: schedule.id, event_id: event.event_id });
      await this.#handleResultNotification(schedule, { ok: true, event });
      return { scheduleId: schedule.id, status: 'completed', result };
    } catch (error) {
      const maxRetries = policy.max_retries;
      schedule.retry_count = (schedule.retry_count ?? 0) + 1;
      schedule.last_error = error.message;
      schedule.last_run = { status: 'failed', at: this.now().toISOString(), error: error.message };
      const retriesExhausted = schedule.retry_count > maxRetries;
      if (!retriesExhausted) {
        const backoffMs = computeBackoffMs(policy, schedule.retry_count);
        schedule.next_run_at = new Date(this.now().getTime() + backoffMs).toISOString();
        schedule.enabled = true;
      } else {
        schedule.next_run_at = schedule.resume_next_run_at;
        schedule.enabled = Boolean(schedule.next_run_at);
        delete schedule.pending_occurrence;
        delete schedule.resume_next_run_at;
      }
      await this.store.upsert(schedule);
      this.onAudit({ type: 'schedule_failed', schedule_id: schedule.id, event_id: event.event_id, error: error.message, retries_exhausted: retriesExhausted });
      if (retriesExhausted) {
        await this.#sendFailureAlert(schedule, error, event);
        await this.#handleResultNotification(schedule, { ok: false, event, error });
      }
      return { scheduleId: schedule.id, status: 'failed', error: error.message, retriesExhausted };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      controller.signal.removeEventListener('abort',rejectAbort);
      this.#controllers.delete(controller);
    }
  }

  /**
   * 按执行对象类型分发（决议 43）。
   * - Agent：执行指令作为首条用户消息注入；只传 messages，不触碰 system prompt。
   * - Skill：执行指令填入 Skill Contract 的主输入字段后直接执行。
   * - product_handler：沿用产品侧 handler（业务执行模型留在产品）。
   */
  async #dispatch(schedule, event) {
    const target = schedule.target;
    if (target.type === 'product_handler') {
      const handler = this.#handlers.get(schedule.product_id);
      // #run 已前置检查；此处为防御性兜底（并发注销时转为一次普通失败）
      if (!handler) throw new Error(`No product handler registered: ${schedule.product_id}`);
      return handler(event);
    }
    if (target.type === 'agent') {
      if (typeof this.agentRunner !== 'function') {
        throw new Error('Agent 定时任务需要宿主显式注入 agentRunner，未接入真实执行器（不使用 Mock）');
      }
      const instruction = schedule.execution?.instruction ?? '';
      return this.agentRunner({
        agentId: target.agent_id,
        instruction,
        messages: [{ role: 'user', content: instruction }],
        event
      });
    }
    if (target.type === 'skill') {
      if (typeof this.skillRunner !== 'function') {
        throw new Error('Skill 定时任务需要宿主显式注入 skillRunner，未接入真实执行器（不使用 Mock）');
      }
      const instruction = schedule.execution?.instruction ?? '';
      const skillVersion = target.skill_version ?? 'latest';
      return this.skillRunner({ skillId: target.skill_id, skillVersion, instruction, event });
    }
    throw new Error(`Unsupported target type: ${target.type}`);
  }

  /** 失败告警（决议 41）：重试耗尽后的最终失败才告警。 */
  async #sendFailureAlert(schedule, error, event) {
    const alert = runtimePolicy(schedule).alert;
    if (!alert || !alert.channels?.length) return;
    const title = `定时任务执行失败：${schedule.name || schedule.id}`;
    const body = `任务「${schedule.name || schedule.id}」在 ${event.scheduled_at} 的执行失败，已重试 ${Math.max(0, (schedule.retry_count ?? 1) - 1)} 次：${error.message}`;
    await this.#notify(alert, { title, body, schedule_id: schedule.id, event_id: event.event_id, kind: 'failure', error: error.message });
  }

  /** 结果处理（决议 44）：仅保存（默认）或发送通知。 */
  async #handleResultNotification(schedule, { ok, event, error }) {
    const result = runtimePolicy(schedule).result;
    if (result.handling !== 'notify' || !result.notify) return;
    const title = ok ? `定时任务执行完成：${schedule.name || schedule.id}` : `定时任务最终失败：${schedule.name || schedule.id}`;
    const body = ok
      ? `任务「${schedule.name || schedule.id}」在 ${event.scheduled_at} 执行完成。`
      : `任务「${schedule.name || schedule.id}」在 ${event.scheduled_at} 最终失败：${error?.message ?? error}`;
    await this.#notify(result.notify, {
      title, body, schedule_id: schedule.id, event_id: event.event_id,
      kind: ok ? 'result' : 'failure', error: ok ? undefined : (error?.message ?? String(error))
    });
  }

  async #notify(notifyConfig, { title, body, schedule_id, event_id, kind, error }) {
    for (const channel of notifyConfig.channels) {
      if (channel === 'internal') {
        if (typeof this.notifier !== 'function') {
          this.onAudit({ type: 'schedule_alert_unsent', schedule_id, channel: 'internal', kind, reason: '未配置站内通知发送器（schedulerNotifier），通知未发出' });
          continue;
        }
        try {
          await this.notifier({ channel: 'internal', title, body, schedule_id, event_id, kind, error });
          this.onAudit({ type: 'schedule_alert_sent', schedule_id, channel: 'internal', kind });
        } catch (notifyError) {
          this.onAudit({ type: 'schedule_alert_failed', schedule_id, channel: 'internal', kind, error: notifyError.message });
        }
      } else if (channel === 'webhook') {
        await this.#postWebhook(notifyConfig.webhook_url, { title, body, schedule_id, event_id, kind, error, occurred_at: this.now().toISOString() }, schedule_id, kind);
      }
    }
  }

  /**
   * webhook 告警。失败只记 audit，不抛错、不影响主流程；
   * webhook URL 是敏感配置，永不进入 audit/日志（错误信息中做脱敏）。
   */
  async #postWebhook(url, payload, scheduleId, kind) {
    const doFetch = this.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (typeof doFetch !== 'function') {
      this.onAudit({ type: 'schedule_alert_failed', schedule_id: scheduleId, channel: 'webhook', kind, error: '当前环境不支持 webhook 发送' });
      return;
    }
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response || !response.ok) throw new Error(`webhook 响应异常：${response?.status ?? '无响应'}`);
      this.onAudit({ type: 'schedule_alert_sent', schedule_id: scheduleId, channel: 'webhook', kind });
    } catch (error) {
      const raw = String(error?.message ?? error);
      const safe = url ? raw.split(url).join('[webhook 地址已脱敏]') : raw;
      this.onAudit({ type: 'schedule_alert_failed', schedule_id: scheduleId, channel: 'webhook', kind, error: safe });
    }
  }
}

export { nextOccurrence, validateSchedule };
