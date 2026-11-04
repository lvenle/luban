import { workspaceContext, isBuilder } from '../enterprise/context.js';
import { applicationRunOwner } from '@xiaoya/agent-platform/hosting/context';
import { readFileSync } from 'node:fs';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';
import { LubanToolProvider } from './tool-provider.js';
import { ensurePlatformService } from './platform-service.js';
import { prepareLubanToolCalls } from './tool-batch.js';
import { resolveLubanAgent, resolveLubanBusinessAgent } from './agent-resolver.js';

const agentSystemPrompt = readFileSync(
  new URL('../../agents/luban-app-builder/prompts/system.md', import.meta.url),
  'utf8'
).trim();

export function buildLubanSystemPrompt(productContextPrompt = '') {
  let namespaced = productContextPrompt;
  if(isBuilder())namespaced+='\n企业构建流程：create_app 仅提出待确认方案，不会创建应用。用户必须在界面检查、修改并点击确认并创建后才建立草稿。返回 requiresConfirmation 时停止后续构建，明确说明正在等待用户确认，不能宣称已经创建。';
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
  const agent = await (workspaceContext()&&!isBuilder()?resolveLubanBusinessAgent({store:service.store}):resolveLubanAgent({settings,store:service.store}));
  const approvals=new Map();const approve=invocation=>{if(!approvals.has(invocation.callId))approvals.set(invocation.callId,requestApproval?requestApproval(invocation):Promise.resolve(false));return approvals.get(invocation.callId)};
  const productTools = new ToolRegistry();
  productTools.registerProvider(new LubanToolProvider({
    tools, appId: request.appId, pageId: request.pageId, requestApproval:approve, onExecution
  }));
  const globalCapabilities = new Map(service.tools.listCapabilities().map(tool => [tool.name, tool]));
  for (const tool of productTools.listCapabilities()) {
    if (globalCapabilities.get(tool.name)?.enabled === false) productTools.setEnabled(tool.name, false);
  }
  // Definitions and execution context are scoped to this run, never stored globally.
  const productNames = new Set(productTools.listCapabilities().map(tool => tool.name));
  const sharedAllowed=name=>!workspaceContext() || ['platform.skills.read','platform.knowledge.search'].includes(name);
  const scopedTools = {
    listCapabilities: () => [
      ...service.tools.listCapabilities().filter(tool => sharedAllowed(tool.name) && !productNames.has(tool.name)),
      ...productTools.listCapabilities()
    ],
    execute: invocation => productNames.has(invocation.name)
      ? productTools.execute(invocation) : sharedAllowed(invocation.name) ? service.tools.execute(invocation) : Promise.reject(new Error('此助手没有该工具权限'))
  };
  const sessionId = service.runs.resolveProductSession({
    productId: agent.applicationInstanceId, externalId: request.sessionId || request.requestId,
    agentId: agent.id, owner: applicationRunOwner()
  });
  const start = () => service.startApplicationRun(agent.applicationInstanceId, {
    agentId: agent.id, agentVersion: agent.version, sessionId, messages,
    source: request.source || 'luban-chat'
  }, {
    owner: applicationRunOwner(), recoveryContext:{appId:request.appId||null,pageId:request.pageId||null}, onEvent, tools: scopedTools,confirmTool:invocation=>approve({callId:invocation.callId,name:invocation.tool,input:invocation.input,signal:invocation.signal}),
    systemSuffix: workspaceContext() && !isBuilder() ? '你是当前已发布应用的业务助手。只能查询和操作当前用户有权使用的业务记录，不能构建或修改应用结构。\n'+(system||'') : buildLubanSystemPrompt(system),
    prepareToolCalls: prepareLubanToolCalls,
    ...(provider ? { providerFactory: () => provider } : {})
  });
  const previous=request.continue?service.runs.latestSessionRun(sessionId,applicationRunOwner()):null;
  if(request.continue&&!previous)throw Error('找不到可继续的运行');
  if(previous){const recovery=service.runs.recovery(previous.runId,applicationRunOwner()),context=recovery.checkpoint?.recoveryContext;const created=recovery.operations.find(item=>item.tool==='luban.app.create'&&item.outcome==='confirmed'&&item.output?.appId===request.appId);if(!context||(context.appId!==(request.appId||null)&&!created)||context.pageId!==(request.pageId||null))throw Error('应用或页面上下文已变化，请重新发起任务');}
  const handle=request.continue?service.continueRun(previous.runId,{
    owner:applicationRunOwner(),recoveryContext:{appId:request.appId||null,pageId:request.pageId||null},productContinuation:true,onEvent,tools:scopedTools,
    systemSuffix:workspaceContext()&&!isBuilder()?'你是当前已发布应用的业务助手。\n'+(system||''):buildLubanSystemPrompt(system),prepareToolCalls:prepareLubanToolCalls,
    confirmTool:invocation=>approve({callId:invocation.callId,name:invocation.tool,input:invocation.input,signal:invocation.signal}),
    ...(provider?{providerFactory:()=>provider}:{})
  }):start();

  const abort = () => handle.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try { return await handle.result; }
  finally { signal?.removeEventListener('abort', abort); }
}
