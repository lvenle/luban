import { h, buttonLabel } from '../common/dom.js';
import { state, formatFieldValue, viewOrderedFields, applyViewFilters, sortRecords } from '../app.js';
import { renderViewBar, openFilterModal, openSortModal, getCurrentView, updateCurrentView, selectFromOptions } from './ViewBar.js';
import { openRecordModal } from './RecordModal.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog } from '../common/modal.js';
import { renderFieldValue, startCellEdit } from './CellEditor.js';
import { optionObject } from './FieldEditor.js';
import { renderRuntime, renderInfiniteLoadSentinel } from './index.js';
import { optionDisplayValue, orderSelectedOptions } from './Ordering.js';
import { openMarkdownRecordEditor } from './MarkdownEditor.js';

const invalidMode = new Set();
const TYPED_PANEL_CLASS = 'panel table-panel typed-view-panel';

export function renderTypedTableView(page, entity, records, view) {
  const filtered = sortRecords(applyViewFilters(records, entity, view), view);
  if (view.type === 'quadrant') return renderQuadrantView(page, entity, filtered, view);
  if (view.type === 'gantt') return renderGanttView(page, entity, filtered, view);
  return null;
}

export function renderQuadrantView(page, entity, records, view) {
  const field = entity.fields.find((item) => item.id === view.quadrant?.fieldId);
  const options = orderSelectedOptions(field?.options || [], view.quadrant?.optionIds || [], optionObject);
  const optionValues = options.map((option) => option.label);
  const visibleFields = visibleViewFields(entity, view);
  const groups = new Map(optionValues.map((value) => [value, []]));
  const invalid = [];
  for (const record of records) {
    const value = optionDisplayValue(field?.options || [], record.data[field?.id], optionObject);
    if (groups.has(value)) groups.get(value).push(record);
    else invalid.push(record);
  }
  if (invalidMode.has(view.id)) return renderInvalidRecords(entity, view, invalid, '未归类记录');
  return h('div', { class: `${TYPED_PANEL_CLASS} quadrant-view` }, [
    ...renderTypedHeader(entity, view, invalid, '未归类', '', [h('button', { class: 'secondary icon-label-button', onclick: () => openQuadrantConfigModal(entity, view) }, buttonLabel('settings', '象限设置'))]),
    h('div', { class: 'typed-view-body' }, [
      h('div', { class: 'quadrant-grid' }, options.map((option) =>
        h('section', { class: 'quadrant-cell' }, [
          h('div', { class: 'quadrant-head' }, [
            h('span', { class: `option-color-dot select-${option.color || 'gray'}` }),
            h('strong', { text: option.label }),
            h('span', { class: 'muted', text: `${groups.get(option.label)?.length || 0} 条` })
          ]),
          renderCompactTable(entity, groups.get(option.label) || [], visibleFields, view)
        ])
      )),
      renderInfiniteLoadSentinel(entity)
    ])
  ]);
}

