function abortError(signal) {
  return signal?.reason ?? new Error('Model request cancelled');
}

export class RetryingModelProvider {
  constructor(provider, { maxRetries = 2, maxRetryDelayMs = 5000, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!provider || typeof provider.stream !== 'function') throw new TypeError('provider.stream is required');
    this.provider=provider; this.id=provider.id; this.maxRetries=maxRetries; this.maxRetryDelayMs=maxRetryDelayMs; this.delay=delay;
  }

  async *stream(request) {
    for (let attempt=0;;attempt+=1) {
      let emitted=false;
      try {
        for await (const event of this.provider.stream(request)) { emitted=true; yield event; }
        return;
      } catch(error) {
        const retryable=error?.retryable===true || error instanceof TypeError;
        if(request.signal?.aborted) throw abortError(request.signal);
        if(emitted || !retryable || attempt>=this.maxRetries) throw error;
        const wait=Math.min(this.maxRetryDelayMs,500*(2**attempt));
        await this.delay(wait,request.signal);
        if(request.signal?.aborted) throw abortError(request.signal);
      }
    }
  }
}
