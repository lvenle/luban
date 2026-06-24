import { renderAssistantDrawer } from './ai-assistant/index.js';
import { h, uiIcon, buttonLabel } from './common/dom.js';
import { api } from './common/api.js';
import { toast } from './common/toast.js';
import { openConfirmDialog, openTextModal, floatingMenus, closeFloatingMenus, bindFloatingMenu, setupModalAccessibility } from './common/modal.js';
import { readStorage, writeStorage, globalStorageKey, clampSidebarWidth } from './common/storage.js';
import { renderHome, loadApps, goHome } from './app-home/index.js';
import { appCategory } from './app-home/AppCard.js';
import { formatDateFieldValue } from './app-runtime/DateFormat.js';

export const state = {
  apps: [], currentApp: null, currentPageId: null, records: [],
  inlineEditId: null, loading: false, appCategory: '全部', currentViewId: '',
  assistantOpen: false, pageDragId: '', cellSelection: null, cellClipboard: null,
  sidebarCollapsed: false, sidebarWidth: 168, recordPagination: {}, loadingRecordPages: {}
};

export const root = document.querySelector('#app');
export const APP_VERSION = '2026.06.23';

export function storageKey(scope, suffix = '') {
  const appId = state.currentApp?.id || 'global';
  const pageId = state.currentPageId || 'home';
  return `luban-ai:${appId}:${pageId}:${scope}${suffix ? `:${suffix}` : ''}`;
}

