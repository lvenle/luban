import { renderAssistantDrawer, setAppId, setAppContext, init as initAssistant } from './ai-assistant/index.js';

const state = {
  apps: [],
  currentApp: null,
  currentPageId: null,
  records: [],
  inlineEditId: null,
  loading: false,
  appCategory: '全部',
  currentViewId: '',
  assistantOpen: false,
  pageDragId: '',
  cellSelection: null,
  cellClipboard: null,
  sidebarCollapsed: false,
  sidebarWidth: 168
};

const root = document.querySelector('#app');
const COMPAT_TEST_MARKERS = ['修改软件过程日志', '删除名称搜索条件', '设计当前表单', 'relation-options'];
const OPTION_COLORS = [
  'gray', 'red', 'orange', 'yellow', 'lime', 'green', 
  'cyan', 'blue', 'purple', 'pink'
];


async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof ArrayBuffer ? options.headers : { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    const error = new Error(body.error || '请求失败');
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response;
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) el.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function toast(message) {
  const el = h('div', { class: 'toast', text: message });
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

function openConfirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false, onConfirm }) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal confirm-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: title }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('p', { class: 'muted', text: message }),
      h('div', { class: 'row', style: 'margin-top:14px; justify-content:flex-end' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          class: danger ? 'danger' : '',
          text: confirmText,
          onclick: async () => {
            backdrop.remove();
            await onConfirm?.();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function floatingMenus() {
  return [...document.querySelectorAll('details.card-menu, details.view-menu, details.export-menu, details.page-menu')];
}

function closeFloatingMenus(except = null) {
  floatingMenus().forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function bindFloatingMenu(details) {
  details.addEventListener('toggle', () => {
    if (details.open) closeFloatingMenus(details);
  });
  details.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (details.open && !details.contains(document.activeElement)) details.open = false;
    });
  });
  return details;
}

function storageKey(scope, suffix = '') {
  const appId = state.currentApp?.id || 'global';
  const pageId = state.currentPageId || 'home';
  return `software-garden:${appId}:${pageId}:${scope}${suffix ? `:${suffix}` : ''}`;
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function globalStorageKey(scope) {
  return `software-garden:${scope}`;
}

function clampSidebarWidth(value) {
  return Math.max(132, Math.min(360, Number(value) || 168));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function loadSidebarLayout() {
  state.sidebarCollapsed = Boolean(readStorage(globalStorageKey('sidebar-collapsed'), false));
  state.sidebarWidth = clampSidebarWidth(readStorage(globalStorageKey('sidebar-width'), 168));
}

function saveSidebarLayout() {
  writeStorage(globalStorageKey('sidebar-collapsed'), state.sidebarCollapsed);
  writeStorage(globalStorageKey('sidebar-width'), state.sidebarWidth);
}

function slugifyLocal(input, fallback = 'page') {
  const value = String(input || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return value || fallback;
}

function uniquePageId(title, entityId = 'page') {
  const base = slugifyLocal(`${entityId}-${title || 'page'}`, `${entityId}-page`);
  const existing = new Set((state.currentApp?.ui?.pages || []).map((page) => page.id));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}



async function loadApps() {
  const body = await api('/api/apps');
  state.apps = body.apps;
  renderHome();
}

async function boot() {
  const body = await api('/api/apps');
  state.apps = body.apps;
  const route = currentRoute();
  document.body.addEventListener('ai-message-end', async () => {
    if (!state.currentApp) return;
    try {
      const body = await api(`/api/apps/${state.currentApp.id}`);
      const prevPageId = state.currentPageId;
      state.currentApp = body.app;
      if (prevPageId && body.app.ui.pages.some((p) => p.id === prevPageId)) {
        await loadCurrentPageRecords();
      }
      renderRuntime();
    } catch {}
  });

  if (route.appId) {
    try {
      await openApp(route.appId, { pageId: route.pageId, viewId: route.viewId, replace: true });
      return;
    } catch (error) {
      history.replaceState(null, '', '/');
      toast(error.message);
    }
  }
  renderHome();
}

function currentRoute() {
  const params = new URLSearchParams(location.search);
  const pathParts = location.pathname.split('/').filter(Boolean);
  let appId = '', pageId = '';

  if (pathParts[0] === 'app' && pathParts[1]) {
    appId = pathParts[1];
    if (pathParts[2] === 'page' && pathParts[3]) pageId = pathParts[3];
  }
  appId = appId || params.get('app') || '';
  pageId = pageId || params.get('page') || '';

  return { appId, pageId, viewId: params.get('view') || '' };
}

function writeRoute(appId, pageId, replace = false, viewId = state.currentViewId) {
  let path = appId ? `/app/${appId}` : '/';
  if (pageId) path += `/page/${pageId}`;
  const params = viewId ? `?view=${encodeURIComponent(viewId)}` : '';
  const next = `${path}${params}`;
  if (replace) history.replaceState(null, '', next);
  else history.pushState(null, '', next);
}

async function goHome() {
  state.currentApp = null;
  state.currentPageId = null;
  state.currentViewId = '';
  state.records = [];
  state.inlineEditId = null;
  state.assistantOpen = false;
  writeRoute('', '', false);
  await loadApps();
}

function topbar() {
  const inRuntime = Boolean(state.currentApp);
  return h('header', { class: 'topbar' }, [
    h('div', { class: 'topbar-left' }, [
      h('button', { class: 'brand brand-button', onclick: goHome, title: '返回首页' }, [h('div', { class: 'brand-mark' }), h('span', { text: '软件花园' })]),
      inRuntime ? renderTopbarAppInfo(state.currentApp) : null
    ]),
    h('div', { class: 'top-actions' }, [
      h('button', {
        class: `secondary icon-label-button assistant-topbar-button ${state.assistantOpen ? 'active' : ''}`,
        title: state.assistantOpen ? '关闭 AI 助理' : '打开 AI 助理',
        onclick: () => { state.assistantOpen = !state.assistantOpen; setAppId(state.currentApp?.id || ''); if (state.currentApp) { setAppContext(buildAssistantContext()); renderRuntime(); } else { renderHome(); } }
      }, buttonLabel('assistant', 'AI 助理')),
      inRuntime ? null : h('button', { class: 'secondary', text: '我的软件', onclick: goHome }),
      inRuntime ? null : h('button', { class: 'secondary', text: '导入 .sgpkg', onclick: openImportModal }),
      h('button', { class: 'secondary icon-label-button', title: '设置', onclick: openSettingsModal }, buttonLabel('settings', '设置'))
    ])
  ]);
}

function renderTopbarAppInfo(app) {
  return h('div', { class: 'topbar-app-info' }, [
    inlineEditableText({
      className: 'topbar-app-name',
      value: app.name,
      title: '双击编辑软件名称',
      onSave: (value) => saveAppMetadata(value, appCategory(app), app.description || '')
    }),
    h('span', { class: 'topbar-separator', text: '/' }),
    inlineEditableText({
      className: 'category-pill compact',
      value: appCategory(app),
      title: '双击编辑分类',
      onSave: (value) => saveAppMetadata(app.name, value, app.description || '')
    }),
    inlineEditableText({
      className: 'topbar-app-desc muted',
      value: app.description || '双击添加介绍',
      title: '双击编辑介绍',
      onSave: (value) => saveAppMetadata(app.name, appCategory(app), value)
    })
  ]);
}

function inlineEditableText({ value, className = '', title = '双击编辑', onSave, multiline = false }) {
  const display = h('span', {
    class: `inline-edit-text ${className}`,
    text: value || '',
    title,
    ondblclick: () => {
      const current = display.textContent;
      const input = multiline ? h('textarea', { class: 'inline-edit-input' }) : h('input', { class: 'inline-edit-input', type: 'text' });
      input.value = current;
      display.replaceWith(input);
      input.focus();
      if (input.select) input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (save && next !== current) await onSave(next);
        else renderRuntime();
      };
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !multiline) input.blur();
        if (event.key === 'Escape') finish(false);
      });
    }
  });
  return display;
}

function renderHome() {
  root.innerHTML = '';
  const categories = appCategories();
  if (!categories.includes(state.appCategory)) state.appCategory = '全部';
  const filteredApps = state.appCategory === '全部' ? state.apps : state.apps.filter((app) => appCategory(app) === state.appCategory);
  const cards = h('div', { class: 'grid' }, filteredApps.map(appCard));
  root.append(
    h('div', { class: 'shell' }, [
      topbar(),
      h('main', { class: 'container' }, [
        h('section', { class: 'hero' }, [
          h('h1', { text: '软件花园' }),
          h('p', { text: '把自然语言生成的软件、数据结构、页面、动作和提示词一起运行和分发。创建新软件已收进右下角 AI 助理。' }),
          h('div', { class: 'hero-meta' }, [
            h('span', { text: '结构化生成' }),
            h('span', { text: '动态表单' }),
            h('span', { text: '导入导出' }),
            h('span', { text: 'AI 修改' })
          ])
        ]),
        h('div', { class: 'section-heading' }, [
          h('div', {}, [h('h2', { class: 'section-title', text: '我的软件' }), h('p', { class: 'muted', text: `${filteredApps.length} / ${state.apps.length} 个本地软件，可打开、导出或继续改造。` })]),
          h('div', { class: 'category-filter' }, categories.map((category) =>
            h('button', {
              class: `chip ${state.appCategory === category ? 'active' : ''}`,
              text: category,
              onclick: () => {
                state.appCategory = category;
                renderHome();
              }
            })
          ))
        ]),
        cards
      ])
    ])
  );
  if (state.assistantOpen) {
    renderAssistantDrawer(() => {
      state.assistantOpen = false;
      const btn = document.querySelector('.assistant-topbar-button');
      if (btn) btn.classList.remove('active');
    });
  }
}

function appCard(app) {
  const menu = bindFloatingMenu(h('details', { class: 'card-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { title: '更多操作' }, '⋮'),
      h('div', { class: 'card-menu-popover' }, [
      h('a', { href: `/api/apps/${app.id}/export`, download: `${app.slug}.sgpkg` }, '导出 .sgpkg'),
      h('button', {
        class: 'ghost-menu danger',
        text: '删除',
        onclick: async (event) => {
          event.stopPropagation();
          openConfirmDialog({
            title: '删除软件',
            message: `确定删除「${app.name}」吗？这个操作不会使用浏览器确认框。`,
            confirmText: '删除',
            danger: true,
            onConfirm: async () => {
              await api(`/api/apps/${app.id}`, { method: 'DELETE' });
              await loadApps();
              toast('软件已删除');
            }
          });
        }
      })
    ])
  ]));
  return h('article', { class: 'card app-card clickable-card', tabindex: '0', onclick: () => openApp(app.id), onkeydown: (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openApp(app.id);
    }
  } }, [
    h('div', { class: 'app-card-top' }, [
      h('span', { class: 'category-pill', text: appCategory(app) }),
      menu
    ]),
    h('div', {}, [h('h3', { text: app.name }), h('p', { class: 'muted', text: app.description || '无描述' })]),
    h('small', { class: 'muted', text: `更新于 ${new Date(app.updatedAt).toLocaleString()}` })
  ]);
}

function appCategories() {
  return ['全部', ...new Set(state.apps.map(appCategory))];
}

function appCategory(app) {
  if (app.manifest?.category) return app.manifest.category;
  const text = `${app.name || ''} ${(app.manifest?.tags || []).join(' ')} ${app.description || ''}`.toLowerCase();
  if (text.includes('crm') || text.includes('客户') || text.includes('线索')) return '客户';
  if (text.includes('finance') || text.includes('记账') || text.includes('预算') || text.includes('金额')) return '财务';
  if (text.includes('writing') || text.includes('文章') || text.includes('内容') || text.includes('脚本')) return '内容';
  if (text.includes('productivity') || text.includes('待办') || text.includes('任务') || text.includes('项目')) return '效率';
  if (text.includes('库存') || text.includes('资产') || text.includes('设备')) return '资产';
  return '通用';
}

async function openApp(appId, options = {}) {
  const body = await api(`/api/apps/${appId}`);
  state.currentApp = body.app;
  state.currentPageId = options.pageId && body.app.ui.pages.some((page) => page.id === options.pageId) ? options.pageId : body.app.ui.pages[0]?.id;
  state.currentViewId = options.viewId || '';
  await loadCurrentPageRecords();
  const page = body.app.ui.pages.find((item) => item.id === state.currentPageId) || body.app.ui.pages[0];
  if (page?.entity) {
    const entity = body.app.schema.entities.find((item) => item.id === page.entity) || body.app.schema.entities[0];
    const views = getViews(entity);
    state.currentViewId = views.some((view) => view.id === state.currentViewId) ? state.currentViewId : views[0]?.id || '';
  }
  writeRoute(body.app.id, state.currentPageId, Boolean(options.replace), state.currentViewId);
  if (state.assistantOpen) setAppContext(buildAssistantContext());
  renderRuntime();
}

async function loadRecords(entityId = '') {
  if (!state.currentApp) return;
  const path = entityId ? `/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}` : `/api/apps/${state.currentApp.id}/records`;
  const body = await api(path);
  state.records = body.records;
}

async function loadCurrentPageRecords() {
  const page = currentPage();
  const entity = pageEntityForRecordLoad(page);
  if (!entity) {
    await loadRecords();
    return;
  }
  await loadRecords(entity.id);
  const relationTargets = [...new Set(entity.fields
    .filter((field) => field.type === 'relation' && field.targetEntity && field.targetEntity !== entity.id)
    .map((field) => field.targetEntity))];
  for (const targetEntityId of relationTargets) {
    await mergeEntityRecords(targetEntityId);
  }
}

async function mergeEntityRecords(entityId) {
  const body = await api(`/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}`);
  const others = state.records.filter((record) => record.entityId !== entityId);
  state.records = [...others, ...body.records];
}

