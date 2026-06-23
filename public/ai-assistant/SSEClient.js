const STALL_TIMEOUT_MS = 60_000;

export default class SSEClient {
  constructor() {
    this.abortController = null;
    this.callbacks = {};
    this.stallTimer = null;
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
    return this;
  }

  emit(event, data) {
    for (const cb of this.callbacks[event] || []) cb(data);
  }

  /**
   * Reset the stall watchdog timer. Called whenever new data arrives.
   * If no data arrives within STALL_TIMEOUT_MS, the connection is considered dead
   * and an 'error' event is emitted so the UI can show a timeout message.
   */
  resetStallTimer() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.emit('error', { message: '连接超时：长时间未收到服务器响应，请重试。' });
      this.abortController?.abort();
    }, STALL_TIMEOUT_MS);
  }

  clearStallTimer() {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
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

      this.resetStallTimer();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Data received — reset the stall timer
        this.resetStallTimer();

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

      this.clearStallTimer();
      this.emit('stream_end', {});
    } catch (error) {
      this.clearStallTimer();
      if (error.name === 'AbortError') return;
      this.emit('error', { message: error.message });
    }
  }

  disconnect() {
    this.clearStallTimer();
    this.abortController?.abort();
    this.abortController = null;
  }
}
