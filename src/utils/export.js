import { isSingleChoiceField, isMultiChoiceField, isRelationField, isFileLikeField } from '../core/fieldTypeHelpers.js';

export function displayExportValue(value, field = {}) {
  if (isSingleChoiceField(field)) return optionLabel(field, value);
  if (isMultiChoiceField(field)) return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).join('、');
  if (isRelationField(field)) return (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => item.displayValue || item).join('、');
  if (isFileLikeField(field)) return fileLabel(value);
  if (Array.isArray(value)) return value.join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.optionId || '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value ?? '';
}

export function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}

export function fileLabel(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(fileLabel).filter(Boolean).join('、');
  if (typeof value === 'object') return value.name || value.filename || value.label || value.url || '';
  return value;
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(records, entity = null) {
  const fields = entity?.fields?.length
    ? entity.fields
    : [...new Set(records.flatMap((record) => Object.keys(record.data)))].map((id) => ({ id, label: id }));
  const lines = [fields.map((field) => csvEscape(field.label || field.id)).join(',')];
  for (const record of records) {
    lines.push(fields.map((field) => csvEscape(displayExportValue(record.data[field.id], field))).join(','));
  }
  return '\ufeff' + lines.join('\n');
}

export function toMarkdown(records) {
  return records
    .map((record, index) => {
      const lines = [`## 记录 ${index + 1}`];
      for (const [key, value] of Object.entries(record.data)) {
        lines.push(`- ${key}: ${displayExportValue(value)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