function slugifyLocal(input, fallback = 'page') {
  const value = String(input || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value || fallback;
}

export function uniquePageId(title, entityId = 'page') {
  const base = slugifyLocal(`${entityId}-${title || 'page'}`, `${entityId}-page`);
  const existing = new Set((state.currentApp?.ui?.pages || []).map((p) => p.id));
  if (!existing.has(base)) return base;
  let i = 2; while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

async function boot() {
  setupModalAccessibility();
  state.apps = (await api('/api/apps')).apps;
  const route = currentRoute();
  document.body.addEventListener('ai-message-end', async () => {
    if (!state.currentApp) {
      await loadApps();
      return;
    }
    try {
      state.currentApp = (await api(`/api/apps/${state.currentApp.id}`)).app;
      const rt = await import('./app-runtime/index.js');
      if (state.currentPageId && state.currentApp.ui.pages.some((p) => p.id === state.currentPageId)) await rt.loadCurrentPageRecords();
      rt.renderRuntime();
    } catch {}
  });
  if (route.appId) {
    try { await (await import('./app-runtime/index.js')).openApp(route.appId, { pageId: route.pageId, viewId: route.viewId, replace: true }); return; }
    catch (error) { history.replaceState(null, '', '/'); toast(error.message); }
  }
  state.currentApp = null;
  state.currentPageId = null;
  state.currentViewId = '';
  state.records = [];
  state.inlineEditId = null;
  renderHome();
}

export function currentRoute() {
  const params = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean);
  let appId = '', pageId = '';
  if (parts[0] === 'app' && parts[1]) { appId = parts[1]; if (parts[2] === 'page' && parts[3]) pageId = parts[3]; }
  return { appId: appId || params.get('app') || '', pageId: pageId || params.get('page') || '', viewId: params.get('view') || '' };
}

export function writeRoute(appId, pageId, replace = false, viewId = state.currentViewId) {
  const params = viewId ? `?view=${encodeURIComponent(viewId)}` : '';
  const next = `${appId ? `/app/${appId}${pageId ? `/page/${pageId}` : ''}` : '/'}${params}`;
  if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
}

export function topbar() {
  const inRuntime = Boolean(state.currentApp);
  return h('header', { class: 'topbar' }, [
    h('div', { class: 'topbar-left' }, [
      h('button', { class: 'brand brand-button', onclick: goHome, title: '返回首页' }, [
        h('img', { class: 'brand-logo', src: '/images/logo.png', alt: '鲁班AI系统' }),
        h('div', { class: 'brand-title-group' }, [
          h('span', { text: '鲁班AI系统' }),
          h('span', { class: 'version-badge', text: `v${APP_VERSION}` })
        ])
      ]),
      inRuntime ? renderTopbarAppInfo(state.currentApp) : null
    ]),
    h('div', { class: 'top-actions' }, [
      h('button', {
        class: `secondary icon-label-button assistant-topbar-button ${state.assistantOpen ? 'active' : ''}`,
        onclick: () => { state.assistantOpen = !state.assistantOpen; if (state.currentApp) { (async () => { const rt = await import('./app-runtime/index.js'); rt.renderRuntime(); })(); } else renderHome(); }
      }, buttonLabel('assistant', 'AI 助理')),
      h('button', { class: 'secondary icon-label-button', title: '设置', onclick: () => import('./app-runtime/SettingsModal.js').then(m => m.openSettingsModal()) }, buttonLabel('settings', '设置'))
    ])
  ]);
}

function renderTopbarAppInfo(app) {
  return h('div', { class: 'topbar-app-info' }, [
    inlineEditableText({ className: 'topbar-app-name', value: app.name, title: '双击编辑软件名称', onSave: (v) => saveAppMetadata(v, appCategory(app)) }),
    h('span', { class: 'topbar-separator', text: '/' }),
    inlineEditableText({ className: 'category-pill compact', value: appCategory(app), title: '双击编辑分类', onSave: (v) => saveAppMetadata(app.name, v) }),
    inlineEditableText({ className: 'topbar-app-desc muted', value: app.description || '双击添加介绍', title: '双击编辑介绍', onSave: (v) => saveAppMetadata(app.name, appCategory(app), v) })
  ]);
}

async function saveAppMetadata(name, category, description) {
  const body = await api(`/api/apps/${state.currentApp.id}`, { method: 'PUT', body: JSON.stringify({ name, category, description: description || '', expectedUpdatedAt: state.currentApp.updatedAt }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
  (await import('./app-runtime/index.js')).renderRuntime();
}

function inlineEditableText({ value, className = '', onSave, multiline = false }) {
  const display = h('span', { class: `inline-edit-text ${className}`, text: value || '', ondblclick: () => {
    const input = multiline ? h('textarea', { class: 'inline-edit-input' }) : h('input', { class: 'inline-edit-input', type: 'text' });
    input.value = display.textContent;
    display.replaceWith(input); input.focus(); if (input.select) input.select();
    let done = false;
    const finish = async (save) => { if (done) return; done = true; const next = input.value.trim(); if (save && next !== value) await onSave(next); else (async () => (await import('./app-runtime/index.js')).renderRuntime())(); };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) input.blur(); if (e.key === 'Escape') finish(false); });
  }});
  return display;
}

export function entityFor(page) { return state.currentApp.schema.entities.find((e) => e.id === page.entity) || state.currentApp.schema.entities[0]; }
export function currentPage() { return state.currentApp?.ui.pages.find((p) => p.id === state.currentPageId) || state.currentApp?.ui.pages[0] || null; }
export function pageEntityForRecordLoad(page) { if (!page || !state.currentApp) return null; if (page.entity) return entityFor(page); if (['list', 'chart', 'editor', 'form', 'detail'].includes(page.type)) return entityFor(page); return null; }
export function recordsFor(entityId) { return state.records.filter((r) => !entityId || r.entityId === entityId); }
export function entityById(entityId) { return state.currentApp.schema.entities.find((e) => e.id === entityId); }

export function formatFieldValue(value, field) {
  if (value == null || value === '') return '';
  if (field.type === 'select') return (field.options || []).map(o => typeof o === 'string' ? { id: o, label: o, color: 'gray' } : o).find((o) => (o.id === (value?.optionId || value?.id || value)) || o.label === value)?.label || value?.optionId || value?.id || value || '';
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((i) => formatFieldValue({ optionId: i.optionId || i.id || i }, { type: 'select', options: field.options })).filter(Boolean).join('、');
  if (field.type === 'relation') return (Array.isArray(value) ? value : [value]).map((v) => v?.displayValue || v?.label || v?.name || '').filter(Boolean).join('、');
  if (field.type === 'image' || field.type === 'file') return typeof value === 'object' ? (value.name || value.url?.split('/').pop() || '') : String(value);
  if (field.type === 'formula') return formatFieldValue(value, { ...field, type: field.formula?.resultType || 'number' });
  if (field.type === 'number') { const n = Number(value); if (Number.isNaN(n)) return String(value ?? ''); if (field.format === 'integer') return String(Math.round(n)); if (field.format === 'decimal2') return n.toFixed(2); if (field.format === 'currency') return `¥${n.toFixed(2)}`; if (field.format === 'percent') return `${(n * 100).toFixed(2)}%`; return Number.isInteger(n) ? String(n) : n.toFixed(2); }
  if (field.type === 'date' || field.type === 'datetime') return formatDateFieldValue(value, field);
  if (Array.isArray(value)) return value.map((i) => i?.displayValue || i?.label || i).join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.name || value.optionId || '';
  if (value === true) return '是'; if (value === false) return '否';
  return String(value ?? '');
}

export function dateKey(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
}

// View system helpers (used by runtime modules)
export function defaultView(entity) {
  const legacy = readStorage(storageKey('list', entity.id), null);
  const fb = { id: 'default', name: '全部记录', visibleFields: entity.fields.map(f => f.id), fieldOrder: entity.fields.map(f => f.id), searchFields: [], columnWidths: {}, actionWidth: 112, allFields: entity.fields.map(f => f.id), filters: [], sorts: [], group: null };
  return normalizeView(entity, { ...fb, visibleFields: legacy?.visibleFields, fieldOrder: legacy?.fieldOrder, searchFields: legacy?.searchFields, columnWidths: legacy?.columnWidths, sorts: legacy?.sort?.field ? [{ field: legacy.sort.field, direction: legacy.sort.direction || 'asc' }] : [] });
}

export function orderedFields(entity) {
  const layout = getFormLayout(entity);
  const byId = new Map(entity.fields.map(f => [f.id, f]));
  return layout.order.map(id => byId.get(id)).filter(Boolean);
}

export function viewOrderedFields(entity, view) {
  const byId = new Map(entity.fields.map(f => [f.id, f]));
  const ordered = (view.fieldOrder || []).map(id => byId.get(id)).filter(Boolean);
  orderedFields(entity).forEach(f => { if (!ordered.some(o => o.id === f.id)) ordered.push(f); });
  return ordered;
}

export function sortRecords(records, config) {
  const sorts = config.sorts?.length ? config.sorts : config.sort?.field ? [config.sort] : [];
  if (!sorts.length) return [...records];
  const basePos = new Map(records.map((r, i) => [r.id, i]));
  return [...records].sort((a, b) => {
    for (const s of sorts) {
      const dir = s.direction === 'desc' ? -1 : 1;
      const r = compareValues(a.data[s.field], b.data[s.field]);
      if (r !== 0) return r * dir;
    }
    return (basePos.get(a.id) ?? 0) - (basePos.get(b.id) ?? 0);
  });
}

export function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true });
}