async function saveAppMetadata(name, category, description = state.currentApp.description || '') {
  const cleanName = String(name || '').trim();
  const cleanCategory = String(category || '').trim();
  const cleanDescription = String(description || '').trim();
  if (!cleanName) return toast('应用名称不能为空。');
  const body = await api(`/api/apps/${state.currentApp.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: cleanName, category: cleanCategory || '通用', description: cleanDescription })
  });
  state.currentApp = body.app;
  state.apps = state.apps.map((app) => (app.id === body.app.id ? body.app : app));
  renderRuntime();
  toast('应用信息已保存');
}

function packageFromCurrentApp() {
  const app = state.currentApp;
  return {
    manifest: { ...(app.manifest || {}), name: app.name, description: app.description || '', icon: app.icon || '' },
    schema: structuredClone(app.schema),
    ui: structuredClone(app.ui),
    actions: structuredClone(app.actions || { actions: [] }),
    prompts: structuredClone(app.prompts || {})
  };
}

async function saveCurrentPackage(mutator) {
  const pkg = packageFromCurrentApp();
  mutator(pkg);
  const body = await api(`/api/apps/${state.currentApp.id}/package`, { method: 'PUT', body: JSON.stringify({ package: pkg }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((app) => (app.id === body.app.id ? body.app : app));
  return body.app;
}

async function createAppFromPrompt(prompt) {
  try {
    const body = await api('/api/apps/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
    await openApp(body.appId);
    toast(`已创建 ${body.app?.name || '新软件'}`);
  } catch (error) {
    toast(error.message);
  }
}

function buildAssistantContext() {
  const app = state.currentApp;
  if (!app) return '';
  const page = app.ui.pages.find((p) => p.id === state.currentPageId) || app.ui.pages[0];
  const entity = page?.entity ? entityFor(page) : null;
  const parts = [`App ID: ${app.id}`, `App Name: ${app.name}`];
  if (page) parts.push(`Page: ${page.title} (${page.id})`);
  if (entity) {
    parts.push(`Entity: ${entity.name} (${entity.id})`);
    const fields = entity.fields.map((f) => `${f.label||f.id} (${f.type})`).join(', ');
    parts.push(`Fields: ${fields}`);
  }
  return parts.join(' | ');
}

function renderRuntime() {
  // 保存表格滚动位置
  const tableWrap = document.querySelector('.table-wrap');
  const savedScrollTop = tableWrap?.scrollTop || 0;
  const savedScrollLeft = tableWrap?.scrollLeft || 0;
  
  const app = state.currentApp;
  const page = app.ui.pages.find((item) => item.id === state.currentPageId) || app.ui.pages[0];
  state.currentPageId = page?.id || state.currentPageId;
  loadSidebarLayout();
  root.innerHTML = '';
  root.append(
    h('div', { class: 'shell' }, [
      topbar(),
      h('main', {
        class: `runtime ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`,
        style: `--sidebar-width:${state.sidebarWidth}px`
      }, [
        h('aside', { class: 'sidebar' }, renderSidebarContent(app, page)),
        h('div', {
          class: 'sidebar-resizer',
          title: state.sidebarCollapsed ? '展开页面列表' : '拖动调整页面列表宽度',
          onpointerdown: startSidebarResize,
          ondblclick: toggleSidebarCollapsed
        }),
        h('section', { class: 'workspace' }, [renderPage(page)])
      ])
    ])
  );

  if (state.assistantOpen) {
    renderAssistantDrawer(() => {
      state.assistantOpen = false;
      const btn = document.querySelector('.assistant-topbar-button');
      if (btn) btn.classList.remove('active');
    });
  } else {
    document.querySelector('.drawer-backdrop')?.remove();
    document.querySelector('.assistant.drawer')?.remove();
  }

  // 恢复表格滚动位置
  if (savedScrollTop > 0 || savedScrollLeft > 0) {
    setTimeout(() => {
      const newTableWrap = document.querySelector('.table-wrap');
      if (newTableWrap) {
        newTableWrap.scrollTop = savedScrollTop;
        newTableWrap.scrollLeft = savedScrollLeft;
      }
    }, 0);
  }

}

function renderSidebarContent(app, page) {
  const toggle = h('button', {
    class: 'sidebar-toggle ghost',
    title: state.sidebarCollapsed ? '展开页面列表' : '折叠页面列表',
    onclick: toggleSidebarCollapsed
  }, [
    h('span', { text: state.sidebarCollapsed ? '›' : '‹' }),
    state.sidebarCollapsed ? null : h('span', { text: '折叠' })
  ]);
  if (state.sidebarCollapsed) return [toggle];
  return [
    h('div', { class: 'sidebar-head' }, [
      h('div', { class: 'sidebar-label', text: '表格与页面' }),
      toggle
    ]),
    h('div', { class: 'page-list' }, app.ui.pages.map((item) => renderPageNavItem(app, page, item))),
    h('hr', { class: 'sidebar-divider' }),
    h('button', { class: 'page-button create-page-button', onclick: () => openCreatePageModal(page) }, [
      h('span', { class: 'button-icon page-icon' }, [pageTypeIcon('page')]),
      h('span', { text: '+ 新建页面' })
    ]),
    h('button', { class: 'page-button create-table-button', onclick: openCreateTableModal }, [
      h('span', { class: 'button-icon table-icon' }, [pageTypeIcon('table')]),
      h('span', { text: '+ 新建表' })
    ])
  ];
}

function toggleSidebarCollapsed() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  saveSidebarLayout();
  renderRuntime();
}

function startSidebarResize(event) {
  if (state.sidebarCollapsed) {
    toggleSidebarCollapsed();
    return;
  }
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = state.sidebarWidth;
  const controller = new AbortController();
  document.body.classList.add('resizing-sidebar');
  const update = (moveEvent) => {
    state.sidebarWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
    document.querySelector('.runtime')?.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  };
  const finish = () => {
    document.body.classList.remove('resizing-sidebar');
    saveSidebarLayout();
    controller.abort();
  };
  document.addEventListener('pointermove', update, { signal: controller.signal });
  document.addEventListener('pointerup', finish, { once: true, signal: controller.signal });
  document.addEventListener('pointercancel', finish, { once: true, signal: controller.signal });
}

function clearPageDragStyles() {
  document.querySelectorAll('.page-nav-item').forEach((item) => {
    item.classList.remove('is-dragging', 'drop-before', 'drop-after');
    delete item.dataset.dropPosition;
  });
}

function renderPageNavItem(app, activePage, item) {
  const entity = item.entity ? app.schema.entities.find((candidate) => candidate.id === item.entity) : null;
  const navKind = pageNavKind(app, item);
  const menu = bindFloatingMenu(h('details', { class: 'page-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { title: '页面操作' }, '⋮'),
    h('div', { class: 'page-menu-popover' }, [
      navKind === 'page' ? h('button', {
        class: 'ghost-menu',
        text: '删除页面',
        onclick: (event) => {
          event.preventDefault();
          menu.open = false;
          deletePage(item);
        }
      }) : null,
      navKind === 'table' && entity ? h('button', {
        class: 'ghost-menu',
        text: '清除数据',
        onclick: (event) => {
          event.preventDefault();
          menu.open = false;
          clearTableData(entity);
        }
      }) : null,
      navKind === 'table' && entity ? h('button', {
        class: 'ghost-menu danger',
        text: '删除表',
        onclick: (event) => {
          event.preventDefault();
          menu.open = false;
          deleteTableAndData(entity);
        }
      }) : null
    ])
  ]));
  const row = h('div', {
    class: `page-nav-item ${item.id === activePage?.id ? 'active' : ''}`,
    draggable: 'true',
    ondragstart: (event) => {
      state.pageDragId = item.id;
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
    },
    ondragover: (event) => {
      if (!state.pageDragId || state.pageDragId === item.id) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      const position = event.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
      row.dataset.dropPosition = position;
      row.classList.toggle('drop-before', position === 'before');
      row.classList.toggle('drop-after', position === 'after');
      event.dataTransfer.dropEffect = 'move';
    },
    ondragleave: () => {
      row.classList.remove('drop-before', 'drop-after');
      delete row.dataset.dropPosition;
    },
    ondrop: async (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain') || state.pageDragId;
      const position = row.dataset.dropPosition || 'before';
      clearPageDragStyles();
      state.pageDragId = '';
      await reorderPage(draggedId, item.id, position);
    },
    ondragend: () => {
      state.pageDragId = '';
      clearPageDragStyles();
    }
  }, [
    h('span', { class: `page-type-icon ${navKind}`, title: `${pageTypeLabel(item, navKind)} · 拖动排序` }, [pageTypeIcon(navKind)]),
    h('button', {
      class: `menu-item ${item.id === activePage?.id ? 'active' : ''}`,
      text: item.title,
      onclick: async () => {
        state.currentPageId = item.id;
        await loadCurrentPageRecords();
        const nextEntity = entityFor(item);
        const views = getViews(nextEntity);
        state.currentViewId = views[0]?.id || '';
        writeRoute(app.id, item.id, false, state.currentViewId);
        if (state.assistantOpen) setAppContext(buildAssistantContext());
        renderRuntime();
      }
    }),
    menu
  ]);
  return row;
}

function pageNavKind(app, page) {
  if (page?.navKind === 'table' || page?.source === 'table') return 'table';
  if (page?.navKind === 'page' || page?.source === 'page') return 'page';
  if (page?.type === 'list' && page.entity) {
    const entity = app.schema.entities.find((item) => item.id === page.entity);
    const firstEntityListPage = app.ui.pages.find((item) => item.type === 'list' && item.entity === page.entity);
    if (firstEntityListPage?.id === page.id) return 'table';
    if (page.id === `${page.entity}-list` || page.title === `${entity?.name || ''}列表`) return 'table';
  }
  return 'page';
}

function pageTypeIcon(navKind) {
  if (navKind === 'table') {
    return svgIcon('0 0 18 18', [
      svgLine(4, 5, 14, 5),
      svgLine(4, 9, 14, 9),
      svgLine(4, 13, 14, 13)
    ], 'page-type-svg');
  }
  return svgIcon('0 0 18 18', [
    svgPath('M7.25 6.1 6.1 7.25a3 3 0 0 0 4.24 4.24l1.15-1.15'),
    svgPath('M10.75 11.9 11.9 10.75a3 3 0 0 0-4.24-4.24L6.5 7.66'),
    svgLine(7.4, 10.6, 10.6, 7.4)
  ], 'page-type-svg');
}

function uiIcon(name) {
  const icons = {
    assistant: [svgPath('M12 3.5l1.15 3.35L16.5 8l-3.35 1.15L12 12.5l-1.15-3.35L7.5 8l3.35-1.15L12 3.5Z'), svgPath('M6.5 11.5 7.2 13.3 9 14l-1.8.7-.7 1.8-.7-1.8L4 14l1.8-.7.7-1.8Z')],
    settings: [svgPath('M8.5 3.5h3l.45 1.65 1.45.6 1.5-.85 1.5 2.6-1.2 1.1v1.8l1.2 1.1-1.5 2.6-1.5-.85-1.45.6-.45 1.65h-3l-.45-1.65-1.45-.6-1.5.85-1.5-2.6 1.2-1.1V8.6L3.6 7.5l1.5-2.6 1.5.85 1.45-.6.45-1.65Z'), svgPath('M8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z')],
    add: [svgLine(10, 4, 10, 16), svgLine(4, 10, 16, 10)],
    upload: [svgPath('M10 14V4'), svgPath('M6.5 7.5 10 4l3.5 3.5'), svgPath('M4 15.5h12')],
    download: [svgPath('M10 4v10'), svgPath('M6.5 10.5 10 14l3.5-3.5'), svgPath('M4 15.5h12')],
    trash: [svgPath('M4.5 6h11'), svgPath('M8 6V4.5h4V6'), svgPath('M6 6l.6 9.5h6.8L14 6')],
    filter: [svgPath('M4 5h12l-4.8 5.5V15l-2.4 1v-5.5L4 5Z')],
    sort: [svgPath('M7 4v12'), svgPath('M4.5 6.5 7 4l2.5 2.5'), svgPath('M13 16V4'), svgPath('M10.5 13.5 13 16l2.5-2.5')],
    group: [svgPath('M5 5h10v3H5z'), svgPath('M5 12h10v3H5z'), svgLine(7, 8, 7, 12), svgLine(13, 8, 13, 12)],
    fields: [svgPath('M4.5 5h11v10h-11z'), svgLine(8, 5, 8, 15), svgLine(12, 5, 12, 15)],
    form: [svgPath('M5 4.5h10v11H5z'), svgLine(7, 8, 13, 8), svgLine(7, 11, 11, 11)],
    view: [svgPath('M4.5 5.5h11v9h-11z'), svgLine(4.5, 8.5, 15.5, 8.5), svgLine(8, 8.5, 8, 14.5)],
    close: [svgLine(5.5, 5.5, 14.5, 14.5), svgLine(14.5, 5.5, 5.5, 14.5)]
  };
  return svgIcon('0 0 20 20', icons[name] || icons.view, 'ui-icon');
}

function buttonLabel(iconName, label) {
  return [
    h('span', { class: 'button-label-icon' }, [uiIcon(iconName)]),
    h('span', { class: 'button-label-text', text: label })
  ];
}

function svgIcon(viewBox, children, className = 'page-type-svg') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add(className);
  for (const child of children) svg.append(child);
  return svg;
}

function svgLine(x1, y1, x2, y2) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  return line;
}

function svgPath(d) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  return path;
}

function pageTypeLabel(page, navKind = 'page') {
  if (navKind === 'table') return '数据表';
  const labels = {
    blank: '空白页面',
    list: '表格页面',
    chart: '统计图表',
    dashboard: '仪表盘页面',
    editor: '编辑页面',
    form: '表单页面',
    detail: '详情页面'
  };
  return labels[page?.type] || '页面';
}

async function reorderPage(draggedId, targetId, position = 'before') {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const pages = state.currentApp.ui.pages || [];
  const fromIndex = pages.findIndex((page) => page.id === draggedId);
  const toIndex = pages.findIndex((page) => page.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return;

  try {
    await saveCurrentPackage((pkg) => {
      const nextPages = [...pkg.ui.pages];
      const [moved] = nextPages.splice(fromIndex, 1);
      let insertIndex = nextPages.findIndex((page) => page.id === targetId);
      if (position === 'after') insertIndex += 1;
      nextPages.splice(insertIndex, 0, moved);
      pkg.ui.pages = nextPages;
    });
    writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
    renderRuntime();
    toast('页面顺序已更新');
  } catch (error) {
    toast(error.message);
  }
}

function deletePage(page) {
  const pages = state.currentApp.ui.pages || [];
  if (pages.length <= 1) return toast('至少保留一个页面。');
  const remainingPages = pages.filter((item) => item.id !== page.id);
  if (!remainingPages.some((item) => item.type === 'list')) return toast('至少保留一个列表页面。');
  if (page.type === 'list' && page.entity && !remainingPages.some((item) => item.type === 'list' && item.entity === page.entity)) {
    const entity = state.currentApp.schema.entities.find((item) => item.id === page.entity);
    return toast(`「${entity?.name || page.title}」表只有这一个列表入口，不能单独删除页面。`);
  }
  openConfirmDialog({
    title: '删除页面',
    message: `确定删除「${page.title}」页面吗？只会移除这个页面入口，不会删除表和数据。`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        const index = pages.findIndex((item) => item.id === page.id);
        const nextPage = pages[index + 1] || pages[index - 1] || pages.find((item) => item.id !== page.id);
        await saveCurrentPackage((pkg) => {
          pkg.ui.pages = pkg.ui.pages.filter((item) => item.id !== page.id);
        });
        if (state.currentPageId === page.id) {
          state.currentPageId = nextPage?.id || state.currentApp.ui.pages[0]?.id || '';
          state.currentViewId = '';
        }
        await loadCurrentPageRecords();
        writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
        renderRuntime();
        toast('页面已删除');
      } catch (error) {
        toast(error.message);
      }
    }
  });
}

function deleteTableAndData(entity) {
  const pages = state.currentApp.ui.pages || [];
  const relatedPages = pages.filter((page) => page.entity === entity.id);
  openConfirmDialog({
    title: '删除表',
    message: `确定删除「${entity.name}」表、${relatedPages.length} 个页面入口和这张表里的所有记录吗？如果这些记录被其他表实际引用，会自动阻止删除。`,
    confirmText: '删除表',
    danger: true,
    onConfirm: async () => {
      try {
        const body = await api(`/api/apps/${state.currentApp.id}/tables/${entity.id}`, { method: 'DELETE' });
        state.currentApp = body.app;
        state.apps = state.apps.map((app) => (app.id === body.app.id ? body.app : app));
        if (!state.currentApp.ui.pages.some((page) => page.id === state.currentPageId)) {
          state.currentPageId = state.currentApp.ui.pages[0]?.id || '';
          state.currentViewId = '';
        }
        await loadCurrentPageRecords();
        writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
        renderRuntime();
        toast('表已删除');
      } catch (error) {
        showDeleteTableBlocked(error, entity);
      }
    }
  });
}

function clearTableData(entity) {
  const count = recordsFor(entity.id).length;
  openConfirmDialog({
    title: '清除数据',
    message: `确定清除「${entity.name}」表里的 ${count} 条记录吗？表结构和页面会保留。如果这些记录被其他表实际引用，会自动阻止清除。`,
    confirmText: '清除数据',
    danger: true,
    onConfirm: async () => {
      try {
        const body = await api(`/api/apps/${state.currentApp.id}/tables/${entity.id}/records`, { method: 'DELETE' });
        await loadCurrentPageRecords();
        renderRuntime();
        toast(`已清除 ${body.deletedCount || 0} 条数据`);
      } catch (error) {
        showDeleteTableBlocked(error, entity, '不能清除数据', `请先清理这些关联记录，再清除「${entity.name}」表的数据。`);
      }
    }
  });
}

function showDeleteTableBlocked(error, entity, title = '不能删除表', footer = `请先清理这些关联记录，再删除「${entity.name}」表。`) {
  const references = error.details?.references || [];
  if (!references.length) return toast(error.message);
  const detail = references.map((reference) =>
    `「${reference.sourceEntityName}.${reference.fieldLabel}」已有 ${reference.count} 条记录引用「${entity.name}」的数据`
  ).join('\n');
  openTextModal(title, `${error.message}\n\n${detail}\n\n${footer}`);
}

function openCreatePageModal(sourcePage = null) {
  const nameInput = h('input', { placeholder: '例如：经营看板' });
  const hint = h('p', { class: 'muted field-hint', text: '新页面默认不关联表，也不显示任何内容。创建后可打开 AI Builder 描述你想要的表格、统计图、透视图等卡片。' });

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新建页面' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      hint,
      h('div', { class: 'field' }, [h('label', { text: '页面名称' }), nameInput]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '创建',
          onclick: async () => {
            const title = nameInput.value.trim() || '空白页面';
            const page = buildBlankPage(title);
            try {
              await saveCurrentPackage((pkg) => {
                pkg.ui.pages.push(page);
              });
              state.currentPageId = page.id;
              state.currentViewId = '';
              await loadCurrentPageRecords();
              writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
              backdrop.remove();
              renderRuntime();
              toast('页面已创建');
            } catch (error) {
              toast(error.message);
            }
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function buildBlankPage(title) {
  return {
    id: uniquePageId(title, 'page'),
    title,
    type: 'blank',
    navKind: 'page',
    cards: []
  };
}

function buildPageForEntity({ entity, title, type = 'list', navKind = 'page' }) {
  const page = {
    id: uniquePageId(title, entity.id),
    title,
    type,
    entity: entity.id,
    navKind
  };
  if (type === 'list') {
    page.features = ['create', 'edit', 'delete', 'search', 'export'];
  }
  if (type === 'chart') {
    const groupField = entity.fields.find((field) => ['select', 'multiSelect', 'boolean', 'date'].includes(field.type)) || entity.fields[0];
    page.chart = { type: 'bar', groupBy: groupField?.id || 'name', value: 'count' };
  }
  if (type === 'dashboard') {
    page.cards = [{ type: 'stat', title: `${entity.name}记录数`, entity: entity.id, operation: 'count' }];
  }
  return page;
}

function openCreateTableModal() {
  const nameInput = h('input', { placeholder: '例如：分类表' });
  const descriptionInput = h('textarea', { placeholder: '表格说明，可选' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新建表' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '表名' }), nameInput]),
      h('div', { class: 'field' }, [h('label', { text: '说明' }), descriptionInput]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '创建',
          onclick: async () => {
            const name = nameInput.value.trim();
            if (!name) return toast('表名不能为空。');
            const body = await api(`/api/apps/${state.currentApp.id}/tables`, {
              method: 'POST',
              body: JSON.stringify({ name, description: descriptionInput.value.trim() })
            });
            state.currentApp = body.app;
            state.currentPageId = body.app.ui.pages.at(-1)?.id || state.currentPageId;
            await loadCurrentPageRecords();
            backdrop.remove();
            renderRuntime();
            toast('表已创建');
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function renderPage(page) {
  if (!page) return h('div', { class: 'panel', text: '这个软件还没有页面。' });
  if (page.type === 'blank') return renderBlankPage(page);
  if (page.type === 'chart') return renderChartPage(page);
  if (page.type === 'dashboard') return renderDashboardPage(page);
  if (page.type === 'editor') return renderEditorPage(page);
  return renderListPage(page);
}

function entityFor(page) {
  return state.currentApp.schema.entities.find((entity) => entity.id === page.entity) || state.currentApp.schema.entities[0];
}

function currentPage() {
  return state.currentApp?.ui.pages.find((item) => item.id === state.currentPageId) || state.currentApp?.ui.pages[0] || null;
}

function pageEntityForRecordLoad(page) {
  if (!page || !state.currentApp) return null;
  if (page.entity) return entityFor(page);
  if (['list', 'chart', 'editor', 'form', 'detail'].includes(page.type)) return entityFor(page);
  return null;
}

function recordsFor(entityId) {
  return state.records.filter((record) => !entityId || record.entityId === entityId);
}

function renderBlankPage(page) {
  const cards = Array.isArray(page.cards) ? page.cards : [];
  if (!cards.length) return h('div', { class: 'blank-page-canvas', 'data-page-id': page.id });
  return h('div', { class: 'blank-page-canvas page-card-canvas', 'data-page-id': page.id }, cards.map((card, index) =>
    renderPageCard(page, card, index)
  ));
}

function renderPageCard(page, card, index) {
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

function renderPageCardBody(card) {
  if (card.type === 'table') return renderPageTableCard(card);
  if (card.type === 'chart') return renderPageChartCard(card);
  if (card.type === 'pivot') return renderPagePivotCard(card);
  return renderPageStatCard(card);
}

function renderPageStatCard(card) {
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

function renderPageTableCard(card) {
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

function renderPageChartCard(card) {
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

function renderPagePivotCard(card) {
  const entity = entityById(card.entity);
  const field = entity?.fields?.find((item) => item.id === card.groupBy) || entity?.fields?.[0];
  const rows = groupedCardRows(card, field);
  return h('table', { class: 'page-mini-table' }, [
    h('thead', {}, [h('tr', {}, [h('th', { text: field?.label || '分组' }), h('th', { text: '数量' })])]),
    h('tbody', {}, rows.slice(0, 8).map((row) => h('tr', {}, [h('td', { text: row.label }), h('td', { text: row.value })])))
  ]);
}

function groupedCardRows(card, field) {
  const grouped = new Map();
  for (const record of filteredCardRecords(card)) {
    const label = formatFieldValue(record.data?.[field?.id], field || {}) || '未填写';
    grouped.set(label, (grouped.get(label) || 0) + 1);
  }
  return [...grouped.entries()].map(([label, value]) => ({ label, value }));
}

function filteredCardRecords(card) {
  return recordsFor(card.entity).filter((record) => cardFiltersMatch(record, card.filters || []));
}

function cardFiltersMatch(record, filters) {
  return filters.every((filter) => {
    const value = record.data?.[filter.field];
    if (filter.op === 'notEmpty') return hasDisplayValue(value);
    if (filter.op === 'thisMonth') return dateKey(value).slice(0, 7) === dateKey(new Date()).slice(0, 7);
    if (filter.op === 'today') return dateKey(value) === dateKey(new Date());
    if (filter.op === 'eq') return String(value ?? '') === String(filter.value ?? '');
    return true;
  });
}

function cardFilterLabel(card) {
  const filters = card.filters || [];
  if (!filters.length) return '全部数据';
  if (filters.some((filter) => filter.op === 'thisMonth')) return '本月';
  if (filters.some((filter) => filter.op === 'today')) return '今日';
  return `${filters.length} 个筛选`;
}

function pageCardTitle(card) {
  if (card.type === 'table') return '数据表格';
  if (card.type === 'chart') return '统计图';
  if (card.type === 'pivot') return '透视图';
  return '统计卡片';
}

function entityById(entityId) {
  return state.currentApp.schema.entities.find((entity) => entity.id === entityId);
}

async function reorderPageCard(page, fromIndex, toIndex) {
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

function startPageCardResize(event, page, index) {
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

function orderedFields(entity) {
  const layout = getFormLayout(entity);
  const byId = new Map(entity.fields.map((field) => [field.id, field]));
  return layout.order.map((id) => byId.get(id)).filter(Boolean);
}

function defaultView(entity) {
  const legacy = readStorage(storageKey('list', entity.id), null);
  return normalizeView(entity, {
    id: 'default',
    name: '全部记录',
    visibleFields: legacy?.visibleFields,
    fieldOrder: legacy?.fieldOrder,
    searchFields: legacy?.searchFields,
    columnWidths: legacy?.columnWidths,
    sorts: legacy?.sort?.field ? [{ field: legacy.sort.field, direction: legacy.sort.direction || 'asc' }] : [],
    filters: [],
    group: null
  });
}

function getViews(entity) {
  const stored = readStorage(storageKey('views', entity.id), null);
  const views = Array.isArray(stored) && stored.length ? stored : [defaultView(entity)];
  const normalized = views.map((view) => normalizeView(entity, view)).filter(Boolean);
  return normalized.length ? normalized : [defaultView(entity)];
}

function setViews(entity, views) {
  writeStorage(storageKey('views', entity.id), views.map((view) => normalizeView(entity, view)));
}

function getCurrentView(entity) {
  const views = getViews(entity);
  const current = views.find((view) => view.id === state.currentViewId) || views[0];
  state.currentViewId = current.id;
  return current;
}

function updateCurrentView(entity, updater) {
  const views = getViews(entity);
  const currentIndex = Math.max(0, views.findIndex((view) => view.id === state.currentViewId));
  const current = views[currentIndex] || views[0] || defaultView(entity);
  views[currentIndex] = normalizeView(entity, typeof updater === 'function' ? updater({ ...current }) : { ...current, ...updater });
  setViews(entity, views);
  state.currentViewId = views[currentIndex].id;
  return views[currentIndex];
}

function normalizeView(entity, view = {}) {
  const fieldIds = entity.fields.map((field) => field.id);
  const fieldSet = new Set(fieldIds);
  const fallback = {
    visibleFields: entity.fields.map((field) => field.id),
    fieldOrder: entity.fields.map((field) => field.id),
    searchFields: [],
    columnWidths: {},
    actionWidth: 112,
    allFields: entity.fields.map((field) => field.id),
    filters: [],
    sorts: [],
    group: null
  };
  const next = { ...fallback, ...view };
  next.id = next.id || makeViewId();
  next.name = String(next.name || '未命名视图').trim() || '未命名视图';
  next.visibleFields = (next.visibleFields || []).filter((id) => fieldSet.has(id));
  for (const field of entity.fields) {
    if (!next.visibleFields.includes(field.id)) {
      next.visibleFields.push(field.id);
    }
  }
  if (next.visibleFields.length === 0) next.visibleFields = fallback.visibleFields;
  next.fieldOrder = (next.fieldOrder || []).filter((id) => fieldSet.has(id));
  for (const id of fieldIds) {
    if (!next.fieldOrder.includes(id)) next.fieldOrder.push(id);
  }
  next.searchFields = (next.searchFields || []).filter((id) => fieldSet.has(id));
  next.columnWidths ||= {};
  for (const id of Object.keys(next.columnWidths)) {
    if (!fieldSet.has(id)) delete next.columnWidths[id];
  }
  next.actionWidth = Math.max(84, Number(next.actionWidth || 112));
  next.filters = (next.filters || []).filter((filter) => fieldSet.has(filter.field));
  next.sorts = (next.sorts || []).filter((sort) => fieldSet.has(sort.field));
  if (next.group && !fieldSet.has(next.group.field)) next.group = null;
  next.group = next.group ? { field: next.group.field, mode: next.group.mode || 'value', collapsed: next.group.collapsed || [] } : null;
  next.allFields = fieldIds;
  return next;
}

function makeViewId() {
  return `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getListConfig(entity) {
  return getCurrentView(entity);
}

function setListConfig(entity, config) {
  updateCurrentView(entity, config);
}

function getFormLayout(entity) {
  const fallback = { columns: 2, order: entity.fields.map((field) => field.id) };
  const stored = readStorage(storageKey('form-layout', entity.id), null);
  const layout = stored || fallback;
  const fieldIds = new Set(entity.fields.map((field) => field.id));
  layout.columns = [2, 3, 4].includes(Number(layout.columns)) ? Number(layout.columns) : 2;
  layout.order = (layout.order || []).filter((id) => fieldIds.has(id));
  if (!stored) for (const field of entity.fields) {
    if (!layout.order.includes(field.id)) layout.order.push(field.id);
  }
  return layout;
}

function setFormLayout(entity, layout) {
  writeStorage(storageKey('form-layout', entity.id), layout);
}

function getFormDesign(entity) {
  return getFormDesignFromPatch(entity, readStorage(storageKey('form-design', entity.id), null));
}

function setFormDesign(entity, design) {
  writeStorage(storageKey('form-design', entity.id), getFormDesignFromPatch(entity, design));
}

function getFormDesignFromPatch(entity, design = {}) {
  const fieldSet = new Set(entity.fields.map((field) => field.id));
  return {
    descriptions: Object.fromEntries(Object.entries(design?.descriptions || {}).filter(([id]) => fieldSet.has(id))),
    requiredFields: (design?.requiredFields || []).filter((id) => fieldSet.has(id)),
    defaults: Object.fromEntries(Object.entries(design?.defaults || {}).filter(([id]) => fieldSet.has(id)))
  };
}

function sortRecords(records, config) {
  const sorts = config.sorts?.length ? config.sorts : config.sort?.field ? [config.sort] : [];
  const ordered = [...records];
  const basePositions = new Map(ordered.map((record, index) => [record.id, index]));
  if (!sorts.length) return ordered;
  return ordered.sort((a, b) => {
    for (const sort of sorts) {
      const direction = sort.direction === 'desc' ? -1 : 1;
      const result = compareValues(a.data[sort.field], b.data[sort.field]);
      if (result !== 0) return result * direction;
    }
    return compareRecordPosition(a, b, basePositions);
  });
}

function compareRecordPosition(a, b, basePositions) {
  return (basePositions.get(a.id) ?? 0) - (basePositions.get(b.id) ?? 0);
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true });
}

