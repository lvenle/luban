export async function* decodeServerSentEvents(body, { maxEventBytes = 1_000_000 } = {}) {
  if (!body) throw new Error('Response body is missing');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer) > maxEventBytes) throw new RangeError('SSE event exceeds limit');
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + separator.length);
      const event = parseEvent(frame);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = parseEvent(buffer);
    if (event) yield event;
  }
}

function parseEvent(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return { event, data: data.join('\n') };
}
