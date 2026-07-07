import { getClientRuntimeSettings } from './runtime-settings-store.js';

function dateParts(value) {
  const normalized = String(value || '').trim().replaceAll('/', '-').replace('T', ' ');
  const [datePart = '', timePart = ''] = normalized.split(' ');
  const [year = '', month = '', day = ''] = datePart.split('-');
  const [hour = '', minute = ''] = timePart.split(':');
  return {
    normalized,
    year,
    month: month.padStart(2, '0'),
    monthNumber: String(Number(month || 0) || '').padStart(1, '0'),
    day: day.padStart(2, '0'),
    dayNumber: String(Number(day || 0) || '').padStart(1, '0'),
    hour: hour.padStart(2, '0'),
    minute: minute.padStart(2, '0')
  };
}

function formatDateByPattern(value, pattern) {
  const parts = dateParts(value);
  if (!parts.year || !parts.month || !parts.day) return parts.normalized.slice(0, 10);
  if (pattern === 'yyyy/mm/dd') return `${parts.year}/${parts.month}/${parts.day}`;
  if (pattern === 'yyyy年m月d日') return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日`;
  if (pattern === 'mm-dd') return `${parts.month}-${parts.day}`;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateTimeByPattern(value, pattern) {
  const parts = dateParts(value);
  const date = formatDateByPattern(value, pattern?.replace(' hh:mm', '') || 'yyyy-mm-dd');
  const time = parts.hour && parts.minute ? `${parts.hour}:${parts.minute}` : parts.normalized.slice(11, 16);
  return time ? `${date} ${time}` : date;
}

export function formatDateFieldValue(value, field = {}) {
  if (value === null || value === undefined || value === '') return '';
  const settings = getClientRuntimeSettings();
  if (field.type === 'date') return formatDateByPattern(value, settings.dateFormat);
  return formatDateTimeByPattern(value, settings.dateTimeFormat);
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