function viewOrderedFields(entity, view) {
  const byId = new Map(entity.fields.map((field) => [field.id, field]));
  const ordered = (view.fieldOrder || []).map((id) => byId.get(id)).filter(Boolean);
  for (const field of orderedFields(entity)) {
    if (!ordered.some((item) => item.id === field.id)) ordered.push(field);
  }
  return ordered;
}

function applyViewFilters(records, entity, view) {
  const filters = view.filters || [];
  if (!filters.length) return records;
  const fields = new Map(entity.fields.map((field) => [field.id, field]));
  return records.filter((record) => filters.every((filter) => {
    const field = fields.get(filter.field);
    if (!field) return true;
    return matchesViewFilter(record.data[field.id], field, filter);
  }));
}

function matchesViewFilter(value, field, filter) {
  const op = filter.op || 'contains';
  if (op === 'empty') return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (op === 'notEmpty') return !matchesViewFilter(value, field, { op: 'empty' });
  const expected = filter.value;
  if (field.type === 'number') {
    const actual = Number(value);
    const target = Number(expected);
    if (Number.isNaN(actual) || Number.isNaN(target)) return false;
    if (op === 'gt') return actual > target;
    if (op === 'lt') return actual < target;
    return actual === target;
  }
  if (field.type === 'date' || field.type === 'datetime') {
    const actual = dateKey(value);
    const target = dateKey(expected);
    if (!actual) return false;
    if (op === 'today') return actual === dateKey(new Date());
    if (op === 'thisWeek') return sameWeek(actual, new Date());
    if (op === 'thisMonth') return actual.slice(0, 7) === dateKey(new Date()).slice(0, 7);
    if (!target) return false;
    if (op === 'before') return actual < target;
    if (op === 'after') return actual > target;
    return actual === target;
  }
  if (field.type === 'boolean') {
    const actual = value === true || value === '是' || value === 'true';
    const target = expected === true || expected === '是' || expected === 'true';
    return actual === target;
  }
  const actualText = formatFieldValue(value, field).toLowerCase();
  const targetText = String(expected ?? '').toLowerCase();
  if ((op === 'contains' || op === 'notContains') && !targetText) return true;
  if (op === 'notContains') return !actualText.includes(targetText);
  if (op === 'neq') return actualText !== targetText;
  if (op === 'eq') return actualText === targetText;
  return actualText.includes(targetText);
}

