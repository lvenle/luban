import { h } from '../common/dom.js';
import { clamp } from '../common/storage.js';
import { state, entityFor, entityById, recordsFor, formatFieldValue, dateKey } from '../app.js';
import { hasDisplayValue, matchesFilter } from './CellEditor.js';
import { formatNumberSummary } from './TableRow.js';
import { openRecordModal } from './RecordModal.js';
import { renderListPage } from './DataTable.js';
import { saveCurrentPackage, renderRuntime } from './index.js';

export function renderBlankPage(page) {
  const cards = Array.isArray(page.cards) ? page.cards : [];
  if (!cards.length) return h('div', { class: 'blank-page-canvas', 'data-page-id': page.id });
  return h('div', { class: 'blank-page-canvas page-card-canvas', 'data-page-id': page.id }, cards.map((card, index) =>
    renderPageCard(page, card, index)
  ));
}

export function renderPageCard(page, card, index) {
  const width = clamp(Number(card.w || 3), 2, 6);
  const height = clamp(Number(card.h || 2), 1, 5);
  return h('section', {
    class: `page-card page-card-${card.type || 'stat'}`,
    draggable: 'true',
    style: `grid-column: span ${width}; min-height:${height * 74}px`,
    ondragstart: (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      event.currentTarget.classList.add('is-dragging');
    },
    ondragover: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    ondrop: async (event) => {
      event.preventDefault();
      const fromIndex = Number(event.dataTransfer.getData('text/plain'));
      await reorderPageCard(page, fromIndex, index);
    },
    ondragend: (event) => event.currentTarget.classList.remove('is-dragging')
  }, [
    h('div', { class: 'page-card-head' }, [
      h('strong', { text: card.title || pageCardTitle(card) }),
      h('span', { class: 'page-card-filter', text: cardFilterLabel(card) })
    ]),
    renderPageCardBody(card),
    h('span', {
      class: 'page-card-resize',
      title: '拖动调整大小',
      onpointerdown: (event) => startPageCardResize(event, page, index)
    })
  ]);
}

export function renderPageCardBody(card) {
  if (card.type === 'table') return renderPageTableCard(card);
  if (card.type === 'chart') return renderPageChartCard(card);
  if (card.type === 'pivot') return renderPagePivotCard(card);
  return renderPageStatCard(card);
}

export function renderPageStatCard(card) {
  const entity = entityById(card.entity);
  const records = filteredCardRecords(card);
  const value = card.operation === 'sum'
    ? records.reduce((sum, record) => sum + Number(record.data?.[card.field] || 0), 0)
    : records.length;
  const field = entity?.fields?.find((item) => item.id === card.field);
  return h('div', { class: 'page-stat-body' }, [
    h('div', { class: 'stat-value', text: field?.type === 'number' ? formatNumberSummary(value, field) : value }),
    h('p', { class: 'muted', text: entity ? `${entity.name} · ${records.length} 条记录` : '未选择数据表' })
  ]);
}

export function renderPageTableCard(card) {
  const entity = entityById(card.entity);
  if (!entity) return h('p', { class: 'muted', text: '未选择数据表' });
  const fields = (card.fields || entity.fields.map((field) => field.id)).slice(0, 5)
    .map((fieldId) => entity.fields.find((field) => field.id === fieldId))
    .filter(Boolean);
  const records = filteredCardRecords(card).slice(0, 6);
  return h('table', { class: 'page-mini-table' }, [
    h('thead', {}, [h('tr', {}, fields.map((field) => h('th', { text: field.label || field.id })))]),
    h('tbody', {}, records.map((record) =>
      h('tr', {}, fields.map((field) => h('td', { text: formatFieldValue(record.data?.[field.id], field) })))
    ))
  ]);
}

export function renderPageChartCard(card) {
  const entity = entityById(card.entity);
  const field = entity?.fields?.find((item) => item.id === card.groupBy) || entity?.fields?.[0];
  const rows = groupedCardRows(card, field);
  const max = Math.max(1, ...rows.map((row) => row.value));
  return h('div', { class: 'page-card-chart' }, rows.slice(0, 6).map((row) =>
    h('div', { class: 'page-card-bar' }, [
      h('span', { text: row.label }),
      h('div', {}, [h('div', { style: `width:${Math.max(8, (row.value / max) * 100)}%` })]),
      h('strong', { text: row.value })
    ])
  ));
}

export function renderPagePivotCard(card) {
  const entity = entityById(card.entity);
  const field = entity?.fields?.find((item) => item.id === card.groupBy) || entity?.fields?.[0];
  const rows = groupedCardRows(card, field);
  return h('table', { class: 'page-mini-table' }, [
    h('thead', {}, [h('tr', {}, [h('th', { text: field?.label || '分组' }), h('th', { text: '数量' })])]),
    h('tbody', {}, rows.slice(0, 8).map((row) => h('tr', {}, [h('td', { text: row.label }), h('td', { text: row.value })])))
  ]);
}

