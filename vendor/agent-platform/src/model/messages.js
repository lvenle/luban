export function toOpenAIMessages(messages, system, names = { encode: name => name }) {
  const output = system ? [{ role: 'system', content: system }] : [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      output.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.tool_calls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: names.encode(call.name), arguments: call.arguments }
        }))
      });
    } else {
      output.push({
        role: message.role,
        content: message.content,
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
        ...(message.name ? { name: names.encode(message.name) } : {})
      });
    }
  }
  return output;
}

export function toAnthropicMessages(messages, names = { encode: name => name }) {
  const output = [];
  let toolResults = [];
  const flushToolResults = () => {
    if (!toolResults.length) return;
    output.push({ role: 'user', content: toolResults });
    toolResults = [];
  };
  const anthropicContent = content => {
    if (!Array.isArray(content)) return content;
    return content.flatMap(part => {
      if (part?.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }];
      const url = part?.type === 'image_url' ? part.image_url?.url : null;
      const match = typeof url === 'string' ? /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url) : null;
      if (match) return [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }];
      return [];
    });
  };
  for (const message of messages) {
    if (message.role === 'tool') {
      toolResults.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: message.content,
        ...(message.is_error ? { is_error: true } : {})
      });
      continue;
    }
    flushToolResults();
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.tool_calls) {
        let input;
        try { input = JSON.parse(call.arguments || '{}'); }
        catch { input = {}; }
        content.push({ type: 'tool_use', id: call.id, name: names.encode(call.name), input });
      }
      output.push({ role: 'assistant', content });
    } else {
      output.push({ role: message.role, content: anthropicContent(message.content) });
    }
  }
  flushToolResults();
  return output;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(-7);
}

/** Map internal namespaced tool IDs to provider-safe function names (max 64 chars). */
export function createWireToolMap(tools) {
  const internalToWire = new Map();
  const wireToInternal = new Map();
  for (const tool of tools) {
    const stem = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 54);
    const wire = `${stem}_${shortHash(tool.name)}`;
    if (wireToInternal.has(wire)) throw new Error(`Tool wire-name collision: ${tool.name}`);
    internalToWire.set(tool.name, wire);
    wireToInternal.set(wire, tool.name);
  }
  return Object.freeze({
    encode: name => internalToWire.get(name) ?? name,
    decode: name => wireToInternal.get(name) ?? name
  });
}

export function toOpenAITools(tools, names = createWireToolMap(tools)) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: names.encode(tool.name),
      description: tool.description ?? tool.name,
      parameters: tool.inputSchema
    }
  }));
}

export function toAnthropicTools(tools, names = createWireToolMap(tools)) {
  return tools.map(tool => ({
    name: names.encode(tool.name),
    description: tool.description ?? tool.name,
    input_schema: tool.inputSchema
  }));
}
