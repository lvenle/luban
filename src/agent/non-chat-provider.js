import { applicationRunOwner } from '@xiaoya/agent-platform/hosting/context';
import { ensurePlatformService } from './platform-service.js';
import { configurationError } from '../core/errors.js';
import { resolveLubanAgent } from './agent-resolver.js';

/** Answer-only AI work still uses the shared lifecycle, model config and audit. */
export async function completeWithLubanProvider(settings, {
  messages, responseFormat = { type: 'json_object' }, maxTokens = 3000,
  signal, runtime
} = {}) {
  signal?.throwIfAborted();
  runtime ||= await ensurePlatformService();
  const agent = await resolveLubanAgent({ settings, store: runtime.service.store });
  const handle = runtime.service.startApplicationRun(agent.applicationInstanceId, {
    agentId: agent.id, agentVersion: agent.version, messages, source: 'luban-generation', questionPreparation:false
  }, { owner: applicationRunOwner(), toolNames: [], responseFormat, maxTokens });
  const abort = () => handle.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try { return (await handle.result).output; }
  finally { signal?.removeEventListener('abort', abort); }
}

export async function requireLubanModel(settings = {}) {
  const agent = await resolveLubanAgent({ settings });
  if (!agent.connection) throw configurationError(agent.store.modelsManaged?'请先在平台后台配置统一模型连接并设为默认。':'请先在助手设置中配置 AI API Key 和模型连接。');
  const status = agent.store.connectionStatus(agent.connection.id);
  if (!status.usable) throw configurationError(`模型连接不可用：${status.reason}`);
  return agent;
}
