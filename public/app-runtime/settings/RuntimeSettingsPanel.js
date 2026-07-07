import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';
import { normalizeRuntimeSettings } from '../../common/runtime-settings.js';
import { setClientRuntimeSettings } from '../../common/runtime-settings-store.js';

const RUNTIME_FIELDS = [
  { key: 'paginationMax', label: '分页上限', hint: '单次列表请求允许加载的最大记录数。' },
  { key: 'paginationDefault', label: '默认分页', hint: '数据表默认每批加载条数。' },
  { key: 'ruleRunDetailLimit', label: '规则详情日志 limit', hint: '单条业务规则详情里默认读取的执行记录数量。' },
  { key: 'ruleRunDefaultLimit', label: '规则日志默认 limit', hint: '后端规则日志接口未传 limit 时使用的默认值。' },
  { key: 'ruleRunListLimit', label: '规则日志列表 limit', hint: '系统设置/应用设置中执行记录列表默认读取数量，也是规则日志查询上限。' },
  { key: 'ruleStateDisplayLimit', label: '规则状态展示 limit', hint: '等待条件/成功状态默认展示数量。' },
  { key: 'ruleStateMaxLimit', label: '规则状态最大 limit', hint: '等待条件/成功状态接口允许的最大数量。' },
  { key: 'sidebarWidth', label: '侧边栏宽度', hint: '左侧页面列表默认展开宽度。' },
  { key: 'sidebarCollapsedWidth', label: '侧边栏收起宽度', hint: '左侧页面列表收起后的默认宽度。' },
  { key: 'actionWidth', label: '操作列宽度', hint: '数据表操作列默认宽度。' },
  { key: 'dateFormat', label: '日期格式', hint: '日期字段的全局展示格式。', type: 'select', options: [
    { value: 'yyyy-mm-dd', label: '2026-06-21' },
    { value: 'yyyy/mm/dd', label: '2026/06/21' },
    { value: 'yyyy年m月d日', label: '2026年6月21日' },
    { value: 'mm-dd', label: '06-21' }
  ] },
  { key: 'dateTimeFormat', label: '日期时间格式', hint: '日期时间字段的全局展示格式。', type: 'select', options: [
    { value: 'yyyy-mm-dd hh:mm', label: '2026-06-21 09:30' },
    { value: 'yyyy/mm/dd hh:mm', label: '2026/06/21 09:30' },
    { value: 'yyyy年m月d日 hh:mm', label: '2026年6月21日 09:30' }
  ] },
  { key: 'aiRequestTimeoutMs', label: 'AI 请求超时', hint: '非流式 AI 请求超时时间，单位毫秒。' },
  { key: 'aiStreamReadTimeoutMs', label: 'AI 流式/工具超时', hint: 'AI 流式响应和工具执行等待时间，单位毫秒。' },
  { key: 'apiRateLimitMax', label: 'API 限流次数', hint: '普通 API 在限流窗口内允许的最大请求数。' },
  { key: 'confirmRateLimitMax', label: '确认操作限流次数', hint: 'AI 高风险确认接口在限流窗口内允许的最大请求数。' },
  { key: 'rateLimitWindowMs', label: '限流窗口', hint: '限流统计窗口，单位毫秒。' }
];

export function renderRuntimePanel(runtime = {}, schema = RUNTIME_FIELDS, onSaved = () => {}) {
  const values = normalizeRuntimeSettings(runtime);
  const inputs = new Map();
  const fields = schema?.length ? schema : RUNTIME_FIELDS;
  const rows = fields.map(({ key, label, hint, min, max, type = 'number', options = [] }) => {
    const input = type === 'select'
      ? h('select', {}, options.map((option) => h('option', { value: option.value, text: option.label || option.value })))
      : h('input', { type: 'number', step: '1', value: String(values[key]), min, max });
    input.value = String(values[key] ?? '');
    inputs.set(key, input);
    return h('label', { class: 'runtime-setting-row' }, [
      h('span', { class: 'runtime-setting-label', text: label }),
      input,
      h('small', { class: 'field-hint', text: hint })
    ]);
  });
  return h('div', { class: 'runtime-settings-panel' }, [
    h('p', { class: 'muted', text: '这些参数保存后立即生效；后端限流、分页和 AI 超时会在下一次请求时读取最新值。' }),
    h('div', { class: 'runtime-settings-grid' }, rows),
    h('div', { class: 'row settings-actions' }, [
      h('button', { text: '保存运行参数', onclick: async () => {
        const next = {};
        for (const [key, input] of inputs) next[key] = input.value;
        const body = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ runtime: next }) });
        const saved = setClientRuntimeSettings(body.runtime || next);
        onSaved(saved);
        document.dispatchEvent(new CustomEvent('runtime-settings-updated', { detail: saved }));
        toast('运行参数已保存');
      } })
    ])
  ]);
}
