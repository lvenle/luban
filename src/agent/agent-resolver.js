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
export async function resolveLubanAgent({ settings = {}, instanceDirectory, store } = {}) {
  if (!store) {
    store = instanceDirectory
      ? await new InstanceStore(instanceDirectory, { productId: 'luban' }).prepare()
      : (await ensurePlatformService()).service.store;
  }
  let snapshot = store.snapshot();
  let fallback = snapshot.agents.find(item => item.id === LUBAN_AGENT_ID);
  if (!fallback) {
    await store.saveAgent({
      id: LUBAN_AGENT_ID, name: LUBAN_AGENT_NAME,
      description: '鲁班产品的默认应用构建 Agent', system: LUBAN_SYSTEM_PROMPT,
      tools: [...LUBAN_TOOL_PERMISSIONS], skills: [], knowledge: [],
      maxTurns: 20, timeoutMs: 240000
    }, snapshot.revision);
    snapshot = store.snapshot();
    fallback = snapshot.agents.find(item => item.id === LUBAN_AGENT_ID);
    if (!snapshot.defaultAgentId || snapshot.defaultAgentId === 'assistant') {
      await store.setDefaultAgent(LUBAN_AGENT_ID, snapshot.revision);
      snapshot = store.snapshot();
    }
  }
  const selectedId = settings.agentId || snapshot.defaultAgentId || LUBAN_AGENT_ID;
  const selected = snapshot.agents.find(item => item.id === selectedId) || fallback;
  const version = settings.agentVersion || 'draft';
  const agent = store.resolveAgent(selected.id, version);
  let connection = null;
  try { connection = store.resolveConnection(agent.connectionId); } catch { /* inspectable before configuration */ }
  return {
    ...agent, source: 'agent-platform', connection, store,
    instanceDirectory: instanceDirectory || store.directory || platformInstanceDirectory()
  };
}

export { LUBAN_AGENT_ID, LUBAN_AGENT_NAME };
