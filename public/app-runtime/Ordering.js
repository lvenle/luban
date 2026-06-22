export function reorderIds(ids = [], sourceId, targetId, side = 'before') {
  const order = [...ids];
  const sourceIndex = order.indexOf(sourceId);
  if (sourceIndex < 0 || !order.includes(targetId) || sourceId === targetId) return order;
  order.splice(sourceIndex, 1);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex + (side === 'after' ? 1 : 0), 0, sourceId);
  return order;
}

export function reorderItemsById(items = [], sourceId, targetId, side = 'before') {
  if (!sourceId || sourceId === targetId) return items;
  const ids = items.map((item) => item.id);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return reorderIds(ids, sourceId, targetId, side).map((id) => byId.get(id));
}

export function orderSelectedOptions(options = [], selectedIds = [], normalize = (option) => option) {
  const selected = new Set(selectedIds);
  return options.map(normalize).filter((option) => selected.has(option.id)).slice(0, 4);
}

export function frozenColumnMeta(fields = [], columnWidths = {}, frozenFieldId = '', fieldIndex = 0) {
  const boundaryIndex = fields.findIndex((field) => field.id === frozenFieldId);
  if (boundaryIndex < 0 || fieldIndex > boundaryIndex) return { frozen: false, boundary: false, left: 0 };
  const left = 42 + 64 + fields.slice(0, fieldIndex)
    .reduce((sum, field) => sum + Number(columnWidths[field.id] || 160), 0);
  return { frozen: true, boundary: fieldIndex === boundaryIndex, left };
}
