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

export async function resolveLubanBusinessAgent({store}={}) {
  store ||= (await ensurePlatformService()).service.store;
  await store.ensureApplicationAssistant({id:'luban-business',appType:'luban',name:'应用业务助手',agent:{
    id:'luban-business-assistant',name:'应用业务助手',description:'使用已发布应用的业务数据和动作',
    system:'你是企业业务助手。仅在当前用户获授权的已发布应用中查询和处理业务记录。禁止创建应用、修改表字段、页面、规则和系统配置。',
    tools:['luban.records.query','luban.records.create','luban.records.update','luban.records.delete'],skills:[],knowledge:[],maxTurns:20,timeoutMs:240000
  }});
  return {...store.getApplicationAssistant('luban-business'),store};
}
