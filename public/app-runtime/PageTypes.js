export function cardFilterLabel(card) {
  const filters = card.filters || [];
  if (!filters.length) return '全部数据';
  if (filters.some((filter) => filter.op === 'thisMonth')) return '本月';
  if (filters.some((filter) => filter.op === 'today')) return '今日';
  return `${filters.length} 个筛选`;
}

export function pageCardTitle(card) {
  if (card.type === 'table') return '数据表格';
  if (card.type === 'chart') return '统计图';
  if (card.type === 'pivot') return '透视图';
  return '统计卡片';
}
