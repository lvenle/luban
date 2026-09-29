import { createModelProvider } from '@xiaoya/agent-platform/model';
import { createLubanProductRuntimeAdapter } from './product-runtime-adapter.js';

/** Run a single non-tool completion through the shared model Provider. */
export async function completeWithLubanProvider(settings, {
  messages,
  responseFormat = { type: 'json_object' },
  maxTokens = 3000
} = {}) {
  const adapter = createLubanProductRuntimeAdapter(settings);
  const runtime = adapter.buildRuntimeConfig();
  const apiKey = await adapter.resolveCredential(runtime.model.credential_ref);
  const provider = createModelProvider(runtime.model, { apiKey });
  let text = '';
  for await (const event of provider.stream({
    model: runtime.model.model,
    messages,
    tools: [],
    maxTokens,
    responseFormat
  })) {
    if (event.type === 'text_delta') text += event.delta;
  }
  return text;
}
