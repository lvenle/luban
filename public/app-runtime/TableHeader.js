import { h } from '../common/dom.js';
import { fieldIcon } from './FieldIcons.js';
import { toast } from '../common/toast.js';
import { api } from '../common/api.js';
import { renderRuntime, loadCurrentPageRecords } from './index.js';
import { updateField, duplicateField, deleteField, insertField, openFieldEditModal } from './FieldEditor.js';
import { removeRecord } from './RecordModal.js';
import { filterOperators, openFilterModal, setListConfig, getListConfig } from './ViewBar.js';
import { selectColumnHeader, insertRowAround } from './CellSelection.js';
import { reorderIds, frozenColumnMeta } from './Ordering.js';
import { state } from '../app.js';

export function renderResizableHeader(entity, field, nextField, listConfig, visibleFields = [], fieldIndex = 0) {
  const width = Number(listConfig.columnWidths?.[field.id] || 160);
  const sortIndex = (listConfig.sorts || []).findIndex((sort) => sort.field === field.id);
  const sort = sortIndex >= 0 ? listConfig.sorts[sortIndex] : null;
  const label = `${field.label}${sort ? `${sort.direction === 'desc' ? ' ↓' : ' ↑'}${listConfig.sorts.length > 1 ? sortIndex + 1 : ''}` : ''}`;
  const icon = fieldIcon(field.type);
  const children = [h('span', { class: 'header-label-with-icon' }, [icon, h('span', { text: label })]), h('span', { class: 'resize-edge', title: '拖动表头边框调整列宽' })];
  const header = h(
    'th',
    {
      class: `resizable-column column-drag-target ${frozenFieldClass(listConfig, visibleFields, fieldIndex)}`.trim(),
      style: `${columnWidthStyle(listConfig, field)};${frozenFieldStyle(listConfig, visibleFields, fieldIndex)}`,
      draggable: 'true',
      'data-field-id': field.id,
      onclick: (event) => {
        if (event.target?.classList?.contains('resize-edge')) return;
        selectColumnHeader(header);
      },
      ondblclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        startHeaderLabelEdit(header, entity, field);
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        openHeaderContextMenu(event, entity, field, listConfig);
      }
    },
    children
  );
  bindHeaderColumnDrag(header, entity, field, listConfig);
  const handle = header.querySelector('.resize-edge');
  if (!handle) return header;
  handle.addEventListener('click', (event) => event.stopPropagation());
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    startColumnResize(event, entity, field, nextField, listConfig, header);
  });
  return header;
}

export function startColumnResize(event, entity, field, nextField, listConfig, header) {
  const startX = event.clientX;
  const nextHeader = header.nextElementSibling;
  const table = header.closest('table');
  const cols = [...(table?.querySelectorAll('col') || [])];
  const currentCol = cols[header.cellIndex];
  const nextCol = cols[header.cellIndex + 1];
  const startWidth = Math.round(header.getBoundingClientRect().width) || Number(listConfig.columnWidths?.[field.id] || 160);
  const resizingActionColumn = !nextField;
  const startNextWidth = Math.round(nextHeader?.getBoundingClientRect().width || 0) || (resizingActionColumn ? actionColumnWidth(listConfig) : Number(listConfig.columnWidths?.[nextField.id] || 160));
  const tableWidth = Math.round(table?.getBoundingClientRect().width || 0);
  if (table && tableWidth) {
    table.style.width = `${tableWidth}px`;
    table.style.minWidth = `${tableWidth}px`;
  }
  const minWidth = 96;
  const maxDelta = resizingActionColumn ? Infinity : startNextWidth - minWidth;
  const minDelta = minWidth - startWidth;
  document.body.classList.add('resizing-column');
  const applyWidths = (delta) => {
    const nextWidth = Math.round(startWidth + delta);
    const adjacentWidth = resizingActionColumn ? startNextWidth : Math.round(startNextWidth - delta);
    const leftStyle = `width:${nextWidth}px; min-width:${nextWidth}px`;
    const rightStyle = `width:${adjacentWidth}px; min-width:${adjacentWidth}px`;
    header.style.width = `${nextWidth}px`;
    header.style.minWidth = `${nextWidth}px`;
    if (currentCol) currentCol.setAttribute('style', leftStyle);
    if (nextHeader && !resizingActionColumn) {
      nextHeader.style.width = `${adjacentWidth}px`;
      nextHeader.style.minWidth = `${adjacentWidth}px`;
    }
    if (nextCol && !resizingActionColumn) nextCol.setAttribute('style', rightStyle);
    if (table && tableWidth && resizingActionColumn) {
      const nextTableWidth = Math.max(42 + 64 + actionColumnWidth(listConfig) + minWidth, tableWidth + (nextWidth - startWidth));
      table.style.width = `${nextTableWidth}px`;
      table.style.minWidth = `${nextTableWidth}px`;
    }
    return { nextWidth, adjacentWidth };
  };
  const onMove = (moveEvent) => {
    const delta = Math.max(minDelta, Math.min(maxDelta, moveEvent.clientX - startX));
    applyWidths(delta);
  };
  const onUp = (upEvent) => {
    const delta = Math.max(minDelta, Math.min(maxDelta, upEvent.clientX - startX));
    const widths = applyWidths(delta);
    listConfig.columnWidths = {
      ...(listConfig.columnWidths || {}),
      [field.id]: widths.nextWidth
    };
    if (!resizingActionColumn) listConfig.columnWidths[nextField.id] = widths.adjacentWidth;
    setListConfig(entity, listConfig);
    document.body.classList.remove('resizing-column');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    renderRuntime();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function startHeaderLabelEdit(header, entity, field) {
  const labelWrap = header.querySelector('.header-label-with-icon');
  const textSpan = labelWrap ? labelWrap.querySelector('span:last-child') : header.querySelector('span');
  if (!textSpan) return;
  const currentLabel = textSpan.textContent || field.label;
  header.classList.add('header-editing');
  const input = h('input', { class: 'header-edit-input', value: field.label });
  textSpan.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const label = input.value.trim();
    if (save && label && label !== field.label) {
      await updateField(entity.id, field.id, { label });
    } else {
      header.classList.remove('header-editing');
      input.replaceWith(h('span', { text: currentLabel }));
    }
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') finish(false);
  });
}

