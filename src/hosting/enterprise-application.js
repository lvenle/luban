import { initDb, closeDb } from '../storage/db.js';
import { createAppServer } from '../server.js';
import { ensurePlatformService, closePlatformService } from '../agent/platform-service.js';
import { resolveLubanAgent } from '../agent/agent-resolver.js';
import { startScheduledTaskRunner, stopScheduledTaskRunner } from '../services/scheduled-task-runner.js';
let active = false;

/** One Luban application database per process; composite deployments retain product-owned storage. */
export async function createEnterpriseLubanApplication({ publicBasePath = '/luban/', workbenchNavigation = null, searchKnowledge = null, startBackgroundServices = true, runtimeOptions = {} } = {}) {
  if (active) throw Error('当前进程已经挂载鲁班；多个鲁班实例请使用独立进程');
  active = true;
  let runtime, closed = false;
  try {
    await initDb();
    runtime = await ensurePlatformService({ ...runtimeOptions, edition: 'enterprise', listen: false, publicBasePath: publicBasePath + 'admin/', startBackgroundServices, searchKnowledge });
    runtime.consoleUrl = publicBasePath + 'admin/models/basic';
    await resolveLubanAgent({ store: runtime.service.store, applicationTools: searchKnowledge ? ['platform.knowledge.search'] : [] });
    if (startBackgroundServices) startScheduledTaskRunner();
    const server = createAppServer({ publicBasePath, workbenchNavigation, adminRuntime: runtime });
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
