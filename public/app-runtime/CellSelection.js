import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, recordsFor, currentPage, entityFor, pageEntityForRecordLoad } from '../app.js';
import { loadCurrentPageRecords, renderRuntime } from './index.js';
import { fieldTypeLabel } from './FieldEditor.js';
import { closeContextMenu } from './TableHeader.js';
import { defaultValueForField, fieldValuesEqual, relationDisplayValue, displayValue, hasDisplayValue } from './CellEditor.js';

export function startCellRangeSelection(event, cell) {
  if (event.button !== 0 || cell.classList.contains('cell-editing')) return;
  const activeEditorInput = document.querySelector('.editable-cell.cell-editing input, .editable-cell.cell-editing textarea');
  if (activeEditorInput && !cell.contains(activeEditorInput)) activeEditorInput.blur();
  event.preventDefault();
  closeContextMenu();
  document.querySelectorAll('.cell-choice-dropdown').forEach((m) => m.remove());
  clearActiveTableSelection();
  const position = cellPosition(cell);
  state.cellSelection = { active: true, table: cell.closest('table'), start: position, end: position };
  updateCellRangeSelection();
}

export function extendCellRangeSelection(cell) {
  if (!state.cellSelection?.active || cell.closest('table') !== state.cellSelection.table) return;
  state.cellSelection.end = cellPosition(cell);
  updateCellRangeSelection();
}

export function moveCellRangeSelection(event) {
  if (!state.cellSelection?.active) return;
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.editable-cell[data-row-index][data-col-index]');
  if (cell) extendCellRangeSelection(cell);
}

export function finishCellRangeSelection() {
  if (!state.cellSelection?.active) return;
  state.cellSelection.active = false;
  updateCellRangeSelection();
}

export function cellPosition(cell) {
  return {
    row: Number(cell.dataset.rowIndex || 0),
    col: Number(cell.dataset.colIndex || 0)
  };
}

export function updateCellRangeSelection() {
  const selection = state.cellSelection;
  document.querySelectorAll('.editable-cell.selected-cell').forEach(clearCellSelectionClasses);
  if (!selection?.table) return;
  const minRow = Math.min(selection.start.row, selection.end.row);
  const maxRow = Math.max(selection.start.row, selection.end.row);
  const minCol = Math.min(selection.start.col, selection.end.col);
  const maxCol = Math.max(selection.start.col, selection.end.col);
  selection.table.querySelectorAll('.editable-cell[data-row-index][data-col-index]').forEach((cell) => {
    const { row, col } = cellPosition(cell);
    const selected = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
    if (!selected) return;
    cell.classList.add('selected-cell');
    cell.classList.toggle('selection-top', row === minRow);
    cell.classList.toggle('selection-bottom', row === maxRow);
    cell.classList.toggle('selection-left', col === minCol);
    cell.classList.toggle('selection-right', col === maxCol);
  });
}

