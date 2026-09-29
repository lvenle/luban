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
    }
  };
}
