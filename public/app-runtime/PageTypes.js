import { h } from '../common/dom.js';
import { clamp } from '../common/storage.js';
import { state, entityFor, entityById, recordsFor, formatFieldValue, dateKey } from '../app-context.js';
import { hasDisplayValue, matchesFilter } from './CellEditor.js';
import { formatNumberSummary } from './TableRow.js';
import { openRecordModal } from './RecordModal.js';
import { renderListPage } from './DataTable.js';
import { openConfirmDialog } from '../common/modal.js';
import { toast } from '../common/toast.js';
import { saveCurrentPackage, renderRuntime } from './runtime-actions.js';
import { renderMarkdownPage } from './MarkdownPage.js';
import { renderHtmlPage } from './HtmlPage.js';

export function renderPageCanvas(page) {
  if (page.navKind === 'markdown') return renderMarkdownPage(page);
  if (page.navKind === 'webpage') return renderHtmlPage(page);
  // Dashboard is a first-class page type, rendered via independent entry
  if (page.type === 'dashboard') return renderDashboardPage(page);

  const hasCards = Array.isArray(page.cards) && page.cards.length;
  const hasChart = Boolean(page.chart);
  const hasEntity = Boolean(page.entity);

  // Any chart goes through card canvas for drag/resize/delete support
  if (hasChart) return renderChartWithCardsPage(page);
  // Cards + entity: show cards + data table
  if (hasCards && hasEntity) return renderMixedPage(page);
  // Cards only: show card canvas
  if (hasCards) return renderBlankPage(page);
  // Entity only: data table
  if (hasEntity) return renderListPage(page);
  // Empty: welcome screen
  return renderBlankPage(page);
}

function renderChartWithCardsPage(page) {
  // Convert page.chart to a card so it gets drag/resize/delete capabilities
  const allCards = [...(page.cards || [])];
  if (page.chart) {
    const c = page.chart;
    allCards.push({ title: page.title || '图表', type: 'chart', entity: page.entity, groupBy: c.groupBy, x: c._x, y: c._y, _isChart: true });
  }
  return h('div', { class: 'panel' }, [
    h('div', { class: 'blank-page-canvas page-card-canvas', 'data-page-id': page.id }, allCards.map((card, index) =>
      renderPageCard(page, card, index)
    ))
  ]);
}

function renderMixedPage(page) {
  return h('div', { class: 'panel' }, [
    h('div', { class: 'blank-page-canvas page-card-canvas', 'data-page-id': page.id }, (page.cards || []).map((card, index) =>
      renderPageCard(page, card, index)
    )),
    renderListPage(page)
  ]);
}

export function renderBlankPage(page) {
  const cards = Array.isArray(page.cards) ? page.cards : [];
  if (!cards.length) {
    return h('div', { class: 'blank-page-canvas', 'data-page-id': page.id }, [
      h('div', { class: 'blank-page-welcome' }, [
        h('p', { class: 'blank-page-hint', text: '这个页面还没有内容。' }),
        h('button', {
          class: 'primary',
          text: '开始生成页面',
          onclick: () => {
            state.assistantOpen = true;
            renderRuntime();
          }
        })
      ])
    ]);
  }
  return h('div', { class: 'blank-page-canvas page-card-canvas', 'data-page-id': page.id }, cards.map((card, index) =>
    renderPageCard(page, card, index)
  ));
}

