import { applicationRunPolicy } from './application-run-policy.js';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { InstanceStore } from '../settings/instance-store.js';
import { openInstanceDatabase } from '../settings/instance-database.js';
import { acquireInstance } from '../settings/instance-guard.js';
import { slimBase64RunEvents, slimRunOwnersToRunsTable, reconcileRunningRuns, migrateConversationSummaries, applyRunEventRetention } from '../settings/storage-migrations.js';
import { RunService } from '../runtime/run-service.js';
import { ToolRegistry } from '../tools/registry.js';
import { SkillStore } from '../skills/store.js';
import { MemoryStore } from '../memory/store.js';
import { createStandardTools } from '../tools/standard-provider.js';

/** Local host uses the same execution/configuration implementations without an HTTP console. */
export async function createLocalAgentHost({ directory, productId, tools = new ToolRegistry(), allowedTools, providerFactory, toolPolicyFactory, runtimePolicy = applicationRunPolicy, confirmTool, policy = {}, skills: suppliedSkills, knowledgeStore = null, groundKnowledge = null } = {}) {
  if (!directory || !productId) throw Error('Local host requires a directory and product identity');
  const release = await acquireInstance(directory);
  let database, runs;
  const active = new Map();
  let closing = false, closePromise;
  try {
    database = openInstanceDatabase(directory);
    const store = await new InstanceStore(directory, { productId, database: database.db }).prepare();
    store.lockedFields = { agent: policy.lockedAgentFields || [], connection: policy.lockedConnectionFields || [] };
    const skills = suppliedSkills || new SkillStore(directory, { inheritGlobal: false });
    await skills.prepare();
    const memory = new MemoryStore(join(directory, 'memory'), productId);
    await mkdir(memory.root, { recursive: true, mode: 0o700 });
    const names = { get_current_time: 'platform.time.current', memory_read: 'platform.memory.read', memory_update: 'platform.memory.update' };
    for (const tool of createStandardTools({ names, memory, skills, include: Object.keys(names), memoryScopes: ['global'] })) {
      if (!tools.listCapabilities().some(existing => existing.name === tool.name)) tools.register(tool);
    }
    runs = new RunService({ store, tools, skills, runtimePolicy, database: database.db, allowedTools, providerFactory, toolPolicyFactory, confirmTool, groundKnowledge });
    if (knowledgeStore) runs.knowledge = knowledgeStore;
    // Preserve the existing instance and its history when switching between hosts.
    slimBase64RunEvents({ db: database.db, directory });
    slimRunOwnersToRunsTable({ db: database.db });
    reconcileRunningRuns({ db: database.db });
    migrateConversationSummaries({ db: database.db, directory });
    applyRunEventRetention({ db: database.db });
    function trackRun(handle) {
      if (closing) { handle.cancel(); throw Error('Local agent host is closing'); }
      active.set(handle.runId, handle);
      handle.result.finally(() => active.delete(handle.runId)).catch(() => {});
      return handle;
    }
    function startApplicationRun(applicationInstanceId, request, options = {}) {
      if (closing) throw Error('Local agent host is closing');
      const agent = store.getApplicationAssistant(applicationInstanceId, request.agentVersion || 'draft');
      if (request.agentId && request.agentId !== agent.id) throw Error('Assistant does not belong to this application');
      const handle = runs.run({ ...request, agentId: agent.id, agentVersion: agent.version }, options);
      return trackRun(handle);
    }
    const service = {
      store, tools, skills, runs, startApplicationRun, trackRun,
      startApplicationTask(applicationInstanceId, request, options = {}) {
        if (closing) throw Error('Local agent host is closing');
        return trackRun(runs.runApplicationTask(applicationInstanceId, request, options));
      },
      continueRun(runId,options={}){if(closing)throw Error('Local agent host is closing');return trackRun(runs.continueRun(runId,options));},
      isRunActive: id => active.has(id),
      cancelRun:id=>active.get(id)?.cancel(),
      cancelActiveRuns: reason => { for (const handle of active.values()) handle.cancel(reason); },
      ...(knowledgeStore ? { knowledge: knowledgeStore } : {}),
      async handle(method, path) {
        if (closing) throw Error('Local agent host is closing');
        if (method === 'GET' && path === '/instance') return { ...store.snapshot(), capabilities: { customAgents: false, console: false } };
        if (method === 'POST' && (path === '/agents' || path === '/agents/import')) throw Error('当前产品不支持创建或导入自定义助手');
        throw Error('Local host does not expose this management operation');
      }
    };
    const host = {
      kind: 'local', url: null, service,
      close() {
        return closePromise ||= (async () => {
          closing = true;
          for (const handle of active.values()) handle.cancel();
          await Promise.allSettled([...active.values()].map(handle => handle.result));
          try { runs.close(); database.db.close(); } finally { await release(); }
        })();
      }
    };
    service.close = () => host.close();
    return host;
  } catch (error) {
    try { runs?.close(); database?.db.close(); } finally { await release(); }
    throw error;
  }
}
