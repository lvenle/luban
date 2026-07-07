import { formatDateFieldValue } from './date-format.js';

export function displayValue(value) {
  if (Array.isArray(value)) return value.map((item) => item?.displayValue || item?.label || item).join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.name || value.optionId || '';
  if (value === true) return '是';
  if (value === false) return '否';
  return value ?? '';
}

export function normalizeFileValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value.trim()) ? { url: value, name: value.split('/').pop() || value } : { name: value, url: '' };
  }
  if (typeof value === 'object') {
    return {
      url: value.url || '',
      name: value.name || value.filename || value.label || value.url || '',
      mimeType: value.mimeType || '',
      size: value.size || 0
    };
  }
  return null;
}

export function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || [])
    .map((item) => typeof item === 'string' ? { id: item, label: item, color: 'gray' } : item)
    .find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}

export function relationFieldDisplayText(value) {
  if (!value || typeof value !== 'object') return '';
  return value.displayValue || value.label || value.name || '';
}

export function formatFieldValue(value, field = {}, options = {}) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') {
    return (Array.isArray(value) ? value : [])
      .map((item) => optionLabel(field, item))
      .filter(Boolean)
      .join('、');
  }
  if (field.type === 'relation') {
    return (Array.isArray(value) ? value : [value])
      .map(relationFieldDisplayText)
      .filter(Boolean)
      .join('、');
  }
  if (field.type === 'image' || field.type === 'file') return normalizeFileValue(value)?.name || '';
  if (field.type === 'formula') {
    const resultType = options.effectiveFieldType?.(field) || field.formula?.resultType || 'number';
    return formatFieldValue(value, { ...field, type: resultType }, options);
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (Number.isNaN(number)) return String(displayValue(value));
    if (field.format === 'integer') return String(Math.round(number));
    if (field.format === 'decimal2') return number.toFixed(2);
    if (field.format === 'currency') return `¥${number.toFixed(2)}`;
    if (field.format === 'percent') return `${Math.round(number * 100)}%`;
    return Number.isInteger(number) ? String(number) : number.toFixed(2);
  }
  if (field.type === 'date' || field.type === 'datetime') return formatDateFieldValue(value, field);
  return String(displayValue(value));
}
