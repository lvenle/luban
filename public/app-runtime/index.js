import { h, svgIcon, svgPath, svgLine } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { clearUndoStack } from '../common/UndoStack.js';
import { state, root, topbar, writeRoute, entityFor, entityDisplayName, currentPage, pageEntityForRecordLoad, recordsFor, entityById, formatFieldValue, dateKey, renderPage, setPageRenderers, toggleMobileDrawer } from '../app-context.js';
import { renderAssistantDrawer, removeAssistantDrawer, setAssistantMode } from '../ai-assistant/index.js';
import { loadSidebarLayout, startSidebarResize, toggleSidebarCollapsed } from './RuntimeFrame.js';
import { renderSidebarContent, renderMobileSidebar } from './Sidebar.js';
import { configureRuntimeActions } from './runtime-actions.js';
import { measureAsync, measureSync } from '../common/perf.js';

configureRuntimeActions({ renderRuntime, loadCurrentPageRecords, saveCurrentPackage, renderInfiniteLoadSentinel });

async function registerPageRenderers() {
  const dt = await import('./DataTable.js').catch(() => ({}));
  const pt = await import('./PageTypes.js').catch(() => ({}));
  setPageRenderers(Object.assign({}, dt, pt));
}

export async function openApp(appId, options = {}) {
  clearUndoStack();
  // Transient loading overlay while fetching app data
  const loadingOverlay = h('div', { class: 'modal-backdrop', style: 'background:rgba(255,255,255,0.8);z-index:200' }, [
    h('div', { class: 'loading-overlay' }, [
      h('div', { class: 'loading-spinner' }),
      h('span', { text: '正在打开软件…' })
    ])
  ]);
  document.body.append(loadingOverlay);

  await measureAsync('runtime.registerPageRenderers', registerPageRenderers);
  const body = await measureAsync('runtime.fetchApp', () => api(`/api/apps/${appId}`), { meta: { appId } });
  loadingOverlay.remove();

  state.currentApp = body.app;
  state.currentPageId = options.pageId && body.app.ui.pages.some((p) => p.id === options.pageId) ? options.pageId : body.app.ui.pages[0]?.id;
  state.currentViewId = options.viewId || '';
  const page = body.app.ui.pages.find((p) => p.id === state.currentPageId) || body.app.ui.pages[0];
  if (page?.entity) {
    const { getViews } = await import('./ViewBar.js');
    const views = getViews(body.app.schema.entities.find((e) => e.id === page.entity) || body.app.schema.entities[0]);
    state.currentViewId = views.some((v) => v.id === state.currentViewId) ? state.currentViewId : views[0]?.id || '';
  }
  writeRoute(body.app.id, state.currentPageId, Boolean(options.replace), state.currentViewId);
  const initialPageId = state.currentPageId;
  const loadToken = `${body.app.id}:${state.currentPageId}:${Date.now()}`;
  state.activeRecordLoadToken = loadToken;
  state.loading = true;
  renderRuntime();
  try {
    await measureAsync('runtime.loadCurrentPageRecords.initial', loadCurrentPageRecords, { threshold: 120, meta: { appId: body.app.id, pageId: state.currentPageId } });
  } catch (error) {
    console.error('[Runtime] load records error:', error);
    toast(error.message || '加载数据失败');
  } finally {
    if (state.activeRecordLoadToken === loadToken && state.currentApp?.id === body.app.id && state.currentPageId === initialPageId) {
      state.loading = false;
      renderRuntime();
    }
  }
}

function renderMobileBottomNav() {
  return h('nav', { class: 'mobile-nav' }, [
    h('button', { class: `mobile-nav-tab ${state.mobileDrawerOpen ? 'active' : ''}`, onclick: toggleMobileDrawer }, [
      svgIcon('0 0 20 20', [svgLine(3, 5, 17, 5), svgLine(3, 10, 17, 10), svgLine(3, 15, 17, 15)], 'mobile-nav-icon'),
      h('span', { text: '页面' })
    ]),
    h('button', { class: 'mobile-nav-tab', onclick: () => { const s = document.querySelector('.global-search input'); if (s) s.focus(); } }, [
      svgIcon('0 0 20 20', [svgPath('M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z'), svgLine(12.5, 12.5, 17, 17)], 'mobile-nav-icon'),
      h('span', { text: '搜索' })
    ]),
    h('button', { class: 'mobile-nav-tab', onclick: async () => {
      const page = currentPage();
      const entity = pageEntityForRecordLoad(page);
      if (entity) { const { openRecordModal } = await import('./RecordModal.js'); openRecordModal(entity); }
    } }, [
      svgIcon('0 0 20 20', [svgLine(10, 4, 10, 16), svgLine(4, 10, 16, 10)], 'mobile-nav-icon'),
      h('span', { text: '新增' })
    ]),
    h('button', { class: 'mobile-nav-tab', onclick: () => { state.assistantOpen = !state.assistantOpen; renderRuntime(); } }, [
      svgIcon('0 0 20 20', [
        svgPath('M12 3.5l1.15 3.35L16.5 8l-3.35 1.15L12 12.5l-1.15-3.35L7.5 8l3.35-1.15L12 3.5Z'),
        svgPath('M6.5 11.5 7.2 13.3 9 14l-1.8.7-.7 1.8-.7-1.8L4 14l1.8-.7.7-1.8Z')
      ], 'mobile-nav-icon'),
      h('span', { text: 'AI 助理' })
    ])
  ]);
}