export function applyViewFilters(records, entity, view) {
  const filters = view.filters || [];
  if (!filters.length) return records;
  const fields = new Map(entity.fields.map(f => [f.id, f]));
  return records.filter(r => filters.every(f => { const field = fields.get(f.field); return field && matchesViewFilter(r.data[field.id], field, f); }));
}

function matchesViewFilter(value, field, filter) {
  const op = filter.op || 'contains';
  if (op === 'empty') return value == null || value === '' || (Array.isArray(value) && !value.length);
  if (op === 'notEmpty') return !(value == null || value === '' || (Array.isArray(value) && !value.length));
  const e = filter.value;
  const fieldType = field.type === 'formula' ? field.formula?.resultType || 'number' : field.type;
  if (fieldType === 'number') { const a = Number(value), t = Number(e); if (Number.isNaN(a) || Number.isNaN(t)) return false; if (op === 'gt') return a > t; if (op === 'lt') return a < t; return a === t; }
  if (fieldType === 'date' || fieldType === 'datetime') { const a = dateKey(value), t = dateKey(e); if (!a) return false; if (op === 'today') return a === dateKey(new Date()); if (op === 'thisWeek') return sameWeek(a, new Date()); if (op === 'thisMonth') return a.slice(0, 7) === dateKey(new Date()).slice(0, 7); if (!t) return false; if (op === 'before') return a < t; if (op === 'after') return a > t; return a === t; }
  if (field.type === 'boolean') { const a = value === true || value === '是' || value === 'true'; const t = e === true || e === '是' || e === 'true'; return a === t; }
  const at = formatFieldValue(value, field).toLowerCase();
  const tt = String(e ?? '').toLowerCase();
  if (op === 'notContains' && tt) return !at.includes(tt);
  if (op === 'neq') return at !== tt;
  if (op === 'eq') return at === tt;
  return !tt || at.includes(tt);
}