export function clearCellSelectionClasses(cell) {
  cell.classList.remove('selected-cell', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
}

export function selectedCellMatrix() {
  const cells = selectedCellElements();
  if (!cells.length) return [];
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, cell.dataset.copyValue || cell.textContent.trim());
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

export function selectedCellElements() {
  return [...document.querySelectorAll('.editable-cell.selected-cell[data-row-index][data-col-index]')]
    .sort((a, b) => {
      const first = cellPosition(a);
      const second = cellPosition(b);
      return first.row - second.row || first.col - second.col;
    });
}

export function selectedCellPayload() {
  const cells = selectedCellElements();
  if (!cells.length) return null;
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    const field = fieldForCell(cell);
    const record = recordForCell(cell);
    rows.get(row).set(col, {
      fieldId: field?.id || cell.dataset.fieldId || '',
      fieldType: field?.type || cell.dataset.fieldType || '',
      value: structuredClone(record?.data?.[field?.id]),
      text: cell.dataset.copyValue || cell.textContent.trim()
    });
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

export async function copySelectedCellsToClipboard(matrix = selectedCellMatrix(), options = {}) {
  if (!matrix.length) return false;
  state.cellClipboard = selectedCellPayload();
  const text = matrix.map((row) => row.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    if (!options.quiet) toast('已复制选区');
    if (isMultiCellMatrix(matrix)) showCellCopyToolbar();
    return true;
  } catch {
    const copied = fallbackCopyText(text);
    if (!options.quiet) toast(copied ? '已复制选区' : '浏览器暂不允许写入剪贴板。');
    if (copied && isMultiCellMatrix(matrix)) showCellCopyToolbar();
    return copied;
  }
}

export function isMultiCellMatrix(matrix) {
  return matrix.length > 1 || matrix[0]?.length > 1;
}

export async function pasteCellsFromClipboard(event) {
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], .cell-choice-dropdown')) return;
  const targetCells = selectedCellElements();
  if (!targetCells.length) return;
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || await navigator.clipboard.readText().catch(() => '');
  const source = clipboardPayloadFromText(text, state.cellClipboard);
  if (!source.length || !source[0]?.length) return;
  await pasteCellMatrix(source, targetCells);
}

export function clipboardPayloadFromText(text, structuredPayload = null) {
  const textMatrix = parseClipboardText(text);
  if (!textMatrix.length) return [];
  if (payloadMatchesTextMatrix(structuredPayload, textMatrix)) return structuredPayload;
  return textMatrix.map((row) => row.map((value) => ({ text: value, value, fieldType: '' })));
}

export function payloadMatchesTextMatrix(payload, textMatrix) {
  if (!payload || payload.length !== textMatrix.length || payload[0]?.length !== textMatrix[0]?.length) return false;
  return payload.every((row, rowIndex) => row.length === textMatrix[rowIndex].length
    && row.every((cell, colIndex) => String(cell.text ?? '') === String(textMatrix[rowIndex][colIndex] ?? '')));
}

export function parseClipboardText(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  if (!clean) return [];
  return clean.split('\n').map((row) => row.split('\t'));
}

export async function pasteCellMatrix(source, targetCells) {
  const target = targetSelectionBounds(targetCells);
  const sourceRows = source.length;
  const sourceCols = Math.max(...source.map((row) => row.length));
  if (sourceRows > target.rows || sourceCols > target.cols) {
    return toast(`复制区域是 ${sourceRows} 行 ${sourceCols} 列，不能大于目标区域 ${target.rows} 行 ${target.cols} 列。`);
  }
  const fillAll = sourceRows === 1 && sourceCols === 1;
  const changesByRecord = new Map();
  const pasteRows = fillAll ? target.rows : sourceRows;
  const pasteCols = fillAll ? target.cols : sourceCols;

  for (let rowOffset = 0; rowOffset < pasteRows; rowOffset += 1) {
    for (let colOffset = 0; colOffset < pasteCols; colOffset += 1) {
      const targetCell = target.cellMap.get(`${target.minRow + rowOffset}:${target.minCol + colOffset}`);
      if (!targetCell) return toast('目标区域必须是连续的单元格区域。');
      const sourceCell = fillAll ? source[0][0] : source[rowOffset]?.[colOffset];
      const field = fieldForCell(targetCell);
      const record = recordForCell(targetCell);
      if (!field || !record) return toast('找不到目标单元格对应的数据。');
      const parsed = valueForPastedCell(sourceCell, field);
      if (!parsed.ok) return toast(parsed.message);
      const current = changesByRecord.get(record.id) || { record, data: { ...record.data } };
      current.data[field.id] = parsed.value;
      changesByRecord.set(record.id, current);
    }
  }

  for (const { record, data } of changesByRecord.values()) {
    if (fieldValuesEqual(record.data, data)) continue;
    await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
  }
  await loadCurrentPageRecords();
  renderRuntime();
  toast(`已粘贴 ${pasteRows * pasteCols} 个单元格`);
}

export function targetSelectionBounds(cells) {
  const positions = cells.map((cell) => ({ ...cellPosition(cell), cell }));
  const rows = positions.map((item) => item.row);
  const cols = positions.map((item) => item.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  return {
    minRow,
    minCol,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    cellMap: new Map(positions.map((item) => [`${item.row}:${item.col}`, item.cell]))
  };
}

export function fieldForCell(cell) {
  const page = currentPage();
  const entity = page ? (pageEntityForRecordLoad(page) || entityFor(page)) : state.currentApp?.schema.entities[0];
  return entity?.fields.find((field) => field.id === cell.dataset.fieldId);
}

export function recordForCell(cell) {
  return state.records.find((record) => record.id === cell.dataset.recordId);
}

export function valueForPastedCell(sourceCell, targetField) {
  const sourceType = sourceCell?.fieldType || '';
  const text = String(sourceCell?.text ?? sourceCell?.value ?? '');
  if (sourceType && !fieldTypesCompatible(sourceType, targetField.type)) {
    return { ok: false, message: `不能粘贴：复制字段类型「${fieldTypeLabel(sourceType)}」与目标字段「${targetField.label}」不兼容。` };
  }
  if (sourceType && sourceCell && sourceCell.value !== undefined && sourceCell.value !== null) {
    return normalizePastedValue(sourceCell.value, targetField);
  }
  return normalizePastedValue(text, targetField);
}

export function fieldTypesCompatible(sourceType, targetType) {
  if (sourceType === targetType) return true;
  const textLike = new Set(['text', 'textarea', 'richText']);
  if (textLike.has(sourceType) && textLike.has(targetType)) return true;
  if (sourceType === 'select' && targetType === 'multiSelect') return true;
  if (sourceType === 'date' && targetType === 'datetime') return true;
  return false;
}

export function normalizePastedValue(value, field) {
  if (value === null || value === undefined) return { ok: true, value: defaultValueForField(field) };
  if (field.type === 'number') {
    const normalized = String(value).replace(/[¥,%\s]/g, '');
    if (normalized === '') return { ok: true, value: null };
    const number = Number(normalized);
    return Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false, message: `「${field.label}」需要数字，无法粘贴「${value}」。` };
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value };
    const normalized = String(value).trim().toLowerCase();
    if (['true', '是', '对', '1', 'yes', 'y'].includes(normalized)) return { ok: true, value: true };
    if (['false', '否', '错', '0', 'no', 'n', ''].includes(normalized)) return { ok: true, value: false };
    return { ok: false, message: `「${field.label}」需要是/否值，无法粘贴「${value}」。` };
  }
  if (field.type === 'select') return pastedSelectValue(value, field);
  if (field.type === 'multiSelect') return pastedMultiSelectValue(value, field);
  if (field.type === 'date') return pastedDateValue(value, field);
  if (field.type === 'datetime') return pastedDateTimeValue(value, field);
  if (field.type === 'relation') return pastedRelationValue(value, field);
  if (field.type === 'image' || field.type === 'file') {
    return typeof value === 'object'
      ? { ok: true, value }
      : { ok: false, message: `「${field.label}」是附件字段，不能从文本粘贴。` };
  }
  return { ok: true, value: String(value) };
}