export function renderGanttView(page, entity, records, view) {
  const config = view.gantt || {};
  const titleField = entity.fields.find((field) => field.id === config.titleField) || entity.fields[0];
  const startField = entity.fields.find((field) => field.id === config.startField);
  const endField = entity.fields.find((field) => field.id === config.endField);
  const progressField = resolveGanttProgressField(entity, config);
  const valid = [];
  const invalid = [];
  for (const record of records) {
    let start = dateTimestamp(record.data[startField?.id]);
    let end = dateTimestamp(record.data[endField?.id]);
    if (!Number.isFinite(start) && !Number.isFinite(end)) { invalid.push(record); continue; }
    if (!Number.isFinite(start)) start = end;
    if (!Number.isFinite(end)) end = start;
    if (end < start) invalid.push(record);
    else valid.push({ record, start, end });
  }
  if (invalidMode.has(view.id)) return renderInvalidRecords(entity, view, invalid, '未排期或日期无效');
  const minimum = valid.length ? Math.min(...valid.map((item) => item.start)) : dayStart(Date.now());
  const maximum = valid.length ? Math.max(...valid.map((item) => item.end)) : minimum + 6 * DAY;
  const scaleType = config.scaleType || 'day';
  const scale = ganttScale(minimum, maximum, scaleType);
  const ticks = ganttTicks(minimum, maximum, scale.type);
  const timelineWidth = Math.max(640, ticks.length * scale.width);
  const total = Math.max(DAY, maximum - minimum + DAY);
  return h('div', { class: `${TYPED_PANEL_CLASS} gantt-view` }, [
    ...renderTypedHeader(entity, view, invalid, '无效记录', '', [h('button', { class: 'secondary icon-label-button', onclick: () => openGanttConfigModal(entity, view) }, buttonLabel('settings', '甘特设置')), h('select', { class: 'gantt-scale-select', style: 'width:auto;min-width:52px', onchange: (e) => { updateCurrentView(entity, { gantt: { ...config, scaleType: e.currentTarget.value } }); renderRuntime(); } }, [h('option', { value: 'day', text: '日', selected: scaleType === 'day' ? 'selected' : null }), h('option', { value: 'week', text: '周', selected: scaleType === 'week' ? 'selected' : null }), h('option', { value: 'month', text: '月', selected: scaleType === 'month' ? 'selected' : null })])]),
    h('div', { class: 'typed-view-body gantt-scroll' }, [
      h('div', { class: 'gantt-chart', style: `--timeline-width:${timelineWidth}px` }, [
        h('div', { class: 'gantt-axis-row' }, [
          h('div', { class: 'gantt-label gantt-axis-label', text: titleField?.label || '记录' }),
          h('div', { class: 'gantt-axis', style: `width:${timelineWidth}px` }, ticks.map((tick) =>
            h('span', { class: 'gantt-tick', style: `width:${scale.width}px`, text: tick.label })
          ))
        ]),
        ...valid.map(({ record, start, end }) => {
          const left = ((start - minimum) / total) * 100;
          const width = Math.max((DAY / total) * 100, ((end - start + DAY) / total) * 100);
          return h('button', { class: 'gantt-row', onclick: () => openRecordModal(entity, record) }, [
            h('span', { class: 'gantt-label', text: formatFieldValue(record.data[titleField?.id], titleField || {}) || '未命名记录' }),
            h('span', { class: 'gantt-track', style: `width:${timelineWidth}px` }, [
              renderGanttBar(record, titleField, progressField, start, end, left, width, timelineWidth)
            ])
          ]);
        }),
        valid.length ? null : h('div', { class: 'typed-empty muted', text: '暂无可绘制的排期记录。' })
      ]),
      renderInfiniteLoadSentinel(entity)
    ])
  ]);
}

export function ganttScale(start, end, type) {
  const days = Math.max(1, Math.ceil((end - start) / DAY) + 1);
  if (type === 'day' || (!type && days <= 45)) return { type: 'day', label: '日', width: 34 };
  if (type === 'week' || (!type && days <= 270)) return { type: 'week', label: '周', width: 76 };
  return { type: 'month', label: '月', width: 94 };
}

export function resolveGanttProgressField(entity, config = {}) {
  if (config.progressField) {
    const field = entity.fields.find((item) => item.id === config.progressField);
    if (field) return field;
  }
  return entity.fields.find((field) => {
    const type = field.type === 'formula' ? field.formula?.resultType : field.type;
    if (type !== 'number') return false;
    return field.format === 'percent' || /进度/.test(field.label || '') || /progress/i.test(field.id || '');
  }) || null;
}

export function ganttProgressPercent(record, progressField, start, end) {
  if (progressField) {
    const normalized = normalizeProgressPercent(record.data[progressField.id], progressField);
    if (normalized !== null) return normalized;
  }
  return timeProgressPercent(start, end);
}

function renderGanttBar(record, titleField, progressField, start, end, left, width, timelineWidth) {
  const title = formatFieldValue(record.data[titleField?.id], titleField || {}) || '未命名记录';
  const progress = ganttProgressPercent(record, progressField, start, end);
  const progressLabel = `${progress}%`;
  const dateRange = `${formatDate(start)} 至 ${formatDate(end)}`;
  const barPixelWidth = Math.max(8, (width / 100) * timelineWidth);
  const showContent = barPixelWidth >= 56;
  return h('span', {
    class: 'gantt-bar',
    style: `left:${left}%; width:${width}%`,
    title: `${title} · ${progressLabel} · ${dateRange}`
  }, [
    h('span', { class: 'gantt-bar-fill', style: `width:${progress}%` }),
    showContent ? h('span', { class: 'gantt-bar-content' }, [
      h('span', { class: 'gantt-bar-title', text: title }),
      h('span', { class: 'gantt-bar-progress', text: progressLabel })
    ]) : null
  ]);
}

