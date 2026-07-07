const DEFAULT_WARN_MS = 80;
const API_WARN_MS = 300;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function shouldLog(duration, threshold) {
  return Number.isFinite(duration) && duration >= threshold;
}

function logSlow(label, duration, meta = {}) {
  const payload = { duration: `${duration.toFixed(1)}ms`, ...meta };
  console.warn(`[Perf] ${label}`, payload);
}

export function measureSync(label, fn, { threshold = DEFAULT_WARN_MS, meta = {} } = {}) {
  const start = now();
  try {
    return fn();
  } finally {
    const duration = now() - start;
    if (shouldLog(duration, threshold)) logSlow(label, duration, meta);
  }
}

export async function measureAsync(label, fn, { threshold = DEFAULT_WARN_MS, meta = {} } = {}) {
  const start = now();
  try {
    return await fn();
  } finally {
    const duration = now() - start;
    if (shouldLog(duration, threshold)) logSlow(label, duration, meta);
  }
}

export function apiPerfOptions(path) {
  return { threshold: API_WARN_MS, meta: { path } };
}
