const SECRET_KEYS = /^(api[_-]?key|authorization|credential|password|secret|token)$/i;
const SECRET_VALUES = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g
];

function redactString(value) {
  return SECRET_VALUES.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redact(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, seen);
  }
  return output;
}
