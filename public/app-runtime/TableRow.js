import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { state, viewOrderedFields, orderedFields, getFormLayout, setFormLayout, getFormDesign, setFormDesign } from '../app.js';
import { renderRuntime } from './index.js';
import { columnWidthStyle, actionColumnStyle } from './TableHeader.js';
import { startCellRangeSelection, extendCellRangeSelection, finishCellRangeSelection } from './CellSelection.js';
import { startCellEdit, renderFieldValue, formatFieldValue, inputForField, sampleFieldValue, disablePreviewInput, renderFormFieldBlock } from './CellEditor.js';
import { openCellContextMenu } from './TableHeader.js';
import { openRecordModal, removeRecord } from './RecordModal.js';
import { getListConfig, setListConfig } from './ViewBar.js';

export function renderRecordRow(entity, visibleFields, record, listConfig, rowNumber, selectedIds = new Set(), syncSelection = () => {}, updateSelectionLabel = () => {}, rowIndex = rowNumber - 1) {
  return h('tr', { class: 'editable-row', title: '双击单元格编辑' }, [
    h('td', { class: 'select-cell' }, [
      h('input', {
        type: 'checkbox',
        'data-record-id': record.id,
        checked: selectedIds.has(record.id) ? 'checked' : null,
        onchange: (event) => {
          event.currentTarget.checked ? selectedIds.add(record.id) : selectedIds.delete(record.id);
          syncSelection();
          updateSelectionLabel();
        }
      })
    ]),
    h('td', { class: 'index-cell', text: rowNumber }),
    ...visibleFields.map((field, colIndex) => {
      const cell = h('td', {
        class: 'editable-cell',
        style: columnWidthStyle(listConfig, field),
        'data-row-index': rowIndex,
        'data-col-index': colIndex,
        'data-record-id': record.id,
        'data-field-id': field.id,
        'data-field-type': field.type,
        'data-copy-value': formatFieldValue(record.data[field.id], field),
        onpointerdown: (event) => startCellRangeSelection(event, event.currentTarget),
        onpointerenter: (event) => extendCellRangeSelection(event.currentTarget),
        onpointerup: finishCellRangeSelection,
        ondblclick: (event) => startCellEdit(event.currentTarget, entity, record, field),
        oncontextmenu: (event) => openCellContextMenu(event, entity, record)
      });
      cell.append(renderFieldValue(record.data[field.id], field));
      return cell;
    }),
    h('td', { class: 'sticky-action-cell action-cell', style: actionColumnStyle(listConfig) }, [
      h('button', { class: 'secondary', text: '编辑', onclick: () => openRecordModal(entity, record) }),
      ' ',
      h('button', { class: 'danger', text: '删除', onclick: () => removeRecord(record.id, entity.id) })
    ])
  ]);
}

export function renderSummaryRow(records, visibleFields, listConfig, label = '合计') {
  return h('tr', { class: 'summary-row' }, [
    h('td', { class: 'select-cell summary-label-cell' }),
    h('td', { class: 'index-cell summary-label-cell', text: label }),
    ...visibleFields.map((field) => h('td', { class: summaryCellClass(field), style: columnWidthStyle(listConfig, field) }, [renderNumericSummary(records, field, label)])),
    h('td', { class: 'sticky-action-cell action-cell summary-action-cell', style: actionColumnStyle(listConfig) })
  ]);
}

