/** Bounds reads even if a transport ignores AbortSignal. Optionally waits for transport cleanup before settling. */
export class TimeoutModelProvider {
  constructor(provider, timeoutMs, { waitForCleanup = false } = {}) { this.provider = provider; this.timeoutMs = timeoutMs; this.waitForCleanup = waitForCleanup; }
  async *stream(request) {
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    request.signal?.throwIfAborted();
    request.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      const error = new Error('Model connection timed out');
      error.code = 'model_timeout';
      error.retryable = false;
      controller.abort(error);
    }, this.timeoutMs);
    let listener, iterator;
    const interrupted = new Promise((_, reject) => {
      listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', listener, { once: true });
    });
    try {
      iterator = this.provider.stream({ ...request, signal: controller.signal })[Symbol.asyncIterator]();
      while (true) {
        controller.signal.throwIfAborted();
        const next = await Promise.race([iterator.next(), interrupted]);
        if (next.done) return;
        controller.signal.throwIfAborted();
        yield next.value;
      }
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', listener);
      request.signal?.removeEventListener('abort', abort);
      controller.abort(new Error('Model request finished'));
      const cleanup = Promise.resolve().then(() => iterator?.return?.()).catch(() => {});
      if (this.waitForCleanup) await cleanup;
    }
  }
}
