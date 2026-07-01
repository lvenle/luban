import { toast } from '../common/toast.js';

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '空';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatRuleChanges(result, app) {
  return (result?.changes || []).map((change) => {
    const entityId = change.entityId || change.after?.entityId || change.before?.entityId;
    const changedFieldId = change.fieldId || Object.keys(change.after?.data || {}).find(
      (fieldId) => JSON.stringify(change.before?.data?.[fieldId]) !== JSON.stringify(change.after?.data?.[fieldId])
    );
    const beforeValue = Object.prototype.hasOwnProperty.call(change, 'beforeValue')
      ? change.beforeValue : change.before?.data?.[changedFieldId];
    const afterValue = Object.prototype.hasOwnProperty.call(change, 'afterValue')
      ? change.afterValue : change.after?.data?.[changedFieldId];
    const entity = app?.schema?.entities?.find((item) => item.id === entityId);
    const field = entity?.fields?.find((item) => item.id === changedFieldId);
    const entityName = entity?.name || '相关数据';
    const fieldName = field?.label || '目标字段';
    return `${entityName}的“${fieldName}”已由 ${displayValue(beforeValue)} 调整为 ${displayValue(afterValue)}`;
  });
}

export function notifyRuleResults(results, app) {
  const waiting = (results || []).filter((result) => result.status === 'waiting');
  const succeeded = (results || []).filter((result) => result.status === 'success');
  if (waiting.length) {
    const fields = [...new Set(waiting.flatMap((result) => (result.missingFields || []).map((field) => field.label)))];
    toast(`记录已保存。补充${fields.join('、')}后，系统会自动完成相关业务处理。`);
    return;
  }
  if (succeeded.length) {
    const details = succeeded.flatMap((result) => formatRuleChanges(result, app));
    const names = succeeded.map((result) => result.ruleName).filter(Boolean).join('、');
    toast(`已完成${names ? `“${names}”` : '相关业务处理'}${details.length ? `：${details.join('；')}。` : '。'}`);
  }
}
