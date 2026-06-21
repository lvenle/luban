export function formatDateFieldValue(value, field = {}) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim().replace('T', ' ');
  const date = normalized.slice(0, 10);

  if (field.type === 'date') {
    if (field.format === 'mm-dd') return date.slice(5);
    if (field.format === 'yyyy-mm-dd') return date;
    return date.replaceAll('-', '/');
  }

  const dateTime = normalized.slice(0, 16);
  if (field.format === 'yyyy-mm-dd hh:mm') return dateTime;
  return dateTime.replaceAll('-', '/');
}

export function dateInputValue(value, fieldType) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim().replaceAll('/', '-');
  if (fieldType === 'date') return normalized.slice(0, 10);
  if (fieldType === 'datetime') return normalized.replace(' ', 'T').slice(0, 16);
  return normalized;
}