export function groupedCardRows(card, field) {
  const grouped = new Map();
  for (const record of filteredCardRecords(card)) {
    const label = formatFieldValue(record.data?.[field?.id], field || {}) || '未填写';
    grouped.set(label, (grouped.get(label) || 0) + 1);
  }
  return [...grouped.entries()].map(([label, value]) => ({ label, value }));
}

export function filteredCardRecords(card) {
  return recordsFor(card.entity).filter((record) => cardFiltersMatch(record, card.filters || []));
}

export function cardFiltersMatch(record, filters) {
  return filters.every((filter) => {
    const value = record.data?.[filter.field];
    if (filter.op === 'notEmpty') return hasDisplayValue(value);
    if (filter.op === 'thisMonth') return dateKey(value).slice(0, 7) === dateKey(new Date()).slice(0, 7);
    if (filter.op === 'today') return dateKey(value) === dateKey(new Date());
    if (filter.op === 'eq') return String(value ?? '') === String(filter.value ?? '');
    return true;
  });
}

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

export async function reorderPageCard(page, fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || fromIndex === toIndex) return;
  await saveCurrentPackage((pkg) => {
    const target = pkg.ui.pages.find((item) => item.id === page.id);
    const cards = [...(target.cards || [])];
    const [moved] = cards.splice(fromIndex, 1);
    cards.splice(toIndex, 0, moved);
    target.cards = cards;
  });
  renderRuntime();
}

export function startPageCardResize(event, page, index) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const card = page.cards[index];
  const startW = Number(card.w || 3);
  const startH = Number(card.h || 2);
  const onMove = (moveEvent) => {
    card.w = clamp(startW + Math.round((moveEvent.clientX - startX) / 120), 2, 6);
    card.h = clamp(startH + Math.round((moveEvent.clientY - startY) / 70), 1, 5);
    renderRuntime();
  };
  const onUp = async () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    await saveCurrentPackage((pkg) => {
      const target = pkg.ui.pages.find((item) => item.id === page.id);
      if (target?.cards?.[index]) {
        target.cards[index].w = card.w;
        target.cards[index].h = card.h;
      }
    });
    renderRuntime();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

export function renderDashboardPage(page) {
  const cards = page.cards || state.currentApp.ui.home?.cards || [];
  return h('div', { class: 'panel' }, [
    h('h3', { text: page.title || '仪表盘' }),
    h('div', { class: 'stat-grid' }, cards.map((card) => renderDashboardCard(card)))
  ]);
}

export function renderDashboardCard(card) {
  if (card.type === 'quickAction') {
    return h('div', { class: 'card' }, [
      h('h3', { text: card.title }),
      h('button', {
        text: '打开表单',
        onclick: () => openRecordModal(entityById(card.entity) || state.currentApp.schema.entities[0])
      })
    ]);
  }
  const records = recordsFor(card.entity).filter((record) => matchesFilter(record.data, card.filter));
  const value = card.operation === 'sum' ? records.reduce((sum, record) => sum + Number(record.data[card.field] || 0), 0) : records.length;
  return h('div', { class: 'card' }, [h('p', { class: 'muted', text: card.title }), h('div', { class: 'stat-value', text: value })]);
}

export function renderChartPage(page) {
  const entity = entityFor(page);
  const chart = page.chart || {};
  const records = recordsFor(entity.id);
  const groupField = entity.fields.find((field) => field.id === chart.groupBy) || {};
  const grouped = new Map();
  for (const record of records) {
    const key = formatFieldValue(record.data[chart.groupBy], groupField) || '未填写';
    const value = chart.value === 'count' ? 1 : Number(record.data[chart.value] || 0);
    grouped.set(key, (grouped.get(key) || 0) + value);
  }
  const rows = [...grouped.entries()];
  const max = Math.max(1, ...rows.map((row) => row[1]));
  return h('div', { class: 'panel' }, [
    h('h3', { text: page.title }),
    h('p', { class: 'muted', text: rows.length ? '按配置字段自动统计。' : '暂无数据，先新增记录。' }),
    h('div', { class: 'chart-row' }, rows.map(([label, value]) =>
      h('div', { class: 'bar' }, [
        h('span', { text: label }),
        h('div', {}, [h('div', { class: 'bar-fill', style: `width:${Math.max(8, (value / max) * 100)}%` })]),
        h('strong', { text: value })
      ])
    ))
  ]);
}

export function renderEditorPage(page) {
  const entity = entityFor(page);
  return h('div', { class: 'panel' }, [
    h('div', { class: 'toolbar' }, [
      h('div', {}, [h('h3', { text: page.title }), h('p', { class: 'muted', text: 'MVP 中富文本编辑器先用结构化表单替代。' })]),
      h('button', { text: '新建内容', onclick: () => openRecordModal(entity) })
    ]),
    renderListPage({ ...page, type: 'list' })
  ]);
}