function dateKey(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function sameWeek(actualKey, now) {
  const actual = new Date(actualKey);
  const current = new Date(dateKey(now));
  const day = current.getDay() || 7;
  const start = new Date(current);
  start.setDate(current.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return actual >= start && actual <= end;
}

function groupRecords(records, entity, group) {
  const field = entity.fields.find((item) => item.id === group.field);
  const grouped = new Map();
  for (const record of records) {
    const key = groupKeyForRecord(record, field, group);
    if (!grouped.has(key.key)) grouped.set(key.key, { ...key, records: [] });
    grouped.get(key.key).records.push(record);
  }
  return [...grouped.values()];
}

function groupKeyForRecord(record, field, group) {
  const value = record.data[field?.id];
  if (!field) return { key: 'ungrouped', label: '未分组' };
  if (field.type === 'date' || field.type === 'datetime') {
    const key = dateKey(value);
    if (!key) return { key: 'empty', label: '未填写' };
    if (group.mode === 'month') return { key: key.slice(0, 7), label: key.slice(0, 7) };
    if (group.mode === 'week') {
      const date = new Date(key);
      const weekStart = new Date(date);
      const day = weekStart.getDay() || 7;
      weekStart.setDate(weekStart.getDate() - day + 1);
      const start = dateKey(weekStart);
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 6);
      return { key: `week:${start}`, label: `${start} 至 ${dateKey(endDate)}` };
    }
    return { key, label: key };
  }
  const label = formatFieldValue(value, field) || '未填写';
  return { key: String(label), label: String(label) };
}

function renderListPage(page) {
  const entity = entityFor(page);
  const records = recordsFor(entity.id);
  const listConfig = getListConfig(entity);
  const visibleFields = viewOrderedFields(entity, listConfig).filter((field) => listConfig.visibleFields.includes(field.id));
  const globalSearch = h('input', { placeholder: '搜索全部记录' });
  const searchInputs = new Map();
  const tableBody = h('tbody');
  const selectionKey = storageKey('selection', entity.id);
  const selectedIds = new Set(readStorage(selectionKey, []));
  const syncSelection = () => writeStorage(selectionKey, [...selectedIds]);
  const validRecordIds = new Set(records.map((record) => record.id));
  let cleanedSelection = false;
  for (const recordId of [...selectedIds]) {
    if (!validRecordIds.has(recordId)) {
      selectedIds.delete(recordId);
      cleanedSelection = true;
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
  const drawRows = (items) => {
    tableBody.innerHTML = '';
    currentRenderedIds = [];
    const filteredItems = applyViewFilters(items, entity, listConfig);
    const sortedItems = sortRecords(filteredItems, listConfig);
    if (sortedItems.length === 0) {
      tableBody.append(h('tr', {}, [h('td', { colspan: visibleFields.length + 3, class: 'muted', text: '暂无记录' })]));
      tableBody.append(renderQuickAddRow(entity, visibleFields));
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
          ...visibleFields.map((field) => h('td', { class: summaryCellClass(field) }, [renderNumericSummary(group.records, field, '小计')])),
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
      tableBody.append(renderSummaryRow(sortedItems, visibleFields, listConfig, '合计'));
      tableBody.append(renderQuickAddRow(entity, visibleFields));
      updateSelectionState();
      return;
    }
    for (const [index, record] of sortedItems.entries()) {
      currentRenderedIds.push(record.id);
      tableBody.append(renderRecordRow(entity, visibleFields, record, listConfig, index + 1, selectedIds, syncSelection, updateSelectionState, index));
    }
    tableBody.append(renderSummaryRow(sortedItems, visibleFields, listConfig, '合计'));
    tableBody.append(renderQuickAddRow(entity, visibleFields));
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
  const table = h('table', { style: tableWidthStyle(visibleFields, listConfig) }, [
    renderTableColgroup(visibleFields, listConfig),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { class: 'select-cell' }, [
          selectAllInput
        ]),
        h('th', { class: 'index-cell', text: '序号' }),
        ...visibleFields.map((field, index) =>
          renderResizableHeader(entity, field, visibleFields[index + 1], listConfig)
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
    ])
  ]);
}

function renderTableColgroup(visibleFields, listConfig) {
  return h('colgroup', {}, [
    h('col', { style: 'width:42px; min-width:42px' }),
    h('col', { style: 'width:64px; min-width:64px' }),
    ...visibleFields.map((field) => h('col', { style: columnWidthStyle(listConfig, field), 'data-field-id': field.id })),
    h('col', { style: actionColumnStyle(listConfig), 'data-action-col': 'true' })
  ]);
}

function renderExportMenu(entity, exportSelectedLink) {
  return bindFloatingMenu(h('details', { class: 'export-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { class: 'secondary icon-label-button', title: '导出数据' }, buttonLabel('download', '导出')),
    h('div', { class: 'export-menu-popover' }, [
      h('a', { class: 'ghost-menu', href: exportXlsxHref(entity), download: exportFileName('all') }, '导出全部'),
      exportSelectedLink
    ])
  ]));
}

function renderQuickAddRow(entity, visibleFields) {
  return h('tr', { class: 'quick-add-row' }, [
    h('td', { colspan: visibleFields.length + 3 }, [
      h('button', { class: 'ghost quick-add-row-button icon-label-button', onclick: () => quickAddRecord(entity) }, buttonLabel('add', '快速新增行'))
    ])
  ]);
}

function exportXlsxHref(entity, selectedIds = null) {
  const params = new URLSearchParams({ entity: entity.id });
  if (selectedIds?.size) params.set('ids', [...selectedIds].join(','));
  return `/api/apps/${state.currentApp.id}/export.xlsx?${params.toString()}`;
}

function exportFileName(scope = 'all') {
  const slug = state.currentApp.slug || state.currentApp.id;
  return scope === 'selected' ? `${slug}-selected.xlsx` : `${slug}.xlsx`;
}

function importTableData(entity) {
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

function tableWidthStyle(visibleFields, listConfig) {
  const width = 42 + 64 + actionColumnWidth(listConfig) + visibleFields.reduce((sum, field) => sum + Number(listConfig.columnWidths?.[field.id] || 160), 0);
  return `width:${width}px; min-width:${width}px`;
}

function stretchTableToWrap(table, visibleFields, listConfig) {
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

function renderViewBar(entity, currentView) {
  const views = getViews(entity);
  return h('div', { class: 'view-bar' }, [
    h('div', { class: 'view-tabs' }, views.map((view) =>
      h('div', {
        class: `view-tab ${view.id === currentView.id ? 'active' : ''}`,
        ondblclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.currentViewId = view.id;
          startViewNameEdit(event.currentTarget, entity, view);
        },
        onclick: () => {
          state.currentViewId = view.id;
          writeRoute(state.currentApp.id, state.currentPageId, false, view.id);
          renderRuntime();
        }
      }, [
        h('span', { class: 'view-tab-name', text: view.name }),
        view.id === currentView.id ? renderViewMenu(entity) : null
      ])
    )),
    h('div', { class: 'row' }, [
      h('button', { class: 'secondary icon-label-button', onclick: () => createView(entity) }, buttonLabel('add', '新建视图'))
    ])
  ]);
}

function renderViewMenu(entity) {
  return h('button', {
    class: 'view-menu-trigger',
    title: '视图操作',
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openViewMenu(event.currentTarget, entity);
    }
  }, '⋮');
}

function openViewMenu(trigger, entity) {
  closeFloatingMenus();
  document.querySelector('.view-menu-popover')?.remove();
  const menu = h('div', { class: 'view-menu-popover floating-view-menu' }, [
    h('button', { class: 'ghost-menu', text: '复制', onclick: () => { closeViewMenu(); cloneView(entity); } }),
    h('button', { class: 'ghost-menu', text: '重命名', onclick: () => { closeViewMenu(); renameView(entity); } }),
    h('button', { class: 'ghost-menu', text: '清除视图设置', onclick: () => { closeViewMenu(); clearCurrentViewConfig(entity); } }),
    h('button', { class: 'ghost-menu danger-text', text: '删除', onclick: () => { closeViewMenu(); deleteView(entity); } })
  ]);
  document.body.append(menu);
  positionViewMenu(trigger, menu);
  setTimeout(() => document.addEventListener('click', closeViewMenu, { once: true }), 0);
}

function positionViewMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(menu.offsetWidth, 128);
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right + 6));
  const top = Math.min(window.innerHeight - menu.offsetHeight - 8, Math.max(8, rect.top));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeViewMenu() {
  document.querySelector('.view-menu-popover')?.remove();
}

function startViewNameEdit(button, entity, view) {
  const input = h('input', { class: 'view-name-input', value: view.name });
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) {
      state.currentViewId = view.id;
      updateCurrentView(entity, { name });
    }
    renderRuntime();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') finish(false);
  });
}

function createView(entity, name = '新视图', patch = {}) {
  const views = getViews(entity);
  const view = normalizeView(entity, { ...defaultView(entity), ...patch, id: makeViewId(), name });
  views.push(view);
  setViews(entity, views);
  state.currentViewId = view.id;
  writeRoute(state.currentApp.id, state.currentPageId, false, view.id);
  renderRuntime();
}

function cloneView(entity) {
  const current = getCurrentView(entity);
  createView(entity, `${current.name} 副本`, { ...current, id: makeViewId(), name: `${current.name} 副本` });
}

function renameView(entity) {
  const current = getCurrentView(entity);
  const tab = document.querySelector('.view-tab.active');
  if (tab) startViewNameEdit(tab, entity, current);
}

function deleteView(entity) {
  const views = getViews(entity);
  if (views.length <= 1) return toast('至少保留一个视图。');
  const current = getCurrentView(entity);
  openConfirmDialog({
    title: '删除视图',
    message: `确定删除视图「${current.name}」吗？`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      const nextViews = views.filter((view) => view.id !== current.id);
      setViews(entity, nextViews);
      state.currentViewId = nextViews[0]?.id || '';
      writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
      renderRuntime();
      toast('视图已删除');
    }
  });
}

function openFilterModal(entity) {
  let filters = [...(getCurrentView(entity).filters || [])];
  const body = h('div', { class: 'config-list' });
  const controls = new Map();
  const renderRows = () => {
    body.innerHTML = '';
    controls.clear();
    if (!filters.length) body.append(h('p', { class: 'muted', text: '暂无筛选条件。' }));
    filters.forEach((filter, index) => {
      const field = entity.fields.find((item) => item.id === filter.field) || entity.fields[0];
      filter.field = field.id;
      const fieldSelect = selectFromOptions(entity.fields.map((item) => [item.id, item.label]), filter.field);
      const opSelect = selectFromOptions(filterOperators(field).map((item) => [item.op, item.label]), filter.op || filterOperators(field)[0].op);
      const valueInput = filterValueInput(field, filter);
      fieldSelect.addEventListener('change', () => {
        filters[index] = { field: fieldSelect.value, op: filterOperators(entity.fields.find((item) => item.id === fieldSelect.value) || entity.fields[0])[0].op, value: '' };
        renderRows();
      });
      opSelect.addEventListener('change', () => {
        filters[index].op = opSelect.value;
        renderRows();
      });
      valueInput?.addEventListener('input', () => (filters[index].value = valueFromFilterInput(valueInput, field)));
      valueInput?.addEventListener('change', () => (filters[index].value = valueFromFilterInput(valueInput, field)));
      controls.set(index, { fieldSelect, opSelect, valueInput });
      body.append(h('div', { class: 'config-row' }, [
        fieldSelect,
        opSelect,
        valueInput || h('span', { class: 'muted', text: '无需填写值' }),
        h('button', { class: 'secondary', text: '删除', onclick: () => { filters.splice(index, 1); renderRows(); } })
      ]));
    });
  };
  const collectFilters = () => filters.map((filter, index) => {
    const control = controls.get(index);
    if (!control) return filter;
    const field = entity.fields.find((item) => item.id === control.fieldSelect.value) || entity.fields[0];
    return {
      field: field.id,
      op: control.opSelect.value,
      value: control.valueInput ? valueFromFilterInput(control.valueInput, field) : ''
    };
  });
  renderRows();
  openConfigModal('筛选条件', body, [
    h('button', { class: 'secondary', text: '添加条件', onclick: () => { filters.push({ field: entity.fields[0].id, op: filterOperators(entity.fields[0])[0].op, value: '' }); renderRows(); } }),
    h('button', { text: '保存', onclick: () => { updateCurrentView(entity, { filters: collectFilters() }); closeTopModal(); renderRuntime(); } })
  ]);
}

function openSortModal(entity) {
  let sorts = [...(getCurrentView(entity).sorts || [])];
  const body = h('div', { class: 'config-list' });
  const renderRows = () => {
    body.innerHTML = '';
    if (!sorts.length) body.append(h('p', { class: 'muted', text: '暂无排序规则。' }));
    sorts.forEach((sort, index) => {
      const fieldSelect = selectFromOptions(entity.fields.map((item) => [item.id, item.label]), sort.field || entity.fields[0].id);
      const directionSelect = selectFromOptions([['asc', '升序'], ['desc', '降序']], sort.direction || 'asc');
      fieldSelect.addEventListener('change', () => (sorts[index].field = fieldSelect.value));
      directionSelect.addEventListener('change', () => (sorts[index].direction = directionSelect.value));
      body.append(h('div', { class: 'config-row' }, [
        fieldSelect,
        directionSelect,
        h('button', { class: 'secondary', text: '删除', onclick: () => { sorts.splice(index, 1); renderRows(); } })
      ]));
    });
  };
  renderRows();
  openConfigModal('排序规则', body, [
    h('button', { class: 'secondary', text: '添加排序', onclick: () => { sorts.push({ field: entity.fields[0].id, direction: 'asc' }); renderRows(); } }),
    h('button', { text: '保存', onclick: () => { updateCurrentView(entity, { sorts }); closeTopModal(); renderRuntime(); } })
  ]);
}

function openGroupModal(entity) {
  const current = getCurrentView(entity).group || {};
  const groupableFields = entity.fields.filter((field) => ['select', 'boolean', 'date', 'datetime'].includes(field.type));
  const fieldSelect = selectFromOptions([['', '不分组'], ...groupableFields.map((field) => [field.id, field.label])], current.field || '');
  const modeSelect = selectFromOptions([['value', '按值'], ['day', '按天'], ['week', '按周'], ['month', '按月']], current.mode || 'value');
  const body = h('div', { class: 'config-list' }, [
    h('div', { class: 'field' }, [h('label', { text: '分组字段' }), fieldSelect]),
    h('div', { class: 'field' }, [h('label', { text: '日期分组方式' }), modeSelect]),
    h('p', { class: 'muted', text: '单选和布尔字段按值分组；日期字段可按天、周、月分组。' })
  ]);
  openConfigModal('分组设置', body, [
    h('button', { text: '保存', onclick: () => {
      const group = fieldSelect.value ? { field: fieldSelect.value, mode: modeSelect.value, collapsed: current.collapsed || [] } : null;
      updateCurrentView(entity, { group });
      closeTopModal();
      renderRuntime();
    } })
  ]);
}

function openConfigModal(title, content, actions) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: title }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      content,
      h('div', { class: 'row', style: 'margin-top:14px' }, actions)
    ])
  ]);
  document.body.append(backdrop);
}

function closeTopModal() {
  document.querySelector('.modal-backdrop')?.remove();
}

function selectFromOptions(options, value) {
  const select = h('select');
  for (const [optionValue, label] of options) select.append(h('option', { value: optionValue, text: label }));
  select.value = value;
  return select;
}