export function renderNumericSummary(records, field, label = '合计') {
  if (field.type !== 'number') return document.createTextNode('');
  const values = records
    .map((record) => Number(record.data?.[field.id]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return h('span', { class: 'summary-empty', text: '无数据' });
  const sum = values.reduce((total, value) => total + value, 0);
  return h('span', { class: 'numeric-summary', title: `${label}：${values.length} 个数字` }, [
    h('span', { text: formatNumberSummary(sum, field) })
  ]);
}

export function summaryCellClass(field) {
  return field.type === 'number' ? 'summary-cell numeric-summary-cell' : 'summary-cell';
}

export function formatNumberSummary(value, field) {
  if (field.format === 'integer') return String(Math.round(value));
  if (field.format === 'currency') return value.toFixed(2);
  if (field.format === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (field.format === 'decimal2') return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export function openListConfigModal(entity) {
  const config = getListConfig(entity);
  let order = viewOrderedFields(entity, config).map((field) => field.id);
  const visibleChecks = new Map();
  const searchChecks = new Map();
  const list = h('div', { class: 'field-config-list' });
  const renderRows = () => {
    list.innerHTML = '';
    for (const fieldId of order) {
      const field = entity.fields.find((item) => item.id === fieldId);
      if (!field) continue;
      let visible = visibleChecks.get(field.id);
      let searchable = searchChecks.get(field.id);
      if (!visible) {
        visible = h('input', { type: 'checkbox' });
        visible.checked = config.visibleFields.includes(field.id);
        visibleChecks.set(field.id, visible);
      }
      if (!searchable) {
        searchable = h('input', { type: 'checkbox' });
        searchable.checked = config.searchFields.includes(field.id);
        searchChecks.set(field.id, searchable);
      }
      const row = h('div', { class: 'field-config-row', draggable: 'true', 'data-field-id': field.id }, [
        h('span', { class: 'drag-handle', text: '↕' }),
        h('strong', { text: field.label }),
        h('label', { class: 'check-row' }, [visible, h('span', { text: '显示' })]),
        h('label', { class: 'check-row' }, [searchable, h('span', { text: '搜索' })])
      ]);
      row.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', field.id));
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData('text/plain');
        const fromIndex = order.indexOf(from);
        const toIndex = order.indexOf(field.id);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        order.splice(fromIndex, 1);
        order.splice(toIndex, 0, from);
        renderRows();
      });
      list.append(row);
    }
  };
  renderRows();
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '字段显示设置' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('p', { class: 'muted', text: '拖拽调整所有字段顺序，勾选字段是否显示以及是否作为搜索条件。搜索条件最多在工具栏展示 3 个。' }),
      list,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: () => {
            const visibleFields = order.filter((fieldId) => visibleChecks.get(fieldId)?.checked);
            const searchFields = order.filter((fieldId) => searchChecks.get(fieldId)?.checked);
            if (visibleFields.length === 0) return toast('至少保留一个显示字段。');
            setListConfig(entity, { ...config, visibleFields, searchFields, fieldOrder: order });
            backdrop.remove();
            renderRuntime();
          }
        }),
        h('button', {
          class: 'secondary',
          text: '全部显示',
          onclick: () => {
            setListConfig(entity, { ...config, visibleFields: order });
            backdrop.remove();
            renderRuntime();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

export function openFormLayoutModal(entity) {
  const layout = getFormLayout(entity);
  const design = getFormDesign(entity);
  let order = [...layout.order];
  let columns = layout.columns;
  const unusedList = h('div', { class: 'layout-list unused-list' });
  const preview = h('div', { class: 'form-grid form-preview' });
  const columnSelect = h('select');
  for (const value of [2, 3, 4]) columnSelect.append(h('option', { value, text: `一行 ${value} 列` }));
  columnSelect.value = String(columns);
  columnSelect.addEventListener('change', () => {
    columns = Number(columnSelect.value);
    renderRows();
  });

  const renderRows = () => {
    unusedList.innerHTML = '';
    preview.innerHTML = '';
    const unused = entity.fields.filter((field) => !order.includes(field.id));
    if (!unused.length) unusedList.append(h('p', { class: 'muted', text: '没有未使用字段。' }));
    for (const field of unused) {
      unusedList.append(h('div', { class: 'layout-row compact' }, [
        h('span', { text: field.label }),
        h('button', { class: 'secondary', text: '加入', onclick: () => { order.push(field.id); renderRows(); } })
      ]));
    }
    for (const fieldId of order) {
      const field = entity.fields.find((item) => item.id === fieldId);
      if (!field) continue;
      const input = inputForField(field, sampleFieldValue(field));
      disablePreviewInput(input);
      const previewField = renderFormFieldBlock(field, input, design, {
        className: 'preview-field',
        attrs: { draggable: 'true', 'data-field-id': field.id },
        actions: [h('button', { class: 'ghost preview-remove', text: '移除', onclick: () => { order = order.filter((id) => id !== field.id); renderRows(); } })]
      });
      bindFormFieldDrag(previewField, field.id, () => renderRows());
      preview.append(previewField);
    }
    preview.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  };
  let dragFieldId = '';
  const bindFormFieldDrag = (element, fieldId, rerender) => {
    element.addEventListener('dragstart', (event) => {
      dragFieldId = fieldId;
      element.classList.add('is-dragging');
      event.dataTransfer.setData('text/plain', fieldId);
    });
    element.addEventListener('dragover', (event) => {
      if (!dragFieldId || dragFieldId === fieldId) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const position = event.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
      element.dataset.dropPosition = position;
      element.classList.toggle('drop-before', position === 'before');
      element.classList.toggle('drop-after', position === 'after');
    });
    element.addEventListener('dragleave', () => {
      element.classList.remove('drop-before', 'drop-after');
      delete element.dataset.dropPosition;
    });
    element.addEventListener('drop', (event) => {
      event.preventDefault();
      element.classList.remove('drop-before', 'drop-after', 'is-dragging');
      delete element.dataset.dropPosition;
      const from = event.dataTransfer.getData('text/plain') || dragFieldId;
      dragFieldId = '';
      const fromIndex = order.indexOf(from);
      const toIndex = order.indexOf(fieldId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, from);
      rerender();
    });
    element.addEventListener('dragend', () => {
      element.classList.remove('drop-before', 'drop-after', 'is-dragging');
      delete element.dataset.dropPosition;
      dragFieldId = '';
    });
  };
  renderRows();

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal wide-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '表单视图' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('p', { class: 'muted', text: '这是默认表单视图。左侧添加字段，右侧拖拽排序和移除字段；预览实时反映新增/编辑表单的实际效果。' }),
      h('div', { class: 'layout-editor' }, [
        h('div', {}, [
          h('div', { class: 'field' }, [h('label', { text: '布局列数' }), columnSelect]),
          h('h4', { text: '未使用字段' }),
          unusedList
        ]),
        h('div', {}, [
          h('h4', { text: '预览' }),
          preview
        ])
      ]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存表单视图',
          onclick: () => {
            if (!order.length) return toast('表单至少保留一个字段。');
            setFormLayout(entity, { columns, order });
            backdrop.remove();
            toast('表单视图已保存');
          }
        }),
        h('button', {
          class: 'secondary',
          text: '恢复默认',
          onclick: () => {
            order = entity.fields.map((field) => field.id);
            columns = 2;
            columnSelect.value = '2';
            renderRows();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}
