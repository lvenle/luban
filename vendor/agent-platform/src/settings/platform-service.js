import { applicationRunPolicy } from '../hosting/application-run-policy.js';
import { PromptStore, renderPrompt } from '../prompts/store.js';
import { createSharedLinks } from '../content/shared-links.js';
import { createSharedMediaRuntime } from '../content/shared-media.js';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, dirname, resolve } from 'node:path';
import { lstat, readdir, realpath, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InstanceStore } from './instance-store.js';
import { agentDraftOf } from './instance-store.js';
import { RunService } from '../runtime/run-service.js';
import { ToolRegistry } from '../tools/registry.js';
import { createWorkspaceTools, WORKSPACE_TOOL_IDS } from '../tools/pi-agent-tools.js';
import { normalizeHttpTool, executableHttpTool } from '../tools/http-json-tool.js';
import { SkillStore } from '../skills/store.js';
import { planTool } from '../runtime/plan-notebook.js';
import { ModelDiagnostics } from './model-diagnostics.js';
import { createModelProvider } from '../model/index.js';
import { LibraryStore } from '../knowledge/library-store.js';
import { slimBase64RunEvents, applyRunEventRetention } from './storage-migrations.js';
import { reconcileRunningRuns, slimRunOwnersToRunsTable } from './storage-migrations.js';
import { migrateConversationSummaries, archiveMigratedFile } from './storage-migrations.js';
import { openInstanceDatabase } from './instance-database.js';
import { WikiStore } from '../knowledge/wiki.js';
import { extractKnowledgeDocument } from '../knowledge/document-extractor.js';
import { createMediaTools } from '../channels/media-tools.js';
import { createMacosMediaRuntime } from '../channels/macos-media-runtime.js';
import { McpManager } from '../mcp/manager.js';
import { MemoryStore } from '../memory/store.js';
import { createStandardTools } from '../tools/standard-provider.js';
import { acquireInstance } from './instance-guard.js';
import { SqliteScheduleStore, SchedulerService, listTimezones, nextOccurrences, previewSchedule, validateCronExpression, validateSchedule } from '../scheduler/index.js';
import { persistMediaReferences } from '../media/persist-references.js';

/**
 * Agent 的全部生效配置：草稿 + 全部已发布快照（内置助手只有自身）。
 * 用于删除保护等需要覆盖不可变快照的检查。
 */
function agentAllConfigs(a) {
  if (!a) return [];
  return [a.draft, ...(a.versions || []).map(v => v.snapshot)].filter(Boolean);
}

/**
 * ADR-002: 媒体解析同样是底座能力。SunnyPet/build.sh 把 media-helper 编译到
 * connectors/media-macos/，这里按同一约定解析；缺失时如实返回 null。
 */
function resolveMacosMediaHelper() {
  try {
    const helper = fileURLToPath(new URL('../../connectors/media-macos/media-helper', import.meta.url));
    return existsSync(helper) ? helper : null;
  } catch { return null; }
}

/**
 * 只读列出服务器上的子目录，供知识库源目录选择器使用。
 * 仅做目录浏览，不读取文件内容；拒绝符号链接目录。
 */
