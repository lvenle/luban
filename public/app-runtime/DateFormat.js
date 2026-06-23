export function formatDateFieldValue(value, field = {}) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim().replaceAll('/', '-').replace('T', ' ');
  const date = normalized.slice(0, 10);

  if (field.type === 'date') return date;
  return normalized.slice(0, 16);
}

export function dateInputValue(value, fieldType) {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim().replaceAll('/', '-');
  if (fieldType === 'date') return normalized.slice(0, 10);
  if (fieldType === 'datetime') return normalized.replace(' ', 'T').slice(0, 16);
  return normalized;
}

export function dateInputLocale(fieldType) {
  return fieldType === 'date' || fieldType === 'datetime' ? 'en-CA' : '';
}

export function bindDateTimePicker(input) {
  if (!input || !['date', 'datetime-local'].includes(input.type)) return input;
  input.addEventListener('click', () => showDateTimePicker(input));
  return input;
}

export function showDateTimePicker(input) {
  try {
    input?.showPicker?.();
  } catch {
    // Some browsers only allow showPicker during a direct user gesture.
  }
}
