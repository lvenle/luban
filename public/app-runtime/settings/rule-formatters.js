import { h } from '../../common/dom.js';

export function formatTime(value) {
  if (!value) return '暂无';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function statusLabel(status) {
  return ({ active: '启用', disabled: '禁用', draft: '草稿', waiting: '等待条件', success: '成功', blocked: '已阻止', failed: '失败', skipped: '已跳过' })[status] || status;
}

export function jsonDetails(title, value) {
  return h('details', { class: 'rule-json-details' }, [
    h('summary', { text: title }),
    h('pre', { text: JSON.stringify(value || {}, null, 2) })
  ]);
}

export function ruleSummary(rule) {
  const intent = rule.businessIntentJson || {};
  return {
    when: intent.display?.when || intent.summary || rule.sourceText,
    then: intent.display?.then || rule.description || '执行字段联动'
  };
}

export function setSelectOptions(select, items, selectedValue) {
  select.replaceChildren(...items.map((item) => h('option', { value: item.value, text: item.label })));
  select.value = selectedValue ?? items[0]?.value ?? '';
}

export function editableFields(entity) {
  return (entity?.fields || []).filter((field) => !['formula', 'relation', 'ai'].includes(field.type));
}