function filterOperators(field) {
  if (field.type === 'number') return [
    { op: 'eq', label: '等于' },
    { op: 'gt', label: '大于' },
    { op: 'lt', label: '小于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (field.type === 'date' || field.type === 'datetime') return [
    { op: 'eq', label: '等于' },
    { op: 'before', label: '早于' },
    { op: 'after', label: '晚于' },
    { op: 'today', label: '今天' },
    { op: 'thisWeek', label: '本周' },
    { op: 'thisMonth', label: '本月' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (field.type === 'select') return [
    { op: 'eq', label: '等于' },
    { op: 'neq', label: '不等于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (field.type === 'boolean') return [
    { op: 'eq', label: '等于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  return [
    { op: 'contains', label: '包含' },
    { op: 'notContains', label: '不包含' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
}

function filterValueInput(field, filter) {
  if (['empty', 'notEmpty', 'today', 'thisWeek', 'thisMonth'].includes(filter.op)) return null;
  if (field.type === 'select') {
    const select = selectFromOptions([['', '请选择'], ...(field.options || []).map((option) => [optionObject(option).label, optionObject(option).label])], filter.value || '');
    return select;
  }
  if (field.type === 'boolean') return selectFromOptions([['true', '是'], ['false', '否']], String(filter.value ?? 'true'));
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return h('input', { type, value: filter.value || '' });
}

function valueFromFilterInput(input, field) {
  if (field.type === 'boolean') return input.value === 'true';
  if (field.type === 'number') return input.value === '' ? '' : Number(input.value);
  return input.value;
}

function renderResizableHeader(entity, field, nextField, listConfig) {
  const width = Number(listConfig.columnWidths?.[field.id] || 160);
  const sortIndex = (listConfig.sorts || []).findIndex((sort) => sort.field === field.id);
  const sort = sortIndex >= 0 ? listConfig.sorts[sortIndex] : null;
  const label = `${field.label}${sort ? `${sort.direction === 'desc' ? ' ↓' : ' ↑'}${listConfig.sorts.length > 1 ? sortIndex + 1 : ''}` : ''}`;
  const children = [h('span', { text: label }), h('span', { class: 'resize-edge', title: '拖动表头边框调整列宽' })];
  const header = h(
    'th',
    {
      class: 'resizable-column',
      style: `width:${width}px; min-width:${width}px`,
      onclick: (event) => {
        if (event.target?.classList?.contains('resize-edge')) return;
        selectColumnHeader(header);
      },
      ondblclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        startHeaderLabelEdit(header, entity, field);
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        openHeaderContextMenu(event, entity, field, listConfig);
      }
    },
    children
  );
  const handle = header.querySelector('.resize-edge');
  if (!handle) return header;
  handle.addEventListener('click', (event) => event.stopPropagation());
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    startColumnResize(event, entity, field, nextField, listConfig, header);
  });
  return header;
}

function startHeaderLabelEdit(header, entity, field) {
  const span = header.querySelector('span');
  if (!span) return;
  const currentLabel = span.textContent || field.label;
  header.classList.add('header-editing');
  const input = h('input', { class: 'header-edit-input', value: field.label });
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const label = input.value.trim();
    if (save && label && label !== field.label) await updateField(entity.id, field.id, { label });
    else {
      header.classList.remove('header-editing');
      input.replaceWith(h('span', { text: currentLabel }));
    }
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') finish(false);
  });
}

function openHeaderContextMenu(event, entity, field, listConfig) {
  closeContextMenu();
  const menu = h('div', { class: 'context-menu', style: `left:${event.clientX}px; top:${event.clientY}px` }, [
    h('button', { class: 'ghost-menu', text: '编辑字段', onclick: () => { openFieldEditModal(entity, field); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '隐藏字段', onclick: () => { hideFieldInView(entity, field.id); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '复制字段', onclick: () => { duplicateField(entity, field); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '升序', onclick: () => { setFieldSort(entity, field.id, 'asc', listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '降序', onclick: () => { setFieldSort(entity, field.id, 'desc', listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '分组', onclick: () => { setListConfig(entity, { ...listConfig, group: { field: field.id, mode: 'value', collapsed: [] } }); closeContextMenu(); renderRuntime(); } }),
    h('button', { class: 'ghost-menu', text: '筛选', onclick: () => { ensureFilterForField(entity, field.id, listConfig); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向左插入列', onclick: () => { insertField(entity, field, 'left'); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向右插入列', onclick: () => { insertField(entity, field, 'right'); closeContextMenu(); } }),
    h('div', { class: 'context-menu-sep' }),
    h('button', { class: 'danger ghost-menu', text: '删除字段', onclick: () => { deleteField(entity, field); closeContextMenu(); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function closeContextMenu() {
  document.querySelector('.context-menu')?.remove();
}

function openCellContextMenu(event, entity, record) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();
  const menu = h('div', { class: 'context-menu', style: `left:${event.clientX}px; top:${event.clientY}px` }, [
    h('button', { class: 'ghost-menu', text: '向上插入行', onclick: () => { insertRowAround(entity, record, 'above'); closeContextMenu(); } }),
    h('button', { class: 'ghost-menu', text: '向下插入行', onclick: () => { insertRowAround(entity, record, 'below'); closeContextMenu(); } }),
    h('div', { class: 'context-menu-sep' }),
    h('button', { class: 'danger ghost-menu', text: '删除行', onclick: () => { closeContextMenu(); removeRecord(record.id, entity.id); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

async function insertRowAround(entity, referenceRecord, position) {
  try {
    const data = {};
    for (const field of entity.fields) data[field.id] = defaultValueForField(field);
    const refTime = new Date(referenceRecord.createdAt).getTime();
    const offset = position === 'above' ? -1 : 1;
    const _createdAt = new Date(refTime + offset).toISOString();
    await api(`/api/apps/${state.currentApp.id}/records`, {
      method: 'POST',
      body: JSON.stringify({ entityId: entity.id, data, _createdAt })
    });
    await loadCurrentPageRecords();
    renderRuntime();
    toast(`已新增 1 行`);
  } catch (error) {
    toast(`新增行失败：${error.message}`);
  }
}

function clearActiveTableSelection() {
  document.querySelectorAll('th.selected-column-header').forEach((item) => item.classList.remove('selected-column-header'));
  document.querySelectorAll('.editable-cell.selected-cell').forEach(clearCellSelectionClasses);
  state.cellSelection = null;
  hideCellCopyToolbar();
}

function clickedOutsideTableSelection(target) {
  if (target?.closest?.('.context-menu, .cell-choice-dropdown, .cell-copy-toolbar')) return false;
  return !target?.closest?.('table');
}

function selectColumnHeader(header) {
  clearActiveTableSelection();
  header.classList.add('selected-column-header');
}

function startCellRangeSelection(event, cell) {
  if (event.button !== 0 || cell.classList.contains('cell-editing')) return;
  const activeEditorInput = document.querySelector('.editable-cell.cell-editing input, .editable-cell.cell-editing textarea');
  if (activeEditorInput && !cell.contains(activeEditorInput)) activeEditorInput.blur();
  event.preventDefault();
  closeContextMenu();
  document.querySelectorAll('.cell-choice-dropdown').forEach((m) => m.remove());
  clearActiveTableSelection();
  const position = cellPosition(cell);
  state.cellSelection = { active: true, table: cell.closest('table'), start: position, end: position };
  updateCellRangeSelection();
}

function extendCellRangeSelection(cell) {
  if (!state.cellSelection?.active || cell.closest('table') !== state.cellSelection.table) return;
  state.cellSelection.end = cellPosition(cell);
  updateCellRangeSelection();
}

function moveCellRangeSelection(event) {
  if (!state.cellSelection?.active) return;
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.editable-cell[data-row-index][data-col-index]');
  if (cell) extendCellRangeSelection(cell);
}

function finishCellRangeSelection() {
  if (!state.cellSelection?.active) return;
  state.cellSelection.active = false;
  updateCellRangeSelection();
}

function cellPosition(cell) {
  return {
    row: Number(cell.dataset.rowIndex || 0),
    col: Number(cell.dataset.colIndex || 0)
  };
}

function updateCellRangeSelection() {
  const selection = state.cellSelection;
  document.querySelectorAll('.editable-cell.selected-cell').forEach(clearCellSelectionClasses);
  if (!selection?.table) return;
  const minRow = Math.min(selection.start.row, selection.end.row);
  const maxRow = Math.max(selection.start.row, selection.end.row);
  const minCol = Math.min(selection.start.col, selection.end.col);
  const maxCol = Math.max(selection.start.col, selection.end.col);
  selection.table.querySelectorAll('.editable-cell[data-row-index][data-col-index]').forEach((cell) => {
    const { row, col } = cellPosition(cell);
    const selected = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
    if (!selected) return;
    cell.classList.add('selected-cell');
    cell.classList.toggle('selection-top', row === minRow);
    cell.classList.toggle('selection-bottom', row === maxRow);
    cell.classList.toggle('selection-left', col === minCol);
    cell.classList.toggle('selection-right', col === maxCol);
  });
}

function clearCellSelectionClasses(cell) {
  cell.classList.remove('selected-cell', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
}

function selectedCellMatrix() {
  const cells = selectedCellElements();
  if (!cells.length) return [];
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, cell.dataset.copyValue || cell.textContent.trim());
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

function selectedCellElements() {
  return [...document.querySelectorAll('.editable-cell.selected-cell[data-row-index][data-col-index]')]
    .sort((a, b) => {
      const first = cellPosition(a);
      const second = cellPosition(b);
      return first.row - second.row || first.col - second.col;
    });
}

function selectedCellPayload() {
  const cells = selectedCellElements();
  if (!cells.length) return null;
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    const field = fieldForCell(cell);
    const record = recordForCell(cell);
    rows.get(row).set(col, {
      fieldId: field?.id || cell.dataset.fieldId || '',
      fieldType: field?.type || cell.dataset.fieldType || '',
      value: structuredClone(record?.data?.[field?.id]),
      text: cell.dataset.copyValue || cell.textContent.trim()
    });
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

async function copySelectedCellsToClipboard(matrix = selectedCellMatrix(), options = {}) {
  if (!matrix.length) return false;
  state.cellClipboard = selectedCellPayload();
  const text = matrix.map((row) => row.join('\t')).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    if (!options.quiet) toast('已复制选区');
    if (isMultiCellMatrix(matrix)) showCellCopyToolbar();
    return true;
  } catch {
    const copied = fallbackCopyText(text);
    if (!options.quiet) toast(copied ? '已复制选区' : '浏览器暂不允许写入剪贴板。');
    if (copied && isMultiCellMatrix(matrix)) showCellCopyToolbar();
    return copied;
  }
}

function isMultiCellMatrix(matrix) {
  return matrix.length > 1 || matrix[0]?.length > 1;
}

async function pasteCellsFromClipboard(event) {
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], .cell-choice-dropdown')) return;
  const targetCells = selectedCellElements();
  if (!targetCells.length) return;
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || await navigator.clipboard.readText().catch(() => '');
  const source = clipboardPayloadFromText(text, state.cellClipboard);
  if (!source.length || !source[0]?.length) return;
  await pasteCellMatrix(source, targetCells);
}

function clipboardPayloadFromText(text, structuredPayload = null) {
  const textMatrix = parseClipboardText(text);
  if (!textMatrix.length) return [];
  if (payloadMatchesTextMatrix(structuredPayload, textMatrix)) return structuredPayload;
  return textMatrix.map((row) => row.map((value) => ({ text: value, value, fieldType: '' })));
}

function payloadMatchesTextMatrix(payload, textMatrix) {
  if (!payload || payload.length !== textMatrix.length || payload[0]?.length !== textMatrix[0]?.length) return false;
  return payload.every((row, rowIndex) => row.length === textMatrix[rowIndex].length
    && row.every((cell, colIndex) => String(cell.text ?? '') === String(textMatrix[rowIndex][colIndex] ?? '')));
}

function parseClipboardText(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
  if (!clean) return [];
  return clean.split('\n').map((row) => row.split('\t'));
}

async function pasteCellMatrix(source, targetCells) {
  const target = targetSelectionBounds(targetCells);
  const sourceRows = source.length;
  const sourceCols = Math.max(...source.map((row) => row.length));
  if (sourceRows > target.rows || sourceCols > target.cols) {
    return toast(`复制区域是 ${sourceRows} 行 ${sourceCols} 列，不能大于目标区域 ${target.rows} 行 ${target.cols} 列。`);
  }
  const fillAll = sourceRows === 1 && sourceCols === 1;
  const changesByRecord = new Map();
  const pasteRows = fillAll ? target.rows : sourceRows;
  const pasteCols = fillAll ? target.cols : sourceCols;

  for (let rowOffset = 0; rowOffset < pasteRows; rowOffset += 1) {
    for (let colOffset = 0; colOffset < pasteCols; colOffset += 1) {
      const targetCell = target.cellMap.get(`${target.minRow + rowOffset}:${target.minCol + colOffset}`);
      if (!targetCell) return toast('目标区域必须是连续的单元格区域。');
      const sourceCell = fillAll ? source[0][0] : source[rowOffset]?.[colOffset];
      const field = fieldForCell(targetCell);
      const record = recordForCell(targetCell);
      if (!field || !record) return toast('找不到目标单元格对应的数据。');
      const parsed = valueForPastedCell(sourceCell, field);
      if (!parsed.ok) return toast(parsed.message);
      const current = changesByRecord.get(record.id) || { record, data: { ...record.data } };
      current.data[field.id] = parsed.value;
      changesByRecord.set(record.id, current);
    }
  }

  for (const { record, data } of changesByRecord.values()) {
    if (fieldValuesEqual(record.data, data)) continue;
    await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
  }
  await loadCurrentPageRecords();
  renderRuntime();
  toast(`已粘贴 ${pasteRows * pasteCols} 个单元格`);
}

function targetSelectionBounds(cells) {
  const positions = cells.map((cell) => ({ ...cellPosition(cell), cell }));
  const rows = positions.map((item) => item.row);
  const cols = positions.map((item) => item.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  return {
    minRow,
    minCol,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    cellMap: new Map(positions.map((item) => [`${item.row}:${item.col}`, item.cell]))
  };
}

function fieldForCell(cell) {
  const page = currentPage();
  const entity = page ? (pageEntityForRecordLoad(page) || entityFor(page)) : state.currentApp?.schema.entities[0];
  return entity?.fields.find((field) => field.id === cell.dataset.fieldId);
}

function recordForCell(cell) {
  return state.records.find((record) => record.id === cell.dataset.recordId);
}

function valueForPastedCell(sourceCell, targetField) {
  const sourceType = sourceCell?.fieldType || '';
  const text = String(sourceCell?.text ?? sourceCell?.value ?? '');
  if (sourceType && !fieldTypesCompatible(sourceType, targetField.type)) {
    return { ok: false, message: `不能粘贴：复制字段类型「${fieldTypeLabel(sourceType)}」与目标字段「${targetField.label}」不兼容。` };
  }
  if (sourceType && sourceCell && sourceCell.value !== undefined && sourceCell.value !== null) {
    return normalizePastedValue(sourceCell.value, targetField);
  }
  return normalizePastedValue(text, targetField);
}

function fieldTypesCompatible(sourceType, targetType) {
  if (sourceType === targetType) return true;
  const textLike = new Set(['text', 'textarea', 'richText']);
  if (textLike.has(sourceType) && textLike.has(targetType)) return true;
  if (sourceType === 'select' && targetType === 'multiSelect') return true;
  if (sourceType === 'date' && targetType === 'datetime') return true;
  return false;
}

function normalizePastedValue(value, field) {
  if (value === null || value === undefined) return { ok: true, value: defaultValueForField(field) };
  if (field.type === 'number') {
    const normalized = String(value).replace(/[¥,%\s]/g, '');
    if (normalized === '') return { ok: true, value: null };
    const number = Number(normalized);
    return Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false, message: `「${field.label}」需要数字，无法粘贴「${value}」。` };
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value };
    const normalized = String(value).trim().toLowerCase();
    if (['true', '是', '对', '1', 'yes', 'y'].includes(normalized)) return { ok: true, value: true };
    if (['false', '否', '错', '0', 'no', 'n', ''].includes(normalized)) return { ok: true, value: false };
    return { ok: false, message: `「${field.label}」需要是/否值，无法粘贴「${value}」。` };
  }
  if (field.type === 'select') return pastedSelectValue(value, field);
  if (field.type === 'multiSelect') return pastedMultiSelectValue(value, field);
  if (field.type === 'date') return pastedDateValue(value, field);
  if (field.type === 'datetime') return pastedDateTimeValue(value, field);
  if (field.type === 'relation') return pastedRelationValue(value, field);
  if (field.type === 'image' || field.type === 'file') {
    return typeof value === 'object'
      ? { ok: true, value }
      : { ok: false, message: `「${field.label}」是附件字段，不能从文本粘贴。` };
  }
  return { ok: true, value: String(value) };
}

function pastedSelectValue(value, field) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: true, value: '' };
  const option = (field.options || []).map(optionObject).find((item) => item.id === text || item.label === text);
  return option
    ? { ok: true, value: option.id }
    : { ok: false, message: `「${field.label}」没有选项「${text}」。` };
}

function pastedMultiSelectValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.map((item) => optionObject(item).id || item).filter(Boolean);
    const validIds = new Set((field.options || []).map((item) => optionObject(item).id));
    const invalid = values.find((item) => !validIds.has(item));
    return invalid ? { ok: false, message: `「${field.label}」没有选项「${invalid}」。` } : { ok: true, value: values };
  }
  const parts = String(value || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  const options = (field.options || []).map(optionObject);
  const values = [];
  for (const part of parts) {
    const option = options.find((item) => item.id === part || item.label === part);
    if (!option) return { ok: false, message: `「${field.label}」没有选项「${part}」。` };
    values.push(option.id);
  }
  return { ok: true, value: values };
}

function pastedDateValue(value, field) {
  const text = String(value || '').trim().replaceAll('/', '-');
  if (!text) return { ok: true, value: '' };
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return { ok: false, message: `「${field.label}」需要日期，无法粘贴「${value}」。` };
  return { ok: true, value: `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` };
}

function pastedDateTimeValue(value, field) {
  const text = String(value || '').trim().replaceAll('/', '-').replace(' ', 'T');
  if (!text) return { ok: true, value: '' };
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{1,2}))?/);
  if (!match) return { ok: false, message: `「${field.label}」需要日期时间，无法粘贴「${value}」。` };
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const time = match[4] ? `T${match[4].padStart(2, '0')}:${match[5].padStart(2, '0')}` : '';
  return { ok: true, value: `${date}${time}` };
}

function pastedRelationValue(value, field) {
  if (Array.isArray(value)) {
    const values = value.map((item) => item.targetRecordId || item.recordId || item).filter(Boolean);
    return { ok: true, value: field.multiple ? values : values[0] || '' };
  }
  if (value && typeof value === 'object') {
    const id = value.targetRecordId || value.recordId || value.id;
    return { ok: true, value: field.multiple ? [id].filter(Boolean) : id || '' };
  }
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: field.multiple ? [] : '' };
  const targetEntity = state.currentApp.schema.entities.find((item) => item.id === field.targetEntity);
  const candidates = recordsFor(field.targetEntity);
  const record = candidates.find((item) => item.id === text || relationDisplayValue(field, targetEntity, item) === text);
  if (!record) return { ok: false, message: `「${field.label}」找不到关联记录「${text}」。` };
  return { ok: true, value: field.multiple ? [record.id] : record.id };
}

function fallbackCopyText(text) {
  const input = h('textarea', { class: 'clipboard-fallback', readonly: 'readonly' }, text);
  document.body.append(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  input.remove();
  return copied;
}

function hideCellCopyToolbar() {
  document.querySelector('.cell-copy-toolbar')?.remove();
}

function showCellCopyToolbar() {
  hideCellCopyToolbar();
  const cells = [...document.querySelectorAll('.editable-cell.selected-cell')];
  if (!cells.length) return;
  const bounds = cells.reduce((rect, cell) => {
    const next = cell.getBoundingClientRect();
    if (!rect) return { left: next.left, top: next.top, right: next.right, bottom: next.bottom };
    return {
      left: Math.min(rect.left, next.left),
      top: Math.min(rect.top, next.top),
      right: Math.max(rect.right, next.right),
      bottom: Math.max(rect.bottom, next.bottom)
    };
  }, null);
  const toolbar = h('div', {
    class: 'cell-copy-toolbar',
    style: `left:${Math.max(8, bounds.right - 112)}px; top:${bounds.bottom + 8}px`
  }, [
    h('button', { class: 'secondary', text: '复制成图片', onclick: copySelectedCellsAsImage })
  ]);
  document.body.append(toolbar);
}

async function copySelectedCellsAsImage() {
  const imageRows = selectedCellImageRows();
  if (!imageRows.length) {
    hideCellCopyToolbar();
    return toast('先选择要复制的单元格。');
  }
  try {
    const blob = await selectedCellsImageBlob(imageRows);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制为图片');
  } catch {
    toast('当前浏览器不支持复制图片到剪贴板。');
  } finally {
    hideCellCopyToolbar();
  }
}

function selectedCellImageRows() {
  const cells = selectedCellElements();
  if (!cells.length) return [];
  const rows = new Map();
  for (const cell of cells) {
    const { row, col } = cellPosition(cell);
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row).set(col, cellImageContent(cell));
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, cols]) => [...cols.entries()].sort(([a], [b]) => a - b).map(([, value]) => value));
}

function cellImageContent(cell) {
  const tags = [...cell.querySelectorAll('.select-tag, .relation-tag')].map((tag) => {
    const style = getComputedStyle(tag);
    return {
      text: tag.textContent.trim(),
      background: style.backgroundColor || '#f8fafc',
      color: style.color || '#253044',
      border: style.borderColor || '#cbd5e1'
    };
  }).filter((tag) => tag.text);
  return {
    text: cell.dataset.copyValue || cell.textContent.trim(),
    tags
  };
}

function selectedCellsImageBlob(rows) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const cellWidth = 150;
  const cellHeight = 34;
  const padding = 10;
  const pixelRatio = Math.max(3, window.devicePixelRatio || 1);
  const width = Math.max(1, rows[0].length) * cellWidth + padding * 2;
  const height = rows.length * cellHeight + padding * 2;
  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.scale(pixelRatio, pixelRatio);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#dbe2ea';
  context.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.textBaseline = 'middle';
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const x = padding + colIndex * cellWidth;
      const y = padding + rowIndex * cellHeight;
      context.strokeStyle = '#dbe2ea';
      context.strokeRect(x, y, cellWidth, cellHeight);
      drawCellImageContent(context, cell, x, y, cellWidth, cellHeight);
    });
  });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片生成失败')), 'image/png'));
}

function drawCellImageContent(context, cell, x, y, width, height) {
  if (!cell.tags.length) {
    context.fillStyle = '#253044';
    context.fillText(String(cell.text || '').slice(0, 24), x + 8, y + height / 2);
    return;
  }
  let cursorX = x + 8;
  let cursorY = y + 6;
  const maxX = x + width - 8;
  for (const tag of cell.tags) {
    const tagText = String(tag.text || '');
    if (!tagText) continue;
    const tagWidth = Math.min(maxX - cursorX, Math.ceil(context.measureText(tagText).width) + 16);
    if (tagWidth <= 14) break;
    context.fillStyle = tag.background;
    drawRoundedRect(context, cursorX, cursorY, tagWidth, 22, 4);
    context.fill();
    context.strokeStyle = tag.border;
    drawRoundedRect(context, cursorX, cursorY, tagWidth, 22, 4);
    context.stroke();
    context.fillStyle = tag.color;
    context.fillText(tagText, cursorX + 8, cursorY + 11);
    cursorX += tagWidth + 4;
  }
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const nextRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + nextRadius, y);
  context.lineTo(x + width - nextRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  context.lineTo(x + width, y + height - nextRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  context.lineTo(x + nextRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  context.lineTo(x, y + nextRadius);
  context.quadraticCurveTo(x, y, x + nextRadius, y);
  context.closePath();
}

function setFieldSort(entity, fieldId, direction, listConfig) {
  setListConfig(entity, { ...listConfig, sorts: [{ field: fieldId, direction }] });
  renderRuntime();
}

function hideFieldInView(entity, fieldId) {
  const config = getListConfig(entity);
  const visibleFields = config.visibleFields.filter((id) => id !== fieldId);
  if (!visibleFields.length) return toast('至少保留一个显示字段。');
  setListConfig(entity, { ...config, visibleFields });
  renderRuntime();
}

function ensureFilterForField(entity, fieldId, listConfig) {
  const field = entity.fields.find((item) => item.id === fieldId);
  if (!field) return;
  const filters = [...(listConfig.filters || []).filter((filter) => filter.field !== fieldId), { field: fieldId, op: filterOperators(field)[0].op, value: '' }];
  setListConfig(entity, { ...listConfig, filters });
  openFilterModal(entity);
}

function fieldTypes() {
  return [
    ['text', '文本'],
    ['textarea', '长文本'],
    ['number', '数字'],
    ['select', '单选'],
    ['multiSelect', '多选'],
    ['relation', '关联记录'],
    ['image', '图片'],
    ['file', '附件'],
    ['boolean', '复选框'],
    ['date', '日期'],
    ['datetime', '日期时间']
  ];
}

function openFieldEditModal(entity, field = null, options = {}) {
  const editing = Boolean(field);
  const draft = field ? structuredClone(field) : { id: uniqueFieldId(entity, 'new_field'), label: '新字段', type: 'text' };
  if (!draft.options && draft.values) draft.options = draft.values;
  const labelInput = h('input', { value: draft.label || '', placeholder: '请输入字段标题' });
  const typeSelect = selectFromOptions(fieldTypes(), draft.type || 'text');
  const advanced = h('div', { class: 'field-advanced field-popover-section' });
  const typeLabel = h('span', { class: 'field-type-current', text: fieldTypeLabel(typeSelect.value) });
  const renderAdvanced = () => {
    advanced.innerHTML = '';
    const type = typeSelect.value;
    typeLabel.textContent = fieldTypeLabel(type);
    if (type === 'select' || type === 'multiSelect') {
      advanced.append(renderOptionEditor(draft.options || []));
      return;
    }
    if (type === 'relation') {
      const targets = state.currentApp.schema.entities.filter((item) => item.id !== entity.id);
      const targetSelect = selectFromOptions(targets.map((item) => [item.id, item.name]), draft.targetEntity || targets[0]?.id || '');
      targetSelect.dataset.fieldEditor = 'targetEntity';
      const displaySelect = h('select', { 'data-field-editor': 'displayField' });
      const multiple = h('input', { type: 'checkbox', 'data-field-editor': 'multiple' });
      multiple.checked = Boolean(draft.multiple);
      const renderDisplayFields = () => {
        const target = state.currentApp.schema.entities.find((item) => item.id === targetSelect.value);
        displaySelect.innerHTML = '';
        for (const field of target?.fields || []) {
          if (field.type === 'relation') continue;
          displaySelect.append(h('option', { value: field.id, text: field.label || field.id }));
        }
        displaySelect.value = draft.displayField || displaySelect.options[0]?.value || '';
      };
      targetSelect.addEventListener('change', renderDisplayFields);
      renderDisplayFields();
      advanced.append(
        h('div', { class: 'field-popover-subtitle', text: '关联设置' }),
        h('div', { class: 'field-setting-list' }, [
          h('label', { class: 'field-setting-row' }, [h('span', { text: '关联表' }), targetSelect]),
          h('label', { class: 'field-setting-row' }, [h('span', { text: '展示字段' }), displaySelect])
        ]),
        h('label', { class: 'field-setting-check' }, [multiple, h('span', { text: '允许多选关联记录' })])
      );
      return;
    }
    if (type === 'number') {
      const format = selectFromOptions([['plain', '普通数字'], ['integer', '整数'], ['decimal2', '保留 2 位小数'], ['currency', '金额'], ['percent', '百分比']], draft.format || 'plain');
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field-setting-list' }, [
        h('label', { class: 'field-setting-row' }, [h('span', { text: '数字格式' }), format])
      ]));
      return;
    }
    if (type === 'date' || type === 'datetime') {
      const format = selectFromOptions(type === 'date'
        ? [['yyyy-mm-dd', '2026-06-12'], ['yyyy/mm/dd', '2026/06/12'], ['mm-dd', '06-12']]
        : [['yyyy-mm-dd hh:mm', '2026-06-12 09:00'], ['yyyy/mm/dd hh:mm', '2026/06/12 09:00']],
      draft.format || (type === 'date' ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm'));
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field-setting-list' }, [
        h('label', { class: 'field-setting-row' }, [h('span', { text: '日期格式' }), format])
      ]));
      return;
    }
    if (type === 'boolean') {
      advanced.append(h('p', { class: 'field-help', text: '是/否字段会在表格和表单中以开关值编辑。' }));
      return;
    }
    if (type === 'image') {
      advanced.append(h('p', { class: 'field-help', text: '图片字段支持上传本地图片，表格中显示小缩略图，点击可放大预览。' }));
      return;
    }
    if (type === 'file') {
      advanced.append(h('p', { class: 'field-help', text: '附件字段支持上传本地文件，表格中显示原始文件名，点击可打开。' }));
      return;
    }
    advanced.append(h('div', { class: 'field-setting-list' }, [
      h('label', { class: 'field-setting-row' }, [
        h('span', { text: '输入提示' }),
        h('input', { 'data-field-editor': 'placeholder', value: draft.placeholder || '', placeholder: '填写时展示的提示文字' })
      ])
    ]));
  };
  typeSelect.addEventListener('change', renderAdvanced);
  renderAdvanced();
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal field-settings-modal' }, [
      h('div', { class: 'field-settings-head' }, [
        h('h3', { text: editing ? '编辑字段' : '添加字段' }),
        h('button', { class: 'ghost icon-button', text: '×', title: '关闭字段设置', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field-popover-section' }, [
        h('label', { class: 'field-popover-label', text: '标题' }),
        labelInput
      ]),
      h('div', { class: 'field-popover-section' }, [
        h('label', { class: 'field-popover-label', text: '字段类型' }),
        h('label', { class: 'field-type-picker' }, [
          typeLabel,
          typeSelect,
          h('span', { class: 'field-type-arrow', text: '›' })
        ])
      ]),
      advanced,
      h('div', { class: 'field-settings-footer' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '确定',
          onclick: async () => {
            const label = labelInput.value.trim();
            if (!label) return toast('字段名称不能为空。');
            const patch = fieldPatchFromEditor(label, typeSelect.value, advanced);
            if (editing) await updateField(entity.id, field.id, patch);
            else await createField(entity, patch, options.nearField, options.side);
            backdrop.remove();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
  setTimeout(() => {
    labelInput.focus();
    labelInput.select();
  }, 0);
}

function fieldPatchFromEditor(label, type, advanced) {
  const patch = { label, type };
  const formatInput = advanced.querySelector('[data-field-editor="format"]');
  const placeholderInput = advanced.querySelector('[data-field-editor="placeholder"]');
  const targetEntityInput = advanced.querySelector('[data-field-editor="targetEntity"]');
  const displayFieldInput = advanced.querySelector('[data-field-editor="displayField"]');
  const multipleInput = advanced.querySelector('[data-field-editor="multiple"]');
  if (type === 'select' || type === 'multiSelect') patch.options = collectOptionEditorValues(advanced);
  if (formatInput) patch.format = formatInput.value;
  if (placeholderInput) patch.placeholder = placeholderInput.value.trim();
  if (type === 'relation') {
    patch.targetEntity = targetEntityInput?.value || '';
    patch.displayField = displayFieldInput?.value || '';
    patch.multiple = Boolean(multipleInput?.checked);
    patch.enableSearch = true;
    patch.allowCreateTargetRecord = false;
  }
  if (type !== 'select' && type !== 'multiSelect') patch.options = [];
  return patch;
}

function fieldTypeLabel(type) {
  return fieldTypes().find(([value]) => value === type)?.[1] || type || '文本';
}

function renderOptionEditor(options = []) {
  const list = h('div', { class: 'option-editor-list', 'data-field-editor': 'options-list' });
  const addRow = (option = {}) => {
    const normalized = optionObject(option);
    list.append(optionEditorRow(normalized));
  };
  const source = options.length ? options : ['选项 1', '选项 2'];
  source.forEach(addRow);
  const addButton = h('button', {
    class: 'option-add-button',
    type: 'button',
    text: '+ 添加选项',
    onclick: () => addRow({ label: `选项 ${list.children.length + 1}` })
  });
  return h('div', { class: 'option-editor' }, [
    h('div', { class: 'option-editor-head' }, [
      h('span', { text: '下拉选项内容' }),
      h('label', { class: 'option-reference' }, [h('input', { type: 'checkbox' }), h('span', { text: '引用选项' })])
    ]),
    h('div', { class: 'option-editor-toolbar' }, [
      addButton,
      h('button', { class: 'ghost option-ai-button', type: 'button', text: 'AI 生成选项', onclick: () => toast('AI 生成选项稍后开放。') })
    ]),
    list
  ]);
}

function optionEditorRow(option) {
  const initialColor = option.color || 'gray';
  let dragCounter = 0;
  const dragHandle = h('span', {
    class: 'option-drag',
    text: '⋮⋮',
    title: '拖动排序',
    draggable: 'true',
    ondragstart: (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
      row.classList.add('dragging');
      dragCounter = 0;
    },
    ondragend: () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.option-editor-row.drag-over').forEach(el => el.classList.remove('drag-over'));
    },
    ondragover: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('dragging')) {
        dragCounter++;
        row.classList.add('drag-over');
      }
    },
    ondragleave: () => {
      dragCounter--;
      if (dragCounter <= 0) {
        row.classList.remove('drag-over');
        dragCounter = 0;
      }
    },
    ondrop: (event) => {
      event.preventDefault();
      row.classList.remove('drag-over');
      const dragged = document.querySelector('.option-editor-row.dragging');
      if (dragged && dragged !== row) {
        const parent = row.parentNode;
        const rows = [...parent.querySelectorAll('.option-editor-row')];
        const fromIndex = rows.indexOf(dragged);
        const toIndex = rows.indexOf(row);
        if (fromIndex < toIndex) {
          parent.insertBefore(dragged, row.nextSibling);
        } else {
          parent.insertBefore(dragged, row);
        }
      }
    }
  });
  const row = h('div', { class: 'option-editor-row' }, [
    dragHandle,
    h('div', { class: 'option-color-picker' }, [
      h('button', {
        class: 'option-color-current ghost',
        type: 'button',
        'data-option-color': initialColor,
        onclick: () => toggleColorPicker(row)
      }, [
        h('span', { class: `option-color-dot select-${initialColor}` })
      ]),
      h('div', { class: 'option-color-dropdown hidden' }, 
        OPTION_COLORS.map(color => 
          h('button', {
            class: 'option-color-option ghost',
            type: 'button',
            onclick: () => selectOptionColor(row, color)
          }, [
            h('span', { class: `option-color-dot select-${color}` })
          ])
        )
      )
    ]),
    h('input', { class: 'option-label-input', value: option.label || '', placeholder: '选项名称', 'data-option-label': 'true' }),
    h('button', {
      class: 'ghost option-remove',
      type: 'button',
      text: '×',
      title: '删除选项',
      onclick: () => row.remove()
    })
  ]);
  return row;
}

function toggleColorPicker(row) {
  const dropdown = row.querySelector('.option-color-dropdown');
  document.querySelectorAll('.option-color-dropdown:not(.hidden)').forEach(el => el.classList.add('hidden'));
  dropdown.classList.toggle('hidden');
  const handleClickOutside = (event) => {
    if (!dropdown.contains(event.target) && !row.querySelector('.option-color-current').contains(event.target)) {
      dropdown.classList.add('hidden');
      document.removeEventListener('click', handleClickOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
}

function selectOptionColor(row, color) {
  const dropdown = row.querySelector('.option-color-dropdown');
  const dot = row.querySelector('.option-color-dot');
  const currentDot = row.querySelector('.option-color-current .option-color-dot');
  dot.className = `option-color-dot select-${color}`;
  currentDot.className = `option-color-dot select-${color}`;
  row.querySelector('.option-color-current').dataset.optionColor = color;
  dropdown.classList.add('hidden');
}

function collectOptionEditorValues(root) {
  return [...root.querySelectorAll('.option-editor-row')]
  .map((row) => ({
    label: row.querySelector('[data-option-label]')?.value.trim(),
    color: row.querySelector('[data-option-color]')?.dataset.optionColor || 'gray'
  }))
    .filter((option) => option.label)
    .map(optionObject);
}

function colorLabel(color) {
  const labels = {
    gray: '灰色',
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    lime: '青柠',
    green: '绿色',
    cyan: '青色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色'
  };
  return labels[color] || color;
}

function optionLines(options) {
  return (options || []).map((option) => {
    const item = optionObject(option);
    return `${item.label} | ${item.color}`;
  }).join('\n');
}

function parseOptionLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, color] = line.split('|').map((item) => item.trim());
      return optionObject({ label, color });
    });
}

async function updateField(entityId, fieldId, patch) {
  await saveCurrentPackage((pkg) => {
    const entity = pkg.schema.entities.find((item) => item.id === entityId);
    const field = entity?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    Object.assign(field, patch);
  });
  renderRuntime();
}

async function createField(entity, patch, nearField = null, side = 'right') {
  const id = uniqueFieldId(entity, patch.label.toLowerCase().replace(/[^\w]+/g, '_') || 'field');
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    const index = nearField ? target.fields.findIndex((item) => item.id === nearField.id) : target.fields.length - 1;
    target.fields.splice(Math.max(0, index + (side === 'right' ? 1 : 0)), 0, { id, ...patch });
  });
  addFieldToView(entity.id, id, nearField?.id || entity.fields.at(-1)?.id, side);
  renderRuntime();
}

async function duplicateField(entity, field) {
  const id = uniqueFieldId(entity, `${field.id}_copy`);
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    const index = target.fields.findIndex((item) => item.id === field.id);
    target.fields.splice(index + 1, 0, { ...field, id, label: `${field.label} 副本` });
  });
  addFieldToView(entity.id, id, field.id, 'right');
  toast('字段已复制');
  renderRuntime();
}

async function insertField(entity, nearField, side) {
  openFieldEditModal(entity, null, { nearField, side });
}

function deleteField(entity, field) {
  if ((entity.fields || []).length <= 1) return toast('至少保留一个字段。');
  openConfirmDialog({
    title: '删除字段',
    message: `确定删除字段「${field.label}」？字段中的数据将永久丢失。`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api(`/api/apps/${state.currentApp.id}/fields/${entity.id}/${field.id}`, { method: 'DELETE' });
        const config = getListConfig(entity);
        const visibleFields = (config.visibleFields || []).filter((id) => id !== field.id);
        setListConfig(entity, { ...config, visibleFields });
        toast('字段已删除');
        renderRuntime();
      } catch (error) {
        toast(error.message);
      }
    }
  });
}

