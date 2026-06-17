import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { renderRuntime } from './index.js';
import { updateField, duplicateField, deleteField, insertField, openFieldEditModal } from './FieldEditor.js';
import { removeRecord } from './RecordModal.js';
import { filterOperators, openFilterModal, setListConfig, getListConfig } from './ViewBar.js';
import { selectColumnHeader, insertRowAround } from './CellSelection.js';

export function renderResizableHeader(entity, field, nextField, listConfig) {
  const width = Number(listConfig.columnWidths?.[field.id] || 160);
  const sortIndex = (listConfig.sorts || []).findIndex((sort) => sort.field === field.id);
  const sort = sortIndex >= 0 ? listConfig.sorts[sortIndex] : null;
  const label = `${field.label}${sort ? `${sort.direction === 'desc' ? ' ↓' : ' ↑'}${listConfig.sorts.length > 1 ? sortIndex + 1 : ''}` : ''}`;
  const children = [h('span', { text: label }), h('span', { class: 'resize-edge', title: '拖动表头边框调整列宽' })];
  const header = h(
    'th',
    {
      class: 'resizable-column',
      style: `width:${width}px; min-width:${width}px`,
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
  const span = header.querySelector('span');
  if (!span) return;
  const currentLabel = span.textContent || field.label;
  header.classList.add('header-editing');
  const input = h('input', { class: 'header-edit-input', value: field.label });
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const label = input.value.trim();
    if (save && label && label !== field.label) await updateField(entity.id, field.id, { label });
    else {
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
    h('button', { class: 'danger ghost-menu', text: '删除行', onclick: () => { closeContextMenu(); removeRecord(record.id, entity.id); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}
