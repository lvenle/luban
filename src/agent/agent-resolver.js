import { readFileSync } from 'node:fs';
import { InstanceStore } from '@xiaoya/agent-platform/settings/instance-store';
import { LUBAN_TOOL_PERMISSIONS } from './runtime-adapter.js';
import { ensurePlatformService, platformInstanceDirectory } from './platform-service.js';

const LUBAN_AGENT_ID = 'luban-app-builder';
const LUBAN_AGENT_NAME = '鲁班应用构建 Agent';
const LUBAN_SYSTEM_PROMPT = readFileSync(
  new URL('../../agents/luban-app-builder/prompts/system.md', import.meta.url), 'utf8'
).trim();

/** Product prompt is seeded once; subsequent user configuration stays intact. */
export async function resolveLubanAgent({ settings = {}, instanceDirectory, store, applicationTools = [] } = {}) {
  if (!store) {
    store = instanceDirectory
      ? await new InstanceStore(instanceDirectory, { productId: 'luban' }).prepare()
      : (await ensurePlatformService()).service.store;
  }
  const applicationInstanceId = 'luban';
  await store.ensureApplicationAssistant({
    id: applicationInstanceId, appType: 'luban', name: '鲁班',
    // This known product-owned ID predates application bindings. Preserve its draft and versions.
    adoptLegacy: store.snapshot().productId === 'luban',
    agent: {
      id: LUBAN_AGENT_ID, name: LUBAN_AGENT_NAME,
      description: '鲁班产品的默认应用构建助手', system: LUBAN_SYSTEM_PROMPT,
      tools: [...LUBAN_TOOL_PERMISSIONS, ...applicationTools], skills: [], knowledge: [],
      maxTurns: 20, timeoutMs: 240000
    }
  });
  if (settings.agentId && settings.agentId !== LUBAN_AGENT_ID) {
    throw Error('鲁班应用入口只能使用本应用助手，请清除旧的 Agent 选择设置');
  }
  const agent = store.getApplicationAssistant(applicationInstanceId, settings.agentVersion || 'draft');
  let connection = null;
  try { connection = store.resolveConnection(agent.connectionId); } catch { /* inspectable before configuration */ }
  return {
    ...agent, source: 'agent-platform', connection, store,
    instanceDirectory: instanceDirectory || store.directory || platformInstanceDirectory()
  };
}

export { LUBAN_AGENT_ID, LUBAN_AGENT_NAME };