export function openHeaderContextMenu(event, entity, field, listConfig) {
  closeContextMenu();
  const menu = h('div', { class: 'context-menu', style: `left:${event.clientX}px; top:${event.clientY}px` }, [
    h('button', { class: 'ghost-menu', text: '编辑字段', onclick: () => { openFieldEditModal(entity, field); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '隐藏字段', onclick: () => { hideFieldInView(entity, field.id); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: listConfig.frozenFieldId === field.id ? '取消冻结' : '冻结到此列', onclick: () => { freezeThroughField(entity, field.id, listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '复制字段', onclick: () => { duplicateField(entity, field); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '升序', onclick: () => { setFieldSort(entity, field.id, 'asc', listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '降序', onclick: () => { setFieldSort(entity, field.id, 'desc', listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '分组', onclick: () => { setListConfig(entity, { ...listConfig, group: { field: field.id, mode: 'value', collapsed: [] } }); closeContextMenu(); renderRuntime(); } }),
    h('button', { class: 'ghost-menu', text: '筛选', onclick: () => { ensureFilterForField(entity, field.id, listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向左插入列', onclick: () => { insertField(entity, field, 'left'); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向右插入列', onclick: () => { insertField(entity, field, 'right'); closeContextMenu(); } }),
    h('div', { class: 'context-menu-sep' }),
    h('button', { class: 'danger ghost-menu', text: '删除字段', onclick: () => { deleteField(entity, field); closeContextMenu(); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

export function bindHeaderColumnDrag(header, entity, field, listConfig) {
  header.addEventListener('dragstart', (event) => {
    if (event.target?.classList?.contains('resize-edge')) return event.preventDefault();
    selectColumnHeader(header);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', field.id);
    const column = columnElements(header.closest('table'), field.id);
    column.forEach((item) => item.classList.add('column-dragging-cell'));
    const ghost = createColumnDragGhost(header, column);
    document.body.append(ghost);
    event.dataTransfer.setDragImage(ghost, Math.min(event.offsetX || 24, ghost.offsetWidth - 1), 16);
  });
  header.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = header.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    clearColumnDropIndicators();
    columnElements(header.closest('table'), field.id).forEach((item) => { item.dataset.columnDropSide = side; });
    header.dataset.dropSide = side;
  });
  header.addEventListener('drop', (event) => {
    event.preventDefault();
    const sourceFieldId = event.dataTransfer.getData('text/plain');
    const side = header.dataset.columnDropSide || header.dataset.dropSide || 'before';
    if (!sourceFieldId || sourceFieldId === field.id) return;
    const fieldOrder = reorderFieldOrder(listConfig.fieldOrder, sourceFieldId, field.id, side);
    setListConfig(entity, { ...listConfig, fieldOrder });
    clearColumnDragFeedback();
    renderRuntime();
  });
  header.addEventListener('dragend', clearColumnDragFeedback);
}

export function columnElements(table, fieldId) {
  return table ? [...table.querySelectorAll(`th[data-field-id="${fieldId}"], td[data-field-id="${fieldId}"]`)] : [];
}

export function createColumnDragGhost(header, column = []) {
  const width = Math.round(header.getBoundingClientRect().width) || 160;
  const ghost = h('div', { class: 'column-drag-ghost', style: `width:${width}px` });
  for (const item of column.slice(0, 12)) {
    const clone = item.cloneNode(true);
    clone.removeAttribute('style');
    clone.className = 'column-drag-ghost-cell';
    ghost.append(clone);
  }
  if (column.length > 12) ghost.append(h('div', { class: 'column-drag-ghost-more', text: `+${column.length - 12} 行` }));
  return ghost;
}

export function clearColumnDropIndicators() {
  document.querySelectorAll('[data-column-drop-side]').forEach((item) => delete item.dataset.columnDropSide);
}

export function clearColumnDragFeedback() {
  document.querySelectorAll('.column-dragging-cell').forEach((item) => item.classList.remove('column-dragging-cell'));
  document.querySelectorAll('.column-drag-ghost').forEach((item) => item.remove());
  document.querySelectorAll('.column-drag-target').forEach((item) => delete item.dataset.dropSide);
  clearColumnDropIndicators();
}

export function reorderFieldOrder(fieldOrder = [], sourceFieldId, targetFieldId, side = 'before') {
  return reorderIds(fieldOrder, sourceFieldId, targetFieldId, side);
}

export function freezeThroughField(entity, fieldId, listConfig) {
  setListConfig(entity, { ...listConfig, frozenFieldId: listConfig.frozenFieldId === fieldId ? '' : fieldId });
  renderRuntime();
}

export function hasFrozenColumns(listConfig, visibleFields = []) {
  return visibleFields.some((field) => field.id === listConfig.frozenFieldId);
}

export function frozenUtilityClass(listConfig, visibleFields = [], boundary = false) {
  if (!hasFrozenColumns(listConfig, visibleFields)) return '';
  return `frozen-column${boundary ? ' frozen-boundary' : ''}`;
}

export function frozenUtilityStyle(listConfig, visibleFields = [], left = 0) {
  return hasFrozenColumns(listConfig, visibleFields) ? `left:${left}px` : '';
}

export function frozenFieldClass(listConfig, visibleFields = [], fieldIndex = 0) {
  const meta = frozenColumnMeta(visibleFields, listConfig.columnWidths, listConfig.frozenFieldId, fieldIndex);
  if (!meta.frozen) return '';
  return `frozen-column${meta.boundary ? ' frozen-boundary' : ''}`;
}

export function frozenFieldStyle(listConfig, visibleFields = [], fieldIndex = 0) {
  const meta = frozenColumnMeta(visibleFields, listConfig.columnWidths, listConfig.frozenFieldId, fieldIndex);
  return meta.frozen ? `left:${meta.left}px` : '';
}

export function renderTableColgroup(visibleFields, listConfig) {
  return h('colgroup', {}, [
    h('col', { style: 'width:42px; min-width:42px' }),
    h('col', { style: 'width:64px; min-width:64px' }),
    ...visibleFields.map((field) => h('col', { style: columnWidthStyle(listConfig, field), 'data-field-id': field.id })),
    h('col', { style: actionColumnStyle(listConfig), 'data-action-col': 'true' })
  ]);
}

export function columnWidthStyle(listConfig, field) {
  const width = Number(listConfig.columnWidths?.[field.id] || 160);
  return `width:${width}px; min-width:${width}px`;
}

export function actionColumnWidth(listConfig) {
  return Math.max(84, Number(listConfig.actionWidth || 112));
}

export function actionColumnStyle(listConfig) {
  const width = actionColumnWidth(listConfig);
  return `width:${width}px; min-width:${width}px`;
}

export function setFieldSort(entity, fieldId, direction, listConfig) {
  setListConfig(entity, { ...listConfig, sorts: [{ field: fieldId, direction }] });
  renderRuntime();
}

export function hideFieldInView(entity, fieldId) {
  const config = getListConfig(entity);
  const visibleFields = config.visibleFields.filter((id) => id !== fieldId);
  if (!visibleFields.length) return toast('至少保留一个显示字段。');
  setListConfig(entity, { ...config, visibleFields });
  renderRuntime();
}

export function ensureFilterForField(entity, fieldId, listConfig) {
  const field = entity.fields.find((item) => item.id === fieldId);
  if (!field) return;
  const filters = [...(listConfig.filters || []).filter((filter) => filter.field !== fieldId), { field: fieldId, op: filterOperators(field)[0].op, value: '' }];
  setListConfig(entity, { ...listConfig, filters });
  openFilterModal(entity);
}

export function closeContextMenu() {
  document.querySelector('.context-menu')?.remove();
}

export function openCellContextMenu(event, entity, record) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const menu = h('div', { class: 'context-menu', style: `left:${event.clientX}px; top:${event.clientY}px` }, [
    h('button', { class: 'ghost-menu', text: '向上插入行', onclick: () => { insertRowAround(entity, record, 'above'); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向下插入行', onclick: () => { insertRowAround(entity, record, 'below'); closeContextMenu(); } }),
    h('div', { class: 'context-menu-sep' }),
    h('button', { class: 'ghost-menu', text: '复制行', onclick: () => { closeContextMenu(); duplicateRecordRow(entity, record); } }),
    h('div', { class: 'context-menu-sep' }),
    h('button', { class: 'danger ghost-menu', text: '删除行', onclick: () => { closeContextMenu(); removeRecord(record.id, entity.id); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

async function duplicateRecordRow(entity, record) {
  try {
    const body = await api(`/api/apps/${state.currentApp.id}/records`, {
      method: 'POST', body: JSON.stringify({ entityId: entity.id, data: record.data })
    });
    await loadCurrentPageRecords();
    renderRuntime();
    toast('行已复制');
  } catch (err) {
    toast(err.message);
  }
}
