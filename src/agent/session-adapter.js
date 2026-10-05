import { readFileSync } from 'node:fs';
import { AgentLoop } from '@xiaoya/agent-platform/runtime';
import { createModelProvider, RetryingModelProvider } from '@xiaoya/agent-platform/model';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';
import { createLubanProductRuntimeAdapter } from './product-runtime-adapter.js';
import { prepareLubanToolCalls } from './tool-batch.js';
import { resolveLubanAgent } from './agent-resolver.js';

const agentSystemPrompt = readFileSync(
  new URL('../../agents/luban-app-builder/prompts/system.md', import.meta.url),
  'utf8'
).trim();

export function buildLubanSystemPrompt(productContextPrompt = '') {
  let namespaced = productContextPrompt;
  for (const [legacy, platform] of Object.entries(LUBAN_TOOL_NAMES)) {
    namespaced = namespaced.replaceAll(legacy, platform);
  }
  return namespaced.includes(agentSystemPrompt)
    ? namespaced.trim()
    : `${agentSystemPrompt}\n\n${namespaced}`.trim();
}

export async function runLubanPlatformSession({
  request,
  settings,
  messages,
  system,
  tools,
  provider,
  onEvent = () => {},
  requestApproval,
  onExecution,
  signal
}) {
  const adapter = createLubanProductRuntimeAdapter(settings);
  const agent = await resolveLubanAgent({ settings });
  const config = adapter.buildRuntimeConfig({ ...(request.runtime || {}), agentId: agent.id });
  const registry = new ToolRegistry();
  adapter.registerToolProviders(registry, {
    tools,
    appId: request.appId,
    pageId: request.pageId,
    requestApproval,
    onExecution
  });
  const apiKey = provider ? settings.apiKey : await adapter.resolveCredential(config.model.credential_ref);
  const modelProvider = provider || new RetryingModelProvider(createModelProvider(config.model, { apiKey }));
  const loop = new AgentLoop({ provider: modelProvider, tools: registry, onEvent });
  return loop.run({
    requestId: request.requestId,
    runId: request.runId,
    agentId: agent.id,
    model: config.model.model,
    system: buildLubanSystemPrompt([agent.system, system].filter(Boolean).join('\n\n')),
    messages,
    allowedTools: config.tools.allowed,
    maxTurns: config.limits.max_turns,
    prepareToolCalls: prepareLubanToolCalls,
    signal
  });
}