export function pastedSelectValue(value, field) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true, value: '' };
  const option = (field.options || []).map((o) => {
    const obj = typeof o === 'string' ? { id: o, label: o, color: 'gray' } : { id: o?.id || o?.value || o?.label || '', label: o?.label || o?.name || o?.value || o?.id || '', color: o?.color || 'gray' };
    return obj;
  }).find((item) => item.id === text || item.label === text);
  return option
    ? { ok: true, value: option.id }
    : { ok: false, message: `「${field.label}」没有选项「${text}」。` };
}

export function pastedMultiSelectValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.map((item) => {
      const obj = typeof item === 'string' ? { id: item, label: item, color: 'gray' } : { id: item?.id || item?.value || item?.label || item || '', label: item?.label || item?.name || item?.value || item?.id || item || '', color: item?.color || 'gray' };
      return obj;
    }).map((item) => item.id || item).filter(Boolean);
    const validIds = new Set((field.options || []).map((item) => {
      const obj = typeof item === 'string' ? { id: item, label: item, color: 'gray' } : { id: item?.id || item?.value || item?.label || '', label: item?.label || item?.name || item?.value || item?.id || '', color: item?.color || 'gray' };
      return obj.id;
    }));
    const invalid = values.find((item) => !validIds.has(item));
    return invalid ? { ok: false, message: `「${field.label}」没有选项「${invalid}」。` } : { ok: true, value: values };
  }
  const parts = String(value || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  const options = (field.options || []).map((o) => {
    return typeof o === 'string' ? { id: o, label: o, color: 'gray' } : { id: o?.id || o?.value || o?.label || '', label: o?.label || o?.name || o?.value || o?.id || '', color: o?.color || 'gray' };
  });
  const values = [];
  for (const part of parts) {
    const option = options.find((item) => item.id === part || item.label === part);
    if (!option) return { ok: false, message: `「${field.label}」没有选项「${part}」。` };
    values.push(option.id);
  }
  return { ok: true, value: values };
}

