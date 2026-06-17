import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, root, topbar, writeRoute, entityFor, currentPage, pageEntityForRecordLoad, recordsFor, entityById, formatFieldValue, dateKey, renderPage } from '../app.js';
import { renderAssistantDrawer, setAppContext } from '../ai-assistant/index.js';
import { loadSidebarLayout, startSidebarResize, toggleSidebarCollapsed } from './RuntimeFrame.js';
import { renderSidebarContent } from './Sidebar.js';

function getViews(entity) {
  const stored = JSON.parse(localStorage.getItem(`software-garden:${state.currentApp?.id || 'global'}:${state.currentPageId || 'home'}:views:${entity.id}`) || 'null');
  return Array.isArray(stored) && stored.length ? stored : [{ id: 'default', name: '全部记录', visibleFields: entity.fields.map(f => f.id), fieldOrder: entity.fields.map(f => f.id), searchFields: [], columnWidths: {}, actionWidth: 112, allFields: entity.fields.map(f => f.id), filters: [], sorts: [], group: null }];
}

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
    const views = getViews(body.app.schema.entities.find((e) => e.id === page.entity) || body.app.schema.entities[0]);
    state.currentViewId = views.some((v) => v.id === state.currentViewId) ? state.currentViewId : views[0]?.id || '';
  }
  writeRoute(body.app.id, state.currentPageId, Boolean(options.replace), state.currentViewId);
  if (state.assistantOpen) setAppContext(buildAssistantContext());
  renderRuntime();
}

export function renderRuntime() {
  const tableWrap = document.querySelector('.table-wrap');
  const savedTop = tableWrap?.scrollTop || 0;
  const savedLeft = tableWrap?.scrollLeft || 0;
  const app = state.currentApp;
  const page = app.ui.pages.find((p) => p.id === state.currentPageId) || app.ui.pages[0];
  state.currentPageId = page?.id || state.currentPageId;
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
    document.querySelector('.drawer-backdrop')?.remove();
    document.querySelector('.assistant.drawer')?.remove();
  }
  if (savedTop > 0 || savedLeft > 0) setTimeout(() => { const w = document.querySelector('.table-wrap'); if (w) { w.scrollTop = savedTop; w.scrollLeft = savedLeft; } }, 0);
}

export async function saveAppMetadata(name, category, description = state.currentApp.description || '') {
  const body = await api(`/api/apps/${state.currentApp.id}`, { method: 'PUT', body: JSON.stringify({ name, category, description }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
  renderRuntime();
  toast('应用信息已保存');
}

export async function loadRecords(entityId = '') {
  if (!state.currentApp) return;
  state.records = (await api(`/api/apps/${state.currentApp.id}/records${entityId ? `?entity=${encodeURIComponent(entityId)}` : ''}`)).records;
}

export async function loadCurrentPageRecords() {
  const page = currentPage();
  const entity = pageEntityForRecordLoad(page);
  if (!entity) { await loadRecords(); return; }
  await loadRecords(entity.id);
  const targets = [...new Set(entity.fields.filter((f) => f.type === 'relation' && f.targetEntity && f.targetEntity !== entity.id).map((f) => f.targetEntity))];
  for (const tid of targets) await mergeEntityRecords(tid);
}

export async function mergeEntityRecords(entityId) {
  const body = await api(`/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}`);
  state.records = [...state.records.filter((r) => r.entityId !== entityId), ...body.records];
}

export function packageFromCurrentApp() {
  const app = state.currentApp;
  return { manifest: { ...(app.manifest || {}), name: app.name, description: app.description || '', icon: app.icon || '' }, schema: structuredClone(app.schema), ui: structuredClone(app.ui), actions: structuredClone(app.actions || { actions: [] }), prompts: structuredClone(app.prompts || {}) };
}

export async function saveCurrentPackage(mutator) {
  const pkg = packageFromCurrentApp();
  mutator(pkg);
  const body = await api(`/api/apps/${state.currentApp.id}/package`, { method: 'PUT', body: JSON.stringify({ package: pkg }) });
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