function uniqueFieldId(entity, base) {
  const existing = new Set(entity.fields.map((field) => field.id));
  let clean = String(base || 'field').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
  let id = clean;
  let index = 2;
  while (existing.has(id)) {
    id = `${clean}_${index}`;
    index += 1;
  }
  return id;
}

function addFieldToView(entityId, fieldId, nearFieldId, side) {
  const entity = state.currentApp.schema.entities.find((item) => item.id === entityId);
  if (!entity) return;
  const views = getViews(entity).map((view) => {
    const visibleFields = view.visibleFields.includes(fieldId) ? view.visibleFields : [...view.visibleFields];
    const fieldOrder = view.fieldOrder.includes(fieldId) ? view.fieldOrder : [...view.fieldOrder];
    const nearIndex = fieldOrder.indexOf(nearFieldId);
    const insertAt = nearIndex >= 0 ? nearIndex + (side === 'right' ? 1 : 0) : fieldOrder.length;
    fieldOrder.splice(insertAt, 0, fieldId);
    visibleFields.splice(Math.min(insertAt, visibleFields.length), 0, fieldId);
    return normalizeView(entity, { ...view, visibleFields: [...new Set(visibleFields)], fieldOrder: [...new Set(fieldOrder)] });
  });
  setViews(entity, views);
}

