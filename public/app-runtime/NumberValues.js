export function numberInputValue(value, field = {}) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return field.format === 'percent' ? number * 100 : number;
}

export function storedNumberValue(value, field = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return field.format === 'percent' ? number / 100 : number;
}
