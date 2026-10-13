import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { servePlatform } from '@xiaoya/agent-platform/settings/serve';
import { ToolRegistry } from '@xiaoya/agent-platform/tools';
import { LubanToolProvider } from './tool-provider.js';
import { LUBAN_TOOL_PERMISSIONS } from './runtime-adapter.js';
import { getSetting } from '../models/session.js';
import { requireAuthenticated } from '../models/auth.js';

export const LUBAN_PLATFORM_TOOLS = Object.freeze([
  ...LUBAN_TOOL_PERMISSIONS,
  'platform.time.current', 'platform.memory.read', 'platform.memory.update'
]);

export function platformInstanceDirectory() {
  return resolve(process.env.LUBAN_PLATFORM_INSTANCE_DIR || process.env.AGENT_PLATFORM_INSTANCE_DIR ||
    join(process.env.LUBAN_DATA_DIR || join(process.cwd(), 'data'), 'agent-runtime'));
}

export function platformWorkspaceDirectory() {
  return resolve(process.env.LUBAN_WORKSPACE_DIR ||
    join(process.env.LUBAN_DATA_DIR || join(process.cwd(), 'data'), 'workspace'));
}

let runtimePromise = null;
let closingPromise = null;

/** One owned runtime per product process; no dependency on the workbench process. */
export async function createLubanPlatformService({
  directory = platformInstanceDirectory(), workspaceRoot = platformWorkspaceDirectory(),
  tools: productTools, authorizeRequest = (req) => {
    const token = process.env.LUBAN_DESKTOP_TOKEN;
    if (token && req.headers['x-luban-desktop-token'] !== token) return false;
    try { requireAuthenticated(req); return true; } catch { return false; }
  }, ...options
} = {}) {
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  const tools = new ToolRegistry();
  // Console can inspect product capabilities; execution needs a product-owned context.
  tools.registerProvider(new LubanToolProvider({ tools: productTools, requireContext: true }));
  return servePlatform({
    directory, workspaceRoot, productId: 'luban', port: 0, tools,
    installWorkspaceTools: false, installPiTools: false,
    wechatConnector: null, allowedTools: LUBAN_PLATFORM_TOOLS,
    consoleMode: 'admin',
    consolePages: ['models', 'agent', 'skill', 'knowledge', 'tool', 'mcp', 'tasks', 'logs'],
    authorizeRequest, ...options
  });
}

export function ensurePlatformService(options) {
  if (closingPromise) return Promise.reject(new Error('鲁班底座正在关闭'));
  if (!runtimePromise) {
    runtimePromise = createLubanPlatformService(options).then(async runtime => {
      // Migrate only this product's existing model configuration, never another instance.
      let legacy;
      try { legacy = getSetting('ai'); } catch { /* DB may not be initialized in SDK-only hosts */ }
      try {
        if (legacy?.apiKey && !runtime.service.store.snapshot().connections.length) {
          await runtime.service.store.saveConnection({
            id: 'luban-model', name: '鲁班模型', provider: legacy.provider || 'openai-compatible',
            baseUrl: legacy.baseUrl || 'https://api.openai.com/v1', model: legacy.model || 'gpt-4.1-mini',
            apiKey: legacy.apiKey, isDefault: true
          }, runtime.service.store.snapshot().revision);
        }
        return runtime;
      } catch (error) { await runtime.close(); throw error; }
    }).catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

export function closePlatformService() {
  if (closingPromise) return closingPromise;
  const pending = runtimePromise;
  if (!pending) return Promise.resolve();
  closingPromise = (async () => {
    try { const runtime = await pending; await runtime.close(); }
    finally {
      if (runtimePromise === pending) runtimePromise = null;
      closingPromise = null;
    }
  })();
  return closingPromise;
}