function startColumnResize(event, entity, field, nextField, listConfig, header) {
  const startX = event.clientX;
  const nextHeader = header.nextElementSibling;
  const table = header.closest('table');
  const cols = [...(table?.querySelectorAll('col') || [])];
  const currentCol = cols[header.cellIndex];
  const nextCol = cols[header.cellIndex + 1];
  const startWidth = Math.round(header.getBoundingClientRect().width) || Number(listConfig.columnWidths?.[field.id] || 160);
  const resizingActionColumn = !nextField;
  const startNextWidth = Math.round(nextHeader?.getBoundingClientRect().width || 0) || (resizingActionColumn ? actionColumnWidth(listConfig) : Number(listConfig.columnWidths?.[nextField.id] || 160));
  const tableWidth = Math.round(table?.getBoundingClientRect().width || 0);
  if (table && tableWidth) {
    table.style.width = `${tableWidth}px`;
    table.style.minWidth = `${tableWidth}px`;
  }
  const minWidth = 96;
  const maxDelta = resizingActionColumn ? Infinity : startNextWidth - minWidth;
  const minDelta = minWidth - startWidth;
  document.body.classList.add('resizing-column');
  const applyWidths = (delta) => {
    const nextWidth = Math.round(startWidth + delta);
    const adjacentWidth = resizingActionColumn ? startNextWidth : Math.round(startNextWidth - delta);
    const leftStyle = `width:${nextWidth}px; min-width:${nextWidth}px`;
    const rightStyle = `width:${adjacentWidth}px; min-width:${adjacentWidth}px`;
    header.style.width = `${nextWidth}px`;
    header.style.minWidth = `${nextWidth}px`;
    if (currentCol) currentCol.setAttribute('style', leftStyle);
    if (nextHeader && !resizingActionColumn) {
      nextHeader.style.width = `${adjacentWidth}px`;
      nextHeader.style.minWidth = `${adjacentWidth}px`;
    }
    if (nextCol && !resizingActionColumn) nextCol.setAttribute('style', rightStyle);
    if (table && tableWidth && resizingActionColumn) {
      const nextTableWidth = Math.max(42 + 64 + actionColumnWidth(listConfig) + minWidth, tableWidth + (nextWidth - startWidth));
      table.style.width = `${nextTableWidth}px`;
      table.style.minWidth = `${nextTableWidth}px`;
    }
    return { nextWidth, adjacentWidth };
  };
  const onMove = (moveEvent) => {
    const delta = Math.max(minDelta, Math.min(maxDelta, moveEvent.clientX - startX));
    applyWidths(delta);
  };
  const onUp = (upEvent) => {
    const delta = Math.max(minDelta, Math.min(maxDelta, upEvent.clientX - startX));
    const widths = applyWidths(delta);
    listConfig.columnWidths = {
      ...(listConfig.columnWidths || {}),
      [field.id]: widths.nextWidth
    };
    if (!resizingActionColumn) listConfig.columnWidths[nextField.id] = widths.adjacentWidth;
    setListConfig(entity, listConfig);
    document.body.classList.remove('resizing-column');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    renderRuntime();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function renderRecordRow(entity, visibleFields, record, listConfig, rowNumber, selectedIds = new Set(), syncSelection = () => {}, updateSelectionLabel = () => {}, rowIndex = rowNumber - 1) {
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

function renderSummaryRow(records, visibleFields, listConfig, label = '合计') {
  return h('tr', { class: 'summary-row' }, [
    h('td', { class: 'select-cell summary-label-cell' }),
    h('td', { class: 'index-cell summary-label-cell', text: label }),
    ...visibleFields.map((field) => h('td', { class: summaryCellClass(field), style: columnWidthStyle(listConfig, field) }, [renderNumericSummary(records, field, label)])),
    h('td', { class: 'sticky-action-cell action-cell summary-action-cell', style: actionColumnStyle(listConfig) })
  ]);
}

function renderNumericSummary(records, field, label = '合计') {
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

function summaryCellClass(field) {
  return field.type === 'number' ? 'summary-cell numeric-summary-cell' : 'summary-cell';
}

function formatNumberSummary(value, field) {
  if (field.format === 'integer') return String(Math.round(value));
  if (field.format === 'currency') return value.toFixed(2);
  if (field.format === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (field.format === 'decimal2') return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function startCellEdit(cell, entity, record, field) {
  if (cell.classList.contains('cell-editing')) return;
    if (field.type === 'select' || field.type === 'multiSelect' || field.type === 'relation') {
    const widget = createChoiceWidget(field, record.data[field.id], async (newValue) => {
      if (fieldValuesEqual(record.data[field.id], newValue)) {
        renderRuntime();
        return;
      }
      const data = { ...record.data, [field.id]: newValue };
      try {
        await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
        await loadCurrentPageRecords();
        renderRuntime();
      } catch (error) {
        toast(error.message);
        renderRuntime();
      }
    });
    clearActiveTableSelection();
    cell.classList.add('selected-cell', 'cell-editing');
    cell.innerHTML = '';
    cell.append(widget);
    widget._choiceCloseCallback = () => renderRuntime();
    setTimeout(() => widget.click(), 0);
    return;
  }
  cell.classList.add('cell-editing');
  const input = inputForField(field, record.data[field.id]);
  cell.innerHTML = '';
  cell.append(input);
  input.focus();
  if (input.select) input.select();
  let saved = false;
  let composing = false;
  let blurDuringComposition = false;
  const save = async () => {
    if (composing) {
      blurDuringComposition = true;
      return;
    }
    if (saved) return;
    saved = true;
    const nextValue = await valueFromInput(input, field);
    if (fieldValuesEqual(record.data[field.id], nextValue)) {
      cell.classList.remove('cell-editing');
      cell.replaceChildren(renderFieldValue(record.data[field.id], field));
      return;
    }
    const data = { ...record.data, [field.id]: nextValue };
    cell.classList.add('saving-cell');
    try {
      await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
      await loadCurrentPageRecords();
      renderRuntime();
    } catch (error) {
      toast(error.message);
      renderRuntime();
    }
  };
  input.addEventListener('compositionstart', () => {
    composing = true;
    blurDuringComposition = false;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    if (blurDuringComposition && document.activeElement !== input) {
      blurDuringComposition = false;
      input.focus();
    }
  });
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'Enter' && field.type !== 'textarea' && field.type !== 'richText') input.blur();
    if (event.key === 'Escape') renderRuntime();
  });
  if (input.tagName === 'SELECT' || input.type === 'checkbox') input.addEventListener('change', save);
  if (input.type === 'file') {
    input.addEventListener('change', async () => {
      saved = false;
      await save();
    });
  }
}



function fieldValuesEqual(currentValue, nextValue) {
  if (currentValue === nextValue) return true;
  if ((currentValue === undefined || currentValue === '') && nextValue === null) return true;
  if (currentValue === null && nextValue === '') return true;
  return JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null);
}

function columnWidthStyle(listConfig, field) {
  const width = Number(listConfig.columnWidths?.[field.id] || 160);
  return `width:${width}px; min-width:${width}px`;
}

function actionColumnWidth(listConfig) {
  return Math.max(84, Number(listConfig.actionWidth || 112));
}

function actionColumnStyle(listConfig) {
  const width = actionColumnWidth(listConfig);
  return `width:${width}px; min-width:${width}px`;
}

function openListConfigModal(entity) {
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

function openFormLayoutModal(entity) {
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

function disablePreviewInput(input) {
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' || input.tagName === 'SELECT') {
    input.disabled = true;
  }
}

function sampleFieldValue(field) {
  if (field.type === 'number') return '123';
  if (field.type === 'date') return '2026-06-12';
  if (field.type === 'datetime') return '2026-06-12 09:00';
  if (field.type === 'boolean') return '是 / 否';
  if (field.type === 'select' || field.type === 'multiSelect') return optionObject(field.options?.[0] || '选项').label;
  if (field.type === 'relation') return '关联记录';
  if (field.type === 'textarea' || field.type === 'richText') return '这是一段多行文本示例内容，\n展示长文本在表单中的实际所占高度。\n第三行内容。';
  return '文本';
}

function renderDashboardPage(page) {
  const cards = page.cards || state.currentApp.ui.home?.cards || [];
  return h('div', { class: 'panel' }, [
    h('h3', { text: page.title || '仪表盘' }),
    h(
      'div',
      { class: 'stat-grid' },
      cards.map((card) => renderDashboardCard(card))
    )
  ]);
}

function renderDashboardCard(card) {
  if (card.type === 'quickAction') {
    return h('div', { class: 'card' }, [
      h('h3', { text: card.title }),
      h('button', {
        text: '打开表单',
        onclick: () => openRecordModal(state.currentApp.schema.entities.find((entity) => entity.id === card.entity) || state.currentApp.schema.entities[0])
      })
    ]);
  }
  const records = recordsFor(card.entity).filter((record) => matchesFilter(record.data, card.filter));
  const value = card.operation === 'sum' ? records.reduce((sum, record) => sum + Number(record.data[card.field] || 0), 0) : records.length;
  return h('div', { class: 'card' }, [h('p', { class: 'muted', text: card.title }), h('div', { class: 'stat-value', text: value })]);
}

function renderChartPage(page) {
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
    h(
      'div',
      { class: 'chart-row' },
      rows.map(([label, value]) =>
        h('div', { class: 'bar' }, [
          h('span', { text: label }),
          h('div', {}, [h('div', { class: 'bar-fill', style: `width:${Math.max(8, (value / max) * 100)}%` })]),
          h('strong', { text: value })
        ])
      )
    )
  ]);
}

function renderEditorPage(page) {
  const entity = entityFor(page);
  return h('div', { class: 'panel' }, [
    h('div', { class: 'toolbar' }, [
      h('div', {}, [h('h3', { text: page.title }), h('p', { class: 'muted', text: 'MVP 中富文本编辑器先用结构化表单替代。' })]),
      h('button', { text: '新建内容', onclick: () => openRecordModal(entity) })
    ]),
    renderListPage({ ...page, type: 'list' })
  ]);
}


function openRecordModal(entity, record = null) {
  const layout = getFormLayout(entity);
  const design = getFormDesign(entity);
  const form = h('form', { class: 'form-grid', style: `grid-template-columns: repeat(${layout.columns}, minmax(0, 1fr))` });
  const inputs = {};
  for (const field of orderedFields(entity)) {
    const value = record?.data?.[field.id] ?? (!record ? design.defaults[field.id] : undefined);
    const input = inputForField(field, value);
    inputs[field.id] = input;
    form.append(renderFormFieldBlock(field, input, design));
  }
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: record ? `编辑${entity.name}` : `新增${entity.name}` }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      form,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: async () => {
            const data = record ? { ...record.data } : {};
            for (const field of orderedFields(entity)) data[field.id] = await valueFromInput(inputs[field.id], field);
            const path = record ? `/api/apps/${state.currentApp.id}/records/${record.id}` : `/api/apps/${state.currentApp.id}/records`;
            const method = record ? 'PUT' : 'POST';
            await api(path, { method, body: JSON.stringify({ entityId: entity.id, data }) });
            backdrop.remove();
            await loadCurrentPageRecords();
            renderRuntime();
          }
        }),
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function renderFormFieldBlock(field, input, design = {}, options = {}) {
  const required = field.required || (design.requiredFields || []).includes(field.id);
  const label = h('label', { text: `${field.label}${required ? ' *' : ''}` });
  const labelNode = options.actions?.length
    ? h('div', { class: 'field-label-row' }, [label, ...options.actions])
    : label;
  const description = design.descriptions?.[field.id];
  return h('div', { class: `field ${options.className || ''}`.trim(), ...(options.attrs || {}) }, [
    labelNode,
    input,
    description ? h('small', { class: 'field-hint', text: description }) : null
  ]);
}

