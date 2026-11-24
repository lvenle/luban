import { assertModelResponse, joinUrl } from './http.js';
import { decodeServerSentEvents } from './sse.js';
import { createWireToolMap, toOpenAIMessages, toOpenAITools } from './messages.js';

export class OpenAICompatibleProvider {
  id = 'openai-compatible';

  constructor({ baseUrl = 'https://api.openai.com/v1', apiKey, fetchImpl = fetch }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new TypeError('apiKey is required');
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async *stream({ model, messages, system, tools = [], signal, maxTokens, responseFormat, temperature, topP, stop }) {
    const toolNames = createWireToolMap(tools);
    const response = await this.fetch(joinUrl(this.baseUrl, 'chat/completions'), {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(messages, system, toolNames),
        stream: true,
        stream_options: { include_usage: true },
        ...(tools.length ? { tools: toOpenAITools(tools, toolNames) } : {}),
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(stop !== undefined ? { stop } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {})
      })
    });
    await assertModelResponse(response);
    for await (const event of decodeServerSentEvents(response.body)) {
      if (event.data === '[DONE]') {
        yield { type: 'message_end' };
        return;
      }
      let chunk;
      try { chunk = JSON.parse(event.data); }
      catch { throw new SyntaxError('Model returned an invalid SSE JSON event'); }
      if (chunk.error) throw new Error(chunk.error.message ?? 'Model stream failed');
      const choice = chunk.choices?.[0];
      const delta = choice?.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        yield { type: 'text_delta', delta: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        yield {
          type: 'tool_call_delta',
          index: call.index,
          id: call.id,
          name: call.function?.name ? toolNames.decode(call.function.name) : undefined,
          arguments_delta: call.function?.arguments ?? ''
        };
      }
      if (chunk.usage) yield { type: 'usage', usage: chunk.usage };
      if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason };
    }
    yield { type: 'message_end' };
  }
}
