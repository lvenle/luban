import { getRuntimeSettings } from '../../models/runtime-settings.js';

export const PENDING_CONFIRMS = new Map();

const CONFIRM_RATE_BUCKETS = new Map();

export function rateLimitConfirm(ip) {
  const runtime = getRuntimeSettings();
  const now = Date.now();
  const cutoff = now - runtime.rateLimitWindowMs;
  let entries = CONFIRM_RATE_BUCKETS.get(ip);
  if (!entries) {
    entries = [];
    CONFIRM_RATE_BUCKETS.set(ip, entries);
  }
  while (entries.length && entries[0] <= cutoff) entries.shift();
  if (entries.length >= runtime.confirmRateLimitMax) return false;
  entries.push(now);
  return true;
}

export function waitForConfirm(confirmId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 60000);
    PENDING_CONFIRMS.set(confirmId, {
      ...PENDING_CONFIRMS.get(confirmId),
      resolve: (value) => { clearTimeout(timeout); resolve(value); }
    });
  });
}

export function rejectPendingConfirmsForSession(sessionId) {
  for (const [key, entry] of PENDING_CONFIRMS) {
    if (key.startsWith(`${sessionId}:`)) {
      entry.resolve?.(false);
      PENDING_CONFIRMS.delete(key);
    }
  }
}
