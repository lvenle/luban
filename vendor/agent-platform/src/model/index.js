import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { RetryingModelProvider } from './retry.js';

export { AnthropicProvider, OpenAICompatibleProvider, RetryingModelProvider };
export { TimeoutModelProvider } from './timeout.js';
export { explainProviderError, ModelUnavailableError, MODEL_UNAVAILABLE } from './errors.js';

export function createModelProvider(config, options = {}) {
  const common = {
    baseUrl: config.base_url,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl
  };
  if (config.provider === 'openai-compatible') return new OpenAICompatibleProvider(common);
  if (config.provider === 'anthropic') return new AnthropicProvider(common);
  throw new Error(`Unsupported model provider: ${config.provider}`);
}
