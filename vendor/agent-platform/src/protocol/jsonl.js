const NEWLINE = 0x0a;

export class JsonLinesDecoder {
  #pending = Buffer.alloc(0);
  #maxFrameBytes;

  constructor({ maxFrameBytes = 1_000_000 } = {}) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new TypeError('maxFrameBytes must be a positive safe integer');
    }
    this.#maxFrameBytes = maxFrameBytes;
  }

  push(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#pending = Buffer.concat([this.#pending, bytes]);
    const records = [];

    let newline;
    while ((newline = this.#pending.indexOf(NEWLINE)) >= 0) {
      if (newline > this.#maxFrameBytes) {
        this.#pending = this.#pending.subarray(newline + 1);
        throw new RangeError('Protocol frame exceeds maxFrameBytes');
      }
      const frame = this.#pending.subarray(0, newline);
      this.#pending = this.#pending.subarray(newline + 1);
      if (!frame.toString('utf8').trim()) continue;
      records.push(this.#parse(frame));
    }

    if (this.#pending.length > this.#maxFrameBytes) {
      this.#pending = Buffer.alloc(0);
      throw new RangeError('Protocol frame exceeds maxFrameBytes');
    }
    return records;
  }

  finish() {
    if (this.#pending.length === 0) return [];
    const frame = this.#pending;
    this.#pending = Buffer.alloc(0);
    if (!frame.toString('utf8').trim()) return [];
    return [this.#parse(frame)];
  }

  reset() {
    this.#pending = Buffer.alloc(0);
  }

  #parse(frame) {
    try {
      return JSON.parse(frame.toString('utf8'));
    } catch (error) {
      throw new SyntaxError(`Invalid JSON Lines frame: ${error.message}`);
    }
  }
}

export function encodeJsonLine(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('record must be an object');
  }
  return `${JSON.stringify(record)}\n`;
}
