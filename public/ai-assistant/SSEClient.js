export default class SSEClient {
  constructor() {
    this.abortController = null;
    this.callbacks = {};
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
    return this;
  }

  emit(event, data) {
    for (const cb of this.callbacks[event] || []) cb(data);
  }

  async connect(url, body) {
    this.disconnect();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const err = await response.json();
          errorMsg = err.error || errorMsg;
        } catch {}
        this.emit('error', { message: errorMsg });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let eventType = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }

          if (dataStr) {
            try {
              this.emit(eventType || 'message', JSON.parse(dataStr));
            } catch { /* skip malformed */ }
          }
        }
      }

      this.emit('stream_end', {});
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.emit('error', { message: error.message });
    }
  }

  disconnect() {
    this.abortController?.abort();
    this.abortController = null;
  }
}
