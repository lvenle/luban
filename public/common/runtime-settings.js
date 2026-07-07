const RUNTIME_SETTING_FIELDS = [
  { key: 'paginationMax', defaultValue: 1000, min: 1, max: 10000, type: 'number' },
  { key: 'paginationDefault', defaultValue: 100, min: 1, max: 10000, type: 'number' },
  { key: 'ruleRunDetailLimit', defaultValue: 20, min: 1, max: 1000, type: 'number' },
  { key: 'ruleRunDefaultLimit', defaultValue: 50, min: 1, max: 1000, type: 'number' },
  { key: 'ruleRunListLimit', defaultValue: 100, min: 1, max: 1000, type: 'number' },
  { key: 'ruleStateDisplayLimit', defaultValue: 100, min: 1, max: 1000, type: 'number' },
  { key: 'ruleStateMaxLimit', defaultValue: 200, min: 1, max: 1000, type: 'number' },
  { key: 'sidebarWidth', defaultValue: 168, min: 132, max: 480, type: 'number' },
  { key: 'sidebarCollapsedWidth', defaultValue: 112, min: 88, max: 320, type: 'number' },
  { key: 'actionWidth', defaultValue: 112, min: 84, max: 320, type: 'number' },
  { key: 'dateFormat', defaultValue: 'yyyy-mm-dd', type: 'select', options: ['yyyy-mm-dd', 'yyyy/mm/dd', 'yyyy年m月d日', 'mm-dd'] },
  { key: 'dateTimeFormat', defaultValue: 'yyyy-mm-dd hh:mm', type: 'select', options: ['yyyy-mm-dd hh:mm', 'yyyy/mm/dd hh:mm', 'yyyy年m月d日 hh:mm'] },
  { key: 'aiRequestTimeoutMs', defaultValue: 25000, min: 1000, max: 300000, type: 'number' },
  { key: 'aiStreamReadTimeoutMs', defaultValue: 120000, min: 5000, max: 600000, type: 'number' },
  { key: 'apiRateLimitMax', defaultValue: 100, min: 1, max: 10000, type: 'number' },
  { key: 'confirmRateLimitMax', defaultValue: 10, min: 1, max: 1000, type: 'number' },
  { key: 'rateLimitWindowMs', defaultValue: 60000, min: 1000, max: 3600000, type: 'number' }
];

const SCHEMA_BY_KEY = new Map(RUNTIME_SETTING_FIELDS.map((field) => [field.key, field]));

export function runtimeSettingDefaults() {
  return Object.fromEntries(RUNTIME_SETTING_FIELDS.map(({ key, defaultValue }) => [key, defaultValue]));
}

export function normalizeRuntimeSettings(input = {}) {
  const defaults = runtimeSettingDefaults();
  const next = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const schema = SCHEMA_BY_KEY.get(key);
    if (schema?.type === 'select') {
      next[key] = (schema.options || []).includes(input[key]) ? input[key] : fallback;
      continue;
    }
    const parsed = Number.parseInt(input[key], 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    next[key] = Math.max(schema?.min ?? 1, Math.min(schema?.max ?? Number.MAX_SAFE_INTEGER, value));
  }
  if (next.paginationDefault > next.paginationMax) next.paginationDefault = next.paginationMax;
  if (next.ruleStateDisplayLimit > next.ruleStateMaxLimit) next.ruleStateDisplayLimit = next.ruleStateMaxLimit;
  return next;
}
