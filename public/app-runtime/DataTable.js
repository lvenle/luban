import { h, buttonLabel } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { bindFloatingMenu } from '../common/modal.js';
import { readStorage, writeStorage } from '../common/storage.js';
import { state, writeRoute, storageKey, entityFor, recordsFor, viewOrderedFields, applyViewFilters, sortRecords, groupRecords } from '../app.js';
import { renderRuntime, loadCurrentPageRecords, renderInfiniteLoadSentinel } from './index.js';
import { getViews, getCurrentView, normalizeView, makeViewId, renderViewBar, renderViewMenu, openViewMenu, startViewNameEdit, createView, cloneView, renameView, deleteView, openFilterModal, openSortModal, openGroupModal, updateCurrentView, setListConfig, getListConfig } from './ViewBar.js';
import {
  renderResizableHeader, renderTableColgroup, columnWidthStyle, actionColumnWidth, actionColumnStyle,
  frozenFieldClass, frozenFieldStyle, frozenUtilityClass, frozenUtilityStyle, hasFrozenColumns
} from './TableHeader.js';
import { renderRecordRow, renderSummaryRow, summaryCellClass, renderSummaryValue, openListConfigModal, openFormLayoutModal } from './TableRow.js';
import { searchInputForField, renderFieldValue, formatFieldValue } from './CellEditor.js';
import { openRecordModal, quickAddRecord, bulkDeleteRecords } from './RecordModal.js';
import { renderTypedTableView } from './TypedViews.js';
import { summaryMode } from './SummaryValues.js';

export function renderExportMenu(entity, exportSelectedLink) {
  return bindFloatingMenu(h('details', { class: 'export-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { class: 'secondary icon-label-button', title: '导出数据' }, buttonLabel('download', '导出')),
    h('div', { class: 'export-menu-popover' }, [
      h('a', { class: 'ghost-menu', href: exportXlsxHref(entity), download: exportFileName('all') }, '导出全部'),
      exportSelectedLink
    ])
  ]));
}

export function renderQuickAddRow(entity, visibleFields, listConfig = {}) {
  const frozen = hasFrozenColumns(listConfig, visibleFields);
  return h('tr', { class: 'quick-add-row' }, [
    h('td', { colspan: visibleFields.length + 3 }, [
      h('button', {
        class: `ghost quick-add-row-button icon-label-button${frozen ? ' frozen-quick-add-button' : ''}`,
        onclick: () => quickAddRecord(entity)
      }, buttonLabel('add', '快速新增行'))
    ])
  ]);
}

export function tableWidthStyle(visibleFields, listConfig) {
  const width = 42 + 64 + actionColumnWidth(listConfig) + visibleFields.reduce((sum, field) => sum + Number(listConfig.columnWidths?.[field.id] || 160), 0);
  return `width:${width}px; min-width:${width}px`;
}

export function stretchTableToWrap(table, visibleFields, listConfig) {
  const wrap = table.closest('.table-wrap');
  if (!wrap || !visibleFields.length) return;
  const baseWidth = 42 + 64 + actionColumnWidth(listConfig) + visibleFields.reduce((sum, field) => sum + Number(listConfig.columnWidths?.[field.id] || 160), 0);
  const targetWidth = Math.max(baseWidth, Math.floor(wrap.clientWidth));
  const extra = targetWidth - baseWidth;
  const lastField = visibleFields[visibleFields.length - 1];
  const lastWidth = Number(listConfig.columnWidths?.[lastField.id] || 160) + extra;
  table.style.width = `${targetWidth}px`;
  table.style.minWidth = `${targetWidth}px`;
  const lastCol = table.querySelector(`col[data-field-id="${lastField.id}"]`);
  if (lastCol) lastCol.setAttribute('style', `width:${lastWidth}px; min-width:${lastWidth}px`);
  const lastHeader = [...table.querySelectorAll('th')].find((th) => th.textContent.includes(lastField.label));
  if (lastHeader) {
    lastHeader.style.width = `${lastWidth}px`;
    lastHeader.style.minWidth = `${lastWidth}px`;
  }
}

export function exportXlsxHref(entity, selectedIds = null) {
  const params = new URLSearchParams({ entity: entity.id });
  if (selectedIds?.size) params.set('ids', [...selectedIds].join(','));
  return `/api/apps/${state.currentApp.id}/export.xlsx?${params.toString()}`;
}