export function pastedDateValue(value, field) {
  const text = String(value || '').trim().replaceAll('/', '-');
  if (!text) return { ok: true, value: '' };
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return { ok: false, message: `「${field.label}」需要日期，无法粘贴「${value}」。` };
  return { ok: true, value: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` };
}

export function pastedDateTimeValue(value, field) {
  const text = String(value || '').trim().replaceAll('/', '-').replace(' ', 'T');
  if (!text) return { ok: true, value: '' };
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{1,2}))?/);
  if (!match) return { ok: false, message: `「${field.label}」需要日期时间，无法粘贴「${value}」。` };
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const time = match[4] ? `T${match[4].padStart(2, '0')}:${match[5].padStart(2, '0')}` : '';
  return { ok: true, value: `${date}${time}` };
}

export function pastedRelationValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.map((item) => item.targetRecordId || item.recordId || item).filter(Boolean);
    return { ok: true, value: field.multiple ? values : values[0] || '' };
  }
  if (value && typeof value === 'object') {
    const id = value.targetRecordId || value.recordId || value.id;
    return { ok: true, value: field.multiple ? [id].filter(Boolean) : id || '' };
  }
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: field.multiple ? [] : '' };
  const targetEntity = state.currentApp.schema.entities.find((item) => item.id === field.targetEntity);
  const candidates = recordsFor(field.targetEntity);
  const record = candidates.find((item) => item.id === text || relationDisplayValue(field, targetEntity, item) === text);
  if (!record) return { ok: false, message: `「${field.label}」找不到关联记录「${text}」。` };
  return { ok: true, value: field.multiple ? [record.id] : record.id };
}

export function fallbackCopyText(text) {
  const input = h('textarea', { class: 'clipboard-fallback', readonly: 'readonly' }, text);
  document.body.append(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  input.remove();
  return copied;
}

export function hideCellCopyToolbar() {
  document.querySelector('.cell-copy-toolbar')?.remove();
}

export function showCellCopyToolbar() {
  hideCellCopyToolbar();
  const cells = [...document.querySelectorAll('.editable-cell.selected-cell')];
  if (!cells.length) return;
  const bounds = cells.reduce((rect, cell) => {
    const next = cell.getBoundingClientRect();
    if (!rect) return { left: next.left, top: next.top, right: next.right, bottom: next.bottom };
    return {
      left: Math.min(rect.left, next.left),
      top: Math.min(rect.top, next.top),
      right: Math.max(rect.right, next.right),
      bottom: Math.max(rect.bottom, next.bottom)
    };
  }, null);
  const toolbar = h('div', {
    class: 'cell-copy-toolbar',
    style: `left:${Math.max(8, bounds.right - 112)}px; top:${bounds.bottom + 8}px`
  }, [
    h('button', { class: 'secondary', text: '复制成图片', onclick: copySelectedCellsAsImage })
  ]);
  document.body.append(toolbar);
}

export async function copySelectedCellsAsImage() {
  const imageRows = selectedCellImageRows();
  if (!imageRows.length) {
    hideCellCopyToolbar();
    return toast('先选择要复制的单元格。');
  }
  try {
    const blob = await selectedCellsImageBlob(imageRows);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制为图片');
  } catch {
    toast('当前浏览器不支持复制图片到剪贴板。');
  } finally {
    hideCellCopyToolbar();
  }
}

export function selectedCellImageRows() {
  const cells = selectedCellElements();
  if (!cells.length) return [];
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, cellImageContent(cell));
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

export function cellImageContent(cell) {
  const tags = [...cell.querySelectorAll('.select-tag, .relation-tag')].map((tag) => {
    const style = getComputedStyle(tag);
    return {
      text: tag.textContent.trim(),
      background: style.backgroundColor || '#f8fafc',
      color: style.color || '#253044',
      border: style.borderColor || '#cbd5e1'
    };
  }).filter((tag) => tag.text);
  return {
    text: cell.dataset.copyValue || cell.textContent.trim(),
    tags
  };
}

export function selectedCellsImageBlob(rows) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const cellWidth = 150;
  const cellHeight = 34;
  const padding = 10;
  const pixelRatio = Math.max(3, window.devicePixelRatio || 1);
  const width = Math.max(1, rows[0].length) * cellWidth + padding * 2;
  const height = rows.length * cellHeight + padding * 2;
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#dbe2ea';
  context.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textBaseline = 'middle';
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const x = padding + colIndex * cellWidth;
      const y = padding + rowIndex * cellHeight;
      context.strokeStyle = '#dbe2ea';
      context.strokeRect(x, y, cellWidth, cellHeight);
      drawCellImageContent(context, cell, x, y, cellWidth, cellHeight);
    });
  });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片生成失败')), 'image/png'));
}

export function drawCellImageContent(context, cell, x, y, width, height) {
  if (!cell.tags.length) {
    context.fillStyle = '#253044';
    context.fillText(String(cell.text || '').slice(0, 24), x + 8, y + height / 2);
    return;
  }
  let cursorX = x + 8;
  let cursorY = y + 6;
  const maxX = x + width - 8;
  for (const tag of cell.tags) {
    const tagText = String(tag.text || '');
    if (!tagText) continue;
    const tagWidth = Math.min(maxX - cursorX, Math.ceil(context.measureText(tagText).width) + 16);
    if (tagWidth <= 14) break;
    context.fillStyle = tag.background;
    drawRoundedRect(context, cursorX, cursorY, tagWidth, 22, 4);
    context.fill();
    context.strokeStyle = tag.border;
    drawRoundedRect(context, cursorX, cursorY, tagWidth, 22, 4);
    context.stroke();
    context.fillStyle = tag.color;
    context.fillText(tagText, cursorX + 8, cursorY + 11);
    cursorX += tagWidth + 4;
  }
}

export function drawRoundedRect(context, x, y, width, height, radius) {
  const nextRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + nextRadius, y);
  context.lineTo(x + width - nextRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  context.lineTo(x + width, y + height - nextRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  context.lineTo(x + nextRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  context.lineTo(x, y + nextRadius);
  context.quadraticCurveTo(x, y, x + nextRadius, y);
  context.closePath();
}

export function clearActiveTableSelection() {
  document.querySelectorAll('th.selected-column-header').forEach((item) => item.classList.remove('selected-column-header'));
  document.querySelectorAll('.editable-cell.selected-cell').forEach(clearCellSelectionClasses);
  state.cellSelection = null;
  hideCellCopyToolbar();
}

export function clickedOutsideTableSelection(target) {
  if (target?.closest?.('.context-menu, .cell-choice-dropdown, .cell-copy-toolbar')) return false;
  return !target?.closest?.('table');
}

export function selectColumnHeader(header) {
  clearActiveTableSelection();
  header.classList.add('selected-column-header');
}

export async function insertRowAround(entity, referenceRecord, position) {
  try {
    const data = {};
    for (const field of entity.fields) data[field.id] = defaultValueForField(field);
    const refTime = new Date(referenceRecord.createdAt).getTime();
    const offset = position === 'above' ? -1 : 1;
    const _createdAt = new Date(refTime + offset).toISOString();
    await api(`/api/apps/${state.currentApp.id}/records`, {
      method: 'POST',
      body: JSON.stringify({ entityId: entity.id, data, _createdAt })
    });
    await loadCurrentPageRecords();
    renderRuntime();
    toast(`已新增 1 行`);
  } catch (error) {
    toast(`新增行失败：${error.message}`);
  }
}