function sameWeek(actualKey, now) {
  const a = new Date(actualKey), c = new Date(dateKey(now));
  const s = new Date(c); s.setDate(c.getDate() - (c.getDay() || 7) + 1);
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return a >= s && a <= e;
}

export function groupRecords(records, entity, group) {
  const field = entity.fields.find(f => f.id === group.field);
  const grouped = new Map();
  for (const r of records) {
    const k = groupKeyForRecord(r, field, group);
    if (!grouped.has(k.key)) grouped.set(k.key, { ...k, records: [] });
    grouped.get(k.key).records.push(r);
  }
  return [...grouped.values()];
}

function groupKeyForRecord(record, field, group) {
  const v = record.data[field?.id];
  if (!field) return { key: 'ungrouped', label: '未分组' };
  if (field.type === 'date' || field.type === 'datetime') {
    const k = dateKey(v); if (!k) return { key: 'empty', label: '未填写' };
    if (group.mode === 'month') return { key: k.slice(0, 7), label: k.slice(0, 7) };
    if (group.mode === 'week') { const d = new Date(k); d.setDate(d.getDate() - (d.getDay() || 7) + 1); const s = dateKey(d); return { key: `week:${s}`, label: `${s} 至 ${dateKey(new Date(new Date(s).getTime() + 6*86400000))}` }; }
    return { key: k, label: k };
  }
  const label = formatFieldValue(v, field) || '未填写';
  return { key: String(label), label: String(label) };
}

export function getFormLayout(entity) {
  const fb = { columns: 2, order: entity.fields.map(f => f.id) };
  const legacy = readStorage(storageKey('form-layout', entity.id), null);
  const stored = structuredClone(entity.formLayout || legacy || fb);
  stored.columns = [1, 2, 3, 4].includes(Number(stored.columns)) ? Number(stored.columns) : 2;
  stored.order = (stored.order || []).filter(id => new Set(entity.fields.map(f => f.id)).has(id));
  entity.fields.forEach(f => { if (!stored.order.includes(f.id)) stored.order.push(f.id); });
  return stored;
}

export async function setFormLayout(entity, layout) {
  const normalized = { columns: [1, 2, 3, 4].includes(Number(layout.columns)) ? Number(layout.columns) : 2, order: layout.order };
  entity.formLayout = normalized;
  const { saveCurrentPackage } = await import('./app-runtime/index.js');
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    if (target) target.formLayout = normalized;
  });
  localStorage.removeItem(storageKey('form-layout', entity.id));
}
export function getFormDesign(entity) { return getFormDesignFromPatch(entity, entity.formDesign || readStorage(storageKey('form-design', entity.id), null)); }
export async function setFormDesign(entity, design) {
  const normalized = getFormDesignFromPatch(entity, design);
  const { saveCurrentPackage } = await import('./app-runtime/index.js');
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    if (target) target.formDesign = normalized;
  });
  localStorage.removeItem(storageKey('form-design', entity.id));
}

