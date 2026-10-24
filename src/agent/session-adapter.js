import { applicationRunOwner } from '@xiaoya/agent-platform/hosting/context';
import { readFileSync } from 'node:fs';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';
import { LubanToolProvider } from './tool-provider.js';
import { ensurePlatformService } from './platform-service.js';
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
  request, settings = {}, messages, system, tools, provider,
  onEvent = () => {}, requestApproval, onExecution, signal, runtime
}) {
  signal?.throwIfAborted();
  runtime ||= await ensurePlatformService();
  const service = runtime.service;
  const agent = await resolveLubanAgent({ settings, store: service.store });
  const productTools = new ToolRegistry();
  productTools.registerProvider(new LubanToolProvider({
    tools, appId: request.appId, pageId: request.pageId, requestApproval, onExecution
  }));
  const globalCapabilities = new Map(service.tools.listCapabilities().map(tool => [tool.name, tool]));
  for (const tool of productTools.listCapabilities()) {
    if (globalCapabilities.get(tool.name)?.enabled === false) productTools.setEnabled(tool.name, false);
  }
  // Definitions and execution context are scoped to this run, never stored globally.
  const productNames = new Set(productTools.listCapabilities().map(tool => tool.name));
  const scopedTools = {
    listCapabilities: () => [
      ...service.tools.listCapabilities().filter(tool => !productNames.has(tool.name)),
      ...productTools.listCapabilities()
    ],
    execute: invocation => productNames.has(invocation.name)
      ? productTools.execute(invocation) : service.tools.execute(invocation)
  };
  const sessionId = service.runs.resolveProductSession({
    productId: agent.applicationInstanceId, externalId: request.sessionId || request.requestId,
    agentId: agent.id, owner: applicationRunOwner()
  });
  const handle = service.startApplicationRun(agent.applicationInstanceId, {
    agentId: agent.id, agentVersion: agent.version, sessionId, messages,
    source: request.source || 'luban-chat'
  }, {
    owner: applicationRunOwner(), onEvent, tools: scopedTools,
    systemSuffix: buildLubanSystemPrompt(system),
    prepareToolCalls: prepareLubanToolCalls,
    ...(provider ? { providerFactory: () => provider } : {})
  });
  const abort = () => handle.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try { return await handle.result; }
  finally { signal?.removeEventListener('abort', abort); }
}
