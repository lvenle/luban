import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, root, topbar, writeRoute, entityFor, currentPage, pageEntityForRecordLoad, recordsFor, entityById, formatFieldValue, dateKey, renderPage } from '../app.js';
import { renderAssistantDrawer, removeAssistantDrawer, setAssistantMode } from '../ai-assistant/index.js';
import { loadSidebarLayout, startSidebarResize, toggleSidebarCollapsed } from './RuntimeFrame.js';
import { renderSidebarContent } from './Sidebar.js';

async function registerPageRenderers() {
  const dt = await import('./DataTable.js').catch(() => ({}));
  const pt = await import('./PageTypes.js').catch(() => ({}));
  globalThis.__rt = Object.assign({}, dt, pt);
}

export async function openApp(appId, options = {}) {
  await registerPageRenderers();
  const body = await api(`/api/apps/${appId}`);
  state.currentApp = body.app;
  state.currentPageId = options.pageId && body.app.ui.pages.some((p) => p.id === options.pageId) ? options.pageId : body.app.ui.pages[0]?.id;
  state.currentViewId = options.viewId || '';
  await loadCurrentPageRecords();
  const page = body.app.ui.pages.find((p) => p.id === state.currentPageId) || body.app.ui.pages[0];
  if (page?.entity) {
    const { getViews } = await import('./ViewBar.js');
    const views = getViews(body.app.schema.entities.find((e) => e.id === page.entity) || body.app.schema.entities[0]);
    state.currentViewId = views.some((v) => v.id === state.currentViewId) ? state.currentViewId : views[0]?.id || '';
  }
  writeRoute(body.app.id, state.currentPageId, Boolean(options.replace), state.currentViewId);
  renderRuntime();
}

export function renderRuntime() {
  const tableWrap = document.querySelector('.table-wrap');
  const savedTop = tableWrap?.scrollTop || 0;
  const savedLeft = tableWrap?.scrollLeft || 0;
  const app = state.currentApp;
  const page = app.ui.pages.find((p) => p.id === state.currentPageId) || app.ui.pages[0];
  state.currentPageId = page?.id || state.currentPageId;
  setAssistantMode({ mode: 'modify', appId: app.id, appName: app.name, context: buildAssistantContext() });
  loadSidebarLayout();
  root.innerHTML = '';
  root.append(h('div', { class: 'shell' }, [
    topbar(),
    h('main', { class: `runtime ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`, style: `--sidebar-width:${state.sidebarWidth}px` }, [
      h('aside', { class: 'sidebar' }, renderSidebarContent(app, page)),
      h('div', { class: 'sidebar-resizer', title: state.sidebarCollapsed ? '展开页面列表' : '拖动调整页面列表宽度', onpointerdown: startSidebarResize, ondblclick: toggleSidebarCollapsed }),
      h('section', { class: 'workspace' }, [renderPage(page)])
    ])
  ]));
  if (state.assistantOpen) {
    renderAssistantDrawer(() => { state.assistantOpen = false; const btn = document.querySelector('.assistant-topbar-button'); if (btn) btn.classList.remove('active'); });
  } else {
    removeAssistantDrawer();
  }
  if (savedTop > 0 || savedLeft > 0) setTimeout(() => { const w = document.querySelector('.table-wrap'); if (w) { w.scrollTop = savedTop; w.scrollLeft = savedLeft; } }, 0);
}