function getFormDesignFromPatch(entity, design = {}) {
  const fSet = new Set(entity.fields.map(f => f.id));
  return { descriptions: Object.fromEntries(Object.entries(design?.descriptions || {}).filter(([id]) => fSet.has(id))), defaults: Object.fromEntries(Object.entries(design?.defaults || {}).filter(([id]) => fSet.has(id))) };
}

function normalizeView(entity, view) {
  const fIds = entity.fields.map(f => f.id), fSet = new Set(fIds);
  const fb = { visibleFields: [...fIds], fieldOrder: [...fIds], searchFields: [], columnWidths: {}, actionWidth: 112, allFields: [...fIds], filters: [], sorts: [], group: null, id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: '全部记录' };
  const next = { ...fb, ...view };
  next.name = String(next.name || '未命名视图').trim() || '未命名视图';
  next.visibleFields = (next.visibleFields || []).filter(id => fSet.has(id));
  fIds.forEach(id => { if (!next.visibleFields.includes(id)) next.visibleFields.push(id); });
  if (!next.visibleFields.length) next.visibleFields = [...fIds];
  next.fieldOrder = (next.fieldOrder || []).filter(id => fSet.has(id));
  fIds.forEach(id => { if (!next.fieldOrder.includes(id)) next.fieldOrder.push(id); });
  next.searchFields = (next.searchFields || []).filter(id => fSet.has(id));
  next.columnWidths ||= {}; Object.keys(next.columnWidths).forEach(id => { if (!fSet.has(id)) delete next.columnWidths[id]; });
  next.actionWidth = Math.max(84, Number(next.actionWidth || 112));
  next.filters = (next.filters || []).filter(f => fSet.has(f.field));
  next.sorts = (next.sorts || []).filter(s => fSet.has(s.field));
  if (next.group && !fSet.has(next.group.field)) next.group = null;
  next.group = next.group ? { field: next.group.field, mode: next.group.mode || 'value', collapsed: next.group.collapsed || [] } : null;
  return next;
}

export function renderPage(page) {
  if (state.loading) return renderLoadingSkeleton();
  if (!page) return h('div', { class: 'panel', text: '这个软件还没有页面。' });
  const rt = globalThis.__rt || {};
  if (page.type === 'blank') return (rt.renderBlankPage || (() => h('div', { class: 'blank-page-canvas' })))(page);
  if (page.type === 'chart') return (rt.renderChartPage || (() => h('div')))(page);
  if (page.type === 'dashboard') return (rt.renderDashboardPage || (() => h('div')))(page);
  if (page.type === 'editor') return (rt.renderEditorPage || (() => h('div')))(page);
  return (rt.renderListPage || (() => h('div', { text: '加载中...' })))(page);
}

// Initialize undo/redo keyboard shortcuts once on load
import('./app-runtime/UndoRedo.js').then(({ setupUndoShortcuts }) => setupUndoShortcuts()).catch(() => {});

function renderLoadingSkeleton() {
  return h('div', { class: 'loading-overlay' }, [
    h('div', { class: 'loading-skeleton' }, [
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' })
    ])
  ]);
}

// Global event listeners
window.addEventListener('popstate', () => boot().catch((e) => { root.textContent = e.message; }));
document.addEventListener('click', (e) => { if (!e.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
document.addEventListener('pointerdown', (e) => { if (e.target instanceof HTMLElement && e.target.classList.contains('modal-backdrop')) e.target.remove(); }, true);
document.addEventListener('focusin', (e) => { if (!e.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
import('./app-runtime/CellSelection.js')
  .then(({ bindCellSelectionEvents }) => bindCellSelectionEvents())
  .then(() => boot())
  .catch((e) => { root.textContent = e.message; });
