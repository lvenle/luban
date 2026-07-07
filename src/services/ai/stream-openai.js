import { chatCompletionsUrl } from '../../ai/service.js';
import { getRuntimeSettings } from '../../models/runtime-settings.js';

function readWithTimeout(reader, timeoutMs = getRuntimeSettings().aiStreamReadTimeoutMs) {
  let timer;
  const read = reader.read().finally(() => clearTimeout(timer));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI 响应超时：长时间未收到数据')), timeoutMs);
  });
  read.catch(() => {});
  return Promise.race([read, timeout]);
}

export function withTimeout(promise, timeoutMs, errorMessage) {
  let timer;
  const tracked = promise.finally(() => clearTimeout(timer));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  tracked.catch(() => {});
  return Promise.race([tracked, timeout]);
}

export async function* streamOpenAI(settings, messages, tools, signal = null) {
  const payload = {
    model: settings.model || 'gpt-4.1-mini',
    messages,
    tools: tools.length ? tools : undefined,
    stream: true
  };
  const url = chatCompletionsUrl(settings.baseUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AI 请求失败：${response.status} ${text}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await readWithTimeout(reader);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            yield JSON.parse(trimmed.slice(6));
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
}
