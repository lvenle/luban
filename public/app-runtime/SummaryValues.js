export const NUMERIC_SUMMARY_OPTIONS = [
  ['none', '不显示'],
  ['sum', '求和'],
  ['average', '求平均'],
  ['max', '最大值'],
  ['min', '最小值']
];

export const TEXT_SUMMARY_OPTIONS = [
  ['none', '不显示'],
  ['count', '记录总数'],
  ['filled', '已填写数'],
  ['empty', '未填写数']
];

export function isNumericSummaryField(field) {
  return field?.type === 'number' || (field?.type === 'formula' && field.formula?.resultType === 'number');
}

export function summaryOptions(field) {
  return isNumericSummaryField(field) ? NUMERIC_SUMMARY_OPTIONS : TEXT_SUMMARY_OPTIONS;
}

export function summaryMode(field, summaries = {}) {
  const options = summaryOptions(field);
  const configured = summaries?.[field.id];
  if (options.some(([mode]) => mode === configured)) return configured;
  return isNumericSummaryField(field) ? 'sum' : 'none';
}

export function calculateSummary(records, field, mode) {
  if (!mode || mode === 'none') return null;
  if (!isNumericSummaryField(field)) {
    if (mode === 'count') return records.length;
    const filled = records.filter((record) => hasSummaryValue(record.data?.[field.id])).length;
    if (mode === 'filled') return filled;
    if (mode === 'empty') return records.length - filled;
    return null;
  }
  const values = records
    .map((record) => record.data?.[field.id])
    .filter(hasSummaryValue)
    .map(Number)
    .filter(Number.isFinite);
  if (!values.length) return null;
  if (mode === 'sum') return values.reduce((total, value) => total + value, 0);
  if (mode === 'average') return values.reduce((total, value) => total + value, 0) / values.length;
  if (mode === 'max') return Math.max(...values);
  if (mode === 'min') return Math.min(...values);
  return null;
}

export function hasSummaryValue(value) {
  return value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
}
