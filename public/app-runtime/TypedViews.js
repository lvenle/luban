import { h, buttonLabel } from '../common/dom.js';
import { state, formatFieldValue, viewOrderedFields, applyViewFilters, sortRecords } from '../app.js';
import { renderViewBar, openFilterModal, openSortModal } from './ViewBar.js';
import { openRecordModal } from './RecordModal.js';
import { openListConfigModal } from './TableRow.js';
import { renderFieldValue } from './CellEditor.js';
import { optionObject } from './FieldEditor.js';
import { renderRuntime } from './index.js';
import { orderSelectedOptions } from './Ordering.js';
import { scheduleMarkdownPreview, cancelMarkdownPreview, openMarkdownRecordEditor } from './MarkdownEditor.js';

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
  const optionIds = options.map((option) => option.id);
  const visibleFields = visibleViewFields(entity, view);
  const groups = new Map(optionIds.map((id) => [id, []]));
  const invalid = [];
  for (const record of records) {
    const value = optionValueId(record.data[field?.id]);
    if (groups.has(value)) groups.get(value).push(record);
    else invalid.push(record);
  }
  if (invalidMode.has(view.id)) return renderInvalidRecords(entity, view, invalid, '未归类记录');
  return h('div', { class: `${TYPED_PANEL_CLASS} quadrant-view` }, [
    ...renderTypedHeader(entity, view, invalid, '未归类'),
    h('div', { class: 'typed-view-body' }, [
      h('div', { class: 'quadrant-grid' }, options.map((option) =>
        h('section', { class: 'quadrant-cell' }, [
          h('div', { class: 'quadrant-head' }, [
            h('span', { class: `option-color-dot select-${option.color || 'gray'}` }),
            h('strong', { text: option.label }),
            h('span', { class: 'muted', text: `${groups.get(option.id)?.length || 0} 条` })
          ]),
          renderCompactTable(entity, groups.get(option.id) || [], visibleFields, view)
        ])
      ))
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
    const start = dateTimestamp(record.data[startField?.id]);
    const end = dateTimestamp(record.data[endField?.id]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) invalid.push(record);
    else valid.push({ record, start, end });
  }
  if (invalidMode.has(view.id)) return renderInvalidRecords(entity, view, invalid, '未排期或日期无效');
  const minimum = valid.length ? Math.min(...valid.map((item) => item.start)) : dayStart(Date.now());
  const maximum = valid.length ? Math.max(...valid.map((item) => item.end)) : minimum + 6 * DAY;
  const scale = ganttScale(minimum, maximum);
  const ticks = ganttTicks(minimum, maximum, scale.type);
  const timelineWidth = Math.max(640, ticks.length * scale.width);
  const total = Math.max(DAY, maximum - minimum + DAY);
  return h('div', { class: `${TYPED_PANEL_CLASS} gantt-view` }, [
    ...renderTypedHeader(entity, view, invalid, '无效记录', `自动${scale.label}刻度`),
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
      ])
    ])
  ]);
}

export function ganttScale(start, end) {
  const days = Math.max(1, Math.ceil((end - start) / DAY) + 1);
  if (days <= 45) return { type: 'day', label: '日', width: 34 };
  if (days <= 270) return { type: 'week', label: '周', width: 76 };
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

function renderTypedHeader(entity, view, invalid, invalidLabel, meta = '') {
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
          h('button', { class: 'secondary icon-label-button', onclick: () => openListConfigModal(entity) }, buttonLabel('fields', '字段设置'))
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
          const markdown = ['textarea', 'richText'].includes(field.type);
          return h('td', {
            class: error ? 'formula-error-cell' : '',
            title: error || '',
            onclick: markdown
              ? (event) => scheduleMarkdownPreview(event.currentTarget, entity, record, field)
              : () => openRecordModal(entity, record),
            ondblclick: markdown ? (event) => {
              cancelMarkdownPreview(event.currentTarget);
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
function optionValueId(value) { return value?.optionId || value?.id || value || ''; }
function dateTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
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

const DAY = 86400000;
