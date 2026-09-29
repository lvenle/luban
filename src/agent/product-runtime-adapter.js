import { buildLubanRuntimeConfig } from './runtime-adapter.js';
import { LubanToolProvider } from './tool-provider.js';

/** Product-side adapter: compile RuntimeConfig, resolve secrets, register tool providers. */
export function createLubanProductRuntimeAdapter(settings) {
  return {
    buildRuntimeConfig(options = {}) {
      return buildLubanRuntimeConfig(settings, options);
    },
    async resolveCredential(ref) {
      if (ref !== 'secret:model-default') {
        throw new Error(`Unsupported credential ref: ${ref}`);
      }
      if (!settings.apiKey) {
        throw new Error('请在设置中配置 API Key 后再使用 AI 助理。');
      }
      return settings.apiKey;
    },
    registerToolProviders(registry, context) {
      registry.registerProvider(new LubanToolProvider(context));
    },
    async createScheduledRun(event = {}) {
      const appId = event.appId || event.app_id;
      const prompt = event.prompt || event.message || event.input;
      if (!appId) throw new Error('Scheduled Luban run requires appId');
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error('Scheduled Luban run requires a non-empty prompt');
      }
      return {
        requestId: event.requestId || event.request_id || `scheduled-${Date.now()}`,
        runId: event.runId || event.run_id,
        appId,
        pageId: event.pageId || event.page_id || null,
        messages: [{ role: 'user', content: prompt.trim() }],
        source: 'schedule'
      };
    }
  };
}