export function renderPageCard(page, card, index) {
  const x = card.x ?? (20 + index * 30);
  const y = card.y ?? (20 + index * 30);
  const w = clamp(Number(card.w || 320), 200, 800);
  const hgt = clamp(Number(card.h || 160), 80, 600);

  const cardEl = h('section', {
    class: `page-card page-card-${card.type || 'stat'}`,
    style: `position:absolute;left:${x}px;top:${y}px;width:${w}px;min-height:${hgt}px`
  }, [
    h('button', {
      class: 'ghost page-card-close',
      text: '×',
      title: '删除卡片',
      onclick: (event) => {
        event.stopPropagation();
        deleteCard(page, card, index);
      }
    }),
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
  // Free-position drag via pointer events (listeners added only during drag)
  let dragState = null;
  cardEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.page-card-close, .page-card-resize')) return;
    event.preventDefault();
    const origLeft = parseInt(cardEl.style.left, 10) || 0;
    const origTop = parseInt(cardEl.style.top, 10) || 0;
    dragState = { startX: event.clientX, startY: event.clientY, origLeft, origTop };
    cardEl.classList.add('is-dragging');
    const onMove = (e) => {
      if (!dragState) return;
      cardEl.style.left = `${dragState.origLeft + e.clientX - dragState.startX}px`;
      cardEl.style.top = `${dragState.origTop + e.clientY - dragState.startY}px`;
    };
    const onUp = async () => {
      if (!dragState) return;
      cardEl.classList.remove('is-dragging');
      const finalLeft = Math.round(parseFloat(cardEl.style.left));
      const finalTop = Math.round(parseFloat(cardEl.style.top));
      dragState = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      await saveCurrentPackage((pkg) => {
        const target = pkg.ui.pages.find((item) => item.id === page.id);
        if (card._isChart) {
          if (target) { target.chart = target.chart || {}; target.chart._x = finalLeft; target.chart._y = finalTop; }
        } else if (target?.cards?.[index]) {
          target.cards[index].x = finalLeft;
          target.cards[index].y = finalTop;
        }
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });
  return cardEl;
}

const PIE_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export function renderPageCardBody(card) {
  if (card.type === 'table') return renderPageTableCard(card);
  if (card.type === 'chart') return renderPageChartCard(card);
  if (card.type === 'pie') return renderPagePieCard(card);
  if (card.type === 'line') return renderPageLineCard(card);
  if (card.type === 'pivot') return renderPagePivotCard(card);
  return renderPageStatCard(card);
}

export function renderPagePieCard(card) {
  const entity = entityById(card.entity);
  const field = resolveCardGroupField(entity, card.groupBy);
  const rows = groupedCardRows(card, field);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  let conic = '';
  let cursor = 0;
  const slices = rows.slice(0, 8).map((row, i) => {
    const pct = (row.value / total) * 100;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const start = cursor;
    cursor += pct;
    conic += `${color} ${start}% ${cursor}%`;
    if (i < rows.length - 1) conic += ', ';
    return { label: row.label, value: row.value, color, pct: Math.round(pct) };
  });
  return h('div', { class: 'page-card-pie-body' }, [
    h('div', { class: 'pie-canvas', style: `background: conic-gradient(${conic})` }),
    h('div', { class: 'pie-legend' }, slices.map((s) =>
      h('div', { class: 'pie-legend-item' }, [
        h('span', { class: 'pie-dot', style: `background:${s.color}` }),
        h('span', { text: `${s.label} (${s.pct}%)` }),
        h('strong', { text: s.value })
      ])
    ))
  ]);
}

export function renderPageLineCard(card) {
  const entity = entityById(card.entity);
  const field = resolveCardGroupField(entity, card.groupBy);
  const rows = groupedCardRows(card, field);
  if (!rows.length) return h('div', { class: 'empty-illustration' }, [
    h('p', { text: '暂无数据' })
  ]);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const w = 280, h = 100, pad = 4;
  const stepX = rows.length > 1 ? (w - pad * 2) / (rows.length - 1) : 0;
  const pts = rows.map((row, i) => {
    const x = rows.length > 1 ? Math.round(pad + i * stepX) : w / 2;
    const y = Math.round(h - pad - ((row.value / max) * (h - pad * 2)));
    return { x, y };
  });
  const points = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const last = pts[pts.length - 1];
  return h('div', { class: 'page-card-line' }, [
    h('svg', { viewBox: `0 0 ${w} ${h}`, class: 'line-svg' }, [
      h('polyline', { points, fill: 'none', stroke: '#2563eb', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      last ? h('circle', { cx: last.x, cy: last.y, r: '3', fill: '#2563eb' }) : null
    ]),
    h('div', { class: 'line-labels' }, rows.map((r) => h('span', { text: r.label })))
  ]);
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
  const field = resolveCardGroupField(entity, card.groupBy);
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
  const field = resolveCardGroupField(entity, card.groupBy);
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

function resolveCardGroupField(entity, groupBy) {
  if (!entity || !groupBy) return entity?.fields?.[0];
  return entity.fields.find((f) => f.id === groupBy)
    || entity.fields.find((f) => f.label === groupBy)
    || entity.fields[0];
}

export function pageCardTitle(card) {
  if (card.type === 'table') return '数据表格';
  if (card.type === 'chart') return '统计图';
  if (card.type === 'pivot') return '透视图';
  return '统计卡片';
}

export function deleteCard(page, card, index) {
  openConfirmDialog({
    title: '删除卡片',
    message: `确定删除「${card.title || pageCardTitle(card)}」卡片吗？`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      if (card._isChart) {
        // Synthetic chart card — clear page.chart instead
        await saveCurrentPackage((pkg) => {
          const target = pkg.ui.pages.find((item) => item.id === page.id);
          if (target) delete target.chart;
        });
      } else {
        await saveCurrentPackage((pkg) => {
          const target = pkg.ui.pages.find((item) => item.id === page.id);
          if (target?.cards) target.cards.splice(index, 1);
        });
      }
      renderRuntime();
      toast('卡片已删除');
    }
  });
}

export function startPageCardResize(event, page, index) {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const card = page.cards[index];
  const el = event.currentTarget.parentElement;
  const startW = el.offsetWidth;
  const startH = el.offsetHeight;
  const onMove = (moveEvent) => {
    el.style.width = `${Math.max(200, startW + moveEvent.clientX - startX)}px`;
    el.style.minHeight = `${Math.max(80, startH + moveEvent.clientY - startY)}px`;
  };
  const onUp = async () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const card = page.cards?.[index];
    if (card && !card._isChart) {
      await saveCurrentPackage((pkg) => {
        const target = pkg.ui.pages.find((item) => item.id === page.id);
        if (target?.cards?.[index]) {
          target.cards[index].w = parseInt(el.style.width, 10) || startW;
          target.cards[index].h = parseInt(el.style.minHeight, 10) || startH;
        }
      });
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

export function renderDashboardPage(page) {
  const cards = Array.isArray(page.cards) && page.cards.length
    ? page.cards
    : state.currentApp?.ui?.home?.cards || [];
  if (!cards.length) {
    return h('div', { class: 'panel' }, [
      h('div', { class: 'blank-page-canvas', 'data-page-id': page.id }, [
        h('div', { class: 'blank-page-welcome' }, [
          h('p', { class: 'blank-page-hint', text: '这个看板还没有内容。' })
        ])
      ])
    ]);
  }
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
  if (!entity) return h('div', { class: 'panel', text: '图表需要关联一个数据表。' });
  const chart = page.chart || {};
  const records = recordsFor(entity.id);
  const groupField = entity.fields.find((field) => field.id === chart.groupBy)
    || entity.fields.find((field) => field.label === chart.groupBy)
    || {};
  const grouped = new Map();
  for (const record of records) {
    const raw = record.data[groupField.id || chart.groupBy];
    const key = formatFieldValue(raw, groupField) || '未填写';
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