export async function saveAppMetadata(name, category, description = state.currentApp.description || '') {
  const body = await api(`/api/apps/${state.currentApp.id}`, { method: 'PUT', body: JSON.stringify({ name, category, description, expectedUpdatedAt: state.currentApp.updatedAt }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
  renderRuntime();
  toast('应用信息已保存');
}

export async function loadRecords(entityId = '') {
  if (!state.currentApp) return;
  return loadRecordPage(entityId, { append: false });
}

export async function loadRecordPage(entityId = '', options = {}) {
  if (!state.currentApp) return;
  const page = currentPage();
  const limit = Math.max(1, Math.min(1000, Number(options.limit || (page?.entity === entityId ? page.pageSize : 100) || 100)));
  const previous = state.recordPagination[entityId || '*'];
  const offset = options.append ? Number(previous?.nextOffset || 0) : 0;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (entityId) params.set('entity', entityId);
  const body = await api(`/api/apps/${state.currentApp.id}/records?${params.toString()}`);
  const existing = options.append ? (entityId ? state.records.filter((record) => record.entityId === entityId) : state.records) : [];
  const merged = options.append ? [...existing, ...body.records.filter((record) => !existing.some((item) => item.id === record.id))] : body.records;
  state.records = entityId ? [...state.records.filter((record) => record.entityId !== entityId), ...merged] : merged;
  state.recordPagination[entityId || '*'] = body.pagination || { hasMore: false, nextOffset: merged.length, total: merged.length, limit };
  return body;
}

export async function loadNextRecordPage(entityId) {
  const pagination = state.recordPagination[entityId];
  if (!pagination?.hasMore || state.loadingRecordPages[entityId]) return false;
  state.loadingRecordPages[entityId] = true;
  try {
    await loadRecordPage(entityId, { append: true, limit: pagination.limit });
    renderRuntime();
    return true;
  } finally {
    state.loadingRecordPages[entityId] = false;
  }
}

export function renderInfiniteLoadSentinel(entity) {
  const pagination = state.recordPagination[entity.id];
  const loaded = recordsFor(entity.id).length;
  const sentinel = h('div', {
    class: 'record-load-sentinel muted',
    text: pagination?.hasMore ? `继续向下滚动加载（已加载 ${loaded} / ${pagination.total}）` : `已加载全部 ${pagination?.total ?? loaded} 条`
  });
  if (pagination?.hasMore) requestAnimationFrame(() => {
    if (!sentinel.isConnected) return;
    const observer = new IntersectionObserver(async (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      sentinel.textContent = '正在加载下一页…';
      await loadNextRecordPage(entity.id);
    }, { root: null, rootMargin: '160px 0px' });
    observer.observe(sentinel);
  });
  return sentinel;
}

export async function loadCurrentPageRecords() {
  const page = currentPage();
  const entity = pageEntityForRecordLoad(page);
  state.recordPagination = {};
  if (!entity) {
    await loadRecords();
    while (state.recordPagination['*']?.hasMore) await loadRecordPage('', { append: true, limit: 1000 });
    return;
  }
  await loadRecords(entity.id);
  if (!['list', 'editor', 'form', 'detail'].includes(page?.type)) {
    while (state.recordPagination[entity.id]?.hasMore) await loadRecordPage(entity.id, { append: true, limit: 1000 });
  }
  const targets = [...new Set(entity.fields.filter((f) => f.type === 'relation' && f.targetEntity && f.targetEntity !== entity.id).map((f) => f.targetEntity))];
  for (const tid of targets) await mergeEntityRecords(tid);
}

export async function mergeEntityRecords(entityId) {
  const body = await api(`/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}&limit=1000&offset=0`);
  state.records = [...state.records.filter((r) => r.entityId !== entityId), ...body.records];
  state.recordPagination[entityId] = body.pagination;
}

export function packageFromCurrentApp() {
  const app = state.currentApp;
  return { manifest: { ...(app.manifest || {}), name: app.name, description: app.description || '', icon: app.icon || '' }, schema: structuredClone(app.schema), ui: structuredClone(app.ui), actions: structuredClone(app.actions || { actions: [] }), prompts: structuredClone(app.prompts || {}) };
}

export async function saveCurrentPackage(mutator) {
  const pkg = packageFromCurrentApp();
  mutator(pkg);
  const body = await api(`/api/apps/${state.currentApp.id}/package`, { method: 'PUT', body: JSON.stringify({ package: pkg, expectedUpdatedAt: state.currentApp.updatedAt }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
  return body.app;
}

export function buildAssistantContext() {
  const app = state.currentApp;
  if (!app) return '';
  const page = app.ui.pages.find((p) => p.id === state.currentPageId) || app.ui.pages[0];
  const entity = page?.entity ? entityFor(page) : null;
  const parts = [`App ID: ${app.id}`, `App Name: ${app.name}`];
  if (page) parts.push(`Page: ${page.title} (${page.id})`);
  if (entity) { parts.push(`Entity: ${entity.name} (${entity.id})`); parts.push(`Fields: ${entity.fields.map((f) => `${f.label||f.id} (${f.type})`).join(', ')}`); }
  return parts.join(' | ');
}