function createChoiceWidget(field, initialValue, onChange) {
  const multiple = field.type === 'multiSelect' || (field.type === 'relation' && field.multiple);
  let currentValue = initialValue;

  let choices;
  if (field.type === 'relation') {
    const target = state.currentApp.schema.entities.find((e) => e.id === field.targetEntity);
    choices = recordsFor(field.targetEntity)
      .map((record) => ({
        id: record.id,
        label: relationDisplayValue(field, target, record),
        color: 'gray'
      }))
      .filter((c) => c.label && c.label !== c.id);
  } else {
    choices = (field.options || []).map(optionObject);
  }

  const selectedIds = () => {
    const vals = multiple ? (Array.isArray(currentValue) ? currentValue : []) : [currentValue].filter(Boolean);
    return vals.map((v) => {
      if (field.type === 'relation') return v.targetRecordId || v.recordId || v;
      return optionObject(v).id;
    }).filter(Boolean);
  };

  const tags = h('div', { class: 'cell-choice-editor-tags' });
  const arrow = h('span', { class: 'cell-choice-editor-arrow', text: '⌄' });
  const editor = h('div', { class: 'cell-choice-editor' }, [tags, arrow]);

  const renderTags = () => {
    tags.innerHTML = '';
    const ids = selectedIds();
    for (const choice of choices) {
      if (!ids.includes(choice.id)) continue;
      tags.append(h('span', { class: `cell-choice-editor-pill select-${choice.color || 'gray'}` }, [
        h('span', { text: choice.label }),
        h('button', { class: 'cell-choice-pill-remove', text: '×', title: '移除',
          onclick: (e) => { e.stopPropagation(); toggleOption(choice.id); }
        })
      ]));
    }
  };

  let dropdown = null;
  let outsideController = null;

  const closeDropdown = () => {
    outsideController?.abort();
    outsideController = null;
    if (dropdown) { dropdown.remove(); dropdown = null; }
  };

  const toggleOption = (id) => {
    const ids = selectedIds();
    let newVal;
    if (ids.includes(id)) {
      if (multiple) {
        const arr = Array.isArray(currentValue) ? [...currentValue] : [];
        const valIdx = arr.findIndex((v) => {
          const vid = field.type === 'relation' ? (v.targetRecordId || v.recordId || v) : optionObject(v).id;
          return vid === id;
        });
        if (valIdx >= 0) arr.splice(valIdx, 1);
        newVal = arr;
      } else {
        newVal = '';
      }
    } else {
      if (multiple) {
        const arr = Array.isArray(currentValue) ? [...currentValue] : [];
        arr.push(id);
        newVal = arr;
      } else {
        newVal = id;
      }
    }
    currentValue = newVal;
    editor._choiceValue = newVal;
    renderTags();
    if (dropdown) {
      dropdown.querySelectorAll('[data-choice-option]').forEach((row) => {
        const isSelected = selectedIds().includes(row.dataset.choiceOption);
        row.dataset.choiceSelected = isSelected ? 'true' : 'false';
        row.classList.toggle('selected', isSelected);
      });
    }
    if (onChange) onChange(newVal);
  };

  const openDropdown = () => {
    closeDropdown();
    const list = h('div', { class: 'cell-choice-list' });
    const ids = selectedIds();
    for (const choice of choices) {
      const selected = ids.includes(choice.id);
      list.append(h('button', {
        class: `cell-choice-row ${selected ? 'selected' : ''}`,
        type: 'button',
        'data-choice-option': choice.id,
        'data-choice-selected': selected ? 'true' : 'false',
        onclick: (e) => { e.preventDefault(); toggleOption(choice.id); if (!multiple) closeDropdown(); }
      }, [
        h('span', { class: `cell-choice-pill select-${choice.color || 'gray'}`, text: choice.label })
      ]));
    }
    dropdown = h('div', { class: 'cell-choice-dropdown' }, [list]);
    document.body.append(dropdown);
    const rect = editor.getBoundingClientRect();
    const dw = Math.max(rect.width, 180);
    dropdown.style.left = `${Math.min(window.innerWidth - dw - 8, Math.max(8, rect.left))}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.minWidth = `${dw}px`;
    dropdown.style.maxWidth = `${Math.min(320, window.innerWidth - 16)}px`;
    const ctrl = new AbortController();
    outsideController = ctrl;
    setTimeout(() => {
      if (ctrl.signal.aborted) return;
      document.addEventListener('pointerdown', (e) => {
        if (dropdown?.contains(e.target) || editor.contains(e.target)) return;
        closeDropdown();
        if (editor._choiceCloseCallback) editor._choiceCloseCallback();
      }, { capture: true, signal: ctrl.signal });
    }, 0);
    dropdown.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
        if (editor._choiceCloseCallback) editor._choiceCloseCallback();
      }
    });
  };

  renderTags();
  editor.addEventListener('click', openDropdown);
  editor._choiceValue = currentValue;

  return editor;
}

function inputForField(field, value) {
  if (field.type === 'textarea' || field.type === 'richText') return h('textarea', { value: value ?? '', placeholder: field.placeholder || '' });
  if (field.type === 'image' || field.type === 'file') {
    const input = h('input', { type: 'file', accept: field.type === 'image' ? 'image/*' : '' });
    input.dataset.currentValue = JSON.stringify(normalizeFileValue(value) || null);
    input.title = normalizeFileValue(value)?.name || '选择文件';
    return input;
  }
  if (field.type === 'select' || field.type === 'multiSelect') {
    return createChoiceWidget(field, value ?? (field.type === 'multiSelect' ? [] : ''), null);
  }
  if (field.type === 'relation') {
    return createChoiceWidget(field, value ?? (field.multiple ? [] : ''), null);
  }
  if (field.type === 'boolean') {
    const input = h('input', { type: 'checkbox' });
    input.checked = Boolean(value);
    return input;
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return h('input', { type, value: value ?? '', placeholder: field.placeholder || '' });
}

function searchInputForField(field) {
  if (field.type === 'select') {
    const select = h('select');
    select.append(h('option', { value: '', text: '全部' }));
    for (const rawOption of field.options || []) {
      const option = optionObject(rawOption);
      select.append(h('option', { value: option.label, text: option.label }));
    }
    return select;
  }
  if (field.type === 'boolean') {
    const select = h('select');
    select.append(h('option', { value: '', text: '全部' }));
    select.append(h('option', { value: '是', text: '是' }));
    select.append(h('option', { value: '否', text: '否' }));
    return select;
  }
  const type = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'number' ? 'number' : 'text';
  return h('input', { type, placeholder: `搜索${field.label}` });
}

async function valueFromInput(input, field) {
  if (field.type === 'boolean') return input.checked;
  if (field.type === 'multiSelect') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : []) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'relation') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : [input._choiceValue]) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'select') return input._choiceValue !== undefined ? (input._choiceValue || '') : input.value;
  if (field.type === 'image' || field.type === 'file') return uploadValueFromInput(input, field);
  if (field.type === 'number') return input.value === '' ? null : Number(input.value);
  return input.value;
}

async function uploadValueFromInput(input, field) {
  if (!input.files?.length) return JSON.parse(input.dataset.currentValue || 'null');
  const file = input.files[0];
  if (field.type === 'image' && !file.type.startsWith('image/')) {
    toast('图片字段只能上传图片文件。');
    return JSON.parse(input.dataset.currentValue || 'null');
  }
  const buffer = await file.arrayBuffer();
  const params = new URLSearchParams({ name: file.name });
  const body = await api(`/api/apps/${state.currentApp.id}/uploads?${params.toString()}`, {
    method: 'POST',
    body: buffer,
    headers: { 'content-type': file.type || 'application/octet-stream' }
  });
  input.dataset.currentValue = JSON.stringify(body.file);
  return body.file;
}

async function removeRecord(recordId, entityId) {
  openConfirmDialog({
    title: '删除记录',
    message: '确定删除这条记录吗？',
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
        await loadCurrentPageRecords();
        renderRuntime();
        toast('记录已删除');
      } catch (error) {
        if (!/引用/.test(error.message)) throw error;
        openConfirmDialog({
          title: '删除被引用记录',
          message: `${error.message} 删除后这些关联字段会变为空，是否继续？`,
          confirmText: '继续删除',
          danger: true,
          onConfirm: async () => {
            await api(`/api/apps/${state.currentApp.id}/records/${recordId}?force=true`, { method: 'DELETE' });
            await loadCurrentPageRecords();
            renderRuntime();
            toast('记录和相关关联已删除');
          }
        });
      }
    }
  });
}

async function quickAddRecord(entity) {
  try {
    const data = {};
    for (const field of entity.fields) data[field.id] = defaultValueForField(field);
    const body = await api(`/api/apps/${state.currentApp.id}/records`, { method: 'POST', body: JSON.stringify({ entityId: entity.id, data }) });
    
    // 检查当前视图是否有筛选条件，如果有，提示用户或清除筛选
    const currentView = getCurrentView(entity);
    const hasFilters = currentView.filters && currentView.filters.length > 0;
    
    await loadCurrentPageRecords();
    renderRuntime();
    
    if (hasFilters) {
      toast(`已新增 1 行。注意：当前视图有筛选条件，新记录可能不在此视图中显示。`);
    } else {
      toast(`已新增 1 行，可直接双击单元格编辑。`);
    }
    
    return body.record;
  } catch (error) {
    toast(`新增行失败：${error.message}`);
    console.error('新增行错误：', error);
    throw error;
  }
}

function defaultValueForField(field) {
  if (field.type === 'number') return null;
  if (field.type === 'boolean') return false;
  if (field.type === 'multiSelect') return [];
  if (field.type === 'select') return '';
  if (field.type === 'relation') return [];
  if (field.type === 'image' || field.type === 'file') return null;
  return '';
}

function bulkDeleteRecords(entity, selectedIds, selectionKey) {
  if (!selectedIds.size) return toast('先选择要删除的记录。');
  openConfirmDialog({
    title: '批量删除记录',
    message: `确定删除选中的 ${selectedIds.size} 条记录吗？`,
    confirmText: '批量删除',
    danger: true,
    onConfirm: async () => {
      for (const recordId of selectedIds) {
        await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
      }
      writeStorage(selectionKey, []);
      await loadCurrentPageRecords();
      renderRuntime();
      toast('已删除选中记录');
    }
  });
}

function clearCurrentViewConfig(entity) {
  const config = getListConfig(entity);
  updateCurrentView(entity, {
    ...config,
    filters: [],
    sorts: [],
    group: null,
    searchFields: []
  });
  renderRuntime();
  toast('已清除当前视图的筛选、排序、分组和搜索条件。');
}

async function runAppAction(actionId) {
  try {
    const body = await api(`/api/apps/${state.currentApp.id}/actions/${actionId}/run`, { method: 'POST', body: '{}' });
    openTextModal('Action 结果', typeof body.result === 'string' ? body.result : JSON.stringify(body.result, null, 2));
  } catch (error) {
    toast(error.message);
  }
}

function openTextModal(title, text) {
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: title }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('textarea', { style: 'min-height:300px', readonly: 'readonly' }, text)
    ])
  ]);
  document.body.append(backdrop);
}

async function openSettingsModal() {
  const body = await api('/api/settings');
  const ai = body.ai || {};
  const baseUrl = h('input', { value: ai.baseUrl || 'https://api.openai.com/v1' });
  const apiKey = h('input', { value: ai.apiKey || '', type: 'password' });
  const model = h('input', { value: ai.model || 'gpt-4.1-mini' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: 'AI 设置' }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('div', { class: 'form-grid' }, [
        h('div', { class: 'field' }, [h('label', { text: 'API Base URL' }), baseUrl]),
        h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey]),
        h('div', { class: 'field' }, [h('label', { text: 'Model' }), model])
      ]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: async () => {
            await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ai: { baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value } }) });
            backdrop.remove();
            toast('设置已保存');
          }
        }),
        h('button', { class: 'secondary', text: '使用 Mock AI', onclick: () => (apiKey.value = '') })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function openImportModal() {
  const fileInput = h('input', { type: 'file', accept: '.sgpkg,application/octet-stream' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: '导入软件包' }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('p', { class: 'muted', text: '选择 .sgpkg 文件，系统会校验数据结构、页面和动作后安装。' }),
      fileInput,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '安装',
          onclick: async () => {
            if (!fileInput.files[0]) return toast('请选择 .sgpkg 文件。');
            const buffer = await fileInput.files[0].arrayBuffer();
            const body = await api('/api/apps/import', {
              method: 'POST',
              body: buffer,
              headers: { 'content-type': 'application/octet-stream' }
            });
            backdrop.remove();
            await openApp(body.appId);
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

function displayValue(value) {
  if (Array.isArray(value)) return value.map((item) => item?.displayValue || item?.label || item).join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.name || value.optionId || '';
  if (value === true) return '是';
  if (value === false) return '否';
  return value ?? '';
}

function relationDisplayValue(relation, targetEntity, record) {
  if (!record) return '';
  const displayField = resolveRelationDisplayField(relation, targetEntity, record.data || {});
  const value = displayField ? record.data?.[displayField.id] : Object.values(record.data || {}).find(hasDisplayValue);
  return displayValue(value) || record.id;
}

function resolveRelationDisplayField(relation, targetEntity, data = {}) {
  const fields = (targetEntity?.fields || []).filter((field) => field.type !== 'relation');
  const configured = fields.find((field) => field.id === relation?.displayField);
  if (configured && hasDisplayValue(data[configured.id])) return configured;
  const preferred = fields.find((field) => ['name', 'title'].includes(field.id) && hasDisplayValue(data[field.id]));
  if (preferred) return preferred;
  const labelPreferred = fields.find((field) => /名称|标题|姓名|名字|name|title/i.test(`${field.label || ''} ${field.id || ''}`) && hasDisplayValue(data[field.id]));
  if (labelPreferred) return labelPreferred;
  const textField = fields.find((field) => ['text', 'textarea', 'richText', 'select'].includes(field.type) && hasDisplayValue(data[field.id]));
  if (textField) return textField;
  return fields.find((field) => hasDisplayValue(data[field.id])) || configured || fields[0] || null;
}

function hasDisplayValue(value) {
  return !(value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0));
}

function optionObject(option) {
  if (typeof option === 'string') return { id: option, label: option, color: 'gray' };
  return {
    id: option?.id || option?.value || option?.label || '',
    label: option?.label || option?.name || option?.value || option?.id || '',
    color: option?.color || 'gray'
  };
}

function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).map(optionObject).find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}

function optionColor(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).map(optionObject).find((item) => item.id === raw || item.label === raw);
  return option?.color || 'gray';
}

function renderFieldValue(value, field) {
  if (field.type === 'select') {
    const label = optionLabel(field, value);
    return label ? renderSelectTag(label, optionColor(field, value)) : document.createTextNode('');
  }
  if (field.type === 'multiSelect') {
    const wrap = h('span', { class: 'tag-list' });
    for (const item of Array.isArray(value) ? value : []) {
      const label = optionLabel(field, item);
      if (label) wrap.append(renderSelectTag(label, optionColor(field, item)));
    }
    return wrap;
  }
  if (field.type === 'relation') {
    const wrap = h('span', { class: 'tag-list relation-tags' });
    for (const item of Array.isArray(value) ? value : [value]) {
      const label = relationFieldDisplayText(item);
      if (label) wrap.append(h('span', { class: 'relation-tag', text: label }));
    }
    return wrap;
  }
  if (field.type === 'image') return renderImageValue(value);
  if (field.type === 'file') return renderFileValue(value);
  if (isHttpUrl(value)) return h('a', { class: 'cell-link', href: value, target: '_blank', rel: 'noreferrer', text: value, onclick: (event) => event.stopPropagation() });
  return document.createTextNode(formatFieldValue(value, field));
}

function normalizeFileValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return isHttpUrl(value) ? { url: value, name: value.split('/').pop() || value } : { name: value, url: '' };
  if (typeof value === 'object') return { url: value.url || '', name: value.name || value.filename || value.label || value.url || '', mimeType: value.mimeType || '', size: value.size || 0 };
  return null;
}

function renderImageValue(value) {
  const file = normalizeFileValue(value);
  if (!file?.url) return document.createTextNode(file?.name || '');
  const image = h('img', {
    class: 'image-thumb',
    src: file.url,
    alt: file.name || '图片',
    loading: 'lazy',
    onclick: (event) => {
      event.stopPropagation();
      openImagePreview(file);
    }
  });
  return h('span', { class: 'image-cell' }, [image, h('span', { class: 'file-name', text: file.name || '图片' })]);
}

function renderFileValue(value) {
  const file = normalizeFileValue(value);
  if (!file?.url) return document.createTextNode(file?.name || '');
  return h('a', {
    class: 'file-link',
    href: file.url,
    target: '_blank',
    rel: 'noreferrer',
    title: file.name || file.url,
    text: file.name || '附件',
    onclick: (event) => event.stopPropagation()
  });
}

function openImagePreview(file) {
  const backdrop = h('div', { class: 'modal-backdrop image-preview-backdrop', onclick: () => backdrop.remove() }, [
    h('div', { class: 'image-preview-modal', onclick: (event) => event.stopPropagation() }, [
      h('div', { class: 'toolbar image-preview-toolbar' }, [
        h('strong', { text: file.name || '图片预览' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('img', { class: 'image-preview-full', src: file.url, alt: file.name || '图片预览' })
    ])
  ]);
  document.body.append(backdrop);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function renderSelectTag(label, color = 'gray') {
  return h('span', { class: `select-tag select-${color}`, text: label });
}

function relationFieldDisplayText(value) {
  if (!value || typeof value !== 'object') return '';
  return value.displayValue || value.label || value.name || '';
}

function formatFieldValue(value, field) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).filter(Boolean).join('、');
  if (field.type === 'relation') return (Array.isArray(value) ? value : [value]).map(relationFieldDisplayText).filter(Boolean).join('、');
  if (field.type === 'image' || field.type === 'file') return normalizeFileValue(value)?.name || '';
  if (field.type === 'number') {
    const number = Number(value);
    if (Number.isNaN(number)) return displayValue(value);
    if (field.format === 'integer') return String(Math.round(number));
    if (field.format === 'decimal2') return number.toFixed(2);
    if (field.format === 'currency') return `¥${number.toFixed(2)}`;
    if (field.format === 'percent') return `${(number * 100).toFixed(2)}%`;
  }
  if (field.type === 'date' || field.type === 'datetime') {
    const raw = String(value);
    if (field.format === 'yyyy/mm/dd') return raw.slice(0, 10).replaceAll('-', '/');
    if (field.format === 'mm-dd') return raw.slice(5, 10);
    if (field.format === 'yyyy/mm/dd hh:mm') return raw.replace('T', ' ').slice(0, 16).replaceAll('-', '/');
    if (field.format === 'yyyy-mm-dd hh:mm') return raw.replace('T', ' ').slice(0, 16);
  }
  return displayValue(value);
}

function matchesFilter(data, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => data[key] === value);
}

window.addEventListener('popstate', () => {
  boot().catch((error) => {
    root.textContent = error.message;
  });
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus();
});

document.addEventListener('pointerdown', (event) => {
  if (clickedOutsideTableSelection(event.target)) clearActiveTableSelection();
}, true);

document.addEventListener('pointerdown', (event) => {
  if (event.target instanceof HTMLElement && event.target.classList.contains('modal-backdrop')) {
    event.target.remove();
  }
}, true);

document.addEventListener('pointerup', finishCellRangeSelection);
document.addEventListener('pointermove', moveCellRangeSelection);

document.addEventListener('copy', (event) => {
  const matrix = selectedCellMatrix();
  if (!matrix.length) return;
  event.preventDefault();
  state.cellClipboard = selectedCellPayload();
  event.clipboardData.setData('text/plain', matrix.map((row) => row.join('\t')).join('\n'));
  if (isMultiCellMatrix(matrix)) showCellCopyToolbar();
  toast('已复制选区');
});

document.addEventListener('paste', (event) => {
  pasteCellsFromClipboard(event).catch((error) => toast(error.message));
});

document.addEventListener('focusin', (event) => {
  const currentMenu = event.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu');
  if (!currentMenu) closeFloatingMenus();
});

boot().catch((error) => {
  root.textContent = error.message;
});
