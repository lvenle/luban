export function runtimeSettingDefaults() {
  return {
    paginationMax: 1000,
    paginationDefault: 100,
    ruleRunDetailLimit: 20,
    ruleRunDefaultLimit: 50,
    ruleRunListLimit: 100,
    ruleStateDisplayLimit: 100,
    ruleStateMaxLimit: 200,
    sidebarWidth: 168,
    sidebarCollapsedWidth: 112,
    actionWidth: 112,
    aiRequestTimeoutMs: 25000,
    aiStreamReadTimeoutMs: 120000,
    apiRateLimitMax: 100,
    confirmRateLimitMax: 10,
    rateLimitWindowMs: 60000
  };
}

const BOUNDS = {
  paginationMax: [1, 10000],
  paginationDefault: [1, 10000],
  ruleRunDetailLimit: [1, 1000],
  ruleRunDefaultLimit: [1, 1000],
  ruleRunListLimit: [1, 1000],
  ruleStateDisplayLimit: [1, 1000],
  ruleStateMaxLimit: [1, 1000],
  sidebarWidth: [132, 480],
  sidebarCollapsedWidth: [88, 320],
  actionWidth: [84, 320],
  aiRequestTimeoutMs: [1000, 300000],
  aiStreamReadTimeoutMs: [5000, 600000],
  apiRateLimitMax: [1, 10000],
  confirmRateLimitMax: [1, 1000],
  rateLimitWindowMs: [1000, 3600000]
};

export function normalizeRuntimeSettings(input = {}) {
  const defaults = runtimeSettingDefaults();
  const next = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const [min, max] = BOUNDS[key] || [1, Number.MAX_SAFE_INTEGER];
    const parsed = Number.parseInt(input[key], 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    next[key] = Math.max(min, Math.min(max, value));
  }
  if (next.paginationDefault > next.paginationMax) next.paginationDefault = next.paginationMax;
  if (next.ruleStateDisplayLimit > next.ruleStateMaxLimit) next.ruleStateDisplayLimit = next.ruleStateMaxLimit;
  return next;
}
