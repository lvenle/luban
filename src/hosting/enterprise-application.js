import { initializePlans } from '../enterprise/plans.js';
import { initializeProjects } from '../enterprise/projects.js';
import { initDb, closeDb } from '../storage/db.js';
import { createAppServer } from '../server.js';
import { ensurePlatformService, closePlatformService } from '../agent/platform-service.js';
import { resolveLubanAgent, resolveLubanBusinessAgent } from '../agent/agent-resolver.js';
import { startScheduledTaskRunner, stopScheduledTaskRunner } from '../services/scheduled-task-runner.js';
let active = false;

/** One Luban application database per process; composite deployments retain product-owned storage. */
export async function createEnterpriseLubanApplication({ publicBasePath = '/luban/', workbenchNavigation = null, searchKnowledge = null, startBackgroundServices = true, modelSource = null, runtimeOptions = {} } = {}) {
  if (active) throw Error('当前进程已经挂载鲁班；多个鲁班实例请使用独立进程');
  active = true;
  let runtime, closed = false;
  try {
    await initDb();
    initializeProjects();
    initializePlans();
    runtime = await ensurePlatformService({ ...runtimeOptions, modelSource, edition: 'enterprise', listen: false, publicBasePath: publicBasePath + 'admin/', startBackgroundServices, searchKnowledge });
    runtime.consoleUrl = modelSource?'/platform/models/basic':publicBasePath + 'admin/models/basic';
    await resolveLubanAgent({ store: runtime.service.store, applicationTools: searchKnowledge ? ['platform.knowledge.search'] : [] });
    await resolveLubanBusinessAgent({store:runtime.service.store});
    if (startBackgroundServices) startScheduledTaskRunner();
    const server = createAppServer({ publicBasePath, workbenchNavigation, adminRuntime: runtime, enterprise:true });
    return { server, runtime, async close() {
      if (closed) return;closed=true;
      stopScheduledTaskRunner();
      try { await closePlatformService(); } finally { await closeDb();active=false; }
    } };
  } catch(error) {
    stopScheduledTaskRunner();
    try { await closePlatformService(); } finally { await closeDb();active=false; }
    throw error;
  }
}
