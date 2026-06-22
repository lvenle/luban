export function relationValueId(value) {
  return value?.targetRecordId || value?.recordId || value?.id || value || '';
}

export function normalizeChoiceInitialValue(field, value) {
  if (field.type !== 'relation') return value;
  const multiple = Boolean(field.multiple);
  if (multiple) return Array.isArray(value) ? value : value ? [value] : [];
  return Array.isArray(value) ? (value[0] || '') : (value || '');
}

export function relationChoicesFromValue(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => ({
    id: String(relationValueId(item)),
    label: String(item?.displayValue || item?.label || item?.name || relationValueId(item)),
    color: 'gray'
  })).filter((choice) => choice.id && choice.label);
}

export function mergeChoiceOptions(primary = [], fallback = []) {
  const merged = new Map();
  for (const choice of [...primary, ...fallback]) {
    if (choice?.id && !merged.has(String(choice.id))) merged.set(String(choice.id), { ...choice, id: String(choice.id) });
  }
  return [...merged.values()];
}
