import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { InstanceStore } from '@xiaoya/agent-platform/settings/instance-store';

const LUBAN_AGENT_ID = 'luban-app-builder';
const LUBAN_AGENT_NAME = '鲁班应用构建 Agent';
const LUBAN_SYSTEM_PROMPT = readFileSync(
  new URL('../../agents/luban-app-builder/prompts/system.md', import.meta.url),
  'utf8'
).trim();

function defaultInstanceDirectory() {
  return process.env.AGENT_PLATFORM_INSTANCE_DIR
    ? resolve(process.env.AGENT_PLATFORM_INSTANCE_DIR)
    : resolve(process.cwd(), '../agent-platform/.agent-instance');
}

/**
 * Resolve the Agent owned by the shared platform. The product only adds its
 * tools at runtime; identity and prompt remain platform-owned.
 */
export async function resolveLubanAgent({ settings = {}, instanceDirectory = defaultInstanceDirectory() } = {}) {
  const store = await new InstanceStore(instanceDirectory, {
    productId: 'agent-platform',
    allowForeignProduct: true
  }).prepare();
  const snapshot = store.snapshot();
  const requestedId = settings.agentId || snapshot.defaultAgentId;
  let agent = requestedId ? snapshot.agents.find(item => item.id === requestedId) : null;

  if (!agent) {
    const existing = snapshot.agents.find(item => item.id === LUBAN_AGENT_ID);
    if (existing) agent = existing;
  }

  if (!agent) {
    await store.saveAgent({
      id: LUBAN_AGENT_ID,
      name: LUBAN_AGENT_NAME,
      description: '鲁班产品的默认应用构建 Agent',
      system: LUBAN_SYSTEM_PROMPT,
      tools: [],
      skills: [],
      knowledge: [],
      maxTurns: 20,
      timeoutMs: 240000
    }, snapshot.revision);
    agent = store.snapshot().agents.find(item => item.id === LUBAN_AGENT_ID);
  } else if (agent.id === LUBAN_AGENT_ID && agent.draft?.system !== LUBAN_SYSTEM_PROMPT) {
    await store.saveAgent({
      id: LUBAN_AGENT_ID,
      name: agent.name || LUBAN_AGENT_NAME,
      description: agent.description || '鲁班产品的默认应用构建 Agent',
      ...agent.draft,
      system: LUBAN_SYSTEM_PROMPT
    }, snapshot.revision);
    agent = store.snapshot().agents.find(item => item.id === LUBAN_AGENT_ID);
  }

  const config = agent?.draft || {};
  const baseSystem = config.system || '';
  const system = baseSystem.includes(LUBAN_SYSTEM_PROMPT)
    ? baseSystem
    : [baseSystem, LUBAN_SYSTEM_PROMPT].filter(Boolean).join('\n\n');
  return {
    id: agent.id,
    name: agent.name,
    version: 'draft',
    system,
    maxTurns: config.maxTurns || 20,
    timeoutMs: config.timeoutMs || 240000,
    source: 'agent-platform',
    instanceDirectory: join(instanceDirectory)
  };
}

export { LUBAN_AGENT_ID, LUBAN_AGENT_NAME };