export function exportFileName(scope = 'all') {
  const slug = state.currentApp.slug || state.currentApp.id;
  return scope === 'selected' ? `${slug}-selected.xlsx` : `${slug}.xlsx`;
}

export function importTableData(entity) {
  const input = h('input', { type: 'file', accept: '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'hidden' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const params = new URLSearchParams({ name: file.name });
      const body = await api(`/api/apps/${state.currentApp.id}/tables/${entity.id}/import?${params.toString()}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
        body: await file.arrayBuffer()
      });
      await loadCurrentPageRecords();
      renderRuntime();
      toast(`已导入 ${body.importedCount || 0} 条数据`);
    } catch (error) {
      toast(error.message);
    }
  });
  document.body.append(input);
  input.click();
}

export function renderListPage(page) {
  const entity = entityFor(page);
  const records = recordsFor(entity.id);
  const listConfig = getListConfig(entity);
  if (listConfig.type !== 'list') return renderTypedTableView(page, entity, records, listConfig);
  const visibleFields = viewOrderedFields(entity, listConfig).filter((field) => listConfig.visibleFields.includes(field.id));
  const globalSearch = h('input', { placeholder: '搜索全部记录' });
  const searchInputs = new Map();
  const tableBody = h('tbody');
  const selectionKey = storageKey('selection', entity.id);
  const selectedIds = new Set(readStorage(selectionKey, []));
  const syncSelection = () => writeStorage(selectionKey, [...selectedIds]);
  const validRecordIds = new Set(records.map((record) => record.id));
  let cleanedSelection = false;
  if (!state.recordPagination[entity.id]?.hasMore) {
    for (const recordId of [...selectedIds]) {
      if (!validRecordIds.has(recordId)) {
        selectedIds.delete(recordId);
        cleanedSelection = true;
      }
    }
  }
  if (cleanedSelection) syncSelection();
  const selectedCount = () => selectedIds.size;
  let currentRenderedIds = [];
  let selectAllInput = null;
  const selectionLabel = h('span', { class: 'selection-label muted', text: selectedCount() ? `已选 ${selectedCount()} 条` : '' });
  const exportSelectedLink = h('a', {
    class: 'ghost-menu',
    download: exportFileName('selected'),
    onclick: (event) => {
      if (selectedCount()) return;
      event.preventDefault();
      toast('先选择要导出的记录。');
    }
  });
  const updateExportSelectedLink = () => {
    const count = selectedCount();
    exportSelectedLink.textContent = `导出选中（${count}条数据）`;
    exportSelectedLink.href = count ? exportXlsxHref(entity, selectedIds) : '#';
    exportSelectedLink.download = exportFileName('selected');
    exportSelectedLink.classList.toggle('disabled-menu-item', !count);
    exportSelectedLink.setAttribute('aria-disabled', count ? 'false' : 'true');
  };
  const bulkDeleteButton = h('button', {
    class: 'secondary icon-label-button danger-text',
    disabled: selectedCount() ? null : 'disabled',
    onclick: () => bulkDeleteRecords(entity, selectedIds, selectionKey)
  }, buttonLabel('trash', '批量删除'));
  const bulkDeleteSlot = h('span', { class: 'bulk-delete-slot' });
  const updateSelectionState = () => {
    selectionLabel.textContent = selectedCount() ? `已选 ${selectedCount()} 条` : '';
    if (selectedCount()) {
      bulkDeleteButton.removeAttribute('disabled');
      if (!bulkDeleteSlot.contains(bulkDeleteButton)) bulkDeleteSlot.replaceChildren(bulkDeleteButton);
    } else {
      bulkDeleteButton.setAttribute('disabled', 'disabled');
      bulkDeleteSlot.replaceChildren();
    }
    updateExportSelectedLink();
    if (selectAllInput) {
      const selectableCount = currentRenderedIds.length;
      const checkedCount = currentRenderedIds.filter((id) => selectedIds.has(id)).length;
      selectAllInput.disabled = selectableCount ? false : true;
      selectAllInput.checked = selectableCount > 0 && checkedCount === selectableCount;
      selectAllInput.indeterminate = checkedCount > 0 && checkedCount < selectableCount;
      selectAllInput.title = selectAllInput.checked ? '取消选择当前表格' : '选择当前表格';
    }
  };
  updateExportSelectedLink();
  const updateSummaryMode = (field, mode) => {
    const summaries = { ...(listConfig.summaries || {}) };
    if (mode === summaryMode(field, {})) delete summaries[field.id];
    else summaries[field.id] = mode;
    listConfig.summaries = summaries;
    setListConfig(entity, listConfig);
    renderRuntime();
  };
  const drawRows = (items) => {
    tableBody.innerHTML = '';
    currentRenderedIds = [];
    const filteredItems = applyViewFilters(items, entity, listConfig);
    const sortedItems = sortRecords(filteredItems, listConfig);
    if (sortedItems.length === 0) {
      tableBody.append(h('tr', {}, [h('td', { colspan: visibleFields.length + 3, class: 'muted', text: '暂无记录' })]));
      tableBody.append(renderQuickAddRow(entity, visibleFields, listConfig));
      updateSelectionState();
      return;
    }
    if (listConfig.group?.field) {
      let rowNumber = 1;
      for (const group of groupRecords(sortedItems, entity, listConfig.group)) {
        const collapsed = (listConfig.group.collapsed || []).includes(group.key);
        tableBody.append(h('tr', { class: 'group-row summary-group-row' }, [
          h('td', { colspan: 2 }, [
            h('button', {
              class: 'ghost group-toggle',
              text: `${collapsed ? '▶' : '▼'} ${group.label} (${group.records.length})`,
              onclick: () => {
                const collapsedKeys = new Set(listConfig.group.collapsed || []);
                collapsed ? collapsedKeys.delete(group.key) : collapsedKeys.add(group.key);
                listConfig.group.collapsed = [...collapsedKeys];
                setListConfig(entity, listConfig);
                renderRuntime();
              }
            })
          ]),
          ...visibleFields.map((field, index) => h('td', {
            class: `${summaryCellClass(field)} ${frozenFieldClass(listConfig, visibleFields, index)}`.trim(),
            style: `${columnWidthStyle(listConfig, field)};${frozenFieldStyle(listConfig, visibleFields, index)}`,
            'data-field-id': field.id
          }, [renderSummaryValue(group.records, field, summaryMode(field, listConfig.summaries), '小计')])),
          h('td', { class: 'sticky-action-cell action-cell summary-action-cell', style: actionColumnStyle(listConfig) })
        ]));
        if (!collapsed) {
          for (const record of group.records) {
            currentRenderedIds.push(record.id);
            tableBody.append(renderRecordRow(entity, visibleFields, record, listConfig, rowNumber, selectedIds, syncSelection, updateSelectionState, rowNumber - 1));
            rowNumber += 1;
          }
        }
      }
      tableBody.append(renderSummaryRow(sortedItems, visibleFields, listConfig, '合计', updateSummaryMode));
      tableBody.append(renderQuickAddRow(entity, visibleFields, listConfig));
      updateSelectionState();
      return;
    }
    for (const [index, record] of sortedItems.entries()) {
      currentRenderedIds.push(record.id);
      tableBody.append(renderRecordRow(entity, visibleFields, record, listConfig, index + 1, selectedIds, syncSelection, updateSelectionState, index));
    }
    tableBody.append(renderSummaryRow(sortedItems, visibleFields, listConfig, '合计', updateSummaryMode));
    tableBody.append(renderQuickAddRow(entity, visibleFields, listConfig));
    updateSelectionState();
  };
  const applySearch = () => {
    const globalQuery = globalSearch.value.toLowerCase();
    const fieldsById = new Map(entity.fields.map((field) => [field.id, field]));
    const activeConditions = [...searchInputs.entries()]
      .map(([fieldId, input]) => [fieldId, String(input.value || '').toLowerCase()])
      .filter(([, value]) => value);
    drawRows(records.filter((record) => {
      if (globalQuery && !JSON.stringify(record.data).toLowerCase().includes(globalQuery)) return false;
      return activeConditions.every(([fieldId, value]) => formatFieldValue(record.data[fieldId], fieldsById.get(fieldId) || {}).toLowerCase().includes(value));
    }));
  };
  globalSearch.addEventListener('input', applySearch);
  globalSearch.addEventListener('change', applySearch);
  const searchFields = viewOrderedFields(entity, listConfig).filter((field) => listConfig.searchFields.includes(field.id)).slice(0, 3);
  for (const field of searchFields) {
    const input = searchInputForField(field);
    input.addEventListener('input', applySearch);
    input.addEventListener('change', applySearch);
    searchInputs.set(field.id, input);
  }
  selectAllInput = h('input', {
    type: 'checkbox',
    title: '选择当前表格',
    onchange: (event) => {
      const checked = event.currentTarget.checked;
      for (const recordId of currentRenderedIds) checked ? selectedIds.add(recordId) : selectedIds.delete(recordId);
      syncSelection();
      tableBody.querySelectorAll('input[data-record-id]').forEach((input) => {
        input.checked = selectedIds.has(input.dataset.recordId);
      });
      updateSelectionState();
    }
  });
  const rowHeightClass = `row-height-${listConfig.rowHeight || 'low'}`;
  const table = h('table', {
    class: [hasFrozenColumns(listConfig, visibleFields) ? 'has-frozen-columns' : '', rowHeightClass].filter(Boolean).join(' '),
    style: tableWidthStyle(visibleFields, listConfig)
  }, [
    renderTableColgroup(visibleFields, listConfig),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { class: `select-cell ${frozenUtilityClass(listConfig, visibleFields)}`.trim(), style: frozenUtilityStyle(listConfig, visibleFields, 0) }, [
          selectAllInput
        ]),
        h('th', { class: `index-cell ${frozenUtilityClass(listConfig, visibleFields)}`.trim(), style: frozenUtilityStyle(listConfig, visibleFields, 42), text: '序号' }),
        ...visibleFields.map((field, index) =>
          renderResizableHeader(entity, field, visibleFields[index + 1], listConfig, visibleFields, index)
        ),
        h('th', { class: 'sticky-action-cell action-cell', style: actionColumnStyle(listConfig), text: '操作' })
      ])
    ]),
    tableBody
  ]);
  drawRows(records);
  requestAnimationFrame(() => stretchTableToWrap(table, visibleFields, listConfig));
  return h('div', { class: 'panel table-panel' }, [
    renderViewBar(entity, listConfig),
    h('div', { class: 'table-command-row' }, [
      h('div', { class: 'row action-row table-action-groups' }, [
        h('div', { class: 'toolbar-action-group data-entry-group' }, [
          h('button', { class: 'table-add-button icon-label-button', onclick: () => openRecordModal(entity) }, buttonLabel('add', '添加记录'))
        ]),
        h('div', { class: 'toolbar-action-group data-mutation-group' }, [
          h('button', { class: 'secondary icon-label-button', onclick: () => importTableData(entity) }, buttonLabel('upload', '导入')),
          renderExportMenu(entity, exportSelectedLink),
          bulkDeleteSlot,
          selectionLabel
        ]),
        h('div', { class: 'toolbar-action-group view-rule-group' }, [
          h('button', { class: `secondary icon-label-button${(listConfig.filters || []).length ? ' active' : ''}`, onclick: () => openFilterModal(entity) }, buttonLabel('filter', '筛选')),
          h('button', { class: `secondary icon-label-button${(listConfig.sorts || []).length ? ' active' : ''}`, onclick: () => openSortModal(entity) }, buttonLabel('sort', '排序')),
          h('button', { class: `secondary icon-label-button${listConfig.group?.field ? ' active' : ''}`, onclick: () => openGroupModal(entity) }, buttonLabel('group', '分组'))
        ]),
        h('div', { class: 'toolbar-action-group structure-config-group' }, [
          h('button', { class: 'secondary icon-label-button', onclick: () => openListConfigModal(entity) }, buttonLabel('fields', '字段设置')),
          h('button', { class: 'secondary icon-label-button', onclick: () => openFormLayoutModal(entity) }, buttonLabel('form', '表单视图'))
        ])
      ]),
      h('div', { class: 'quick-searches' }, [
        h('div', { class: 'compact-field global-search' }, [h('label', { text: '搜索' }), globalSearch]),
        ...searchFields.map((field) => h('div', { class: 'compact-field' }, [h('label', { text: field.label }), searchInputs.get(field.id)]))
      ])
    ]),
    h('div', { class: 'table-wrap' }, [
      table
    ]),
    renderInfiniteLoadSentinel(entity)
  ]);
}