export function renderRuntime() {
  return measureSync('runtime.renderRuntime', () => {
    const tableWrap = document.querySelector('.table-wrap');
    const savedTop = tableWrap?.scrollTop || 0;
    const savedLeft = tableWrap?.scrollLeft || 0;
    const app = state.currentApp;
    const page = app.ui.pages.find((p) => p.id === state.currentPageId) || app.ui.pages[0];
    state.currentPageId = page?.id || state.currentPageId;
    setAssistantMode({ mode: 'modify', appId: app.id, appName: app.name, context: buildAssistantContext(), pageId: state.currentPageId });
    loadSidebarLayout();
    try {
      root.innerHTML = '';
      if (state.isMobile) {
        const shell = h('div', { class: 'shell' }, [
          topbar(),
          h('main', { class: 'runtime mobile-runtime' }, [
            h('section', { class: 'workspace' }, [renderPage(page)])
          ]),
          renderMobileBottomNav()
        ]);
        if (state.mobileDrawerOpen) {
          shell.append(
            h('div', { class: 'mobile-drawer-backdrop', onclick: () => { state.mobileDrawerOpen = false; renderRuntime(); } }),
            h('aside', { class: 'mobile-drawer' }, renderMobileSidebar(app, page))
          );
        }
        root.append(shell);
      } else {
        root.append(h('div', { class: 'shell desktop-runtime-shell' }, [
          topbar(),
          h('main', { class: `runtime ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`, style: `--sidebar-width:${state.sidebarWidth}px;--sidebar-collapsed-width:${state.sidebarCollapsedWidth}px` }, [
            h('aside', { class: 'sidebar' }, renderSidebarContent(app, page)),
            h('div', { class: 'sidebar-resizer', title: state.sidebarCollapsed ? '拖动调整折叠列表宽度，双击展开' : '拖动调整页面列表宽度，双击折叠', onpointerdown: startSidebarResize, ondblclick: toggleSidebarCollapsed }),
            h('section', { class: 'workspace' }, [renderPage(page)])
          ])
        ]));
      }
    } catch (err) {
      console.error('[Runtime] render error:', err);
      root.innerHTML = '';
      root.append(h('div', { class: 'panel', style: 'padding:40px;text-align:center' }, [
        h('p', { text: '渲染出错，请刷新重试。' }),
        h('p', { class: 'muted', style: 'font-size:13px', text: err.message })
      ]));
    }
    if (state.assistantOpen) {
      renderAssistantDrawer(() => { state.assistantOpen = false; const btn = document.querySelector('.assistant-topbar-button'); if (btn) btn.classList.remove('active'); });
    } else {
      removeAssistantDrawer();
    }
    if (savedTop > 0 || savedLeft > 0) setTimeout(() => { const w = document.querySelector('.table-wrap'); if (w) { w.scrollTop = savedTop; w.scrollLeft = savedLeft; } }, 0);
  }, { threshold: 80, meta: { appId: state.currentApp?.id, pageId: state.currentPageId, loading: state.loading } });
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
  return measureAsync('runtime.loadRecordPage', async () => {
    const page = currentPage();
    const runtime = state.runtimeSettings;
    const requestedLimit = Number(options.limit || (page?.entity === entityId ? page.pageSize : runtime.paginationDefault) || runtime.paginationDefault);
    const limit = Math.max(1, Math.min(runtime.paginationMax, requestedLimit));
    const previous = state.recordPagination[entityId || '*'];
    const offset = options.append ? Number(previous?.nextOffset || 0) : 0;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (entityId) params.set('entity', entityId);
    const body = await api(`/api/apps/${state.currentApp.id}/records?${params.toString()}`);
    const existing = options.append ? (entityId ? state.records.filter((record) => record.entityId === entityId) : state.records) : [];
    const existingIds = options.append ? new Set(existing.map((record) => record.id)) : null;
    const merged = options.append ? [...existing, ...body.records.filter((record) => !existingIds.has(record.id))] : body.records;
    state.records = entityId ? [...state.records.filter((record) => record.entityId !== entityId), ...merged] : merged;
    state.recordPagination[entityId || '*'] = body.pagination || { hasMore: false, nextOffset: merged.length, total: merged.length, limit };
    return body;
  }, { threshold: 120, meta: { entityId: entityId || '*', append: Boolean(options.append) } });
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
    while (state.recordPagination['*']?.hasMore) await loadRecordPage('', { append: true, limit: state.runtimeSettings.paginationMax });
    return;
  }
  await loadRecords(entity.id);
  if (!['list', 'editor', 'form', 'detail'].includes(page?.type)) {
    while (state.recordPagination[entity.id]?.hasMore) await loadRecordPage(entity.id, { append: true, limit: state.runtimeSettings.paginationMax });
  }
  const targets = [...new Set(entity.fields.filter((f) => f.type === 'relation' && f.targetEntity && f.targetEntity !== entity.id).map((f) => f.targetEntity))];
  for (const tid of targets) await mergeEntityRecords(tid);
}

export async function mergeEntityRecords(entityId) {
  const body = await api(`/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}&limit=${state.runtimeSettings.paginationMax}&offset=0`);
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
  const parts = [`当前应用: ${app.name}`, `当前页面: ${page?.title || '无'}`];
  if (page) parts.push(`页面ID: ${page.id}`, `页面类型: ${page.navKind || page.type}`);
  if (entity) {
    parts.push(`当前数据表: ${entityDisplayName(entity)} (${entity.id})`);
    parts.push(`字段列表: ${entity.fields.map((f) => `${f.label||f.id} (${f.type})`).join(', ')}`);
  }
  return parts.join(' | ');
}
