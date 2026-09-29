import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';

const legacyByPlatform = Object.fromEntries(
  Object.entries(LUBAN_TOOL_NAMES).map(([legacy, platform]) => [platform, legacy])
);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function parseInput(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return { __invalid_arguments: String(value || '') }; }
}

function canonicalCall(call, runtime) {
  const rawName = call.name || call.toolName || call.function?.name || '';
  const name = runtime === 'platform' ? (legacyByPlatform[rawName] || rawName) : rawName;
  const input = parseInput(call.input || call.arguments || call.function?.arguments);
  return {
    name,
    input: stable(input),
    confirmation: Object.prototype.hasOwnProperty.call(call, 'confirmation')
      ? call.confirmation
      : Object.prototype.hasOwnProperty.call(call, 'confirmed') ? call.confirmed : null,
    status: call.status || null
  };
}

/** Compare product-visible tool and confirmation traces from both chat paths. */
export function compareDualRuntimeTraces({ legacy = [], platform = [] } = {}) {
  const left = legacy.map((call) => canonicalCall(call, 'legacy'));
  const right = platform.map((call) => canonicalCall(call, 'platform'));
  const differences = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) {
      differences.push({ index, legacy: left[index] || null, platform: right[index] || null });
    }
  }
  return { equal: differences.length === 0, legacy: left, platform: right, differences };
}
