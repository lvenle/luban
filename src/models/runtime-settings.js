import { getSetting, setSetting } from './session.js';

const RUNTIME_SETTING_FIELDS = [
  { key: 'paginationMax', label: '分页上限', hint: '单次列表请求允许加载的最大记录数。', defaultValue: 1000, min: 1, max: 10000, type: 'number' },
  { key: 'paginationDefault', label: '默认分页', hint: '数据表默认每批加载条数。', defaultValue: 100, min: 1, max: 10000, type: 'number' },
  { key: 'ruleRunDetailLimit', label: '规则详情日志 limit', hint: '单条业务规则详情里默认读取的执行记录数量。', defaultValue: 20, min: 1, max: 1000, type: 'number' },
  { key: 'ruleRunDefaultLimit', label: '规则日志默认 limit', hint: '后端规则日志接口未传 limit 时使用的默认值。', defaultValue: 50, min: 1, max: 1000, type: 'number' },
  { key: 'ruleRunListLimit', label: '规则日志列表 limit', hint: '系统设置/应用设置中执行记录列表默认读取数量，也是规则日志查询上限。', defaultValue: 100, min: 1, max: 1000, type: 'number' },
  { key: 'ruleStateDisplayLimit', label: '规则状态展示 limit', hint: '等待条件/成功状态默认展示数量。', defaultValue: 100, min: 1, max: 1000, type: 'number' },
  { key: 'ruleStateMaxLimit', label: '规则状态最大 limit', hint: '等待条件/成功状态接口允许的最大数量。', defaultValue: 200, min: 1, max: 1000, type: 'number' },
  { key: 'sidebarWidth', label: '侧边栏宽度', hint: '左侧页面列表默认展开宽度。', defaultValue: 168, min: 132, max: 480, type: 'number' },
  { key: 'sidebarCollapsedWidth', label: '侧边栏收起宽度', hint: '左侧页面列表收起后的默认宽度。', defaultValue: 112, min: 88, max: 320, type: 'number' },
  { key: 'actionWidth', label: '操作列宽度', hint: '数据表操作列默认宽度。', defaultValue: 112, min: 84, max: 320, type: 'number' },
  { key: 'dateFormat', label: '日期格式', hint: '日期字段的全局展示格式。', defaultValue: 'yyyy-mm-dd', type: 'select', options: [
    { value: 'yyyy-mm-dd', label: '2026-06-21' },
    { value: 'yyyy/mm/dd', label: '2026/06/21' },
    { value: 'yyyy年m月d日', label: '2026年6月21日' },
    { value: 'mm-dd', label: '06-21' }
  ] },
  { key: 'dateTimeFormat', label: '日期时间格式', hint: '日期时间字段的全局展示格式。', defaultValue: 'yyyy-mm-dd hh:mm', type: 'select', options: [
    { value: 'yyyy-mm-dd hh:mm', label: '2026-06-21 09:30' },
    { value: 'yyyy/mm/dd hh:mm', label: '2026/06/21 09:30' },
    { value: 'yyyy年m月d日 hh:mm', label: '2026年6月21日 09:30' }
  ] },
  { key: 'aiRequestTimeoutMs', label: 'AI 请求超时', hint: '非流式 AI 请求超时时间，单位毫秒。', defaultValue: 25000, min: 1000, max: 300000, type: 'number' },
  { key: 'aiStreamReadTimeoutMs', label: 'AI 流式/工具超时', hint: 'AI 流式响应和工具执行等待时间，单位毫秒。', defaultValue: 120000, min: 5000, max: 600000, type: 'number' },
  { key: 'apiRateLimitMax', label: 'API 限流次数', hint: '普通 API 在限流窗口内允许的最大请求数。', defaultValue: 100, min: 1, max: 10000, type: 'number' },
  { key: 'confirmRateLimitMax', label: '确认操作限流次数', hint: 'AI 高风险确认接口在限流窗口内允许的最大请求数。', defaultValue: 10, min: 1, max: 1000, type: 'number' },
  { key: 'rateLimitWindowMs', label: '限流窗口', hint: '限流统计窗口，单位毫秒。', defaultValue: 60000, min: 1000, max: 3600000, type: 'number' }
];

export function runtimeSettingDefaults() {
  return Object.fromEntries(RUNTIME_SETTING_FIELDS.map(({ key, defaultValue }) => [key, defaultValue]));
}

const SCHEMA_BY_KEY = new Map(RUNTIME_SETTING_FIELDS.map((field) => [field.key, field]));

export function runtimeSettingSchema() {
  return RUNTIME_SETTING_FIELDS.map((field) => ({ ...field, options: field.options ? field.options.map((option) => ({ ...option })) : undefined }));
}

export function normalizeRuntimeSettings(input = {}) {
  const defaults = runtimeSettingDefaults();
  const next = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const schema = SCHEMA_BY_KEY.get(key);
    if (schema?.type === 'select') {
      const allowed = new Set((schema.options || []).map((option) => option.value));
      next[key] = allowed.has(input[key]) ? input[key] : fallback;
      continue;
    }
    const [min, max] = [schema?.min ?? 1, schema?.max ?? Number.MAX_SAFE_INTEGER];
    const parsed = Number.parseInt(input[key], 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    next[key] = Math.max(min, Math.min(max, value));
  }
  if (next.paginationDefault > next.paginationMax) next.paginationDefault = next.paginationMax;
  if (next.ruleStateDisplayLimit > next.ruleStateMaxLimit) next.ruleStateDisplayLimit = next.ruleStateMaxLimit;
  return next;
}

export function getRuntimeSettings() {
  return normalizeRuntimeSettings(getSetting('runtime') || {});
}

export function saveRuntimeSettings(input = {}) {
  return setSetting('runtime', normalizeRuntimeSettings({ ...getRuntimeSettings(), ...input }));
}
