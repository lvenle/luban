import { assertModelResponse, joinUrl } from './http.js';
import { decodeServerSentEvents } from './sse.js';
import { createWireToolMap, toAnthropicMessages, toAnthropicTools } from './messages.js';

export class AnthropicProvider {
  id = 'anthropic';

  constructor({ baseUrl = 'https://api.anthropic.com/v1', apiKey, fetchImpl = fetch, version = '2023-06-01' }) {
    if (typeof apiKey !== 'string' || !apiKey) throw new TypeError('apiKey is required');
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.version = version;
  }

  async *stream({ model, messages, system, tools = [], signal, maxTokens = 4096, temperature, topP, stop }) {
    const toolNames = createWireToolMap(tools);
    const response = await this.fetch(joinUrl(this.baseUrl, 'messages'), {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version
      },
      body: JSON.stringify({
        model,
        messages: toAnthropicMessages(messages, toolNames),
        max_tokens: maxTokens,
        stream: true,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(stop !== undefined ? { stop_sequences: Array.isArray(stop) ? stop : [stop] } : {}),
        ...(system ? { system } : {}),
        ...(tools.length ? { tools: toAnthropicTools(tools, toolNames) } : {})
      })
    });
    await assertModelResponse(response);
    for await (const event of decodeServerSentEvents(response.body)) {
      let data;
      try { data = JSON.parse(event.data); }
      catch { throw new SyntaxError('Model returned an invalid SSE JSON event'); }
      if (data.type === 'error') throw new Error(data.error?.message ?? 'Model stream failed');
      if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
        yield {
          type: 'tool_call_delta',
          index: data.index,
          id: data.content_block.id,
          name: toolNames.decode(data.content_block.name),
          arguments_delta: ''
        };
      }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        yield { type: 'text_delta', delta: data.delta.text };
      }
      if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
        yield {
          type: 'tool_call_delta',
          index: data.index,
          arguments_delta: data.delta.partial_json
        };
      }
      if (data.type === 'message_delta') {
        if (data.usage) yield { type: 'usage', usage: data.usage };
        if (data.delta?.stop_reason) yield { type: 'finish', reason: data.delta.stop_reason };
      }
      if (data.type === 'message_stop') yield { type: 'message_end' };
    }
  }
}