async function listServerDirs(requested) {
  let dir = String(requested || '').trim() || homedir();
  if (!isAbsolute(dir)) throw Error('请使用绝对路径');
  let real;
  try { real = await realpath(dir); }
  catch { throw Error('目录不存在或不可访问：' + dir); }
  const st = await lstat(real).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) throw Error('请选择一个普通目录');
  const entries = await readdir(real, { withFileTypes: true }).catch(() => { throw Error('目录不可读取：' + real); });
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    dirs.push({ name: e.name, path: join(real, e.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return { path: real, parent: dirname(real), entries: dirs };
}

/** Transport-neutral API used by both standalone and embedded hosts. */
export async function createPlatformService({ directory, productId = 'standalone', allowForeignProduct = false, modelSource = null, tools = new ToolRegistry(), providerFactory, toolPolicyFactory, runtimePolicy = applicationRunPolicy, knowledgeStore = null, extensions = [], mediaRuntime = null, allowedTools, confirmTool, policy = {}, schedulerNotifier = null, skillRunner = null, schedulerPollMs = 30_000, workspaceRoot = process.cwd(), installWorkspaceTools = true, installPiTools = undefined, browserAdapter = null, installStandardTools = true, startBackgroundServices = true }) {
  const configuredTools = allowedTools ?? policy.allowedTools ?? null;
  const effective = {
    allowCustomAgents: policy.allowCustomAgents !== false,
    allowedTools: configuredTools,
    confirmTool: confirmTool ?? policy.confirmTool,
    lockedAgentFields: policy.lockedAgentFields ?? [],
    lockedConnectionFields: policy.lockedConnectionFields ?? []
  };
  const release = await acquireInstance(directory);
  let closing=false, closePromise;
  const active=new Map();
  const initializedExtensions = [];
  const trackRun=handle=>{
    if(closing){handle.cancel();return handle;}
    active.set(handle.runId,handle);
    handle.result.finally(()=>active.delete(handle.runId)).catch(()=>{});return handle;
  };
  const chatAttachmentDirectory = join(resolve(directory), '.chat-attachments');
  let initializedRuns;
  let databaseHandle,maintenanceTimer;
  try {
  // P1/P2：先打开并设 PRAGMA，把同一句柄交给 store / runs / knowledge，
  // 避免循环依赖并保证三者共享同一个 schema。InstanceStore 拿到 db 后会跑 P2 history 迁移。
  databaseHandle = openInstanceDatabase(directory);
  const store = await new InstanceStore(directory, { productId, allowForeignProduct, modelSource, database: databaseHandle.db }).prepare();
  const prompts = new PromptStore(databaseHandle.db);
  store.lockedFields = { agent: effective.lockedAgentFields, connection: effective.lockedConnectionFields };
  if (installStandardTools) {
    const memory = new MemoryStore(join(resolve(directory), 'memory'), productId);
    await mkdir(memory.root, { recursive: true, mode: 0o700 });
    const standard = createStandardTools({
      names: {
        skill_list: 'platform.skills.list', skill_install: 'platform.skills.install',
        skill_enable: 'platform.skills.enable', skill_uninstall: 'platform.skills.uninstall',
        get_current_time: 'platform.time.current',
        memory_read: 'platform.memory.read', memory_update: 'platform.memory.update',
        memory_forget: 'platform.memory.forget', write_file: 'workspace.write_file', read_file: 'workspace.read_file',
        list_files: 'workspace.list_files',
        browser_search: 'browser.search', browser_open: 'browser.open', browser_read: 'browser.read',
        browser_scroll: 'browser.scroll', browser_click: 'browser.click', browser_type: 'browser.type'
      },
      skills: { list: () => [], install: async () => { throw new Error('Skill lifecycle tools are UI-managed'); }, enable: async () => { throw new Error('Skill lifecycle tools are UI-managed'); }, uninstall: async () => { throw new Error('Skill lifecycle tools are UI-managed'); } },
      memory,
      files: { list: async () => {
        const root = await realpath(resolve(workspaceRoot));
        const entries = await readdir(root, { withFileTypes: true });
        return entries.filter(entry => !entry.name.startsWith('.') && (entry.isFile() || entry.isDirectory()) && !entry.isSymbolicLink())
          .sort((a, b) => a.name.localeCompare(b.name, 'zh')).slice(0, 200)
          .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
      } },
      browser: browserAdapter,
      memoryScopes: ['global'],
      requestApproval: async () => false
    });
    const safeNames = new Set(['get_current_time', 'memory_read', 'memory_update', 'list_files']);
    if (browserAdapter) for (const name of ['browser_search', 'browser_open', 'browser_read']) safeNames.add(name);
    const existing = new Set(tools.listCapabilities().map(tool => tool.name));
    for (const definition of standard.filter(item => safeNames.has(item.legacyName) && !existing.has(item.name))) {
      tools.register({ ...definition, source: 'platform', provider: 'standard', enabled: true });
    }
  }
  for (const definition of store.customTools()) tools.register(executableHttpTool(definition));
  if (installPiTools === undefined ? installWorkspaceTools : installPiTools) {
    const installed = await createWorkspaceTools({ workspaceRoot });
    const existing = new Set(tools.listCapabilities().map(tool => tool.name));
    for (const definition of installed) if (!existing.has(definition.name)) tools.register(definition);
    const codingToolNames = Object.values(WORKSPACE_TOOL_IDS);
    if (codingToolNames.every(name => installed.some(tool => tool.name === name)) && (!effective.allowedTools || codingToolNames.every(name => effective.allowedTools.includes(name)))) {
      await store.ensureCodingAssistant();
    }
  }
  const skills = new SkillStore(directory, { inheritGlobal: false });
  await skills.prepare();
  const runs = new RunService({ store, tools, skills, runtimePolicy, providerFactory, toolPolicyFactory, allowedTools: effective.allowedTools, confirmTool: effective.confirmTool, database: databaseHandle.db });
  initializedRuns=runs;
  // Startup migration extracts inline media from every event into .runtime-media/.
  // Markers commit with data; failures stop startup rather than splitting storage.
  try {
    const slim = slimBase64RunEvents({ db: runs.db, directory });
    if (!slim.skipped && slim.updated) {
      runs.db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
      console.log(`[platform] slimmed ${slim.updated} run events, reduced inline JSON by ${slim.bytesExtracted} bytes`);
    }
    // P4：把 run_owners 迁入 runs 表；启动对账把卡在 running 的行收尾。
    const runsMig = slimRunOwnersToRunsTable({ db: runs.db });
    const recon = reconcileRunningRuns({ db: runs.db });
    migrateConversationSummaries({db:runs.db,directory});
    const retention = applyRunEventRetention({ db: runs.db });
    if (!runsMig.skipped && runsMig.inserted) console.log(`[platform] migrated ${runsMig.inserted} runs into runs table`);
    if (recon.reconciled) console.log(`[platform] reconciled ${recon.reconciled} stale running rows`);
    if (retention.removedRunEvents || retention.removedRunLateEvents) {
      console.log(`[platform] retention removed ${retention.removedRunEvents} run_events + ${retention.removedRunLateEvents} run_late_events`);
    }
  } catch (error) {
    throw new Error('实例存储迁移失败，旧数据已保留',{cause:error});
  }
  maintenanceTimer=setInterval(()=>{
    try {reconcileRunningRuns({db:runs.db,includeHosted:false});applyRunEventRetention({db:runs.db});} catch(error){console.error('[platform] storage maintenance failed:',error.message);}
  },60*60*1000);
  maintenanceTimer.unref?.();
  // 底座内置 plan 工具：注册进共享 registry，供控制台“测试执行”使用；
  // 真实 Run 仍走 RunService 按 session 绑定的 builtin 实现，二者互不干扰。
  // 测试执行使用隔离 session 'tool-test'，不污染真实会话的计划数据。
  if (!tools.listCapabilities().some(t => t.name === planTool.name)) {
    tools.register({ ...planTool, execute: input => runs.plans.execute(input, { sessionId: 'tool-test', runId: 'tool-test' }) });
  }
  initializedRuns = runs;
  const diagnostics = new ModelDiagnostics(store);
  const knowledge = knowledgeStore || new LibraryStore(runs.db, directory, {
    // 知识库构建可选调用模型做摘要与概念抽取：构建模型 = 知识库配置的构建模型指针
    // （模型连接 ID），未指定时跟随平台默认模型。默认模型未配置时抛错，
    // LibraryStore 会捕获并回退为原文直存；显式指定的构建模型不可用时构建失败。
    resolveModel: (connectionId) => {
      const connection = store.resolveConnection(connectionId);
      const factory = providerFactory ?? (c => createModelProvider({ ...c, base_url: c.baseUrl || undefined }, { apiKey: c.apiKey }));
      return { connection, provider: factory(connection) };
    }
  });
  runs.knowledge = knowledge;
  runs.groundKnowledge = (snapshot, query, options) => new WikiStore(snapshot.root, options).grounding(query);

  const sharedLinks = createSharedLinks();
  const effectiveMediaRuntime = createSharedMediaRuntime(mediaRuntime || (process.platform === 'darwin' ? createMacosMediaRuntime({ helperPath: resolveMacosMediaHelper(), workspaceRoot }) : null));
  for (const factory of extensions) {
    if (typeof factory !== 'function') throw new TypeError('Extension must be a runtime factory');
    const extension = await factory({ store, runs, tools, knowledge, directory, workspaceRoot, providerFactory, trackRun, mediaRuntime: effectiveMediaRuntime, sharedLinks, startBackgroundServices });
    initializedExtensions.push(extension);
  }
  if (effectiveMediaRuntime) for (const definition of createMediaTools(effectiveMediaRuntime)) {
    if (!tools.listCapabilities().some(item => item.name === definition.name)) tools.register(definition);
  }
  if (!tools.listCapabilities().some(item => item.name === sharedLinks.tool.name)) tools.register(sharedLinks.tool);
  const mcp = new McpManager(directory,{database:runs.db});
  await mcp.prepare();
  // 决议 28/30：MCP 同步工具恢复进 Tool 注册表（保留的配置），可达性在下一次同步/调用时探明
  await mcp.restoreSyncedTools(tools);
  /** Test-run a tool with the same policy gates as real runs (allowlist + product confirmation). */
  async function testTool(name, input, owner) {
    if (effective.allowedTools && !effective.allowedTools.includes(name)) throw Error('Tool prohibited by product policy');
    const definition = tools.listCapabilities().find(t => t.name === name);
    if (!definition) throw Error('Tool not found');
    // 与 RunService 一致：底座内置工具不走产品确认门（确认门只针对产品/第三方工具）
    if (name !== planTool.name && (definition.requiresConfirmation || definition.confirmationRequired)) {
      if (typeof effective.confirmTool !== 'function') throw Error('Tool requires product confirmation; no handler available');
      const approved = await effective.confirmTool({ runId: 'tool-test', sessionId: null, owner, tool: name, input: structuredClone(input) });
      if (approved !== true) throw Error('Tool confirmation denied');
    }
    return tools.execute({ callId: 'test-' + randomUUID(), name, input, allowedTools: effective.allowedTools ?? tools.listCapabilities().map(t => t.name) });
  }
  // 定时任务（决议 v18 §九 41–45）：失败策略四件套 / 并发三选一 /
  // Agent-Skill 执行语义 / 结果处理 / 调度预览。
  // Agent 与 Skill 定时任务统一进入 RunService；Skill 通过通用 Agent Skills 机制按需读取说明。
  // 站内通知需上层显式注入 schedulerNotifier，未注入时告警记为 unsent（不伪装送达）。
  // skillRunner 仍可被上层显式覆盖；Mock 必须显式选择，这里只走真实路径。
  const readScheduleAudits = () => runs.db.prepare('SELECT payload,recorded_at FROM schedule_audit_events ORDER BY recorded_at,rowid').all()
    .map(row=>({...JSON.parse(row.payload||'{}'),at:row.recorded_at}));
  const pushScheduleAudit = event => {
    const saved=persistMediaReferences(event,directory);
    runs.db.prepare(`INSERT INTO schedule_audit_events(event_id,schedule_id,run_id,type,payload,recorded_at)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(),event.schedule_id||null,event.run_id||null,event.type,JSON.stringify(saved),new Date().toISOString());
  };
  const defaultSkillRunner = async ({ skillId, skillVersion = 'latest', instruction, event }) => {
    const agentId = `schedule-skill-${event.schedule_id}`;
    const pkg = await skills.resolveBinding(skillId, skillVersion);
    const config = {
      system: `你正在定时任务中执行已绑定的通用 Agent Skill。先调用 platform.skills.read 读取 ${skillId}@${pkg.version} 的 SKILL.md，并遵循其说明完成任务。Skill 可按需读取同目录资源。当前时间：${event.scheduled_at}。`,
      connectionId: null,
      tools: (effective.allowedTools || tools.listCapabilities().filter(item => item.enabled).map(item => item.name)).filter(name => tools.listCapabilities().some(item => item.name === name && item.enabled) && name !== planTool.name),
      skills: [{ id: skillId, version: pkg.version }], knowledge: [], params: {}, maxTurns: 12, timeoutMs: 180000
    };
    const ephemeralStore = {
      directory: store.directory,
      snapshot: () => ({ ...store.snapshot(), agents: [{ id: agentId, name: `定时 Skill ${skillId}`, draft: config, versions: [] }] }),
      resolveAgent: id => ({ id: agentId, name: `定时 Skill ${skillId}`, version: 'draft', ...config }),
      resolveConnection: id => store.resolveConnection(id),
      connectionStatus: id => store.connectionStatus(id),
      modelCard: (id, model) => store.modelCard(id, model),
      recordConnectionResult: (...args) => store.recordConnectionResult(...args)
    };
    const runner = new RunService({ store: ephemeralStore, tools, skills, runtimePolicy, providerFactory, allowedTools: effective.allowedTools, confirmTool: effective.confirmTool, database:runs.db });
    const handle = runner.run({ agentId, agentVersion: 'draft', messages: [{ role: 'user', content: instruction }], source: 'schedule',scheduleId:event.schedule_id }, { owner: 'scheduler' });
    trackRun(handle);
    pushScheduleAudit({ type: 'schedule_run_link', schedule_id: event.schedule_id, event_id: event.event_id, run_id: handle.runId });
    try {
      if (event.signal) {
        if (event.signal.aborted) handle.cancel();
        else event.signal.addEventListener('abort', () => handle.cancel(), { once: true });
      }
      let result;
      try { result = await handle.result; }
      catch (error) {
        pushScheduleAudit({ type: 'skill_run_failed', schedule_id: event.schedule_id, event_id: event.event_id, run_id: handle.runId, skill_id: skillId, skill_version: pkg.version, error: error.message });
        throw error;
      }
      pushScheduleAudit({ type: 'skill_run_completed', schedule_id: event.schedule_id, event_id: event.event_id, run_id: handle.runId, skill_id: skillId, skill_version: pkg.version });
      return result.output;
    } finally { if (runner !== runs) runner.close(); }
  };
  const scheduler = new SchedulerService({
    store: await new SqliteScheduleStore(runs.db).prepare(join(directory, 'schedules.json')),
    onAudit: pushScheduleAudit,
    agentRunner: async ({ agentId, messages, event }) => {
      // 定时任务是线上执行：固定跑最新已发布版，不跑草稿。
      const handle = runs.run({ agentId, agentVersion: 'latest', messages,source:'schedule',scheduleId:event?.schedule_id||null }, { owner: 'scheduler' });
      trackRun(handle);
      pushScheduleAudit({ type: 'schedule_run_link', schedule_id: event?.schedule_id, event_id: event?.event_id, run_id: handle.runId });
      if (event?.signal) {
        if (event.signal.aborted) handle.cancel();
        else event.signal.addEventListener('abort', () => handle.cancel(), { once: true });
      }
      return handle.result;
    },
    skillRunner: typeof skillRunner === 'function' ? skillRunner : defaultSkillRunner,
    notifier: typeof schedulerNotifier === 'function' ? schedulerNotifier : null
  });
  if(startBackgroundServices)scheduler.start(Number.isSafeInteger(schedulerPollMs) && schedulerPollMs > 0 ? schedulerPollMs : 30_000);
  /** 执行对象显示名称（决议 45：Agent / Skill 显示名称而非 ID）。 */
  async function scheduleTargetNames() {
    const agents = store.snapshot().agents;
    let skillEntries = [];
    try { skillEntries = await skills.list(); } catch { /* 名称解析失败不阻断 */ }
    return {
      agent: new Map(agents.map(a => [a.id, a.name])),
      skill: new Map(skillEntries.map(s => [s.id, s.description || s.id]))
    };
  }
  function scheduleTargetName(target, names) {
    if (target?.type === 'agent') return names.agent.get(target.agent_id) ?? null;
    if (target?.type === 'skill') return names.skill.get(target.skill_id) ?? null;
    return null;
  }
  /** API 出参：webhook URL 等敏感配置永不返回，只给「已配置」标记。 */
  function publicSchedule(schedule, targetName) {
    const out = structuredClone(schedule);
    for (const notify of [out.policy?.alert, out.policy?.result?.notify]) {
      if (notify && notify.webhook_url) {
        delete notify.webhook_url;
        notify.webhook_configured = true;
      }
    }
    if (targetName !== undefined) out.target_name = targetName;
    return out;
  }
  /** PATCH 合并 policy：webhook_url 留空表示保留旧值（前端拿不到已存地址）。 */
  function mergeNotify(oldNotify, newNotify) {
    if (newNotify === undefined) return oldNotify ?? null;
    if (newNotify === null) return null;
    const next = { ...newNotify };
    if ((next.webhook_url ?? '') === '' && oldNotify?.webhook_url) next.webhook_url = oldNotify.webhook_url;
    return next;
  }
  function mergePolicy(oldPolicy, patchPolicy) {
    const oldP = oldPolicy ?? {}, patchP = patchPolicy ?? {};
    const merged = { ...oldP, ...patchP };
    merged.alert = mergeNotify(oldP.alert, patchP.alert);
    const oldResult = oldP.result ?? {}, patchResult = patchP.result ?? {};
    merged.result = { ...oldResult, ...patchResult };
    merged.result.notify = mergeNotify(oldResult.notify, patchResult.notify);
    return merged;
  }
  // 定时任务 UI（/tasks）：控制台任务页的薄路由层，逻辑复用 scheduler service/store。
  // UI 任务形态（5 种调度方式 daily/weekly/monthly/interval/cron、失败四件套、并发三选一、
  // 执行对象、结果处理）在此翻译为调度器 schedule 形态；UI 原形保留在 schedule.ui 中回显。
  // 未完成（未选执行对象 / 未填执行指令）的任务以占位 target 入库并强制禁用，不会触发执行。
  const UNASSIGNED_HANDLER = '__unassigned__';
  /** 运行记录的实际结果：成功取 Run 的输出文本，失败取错误信息（不用「已完成」之类状态占位）。 */
  function taskRunOutcome(runId) {
    if (!runId) return { output: '', error: '' };
    const events = runs.events(runId);
    const ended = [...events].reverse().find(event => ['run_completed', 'run_failed', 'run_cancelled'].includes(event.type));
    if (!ended) return { output: events.filter(event => event.type === 'text_delta').map(event => event.payload?.delta || '').join(''), error: '' };
    const output = typeof ended.payload?.output === 'string' ? ended.payload.output : '';
    const error = ended.type === 'run_completed' ? '' : (ended.payload?.message || ended.payload?.error || '');
    return { output, error };
  }
  const taskManualMarks = [];
  const markTaskManualRun = (scheduleId, taskId) => {
    taskManualMarks.push({ schedule_id: scheduleId, task_id: taskId, at: new Date().toISOString() });
    if (taskManualMarks.length > 200) taskManualMarks.shift();
    pushScheduleAudit({type:'task_manual_trigger',schedule_id:scheduleId,task_id:taskId});
  };
  function uiScheduleToTrigger(uiSchedule) {
    const tz = uiSchedule?.timezone || 'Asia/Shanghai';
    const parts = String(uiSchedule?.time || '09:00').split(':');
    const hh = Math.min(Math.max(parseInt(parts[0], 10) || 0, 0), 23);
    const mm = Math.min(Math.max(parseInt(parts[1], 10) || 0, 0), 59);
    switch (uiSchedule?.type ?? 'daily') {
      case 'daily': return { type: 'cron', expression: `${mm} ${hh} * * *`, timezone: tz };
      case 'weekly': {
        const days = [...new Set((uiSchedule.weekdays?.length ? uiSchedule.weekdays : [1]).map(d => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
        return { type: 'cron', expression: `${mm} ${hh} * * ${days.join(',')}`, timezone: tz };
      }
      case 'monthly': {
        const dom = Math.min(Math.max(parseInt(uiSchedule.monthDay, 10) || 1, 1), 28);
        return { type: 'cron', expression: `${mm} ${hh} ${dom} * *`, timezone: tz };
      }
      case 'interval': {
        const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[uiSchedule.intervalUnit] ?? 3_600_000;
        const everyMs = Math.max(1, Math.round(Number(uiSchedule.intervalValue) || 2)) * unit;
        return { type: 'interval', every_ms: everyMs };
      }
      case 'cron': return { type: 'cron', expression: validateCronExpression(uiSchedule.cron, tz), timezone: tz };
      default: throw Error(`不支持的调度类型：${uiSchedule?.type}`);
    }
  }
  function uiTargetToTarget(uiTarget) {
    if (!uiTarget) return { type: 'product_handler', handler: UNASSIGNED_HANDLER };
    if (uiTarget.kind === 'agent') {
      if (!uiTarget.id) throw Error('请选择 Agent');
      return { type: 'agent', agent_id: uiTarget.id };
    }
    if (uiTarget.kind === 'skill') {
      if (!uiTarget.id) throw Error('请选择 Skill');
      return { type: 'skill', skill_id: uiTarget.id };
    }
    throw Error(`不支持的执行对象：${uiTarget.kind}`);
  }
  function uiTaskToPolicy(task) {
    const f = task.failure ?? {};
    const alert = f.alert ?? 'none';
    const notify = task.resultHandling === 'notify';
    return {
      max_retries: Math.min(Math.max(parseInt(f.retries, 10) || 0, 0), 10),
      backoff: {
        strategy: f.backoff === 'fixed' ? 'fixed' : 'exponential',
        interval_ms: 60_000,
        max_delay_ms: Math.min(Math.max(parseInt(f.maxDelayMin, 10) || 10, 1), 1440) * 60_000
      },
      execution_timeout_ms: Math.min(Math.max(parseInt(f.timeoutMin, 10) || 5, 1), 1440) * 60_000,
      concurrency: ['skip', 'queue', 'parallel'].includes(task.concurrency) ? task.concurrency : 'skip',
      alert: alert === 'none' ? null : { channels: [alert], webhook_url: (f.alertWebhookUrl || '').trim() },
      result: notify
        ? { handling: 'notify', notify: { channels: [task.notifyChannel === 'webhook' ? 'webhook' : 'internal'], webhook_url: (task.webhookUrl || '').trim() } }
        : { handling: 'save_only', notify: null }
    };
  }
  /** 任务是否可执行：已选执行对象，且 Agent/Skill 任务已填执行指令 */
  function taskTargetState(schedule) {
    const target = schedule.target;
    if (!target || (target.type === 'product_handler' && target.handler === UNASSIGNED_HANDLER)) return 'incomplete';
    if (target.type === 'product_handler') return 'external';
    if (typeof schedule.execution?.instruction !== 'string' || !schedule.execution.instruction.trim()) return 'incomplete';
    return 'complete';
  }
  function uiTaskToSchedule(task, existing = null) {
    if (!task.name?.trim()) throw Error('请填写任务名称');
    const target = uiTargetToTarget(task.taskTarget ?? task.target);
    const instruction = (task.instruction ?? '').trim();
    if ((target.type === 'agent' || target.type === 'skill') && !instruction) {
      throw Error('Agent / Skill 任务必须填写执行指令');
    }
    const complete = taskTargetState({ target, execution: { instruction } }) !== 'incomplete';
    const policy = uiTaskToPolicy(task);
    // webhook 地址留空表示保留旧值（出参永不回显地址，前端拿不到已存值）
    for (const [holder, oldHolder] of [[policy.alert, existing?.policy?.alert], [policy.result?.notify, existing?.policy?.result?.notify]]) {
      if (holder && !holder.webhook_url && oldHolder?.webhook_url && holder.channels.includes('webhook')) {
        holder.webhook_url = oldHolder.webhook_url;
      }
    }
    return validateSchedule({
      id: task.id || existing?.id || `task-${randomUUID().slice(0, 8)}`,
      product_id: productId,
      name: task.name.trim(),
      description: (task.description ?? '').trim(),
      enabled: (task.enabled !== false) && complete,
      trigger: uiScheduleToTrigger(task.schedule),
      target,
      execution: { instruction },
      policy,
      ui: {
        enabled: task.enabled !== false,
        schedule: task.schedule ?? null,
        failure: task.failure ?? null,
        resultHandling: task.resultHandling ?? 'save',
        notifyChannel: task.notifyChannel ?? 'internal',
        target: task.taskTarget ?? task.target ?? null,
        instruction
      }
    });
  }
  function scheduleToUiTask(schedule) {
    if (!schedule?.ui) return null;
    const ui = schedule.ui, policy = schedule.policy ?? {};
    const alert = policy.alert;
    return {
      id: schedule.id,
      name: schedule.name,
      description: schedule.description ?? '',
      enabled: ui.enabled !== false,
      instruction: schedule.execution?.instruction ?? '',
      resultHandling: ui.resultHandling ?? 'save',
      notifyChannel: ui.notifyChannel ?? 'internal',
      webhookUrl: '',
      webhookConfigured: !!policy.result?.notify?.webhook_url,
      schedule: ui.schedule ?? { type: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
      failure: {
        retries: policy.max_retries ?? 0,
        backoff: policy.backoff?.strategy ?? 'exponential',
        maxDelayMin: Math.round((policy.backoff?.max_delay_ms ?? 600_000) / 60_000),
        timeoutMin: policy.execution_timeout_ms ? Math.round(policy.execution_timeout_ms / 60_000) : 5,
        alert: !alert ? 'none' : (alert.channels.includes('webhook') ? 'webhook' : 'internal'),
        alertWebhookUrl: ''
      },
      alertWebhookConfigured: !!alert?.webhook_url,
      concurrency: policy.concurrency ?? 'skip',
      target: schedule.target?.type === 'product_handler' ? null : {
        kind: schedule.target.type,
        id: schedule.target.type === 'agent' ? schedule.target.agent_id : schedule.target.skill_id,
        name: ui.target?.name ?? null
      },
      nextRunAt: schedule.next_run_at ?? null,
      lastRunAt: schedule.last_completed_at ?? schedule.last_run?.at ?? null,
      lastSkipReason: schedule.last_skip_reason ?? null,
      lastError: schedule.last_error ?? null
    };
  }
  return {
    store, runs, tools, skills, knowledge, prompts, scheduler, extensions: initializedExtensions,
    // Trusted in-process host entry; never accepts tool implementations over HTTP.
    startProductRun(request, options = {}) {
      if (closing) throw Error('Platform service is closing');
      return trackRun(runs.run(request, options));
    },
    startModelRun(request, options = {}) {
      if (closing) throw Error('Platform service is closing');
      return trackRun(runs.runModel(request, options));
    },
    startApplicationRun(applicationInstanceId, request, options = {}) {
      if (closing) throw Error('Platform service is closing');
      const agent = store.getApplicationAssistant(applicationInstanceId, request.agentVersion || 'draft');
      if (request.agentId && request.agentId !== agent.id) throw Error('Assistant does not belong to this application');
      return trackRun(runs.run({ ...request, agentId: agent.id, agentVersion: agent.version }, options));
    },
    continueRun(runId, options={}) { if(closing)throw Error('Platform service is closing');return trackRun(runs.continueRun(runId,options)); },
    close() {
      return closePromise ||= (async () => {
      closing=true;
      clearInterval(maintenanceTimer);
      scheduler.stop();
      const handles = [...active.values()];
      for (const handle of handles) handle.cancel();
      await Promise.allSettled(handles.map(h => h.result));
      await scheduler.drain();
      try {
        const errors = [];
        for (const extension of [...initializedExtensions].reverse()) {
          try { await extension?.close?.(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Product extension shutdown failed');
      }
      finally {
        try { if (!knowledgeStore) await knowledge.drain(); }
        finally { try { await browserAdapter?.close?.(); } finally { runs.close(); databaseHandle.db.close(); await release(); } }
      }
      })();
    },
    async handle(method, path, input = {}, { owner = 'local', onEvent, productId: requestProductId = productId } = {}) {
      for (const extension of initializedExtensions) {
        const result = await extension?.handle?.(method, path, input, { owner, onEvent });
        if (result !== undefined) return result;
      }
      const [cleanPath, queryString] = String(path).split('?', 2);
      const query = Object.fromEntries(new URLSearchParams(queryString || ''));
      path = cleanPath;
      if (path === '/instance' && method === 'GET') return { ...store.snapshot(), capabilities: { customAgents: effective.allowCustomAgents, prompts: true } };
      if (path === '/policy' && method === 'GET') return { allowedTools: effective.allowedTools, confirmationAvailable: true, lockedAgentFields: effective.lockedAgentFields, lockedConnectionFields: effective.lockedConnectionFields };
      if (path === '/media/analyze_image' && method === 'POST') return effectiveMediaRuntime.analyzeImage(input);
      if (path === '/media/transcribe_audio' && method === 'POST') return effectiveMediaRuntime.transcribeAudio(input);
      if (path === '/media/inspect_video' && method === 'POST') return effectiveMediaRuntime.inspectVideo(input);
      if (path === '/prompts' && method === 'GET') return prompts.list(query);
      if (path === '/prompts' && method === 'POST') return prompts.create(input);
      if (path === '/prompts/export' && method === 'GET') return prompts.export();
      if (path === '/prompts/import' && method === 'POST') return prompts.import(input);
      const promptRoute = path.match(/^\/prompts\/([\w-]+)(?:\/(versions|restore|preview|run|runs))?$/);
      if (promptRoute) {
        const [,id,action]=promptRoute;
        if (!action && method==='GET') return prompts.get(id);
        if (!action && method==='PUT') return prompts.update(id,input);
        if (!action && method==='DELETE') return prompts.delete(id,input.revision);
        if (action==='versions' && method==='GET') return {items:prompts.versions(id)};
        if (action==='restore' && method==='POST') return prompts.restore(id,input);
        if (action==='runs' && method==='GET') return {items:prompts.history(id,owner)};
        if (action==='preview' && method==='POST') return {content:renderPrompt(prompts.get(id),input)};
        if (action==='run' && method==='POST') {
          const prompt=prompts.get(id);prompts.checkRevision(prompt,input.revision);
          if(prompt.kind!=='prompt')throw Error('此条目依赖工具或脚本，请先将它改编为独立提示词后运行');
          const content=renderPrompt(prompt,input);
          const handle=this.startModelRun({source:'prompt-library',system:'按用户提供的任务指令完成任务。需要外部工具但当前不可用时，请说明所需资料，不能声称已经执行操作。',messages:[{role:'user',content}]},{owner,toolNames:[],knowledgeIds:[],recoveryContext:{promptId:id,promptRevision:prompt.revision,promptLanguage:input.language||'zh'}});
          prompts.recordRun(id,prompt.revision,owner,input.language||'zh',handle.runId);
          return {runId:handle.runId,revision:prompt.revision};
        }
      }
      if (path === '/libraries' && method === 'GET') return { items: knowledge.list() };
      if (path === '/libraries' && method === 'POST') return knowledge.save(input);
      const libraryUsage = path.match(/^\/libraries\/([\w-]+)\/usage$/);
      if (libraryUsage && method === 'GET') {
        const used = [];
        for (const h of runs.history(owner, 100)) {
          const versions = new Set();
          try {
            for (const event of runs.events(h.runId)) {
              if (event.type === 'knowledge_sources') {
                for (const source of [...(event.payload?.sources || []), ...(event.payload?.libraries || [])])
                  if (source.libraryId === libraryUsage[1] || source.id === libraryUsage[1]) versions.add(source.version);
              } else if (event.type === 'skill_knowledge') {
                for (const source of event.payload?.sources || [])
                  if (source.libraryId === libraryUsage[1]) versions.add(source.version);
              }
            }
          } catch { /* 跳过损坏的运行记录 */ }
          if (versions.size) used.push({ runId: h.runId, agentId: h.agentId, startedAt: h.startedAt, status: h.status, versions: [...versions].filter(Boolean) });
          if (used.length >= 20) break;
        }
        return { libraryId: libraryUsage[1], count: used.length, runs: used };
      }
      if (path === '/fs/dirs' && method === 'GET') return listServerDirs(query.path);
      const libraryRaw = path.match(/^\/libraries\/([\w-]+)\/raw\/read$/);
      if (libraryRaw && method === 'POST') return knowledge.readRaw(libraryRaw[1], input.path);
      const libraryImport = path.match(/^\/libraries\/([\w-]+)\/import\/([\w-]+)$/);
      if (libraryImport) {
        if (method === 'DELETE') return knowledge.deleteImport(libraryImport[1], libraryImport[2]);
        if (method === 'POST') return knowledge.renameImport(libraryImport[1], libraryImport[2], input.title);
      }
      const library = path.match(/^\/libraries\/([\w-]+)\/(import|build|logs|log|catalog|page|search|raw|raw-page|lint|graph|purpose|schema|pending)$/);
      if (library) {
        if (method === 'POST' && library[2] === 'page') { const snapshot = input.version ? knowledge.published(library[1], input.version) : knowledge.snapshot(library[1]); return { libraryId: library[1], version: snapshot.version, ...await new WikiStore(snapshot.root).read(input.path) }; }
        if (method === 'POST' && library[2] === 'raw-page') {
          if (typeof input.path !== 'string' || !input.path.startsWith('raw/sources/')) throw Error('Invalid raw document path');
          return knowledge.readRaw(library[1], input.path);
        }
        if (method === 'POST' && library[2] === 'import') {
          const document = input.contentBase64 !== undefined ? await extractKnowledgeDocument(input) : input;
          const imported = knowledge.import(library[1], document);
          // “自动纳入构建”不仅表示下次手动构建时接收文件，上传成功后也应立即发布新版本。
          // 手动确认策略仍只登记原始资料，避免绕过待确认流程。
          if (knowledge.get(library[1]).newFilePolicy === 'auto' && input.deferBuild !== true) {
            const report = await knowledge.build(library[1]);
            return { ...imported, build: report };
          }
          return imported;
        }
        if (method === 'GET' && library[2] === 'build') return knowledge.buildStatus(library[1]);
        if (method === 'POST' && library[2] === 'build') return knowledge.build(library[1], input);
        if (method === 'GET' && library[2] === 'logs') return { items: knowledge.logs(library[1]) };
        if (method === 'GET' && library[2] === 'log') return { items: await knowledge.logEntries(library[1]) };
        if (method === 'GET' && library[2] === 'catalog') { const snapshot = knowledge.snapshot(library[1]); return { version: snapshot.version, ...await new WikiStore(snapshot.root).catalog() }; }
        if (method === 'GET' && library[2] === 'search') { const snapshot = knowledge.snapshot(library[1]); const store = new WikiStore(snapshot.root); const items = await store.search(query.q || ''); return { version: snapshot.version, items, retrieval: store.retrievalStatus }; }
        if (method === 'GET' && library[2] === 'raw') return { items: await knowledge.rawList(library[1]) };
        if (method === 'POST' && library[2] === 'lint') return knowledge.lint(library[1], input);
        if (method === 'GET' && library[2] === 'graph') return knowledge.graph(library[1], { maxPages: Math.min(Math.max(parseInt(query.max || '60', 10) || 60, 1), 200) });
        if (method === 'GET' && library[2] === 'purpose') return { content: knowledge.getPurpose(library[1]) };
        if (method === 'PUT' && library[2] === 'purpose') return knowledge.setPurpose(library[1], input.content);
        if (method === 'GET' && library[2] === 'schema') return { content: knowledge.getSchema(library[1]) };
        if (method === 'PUT' && library[2] === 'schema') return knowledge.setSchema(library[1], input.content);
        if (method === 'GET' && library[2] === 'pending') return { items: knowledge.pendingFiles(library[1]) };
        if (method === 'POST' && library[2] === 'pending') {
          const action = input?.action;
          if (action === 'confirm') return knowledge.confirmPending(library[1], input.sources);
          if (action === 'reject') return knowledge.rejectPending(library[1], input.sources);
          throw Error('待确认操作无效：action 应为 confirm 或 reject');
        }
      }
      if (path === '/mcp/servers' && method === 'GET') return { items: mcp.list() };
      if (path === '/mcp/servers' && method === 'POST') return mcp.add(input.server || {});
      // 决议 29：MCP 工具只读同步视图（同步状态徽标的数据源）
      if (path === '/mcp/tools' && method === 'GET') return mcp.syncView();
      const mcpItem = path.match(/^\/mcp\/servers\/([\w-]+)$/);
      if (mcpItem && method === 'PATCH') return mcp.update(mcpItem[1], input.server || {});
      if (mcpItem && method === 'DELETE') return mcp.remove(mcpItem[1]);
      const mcpAction = path.match(/^\/mcp\/servers\/([\w-]+)\/(test|tools|sync)$/);
      if (mcpAction && method === 'POST' && mcpAction[2] === 'test') return mcp.test(mcpAction[1]);
      if (mcpAction && method === 'POST' && mcpAction[2] === 'tools') return mcp.refreshTools(mcpAction[1]);
      // 决议 33：MCP 页"立即同步"按钮
      if (mcpAction && method === 'POST' && mcpAction[2] === 'sync') return mcp.syncServer(mcpAction[1], tools);
      const mcpCall = path.match(/^\/mcp\/servers\/([\w-]+)\/tools\/([^/]+)\/call$/);
      if (mcpCall && method === 'POST') return mcp.callTool(mcpCall[1], decodeURIComponent(mcpCall[2]), input.arguments || {});
      if (path === '/history' && method === 'GET') return { items: store.history() };
      if (path === '/history/restore' && method === 'POST') return store.restore(input.targetRevision, input.revision);
      if (path === '/connections' && method === 'POST') return store.saveConnection(input.connection, input.revision);
      const diagnostic = path.match(/^\/connections\/([\w-]+)\/(models|test)$/);
      if (diagnostic && method === 'GET' && diagnostic[2] === 'models') return diagnostics.list(diagnostic[1]);
      if (diagnostic && method === 'POST' && diagnostic[2] === 'test') {
        const result = await diagnostics.test(diagnostic[1], input);
        // 决议 38：手动"测试连接"（连通性探测）更新健康状态；能力探测不改健康。
        if (input?.kind === 'text') {
          try { result.health = await store.recordConnectionHealth(diagnostic[1], result.status === 'passed' ? 'ok' : 'failed'); }
          catch (e) { console.warn('[agent-platform] 连接健康状态记录失败：' + e.message); }
        }
        return result;
      }
      const connectionAction = path.match(/^\/connections\/([\w-]+)\/(default|usage|status)$/);
      if (connectionAction) {
        if (method === 'POST' && connectionAction[2] === 'default') return store.setDefaultConnection(connectionAction[1], input.revision);
        if (method === 'GET' && connectionAction[2] === 'status') return store.connectionStatus(connectionAction[1]);
        // 决议 39/40：使用范围——引用 Agent（可跳转）、Skill 行只读"继承调用方 Agent"、默认连接的内部任务。
        if (method === 'GET' && connectionAction[2] === 'usage') {
          const usage = store.connectionUsage(connectionAction[1]);
          const seen = new Set(), skillsOut = [];
          for (const a of usage.agents) {
            const agent = store.snapshot().agents.find(x => x.id === a.id);
            // 使用范围展示取草稿绑定（可编辑的当前真相）。
            for (const s of agentDraftOf(agent)?.skills || []) {
              const sid = typeof s === 'string' ? s : s.id;
              if (seen.has(a.id + '/' + sid)) continue;
              seen.add(a.id + '/' + sid);
              let name = sid;
              try { const entry = await skills.entry(sid); name = entry.description || sid; } catch { /* 技能缺失不阻断展示 */ }
              skillsOut.push({ id: sid, name, note: '继承调用方 Agent', viaAgent: a.name });
            }
          }
          return { ...usage, skills: skillsOut,
            internalTasks: usage.isDefault ? ['知识库构建摘要与概念抽取', '知识图谱生成'] : [],
            note: '默认连接承担：未指定模型的 Agent 继承、底座内部任务（知识库构建摘要/概念抽取、图谱生成）、内置通用助手。Skill 不独立指定模型，继承调用方 Agent（不可配置）。' };
        }
      }
      if (path === '/agents' && method === 'POST') {
        const agent = input.agent;
        if (!effective.allowCustomAgents && !store.snapshot().agents.some(item => item.id === agent?.id)) throw Error('当前产品不支持创建自定义助手');
        if (effective.allowedTools && Array.isArray(agent?.tools) && agent.tools.some(name => !effective.allowedTools.includes(name))) throw Error('所选工具被产品策略禁止，不能通过设置或导入解除限制');
        // Skill 绑定校验：不存在 / 旧版脚本技能 / 已停用 / 版本未发布一律阻断；
        // 通过后快照版本号（如 xxx@v2.1），Agent 发布时冻结。
        if (agent) agent.skills = await skills.validateBindings(agent.skills);
        return store.saveAgent(agent, input.revision);
      }
      const agentExtensions = path.match(/^\/agents\/([\w-]+)\/extensions$/);
      if (agentExtensions && method === 'POST') return store.setAgentExtensions(agentExtensions[1], input.extensions || [], input.revision);
      if (path === '/agents/import' && method === 'POST') {
        const agent = input.document?.agent;
        if (!effective.allowCustomAgents) throw Error('当前产品不支持导入自定义助手');
        if (effective.allowedTools && Array.isArray(agent?.tools) && agent.tools.some(name => !effective.allowedTools.includes(name))) throw Error('所选工具被产品策略禁止，不能通过设置或导入解除限制');
        if (agent) agent.skills = await skills.validateBindings(agent.skills);
        return store.importAgent(input.document, input);
      }
      const exportedAgent = path.match(/^\/agents\/([\w-]+)\/export$/);
      if (exportedAgent && method === 'GET') return store.exportAgent(exportedAgent[1]);
      // 决议 10（Agent 侧）：版本管理路由——发布 / 历史 / 回滚 / 草稿 Skill 升级，均与 Skill 版本语义同构。
      const agentVersions = path.match(/^\/agents\/([\w-]+)\/versions$/);
      if (agentVersions && method === 'GET') return { items: store.listAgentVersions(agentVersions[1]) };
      const agentPublish = path.match(/^\/agents\/([\w-]+)\/publish$/);
      if (agentPublish && method === 'POST') {
        // 决议 11/12：发布时冻结 Skill 快照；已停用 Skill 阻断发布并点名。
        return store.publishAgent(agentPublish[1], input.version, { note: input.note, resolveSkill: bindings => skills.validateBindings(bindings) }, input.revision);
      }
      const agentDiscard = path.match(/^\/agents\/([\w-]+)\/discard-draft$/);
      if (agentDiscard && method === 'POST') return store.rollbackAgent(agentDiscard[1], 'latest', input.revision);
      const agentRollback = path.match(/^\/agents\/([\w-]+)\/rollback$/);
      if (agentRollback && method === 'POST') return store.rollbackAgent(agentRollback[1], input.fromVersion, input.revision);
      const agentUpgradeSkill = path.match(/^\/agents\/([\w-]+)\/upgrade-skill$/);
      if (agentUpgradeSkill && method === 'POST') {
        // 决议 11（Agent 侧）：草稿绑定可升级到 Skill 最新版；只改草稿，须重走发布才生效。
        return store.upgradeDraftSkillBinding(agentUpgradeSkill[1], input.skillId, input.revision, { resolveLatest: bindings => skills.bindingUpgrades(bindings) });
      }
      // 决议 27："默认 Agent"指针——console 沙箱默认选中、"设为默认"入口使用。
      if (path === '/agents/default' && method === 'GET') return { agent: store.getDefaultAgent() };
      if (path === '/agents/default' && method === 'POST') return store.setDefaultAgent(input.id, input.revision);
      const item = path.match(/^\/(connections|agents)\/([\w-]+)$/);
      if (item && method === 'DELETE') return item[1] === 'connections' ? store.deleteConnection(item[2], input.revision, { successorId: input.successorId }) : store.deleteAgent(item[2], input.revision);
      const libraryDelete = path.match(/^\/libraries\/([\w-]+)$/);
      if (libraryDelete && method === 'DELETE') {
        // 删除保护覆盖草稿 + 全部已发布快照：已发布版本不可变，引用悬空会直接破坏线上运行。
        const inUse = store.snapshot().agents.some(a => agentAllConfigs(a).some(c => (c.knowledge || []).includes(libraryDelete[1])));
        if (inUse) throw Error('知识库已绑定 Agent，请先解除绑定');
        return knowledge.delete(libraryDelete[1]);
      }
      if (path === '/tools' && method === 'GET') return { items: tools.listCapabilities() };
      if (path === '/tools' && method === 'POST') {
        const definition = normalizeHttpTool(input.tool);
        if (store.snapshot().revision !== input.revision) throw Error('配置已变化，请重新加载');
        if (tools.listCapabilities().some(tool => tool.name === definition.name)) throw Error('工具标识已存在');
        tools.register(executableHttpTool(definition));
        try { return await store.saveCustomTool(definition, input.revision); }
        catch (error) { tools.unregister(definition.name); throw error; }
      }
      // 决议 32：调用记录以 Run 日志为准；Tool 侧只做摘要 + 跳转 Run
      const toolUsage = path.match(/^\/tools\/([\w.-]+)\/usage$/);
      if (toolUsage && method === 'GET') {
        const invocations=runs.db.prepare(`SELECT t.*,r.agent_id,r.started_at AS run_started_at,r.status AS run_status FROM tool_invocations t
          JOIN runs r ON r.run_id=t.run_id WHERE t.tool=? AND r.owner=? ORDER BY t.started_at DESC LIMIT 100`)
          .all(toolUsage[1],owner);
        if(invocations.length) {
          const used=new Map();for(const row of invocations)if(!used.has(row.run_id))used.set(row.run_id,{runId:row.run_id,agentId:row.agent_id,startedAt:row.run_started_at,status:row.run_status});
          return {tool:toolUsage[1],count:runs.db.prepare('SELECT COUNT(*) n FROM tool_invocations t JOIN runs r ON r.run_id=t.run_id WHERE t.tool=? AND r.owner=?').get(toolUsage[1],owner).n,
            runs:[...used.values()].slice(0,20),invocations};
        }
        const items = runs.history(owner, 100);
        const used = [];
        for (const h of items) {
          let hit = false;
          try {
            for (const e of runs.events(h.runId)) {
              if (e.payload && (((e.type === 'tool_completed' || e.type === 'tool_started') && e.payload.name === toolUsage[1])
                || (e.type === 'skill_tool_result' && e.payload.tool === toolUsage[1]))) { hit = true; break; }
            }
          } catch { /* 跳过损坏的运行记录 */ }
          if (hit) used.push({ runId: h.runId, agentId: h.agentId, startedAt: h.startedAt, status: h.status });
          if (used.length >= 20) break;
        }
        return { tool: toolUsage[1], count: used.length, runs: used };
      }
      const toolItem = path.match(/^\/tools\/([\w.-]+)(\/config|\/test)?$/);
      if (toolItem) {
        const [, name, action] = toolItem;
        if (method === 'GET' && !action) {
          const definition = tools.listCapabilities().find(t => t.name === name);
          if (!definition) throw Error('Tool not found');
          const secretFields = definition.secretFields || [];
          return { definition, config: store.toolPublicConfig(name), secretFields, secretsConfigured: store.toolSecretsConfigured(name, secretFields) };
        }
        // 决议 28：启用/停用统一在 Tool 侧（含 MCP 同步来的工具）
        if (method === 'PATCH' && !action) {
          const definition = tools.listCapabilities().find(t => t.name === name);
          if (!definition) throw Error('Tool not found');
          if (input.tool) {
            const existing = store.customTools().find(tool => tool.name === name);
            if (!existing) throw Error('只有自建 HTTP 工具可编辑');
            if (store.snapshot().revision !== input.revision) throw Error('配置已变化，请重新加载');
            const next = normalizeHttpTool({ ...input.tool, name });
            tools.replace(executableHttpTool(next));
            try { return await store.saveCustomTool(next, input.revision); }
            catch (error) { tools.replace(executableHttpTool(existing)); throw error; }
          }
          const enabled = !!input.enabled;
          if (definition.source === 'mcp') await mcp.setToolEnabled(name, enabled);
          if (store.customTools().some(tool => tool.name === name)) {
            const current = store.customTools().find(tool => tool.name === name);
            await store.saveCustomTool({ ...current, enabled }, input.revision);
          }
          const tool = tools.setEnabled(name, enabled);
          return { ok: true, name, enabled, tool };
        }
        if (method === 'PUT' && action === '/config') {
          const definition = tools.listCapabilities().find(t => t.name === name);
          if (!definition) throw Error('Tool not found');
          const secretFields = definition.secretFields || [];
          const incoming = input.config ?? null;
          let merged = null;
          if (incoming !== null) {
            merged = { ...incoming };
            const existing = store.toolConfig(name, secretFields) || {};
            for (const field of secretFields) {
              const value = merged[field];
              // 空密钥输入表示保留已有值；clearSecrets 或从未配置则删掉该字段再校验
              if (value === '' || value === undefined) {
                if (!input.clearSecrets && existing[field] !== undefined) merged[field] = existing[field];
                else delete merged[field];
              }
            }
            if (input.clearSecrets) for (const field of secretFields) delete merged[field];
          }
          tools.validateToolConfig(name, merged);
          return store.saveToolConfig(name, merged, input.revision, secretFields, { clearSecrets: !!input.clearSecrets || merged === null });
        }
        if (method === 'POST' && action === '/test') return { result: await testTool(name, input.input, owner) };
      }
      if (path === '/skills' && method === 'GET') return { items: await skills.list() };
      if (path === '/skills' && method === 'POST') return skills.install(input.source);
      if (path === '/skills/upload' && method === 'POST') {
        const f = input.__file;
        if (!f || !f.filename || !f.dataBase64) throw new Error('未收到上传文件');
        return skills.upload(Buffer.from(f.dataBase64, 'base64'), f.filename);
      }
      const skill = path.match(/^\/skills\/([a-z0-9_-]+)$/);
      const skillTest = path.match(/^\/skills\/([a-z0-9_-]+)\/test$/);
      if (skillTest && method === 'POST') {
        const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
        if (!instruction) throw Error('请输入 Skill 测试指令');
        const item = await skills.entry(skillTest[1]);
        const skillVersion = item.debugTarget === 'live' ? 'latest' : 'draft';
        const output = await defaultSkillRunner({ skillId: skillTest[1], skillVersion, instruction, event: { schedule_id: `skill-debug-${skillTest[1]}`, event_id: randomUUID(), scheduled_at: new Date().toISOString() } });
        return { ok: true, output };
      }
      if (skill && method === 'PATCH') {
        if (input.meta) return skills.updateMeta(skill[1], input.meta);
        if (input.debugTarget) return skills.setDebugTarget(skill[1], input.debugTarget);
        return skills.enable(skill[1], input.enabled);
      }
      if (skill && method === 'DELETE') {
        // 删除保护覆盖草稿 + 全部已发布快照（快照 pin 住版本号，卸载会破坏线上运行）。
        const bound = store.snapshot().agents.some(a => agentAllConfigs(a).some(c => (c.skills || []).some(s => (typeof s === 'string' ? s : s.id) === skill[1])));
        if (bound) throw Error('技能已绑定 Agent，请先解除绑定');
        return skills.uninstall(skill[1]);
      }
      if (path === '/skills/upgrades' && method === 'POST') return { items: await skills.bindingUpgrades(input.bindings) };
      const skillExport = path.match(/^\/skills\/([a-z0-9_-]+)\/export$/);
      if (skillExport && method === 'GET') return skills.exportPackage(skillExport[1], { version: query.version || 'draft' });
      const skillVersions = path.match(/^\/skills\/([a-z0-9_-]+)\/versions$/);
      if (skillVersions && method === 'GET') return { versions: await skills.listVersions(skillVersions[1]) };
      const skillPublish = path.match(/^\/skills\/([a-z0-9_-]+)\/publish$/);
      if (skillPublish && method === 'POST') return skills.publish(skillPublish[1], input.version, { note: input.note });
      const skillRollback = path.match(/^\/skills\/([a-z0-9_-]+)\/rollback$/);
      if (skillRollback && method === 'POST') return skills.rollback(skillRollback[1], input.fromVersion);
      const skillCreate = path === '/skills/draft' && method === 'POST';
      if (skillCreate) return skills.createDraft(input.id, { description: input.description });
      const skillFiles = path.match(/^\/skills\/([a-z0-9_-]+)\/files$/);
      if (skillFiles && method === 'GET') return { files: await skills.listFiles(skillFiles[1]) };
      const skillFolders = path.match(/^\/skills\/([a-z0-9_-]+)\/folders$/);
      if (skillFolders && method === 'POST') return skills.createFolder(skillFolders[1], input.path);
      const skillFile = path.match(/^\/skills\/([a-z0-9_-]+)\/files\/(.+)$/);
      if (skillFile && method === 'GET') return skills.readSkillFile(skillFile[1], decodeURIComponent(skillFile[2]));
      if (skillFile && method === 'PUT') return skills.saveSkillFile(skillFile[1], decodeURIComponent(skillFile[2]), input.content);
      if (skillFile && method === 'DELETE') return skills.deleteSkillFile(skillFile[1], decodeURIComponent(skillFile[2]));
      if (path === '/sessions' && method === 'GET') return { items: runs.sessions(owner) };
      if (path === '/chat/attachments/image' && method === 'POST') {
        const mimeType = String(input.mimeType || '').toLowerCase();
        const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
        const filename = String(input.filename || 'image').split(/[\\/]/).pop().slice(0, 180);
        const encoded = String(input.contentBase64 || '').replace(/^data:[^,]+,/, '');
        if (!allowedMimeTypes.has(mimeType)) throw Error('仅支持 PNG、JPEG、GIF、WebP 图片');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error('图片数据格式无效');
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Error('图片大小需在 1 B–5 MB 之间');
        const attachmentId = randomUUID();
        await mkdir(chatAttachmentDirectory, { recursive: true, mode: 0o700 });
        await writeFile(join(chatAttachmentDirectory, `${attachmentId}.img`), bytes, { flag: 'wx', mode: 0o600 });
        return { attachmentId, name: filename || 'image', mimeType, size: bytes.length, kind: 'image' };
      }
      if (path === '/chat/attachments/extract' && method === 'POST') {
        const result = await extractKnowledgeDocument({ title: input.filename, contentBase64: input.contentBase64 });
        return { name: result.title || input.filename, text: String(result.content || '').slice(0, 40_000), truncated: String(result.content || '').length > 40_000 };
      }
      const session = path.match(/^\/sessions\/([\w-]+)$/);
      if (session && method === 'GET') return runs.session(session[1], owner);
      if (session && method === 'PATCH') return runs.renameSession(session[1], owner, input.title);
      if (session && method === 'DELETE') return runs.deleteSession(session[1], owner);
      if (path === '/runs' && method === 'GET') {
        reconcileRunningRuns({db:runs.db,includeHosted:false});
        if(query.page||query.pageSize||query.source||query.paged==='1')return runs.historyPage(owner,{...query,owners:owner==='local'?['local','scheduler',...initializedExtensions.flatMap(extension=>extension?.runOwners || [])]:[owner]});
        return {items:runs.history(owner)};
      }
      if (path === '/runs' && method === 'POST') {
        // 兼容控制台沙箱的 version 参数名（draft / vX.Y / latest）。
        if (input.agentVersion === undefined && input.version !== undefined) input.agentVersion = input.version;
        const auditMessages = structuredClone(input.messages || []);
        const messages = [];
        for (const message of input.messages || []) {
          if (!Array.isArray(message.content)) { messages.push(message); continue; }
          const content = [];
          for (const part of message.content) {
            if (part?.type === 'image_ref') {
              if (!/^[\da-f-]{36}$/i.test(part.attachmentId || '')) throw Error('图片附件引用无效');
              const mimeType = String(part.mimeType || '').toLowerCase();
              if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) throw Error('图片类型无效');
              const bytes = await readFile(join(chatAttachmentDirectory, `${part.attachmentId}.img`));
              if (bytes.length > 5 * 1024 * 1024) throw Error('图片附件超过大小限制');
              content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}` } });
            } else if (part?.type === 'document_ref') {
              content.push({ type: 'text', text: `[附件：${String(part.name || '文档').slice(0, 180)}]\n${String(part.content || '').slice(0, 40_000)}` });
            } else if (part?.type === 'text' && typeof part.text === 'string') content.push(part);
          }
          messages.push({ ...message, content });
        }
        const runInput = { ...input, messages, auditMessages };
        // Product hosts submit a Run request only. Agent selection remains inside
        // Agent Platform and follows its own default-agent setting.
        if (!runInput.agentId && productId === 'sunnypet') {
          const selected = store.getDefaultAgent() || store.snapshot().agents.find(agent => agent.name === '小芽');
          if (!selected) throw Error('底座尚未配置默认 Agent，请先在底座设置中选择。');
          runInput.agentId = selected.id;
        }
        if (input.productSessionId !== undefined) {
          // External session IDs are namespaced by this product instance, owner and Agent.
          // Products never choose or write platform session IDs directly.
          store.resolveAgent(runInput.agentId, runInput.agentVersion || 'latest');
          runInput.sessionId = runs.resolveProductSession({
            productId, externalId: input.productSessionId, agentId: runInput.agentId, owner
          });
        }
        const requestId = input.requestId;
        let handle;
        if (requestId !== undefined) {
          if (typeof requestId !== 'string' || !/^[\w-]{1,200}$/.test(requestId)) throw Error('requestId 必须是 1–200 个字母、数字、下划线或连字符');
          const agentId = runInput.agentId;
          const fingerprint = createHash('sha256').update(JSON.stringify({
            agentId, agentVersion: runInput.agentVersion || 'latest', sessionId: runInput.sessionId || null,
            messages, source: runInput.source || 'api', executionMode: runInput.executionMode || null,
            context: runInput.context || null, questionPreparation: runInput.questionPreparation ?? null
          })).digest('hex');
          runs.db.exec('SAVEPOINT idempotent_run');
          try {
            const existing = runs.db.prepare('SELECT fingerprint,run_id FROM run_requests WHERE product_id=? AND owner=? AND request_id=?').get(requestProductId, owner, requestId);
            if (existing) {
              if (existing.fingerprint !== fingerprint) { const error = Error('requestId 已用于不同的运行请求'); error.code = 'request_conflict'; throw error; }
              const row = runs.db.prepare('SELECT session_id FROM runs WHERE run_id=?').get(existing.run_id);
              runs.db.exec('RELEASE idempotent_run');
              return { runId: existing.run_id, sessionId: row?.session_id || null, replayed: true };
            }
            handle = runs.run(runInput, { owner, onEvent });
            runs.db.prepare('INSERT INTO run_requests(product_id,owner,request_id,fingerprint,run_id,created_at) VALUES(?,?,?,?,?,?)')
              .run(requestProductId, owner, requestId, fingerprint, handle.runId, new Date().toISOString());
            runs.db.exec('RELEASE idempotent_run');
          } catch (error) { runs.db.exec('ROLLBACK TO idempotent_run; RELEASE idempotent_run'); throw error; }
        } else handle = runs.run(runInput, { owner, onEvent });
        active.set(handle.runId, handle);
        handle.result.then(() => active.delete(handle.runId), () => active.delete(handle.runId));
        return { runId: handle.runId, sessionId: handle.sessionId };
      }
      const requestRun = path.match(/^\/run-requests\/([\w-]+)$/);
      if (requestRun && method === 'GET') {
        const saved = runs.db.prepare('SELECT rr.run_id AS runId,r.session_id AS sessionId FROM run_requests rr JOIN runs r ON r.run_id=rr.run_id WHERE rr.product_id=? AND rr.owner=? AND rr.request_id=?')
          .get(requestProductId, owner, requestRun[1]);
        if (!saved) return undefined;
        const runStatus = runs.db.prepare('SELECT status FROM runs WHERE run_id=?').get(saved.runId)?.status;
        return { ...saved, events: runs.events(saved.runId), running: active.has(saved.runId), status: runStatus,
          pendingConfirmationIds: runs.pendingConfirmationIds(saved.runId, owner) };
      }
      const runExport = path.match(/^\/runs\/([\w-]+)\/export$/);
      if (runExport && method === 'GET') {
        if (!runs.authorize(runExport[1], owner)) throw Error('Run is not authorized');
        return { runId: runExport[1], exportedAt: new Date().toISOString(), events: runs.events(runExport[1]), lateEvents: runs.lateEvents(runExport[1]) };
      }
      const runConfirmation = path.match(/^\/runs\/([\w-]+)\/confirm$/);
      if (runConfirmation && method === 'POST') {
        if (!runs.authorize(runConfirmation[1], owner)) throw Error('Run is not authorized');
        return runs.confirmToolRequest({ runId: runConfirmation[1], confirmationId: input.confirmationId, owner, approved: input.approved, decision: input.decision });
      }
      const clarification = path.match(/^\/runs\/([\w-]+)\/clarifications$/);
      if (clarification && method === 'POST') {
        const handle = trackRun(runs.respondToClarification(clarification[1], input.answers, {owner,onEvent}));
        return {runId:handle.runId,sessionId:handle.sessionId};
      }
      const recoveryRoute=path.match(/^\/runs\/([\w-]+)\/(recovery|continue)$/);
      if(recoveryRoute){
        if(!runs.authorize(recoveryRoute[1],owner))throw Error('Run is not authorized');
        if(method==='GET'&&recoveryRoute[2]==='recovery')return runs.recovery(recoveryRoute[1],owner);
        if(method==='POST'&&recoveryRoute[2]==='continue'){
          const handle=trackRun(runs.continueRun(recoveryRoute[1],{owner}));
          return {runId:handle.runId,sessionId:handle.sessionId,parentRunId:recoveryRoute[1]};
        }
      }
      const run = path.match(/^\/runs\/([\w-]+)(\/cancel)?$/);
      if (run) {
        const runOwner=runs.db.prepare('SELECT owner FROM runs WHERE run_id=?').get(run[1])?.owner;
        if (!runs.authorize(run[1], owner) && !(owner==='local'&&['scheduler',...initializedExtensions.flatMap(extension=>extension?.runOwners || [])].includes(runOwner))) throw Error('Run is not authorized');
        if (method === 'GET' && !run[2]) return { ...runs.getRun(run[1],runOwner), events: runs.events(run[1]), running: active.has(run[1]), pendingConfirmationIds: runs.pendingConfirmationIds(run[1], runOwner),
          toolInvocations:runs.db.prepare('SELECT * FROM tool_invocations WHERE run_id=? ORDER BY started_at').all(run[1]) };
        if (method === 'POST' && run[2]) { active.get(run[1])?.cancel(); return { ok: true }; }
      }
      if (path === '/tasks' && method === 'GET') {
        const items = [];
        for (const schedule of await scheduler.list()) {
          const task = scheduleToUiTask(schedule);
          if (task) items.push(task);
        }
        return { items };
      }
      if (path === '/tasks' && method === 'POST') {
        const created = await scheduler.create(uiTaskToSchedule(input.task ?? input));
        return scheduleToUiTask(created);
      }
      const taskRun = path.match(/^\/tasks\/([\w-]+)\/run$/);
      if (taskRun && method === 'POST') {
        const existing = await scheduler.get(taskRun[1]);
        const task = existing && scheduleToUiTask(existing);
        if (!task) throw Error('定时任务不存在');
        const state = taskTargetState(existing);
        if (state === 'incomplete') throw Error('请先在「执行对象」页签选择 Agent 或 Skill，并填写执行指令');
        const override = typeof input.instruction === 'string' ? input.instruction.trim() : '';
        const useTemp = (override && override !== (existing.execution?.instruction ?? '')) || !existing.enabled;
        const runId = useTemp ? `${existing.id}__manual_${Date.now()}` : existing.id;
        if (useTemp) {
          await scheduler.remove(runId).catch(() => {});
          await scheduler.create({
            id: runId, product_id: existing.product_id, name: `${existing.name || existing.id}（手动测试）`,
            description: existing.description, enabled: true,
            trigger: { type: 'once', at: new Date().toISOString() },
            target: structuredClone(existing.target),
            execution: { instruction: override || existing.execution?.instruction || '' },
            policy: structuredClone(existing.policy),
            ui: structuredClone(existing.ui)
          });
        }
        markTaskManualRun(runId, existing.id);
        try {
          const outcome = await scheduler.triggerNow(runId);
          return { ok: outcome.status === 'completed', status: outcome.status, result: outcome.result, error: outcome.error };
        } finally {
          if (useTemp) await scheduler.remove(runId).catch(() => {});
        }
      }
      const taskRuns = path.match(/^\/tasks\/([\w-]+)\/runs$/);
      if (taskRuns && method === 'GET') {
        const existing = await scheduler.get(taskRuns[1]);
        if (!existing || !scheduleToUiTask(existing)) throw Error('定时任务不存在');
        const id = taskRuns[1];
        const scheduleAudits=readScheduleAudits();
        const starts = new Map();
        const items = [];
        for (const e of scheduleAudits) {
          if (e.schedule_id !== id && !String(e.schedule_id).startsWith(id + '__manual')) continue;
          if (e.type === 'schedule_started' && e.event_id) starts.set(e.event_id, e);
          else if ((e.type === 'schedule_completed' || e.type === 'schedule_failed') && e.event_id && starts.has(e.event_id)) {
            const started = starts.get(e.event_id);
            starts.delete(e.event_id);
            const manual = scheduleAudits.some(m => m.type==='task_manual_trigger' && m.schedule_id===started.schedule_id);
            const runId = scheduleAudits.find(item => item.type === 'schedule_run_link' && item.event_id === started.event_id)?.run_id;
            const outcome = taskRunOutcome(runId);
            items.push({
              at: started.at,
              trigger: manual ? 'manual' : 'scheduled',
              status: e.type === 'schedule_completed' ? 'success' : 'failed',
              durationMs: Math.max(0, new Date(e.at).getTime() - new Date(started.at).getTime()),
              eventId: started.event_id,
              runId,
              output: outcome.output,
              error: outcome.error,
              runEvents: runId ? runs.events(runId) : [],
              trace: scheduleAudits.filter(item => item.event_id === started.event_id && !['schedule_started','schedule_completed','schedule_failed','schedule_run_link'].includes(item.type)).map(item => ({ type: item.type, at: item.at, payload: item }))
            });
          }
        }
        return { items: items.reverse().slice(0, 100) };
      }
      const taskItem = path.match(/^\/tasks\/([\w-]+)$/);
      if (taskItem) {
        const existing = await scheduler.get(taskItem[1]);
        if (!existing || !scheduleToUiTask(existing)) throw Error('定时任务不存在');
        if (method === 'GET') return scheduleToUiTask(existing);
        if (method === 'PATCH') {
          const patch = input.task ?? input;
          const current = scheduleToUiTask(existing);
          // UI 补丁可能是局部（{enabled}）或整包；schedule/failure 按整包语义合并
          const merged = { ...current, ...patch };
          if (patch.schedule) merged.schedule = patch.schedule;
          if (patch.failure) merged.failure = patch.failure;
          if (patch.target !== undefined) merged.target = patch.target;
          if (patch.taskTarget !== undefined) { merged.target = patch.taskTarget; }
          merged.id = existing.id;
          const updated = await scheduler.update(existing.id, uiTaskToSchedule(merged, existing));
          return scheduleToUiTask(updated);
        }
        if (method === 'DELETE') {
          await scheduler.remove(taskItem[1]);
          return { ok: true };
        }
      }
      // 定时任务（决议 v18 §九）：列表 / 新建 / 详情 / 更新 / 删除 / 手动触发 /
      // 调度预览 / Cron 校验 / 时区列表 / 调度事件
      if (path === '/schedules/meta/timezones' && method === 'GET') return { items: listTimezones() };
      if (path === '/schedules/validate-cron' && method === 'POST') {
        const expression = validateCronExpression(input.expression, input.timezone ?? 'UTC');
        const timezone = input.timezone ?? 'UTC';
        return { ok: true, expression, timezone, next: nextOccurrences({ type: 'cron', expression, timezone }, new Date(), 3) };
      }
      if (path === '/schedules/preview' && method === 'POST') {
        const draft = validateSchedule({ product_id: productId, ...(input.schedule ?? input) });
        const names = await scheduleTargetNames();
        return previewSchedule(draft, { targetName: scheduleTargetName(draft.target, names) });
      }
   if (path === '/schedules/events' && method === 'GET') {
       // P4：runs + schedule_audit_events 合并返回，重启可查。
        const limit = Math.min(Math.max(parseInt(query.limit || '100', 10) || 100, 1), 200);
        const items = [];
        const runSql = "SELECT run_id, schedule_id, agent_id, status, started_at, finished_at, error FROM runs WHERE source='schedule'"
          + (query.schedule_id ? ' AND schedule_id=?' : '')
          + ' ORDER BY started_at DESC LIMIT ?';
        for (const row of runs.db.prepare(runSql).all(...(query.schedule_id ? [query.schedule_id, limit] : [limit]))) {
          items.push({
            run_id: row.run_id, schedule_id: row.schedule_id, agent_id: row.agent_id,
            status: row.status, started_at: row.started_at, finished_at: row.finished_at, error: row.error,
            type: row.status === 'run_failed' ? 'schedule_failed'
                 : row.status === 'run_completed' ? 'schedule_completed'
                 : row.status === 'interrupted' ? 'schedule_interrupted'
                 : 'schedule_started',
            at: row.started_at
          });
        }
        const auditSql = 'SELECT event_id, schedule_id, run_id, type, payload, recorded_at FROM schedule_audit_events'
          + (query.schedule_id ? ' WHERE schedule_id=?' : '')
          + ' ORDER BY recorded_at DESC LIMIT ?';
        for (const row of runs.db.prepare(auditSql).all(...(query.schedule_id ? [query.schedule_id, limit] : [limit]))) {
          let payload = null;
          try { payload = row.payload ? JSON.parse(row.payload) : null; } catch { /* malformed */ }
          items.push({...payload,event_id:payload?.event_id??row.event_id,schedule_id:row.schedule_id,run_id:row.run_id,
            type:row.type,payload,at:row.recorded_at});
        }
        items.sort((a, b) => String(b.at || b.started_at || '').localeCompare(String(a.at || a.started_at || '')));
        return { items: items.slice(0, limit) };
      }
      if (path === '/schedules' && method === 'GET') {
        const names = await scheduleTargetNames();
        const items = [];
        for (const schedule of await scheduler.list()) {
          const targetName = scheduleTargetName(schedule.target, names);
          items.push({ ...publicSchedule(schedule, targetName), preview: previewSchedule(schedule, { targetName }) });
        }
        return { items };
      }
      if (path === '/schedules' && method === 'POST') {
        const draft = input.schedule ?? input;
        const created = await scheduler.create({ product_id: productId, ...structuredClone(draft) });
        const names = await scheduleTargetNames();
        return publicSchedule(created, scheduleTargetName(created.target, names));
      }
      const scheduleTrigger = path.match(/^\/schedules\/([\w-]+)\/trigger$/);
      if (scheduleTrigger && method === 'POST') return scheduler.triggerNow(scheduleTrigger[1]);
      const scheduleItem = path.match(/^\/schedules\/([\w-]+)$/);
      if (scheduleItem) {
        const existing = await scheduler.get(scheduleItem[1]);
        if (!existing) throw Error('定时任务不存在');
        const names = await scheduleTargetNames();
        if (method === 'GET') return publicSchedule(existing, scheduleTargetName(existing.target, names));
        if (method === 'PATCH') {
          const patch = structuredClone(input.schedule ?? input);
          delete patch.id; delete patch.product_id;
          if (patch.policy !== undefined) patch.policy = mergePolicy(existing.policy, patch.policy);
          const updated = await scheduler.update(scheduleItem[1], patch);
          return publicSchedule(updated, scheduleTargetName(updated.target, names));
        }
        if (method === 'DELETE') {
          await scheduler.remove(scheduleItem[1]);
          return { ok: true };
        }
      }
      return undefined;
    }
  };
  } catch (error) {
    for (const extension of [...initializedExtensions].reverse()) {
      try { await extension?.close?.(); } catch { /* Preserve the startup error while releasing every extension. */ }
    }
    clearInterval(maintenanceTimer);initializedRuns?.close();databaseHandle?.db.close(); await release(); throw error; }
}