function normalizeProgressPercent(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (field?.format === 'percent') return clampPercent(Math.round(number * 100));
  if (number > 1) return clampPercent(Math.round(number));
  return clampPercent(Math.round(number * 100));
}

function timeProgressPercent(start, end) {
  const now = dayStart(Date.now());
  if (now < start) return 0;
  if (now > end) return 100;
  const total = Math.max(DAY, end - start + DAY);
  return clampPercent(Math.round(((now - start + DAY) / total) * 100));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function renderTypedHeader(entity, view, invalid, invalidLabel, meta = '', extraButtons = []) {
  return [
    renderViewBar(entity, view),
    h('div', { class: 'table-command-row' }, [
      h('div', { class: 'row action-row table-action-groups' }, [
        h('div', { class: 'toolbar-action-group data-entry-group' }, [
          h('button', { class: 'table-add-button icon-label-button', onclick: () => openRecordModal(entity) }, buttonLabel('add', '添加记录'))
        ]),
        h('div', { class: 'toolbar-action-group view-rule-group' }, [
          h('button', { class: `secondary icon-label-button${(view.filters || []).length ? ' active' : ''}`, onclick: () => openFilterModal(entity) }, buttonLabel('filter', '筛选')),
          h('button', { class: `secondary icon-label-button${(view.sorts || []).length ? ' active' : ''}`, onclick: () => openSortModal(entity) }, buttonLabel('sort', '排序'))
        ]),
        h('div', { class: 'toolbar-action-group structure-config-group' }, [
          h('button', { class: 'secondary icon-label-button', onclick: () => openTypedViewFieldConfigModal(entity, view) }, buttonLabel('fields', '表格设置')),
          ...extraButtons
        ])
      ]),
      (meta || invalid.length) ? h('div', { class: 'typed-view-meta row' }, [
        meta ? h('span', { class: 'muted', text: meta }) : null,
        invalid.length ? h('button', { class: 'ghost invalid-record-button', text: `${invalidLabel} ${invalid.length} 条`, onclick: () => { invalidMode.add(view.id); renderRuntime(); } }) : null
      ]) : null
    ])
  ];
}

function renderInvalidRecords(entity, view, records, title) {
  const visibleFields = visibleViewFields(entity, view);
  return h('div', { class: `${TYPED_PANEL_CLASS} invalid-records-view` }, [
    renderViewBar(entity, view),
    h('div', { class: 'table-command-row' }, [
      h('div', {}, [h('strong', { text: title }), h('span', { class: 'muted', text: ` · ${records.length} 条` })]),
      h('button', { class: 'secondary', text: '返回视图', onclick: () => { invalidMode.delete(view.id); renderRuntime(); } })
    ]),
    h('div', { class: 'typed-view-body' }, [
      renderCompactTable(entity, records, visibleFields, view)
    ])
  ]);
}

function renderCompactTable(entity, records, fields, view) {
  return h('div', { class: 'compact-record-table-wrap' }, [
    h('table', { class: 'compact-record-table' }, [
      h('thead', {}, [h('tr', {}, fields.map((field) => h('th', { text: field.label })))]),
      h('tbody', {}, records.length ? records.map((record) =>
        h('tr', { title: '点击查看，双击编辑长文本' }, fields.map((field) => {
          const error = record.formulaErrors?.[field.id];
          const isLongText = ['textarea', 'richText', 'ai'].includes(field.type);
          return h('td', {
            class: error ? 'formula-error-cell' : '',
            title: error || '',
            style: error ? 'cursor:pointer' : '',
            onclick: error
              ? (event) => {
                  event.stopPropagation();
                  openConfirmDialog({
                    title: '公式计算错误',
                    message: error,
                    confirmText: '知道了'
                  });
                }
              : () => openRecordModal(entity, record),
            ondblclick: isLongText ? (event) => {
              event.stopPropagation();
              openMarkdownRecordEditor(entity, record, field);
            } : null
          }, [error ? h('span', { text: '计算错误' }) : renderFieldValue(record.data[field.id], field)]);
        }))
      ) : [h('tr', {}, [h('td', { colspan: Math.max(1, fields.length), class: 'muted', text: '暂无记录' })])])
    ])
  ]);
}

function visibleViewFields(entity, view) {
  return viewOrderedFields(entity, view).filter((field) => view.visibleFields.includes(field.id)).slice(0, 6);
}
function dateTimestamp(value) {
  const normalized = String(value || '').trim().replaceAll('/', '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function dayStart(value) { const date = new Date(value); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function formatDate(value) { return new Date(value).toISOString().slice(0, 10); }
function ganttTicks(start, end, type) {
  const ticks = [];
  let cursor = start;
  if (type === 'month') cursor = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1);
  const step = type === 'day' ? DAY : type === 'week' ? 7 * DAY : null;
  while (cursor <= end && ticks.length < 400) {
    const date = new Date(cursor);
    const label = type === 'day' ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : type === 'week' ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}`;
    ticks.push({ value: cursor, label });
    cursor = type === 'month' ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) : cursor + step;
  }
  return ticks.length ? ticks : [{ value: start, label: formatDate(start) }];
}

function openTypedViewFieldConfigModal(entity, view) {
  const config = getCurrentView(entity);
  const orderedIds = viewOrderedFields(entity, config).map((field) => field.id);
  const visibleChecks = new Map();
  const list = h('div', { class: 'field-config-list' });

  const renderRows = () => {
    list.innerHTML = '';
    for (const fieldId of orderedIds) {
      const field = entity.fields.find((item) => item.id === fieldId);
      if (!field) continue;
      let chk = visibleChecks.get(field.id);
      if (!chk) {
        chk = h('input', { type: 'checkbox' });
        chk.checked = config.visibleFields.includes(field.id);
        visibleChecks.set(field.id, chk);
      }
      const row = h('div', { class: 'field-config-row', draggable: 'true', 'data-field-id': field.id }, [
        h('span', { class: 'drag-handle', text: '↕' }),
        h('strong', { text: field.label }),
        h('label', { class: 'check-row' }, [chk, h('span', { text: '显示' })])
      ]);
      row.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', field.id));
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData('text/plain');
        const fromIndex = orderedIds.indexOf(from);
        const toIndex = orderedIds.indexOf(field.id);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        orderedIds.splice(fromIndex, 1);
        orderedIds.splice(toIndex, 0, from);
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
      h('p', { class: 'muted', text: '拖拽调整字段顺序，勾选控制字段在视图中显示或隐藏。' }),
      list,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: (event) => {
            const visibleFields = orderedIds.filter((fieldId) => visibleChecks.get(fieldId)?.checked);
            if (visibleFields.length === 0) return toast('至少保留一个显示字段。');
            event.currentTarget.disabled = true;
            updateCurrentView(entity, { ...config, visibleFields, fieldOrder: orderedIds });
            backdrop.remove();
            renderRuntime();
          }
        }),
        h('button', {
          class: 'secondary',
          text: '全部显示',
          onclick: () => {
            updateCurrentView(entity, { ...config, visibleFields: orderedIds });
            backdrop.remove();
            renderRuntime();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function openGanttConfigModal(entity, view) {
  const config = getCurrentView(entity);
  const gantt = config.gantt || {};
  const titleFields = entity.fields.filter((field) => field.type !== 'formula' || field.formula?.resultType === 'text');
  const dateFields = entity.fields.filter((field) => ['date', 'datetime'].includes(field.type) || (field.type === 'formula' && field.formula?.resultType === 'date'));
  const progressFields = entity.fields
    .filter((field) => field.type === 'number' || (field.type === 'formula' && field.formula?.resultType === 'number'))
    .sort((a, b) => Number(b.format === 'percent' || /进度|progress/i.test(`${b.label} ${b.id}`)) - Number(a.format === 'percent' || /进度|progress/i.test(`${a.label} ${a.id}`)));
  const title = selectFromOptions(titleFields.map((f) => [f.id, f.label]), gantt.titleField || titleFields[0]?.id || '');
  const start = selectFromOptions(dateFields.map((f) => [f.id, f.label]), gantt.startField || dateFields[0]?.id || '');
  const end = selectFromOptions(dateFields.map((f) => [f.id, f.label]), gantt.endField || dateFields[1]?.id || dateFields[0]?.id || '');
  const progress = selectFromOptions([['', '自动识别或按日期计算'], ...progressFields.map((f) => [f.id, f.label])], gantt.progressField || '');
  const scaleType = selectFromOptions([['day', '日'], ['week', '周'], ['month', '月']], gantt.scaleType || 'day');
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '甘特视图设置' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('label', { class: 'field' }, [h('span', { text: '标题字段' }), title]),
      h('label', { class: 'field' }, [h('span', { text: '开始日期' }), start]),
      h('label', { class: 'field' }, [h('span', { text: '结束日期' }), end]),
      h('label', { class: 'field' }, [h('span', { text: '进度字段（可选）' }), progress]),
      h('label', { class: 'field' }, [h('span', { text: '刻度' }), scaleType]),
      h('p', { class: 'muted field-hint', text: '百分比格式按 0–1 读取；普通数值可使用 0–1 或 0–100。' }),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { text: '保存', onclick: () => {
          if (!start.value || !end.value || start.value === end.value) return toast('请选择两个不同的日期字段。');
          updateCurrentView(entity, { gantt: { titleField: title.value, startField: start.value, endField: end.value, progressField: progress.value, scaleType: scaleType.value } });
          backdrop.remove();
          renderRuntime();
        }}),
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function openQuadrantConfigModal(entity, view) {
  const config = getCurrentView(entity);
  const quadrant = config.quadrant || {};
  const selectFields = entity.fields.filter((f) => f.type === 'select' && (f.options || []).length >= 4);
  const fieldSelect = selectFromOptions(selectFields.map((f) => [f.id, f.label]), quadrant.fieldId || selectFields[0]?.id || '');
  const list = h('div', { class: 'field-config-list' });

  const renderRows = () => {
    list.innerHTML = '';
    const field = entity.fields.find((f) => f.id === fieldSelect.value);
    if (!field || !field.options?.length) { list.append(h('p', { class: 'muted', text: '请先选择一个包含至少 4 个选项的字段。' })); return; }
    const currentIds = quadrant.fieldId === field.id ? quadrant.optionIds || [] : [];
    const allIds = [...new Set([...currentIds.filter((id) => field.options.some((o) => optionObject(o).id === id)), ...field.options.map((o) => optionObject(o).id)])];
    const labels = ['右上', '左上', '左下', '右下'];
    for (let i = 0; i < allIds.length; i++) {
      const opt = field.options.map((o) => optionObject(o)).find((o) => o.id === allIds[i]);
      if (!opt) continue;
      const row = h('div', { class: 'field-config-row', draggable: 'true', 'data-opt-id': opt.id }, [
        h('span', { class: 'drag-handle', text: '↕' }),
        h('span', { class: `option-color-dot select-${opt.color || 'gray'}` }),
        h('strong', { text: opt.label || opt.id }),
        i < 4 ? h('span', { class: 'muted quadrant-position-label', text: `（${labels[i]}）` }) : h('span', { class: 'muted', text: '未使用' })
      ]);
      row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', opt.id));
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData('text/plain');
        const fromIdx = allIds.indexOf(fromId);
        const toIdx = allIds.indexOf(opt.id);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        allIds.splice(fromIdx, 1);
        allIds.splice(toIdx, 0, fromId);
        renderRows();
      });
      list.append(row);
    }
  };

  fieldSelect.addEventListener('change', renderRows);

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '四象限视图设置' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('label', { class: 'field' }, [h('span', { text: '象限字段' }), fieldSelect]),
      h('p', { class: 'muted', text: '拖拽调整选项顺序，前 4 项分别对应右上、左上、左下、右下四个象限。' }),
      list,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { text: '保存', onclick: () => {
          const field = entity.fields.find((f) => f.id === fieldSelect.value);
          if (!field || (field.options || []).length < 4) return toast('请选择至少包含 4 个选项的字段。');
          const optionIds = allIds.slice(0, 4);
          updateCurrentView(entity, { quadrant: { fieldId: fieldSelect.value, optionIds } });
          backdrop.remove();
          renderRuntime();
        }}),
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() })
      ])
    ])
  ]);
  document.body.append(backdrop);
  setTimeout(renderRows, 0);
}

const DAY = 86400000;
