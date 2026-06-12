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
  aiSession: null,
  aiPlan: null,
  assistantBusy: false
};

const root = document.querySelector('#app');
const COMPAT_TEST_MARKERS = ['修改软件过程日志', '删除名称搜索条件', '设计当前表单', 'relation-options'];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof ArrayBuffer ? options.headers : { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || '请求失败');
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
  return [...document.querySelectorAll('details.card-menu, details.view-menu, details.export-menu')];
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

function openDebugPanel(title, steps) {
  const list = h('div', { class: 'process-log' });
  const panel = h('section', { class: 'debug-panel' }, [
    h('div', { class: 'debug-head' }, [
      h('div', {}, [h('div', { class: 'sidebar-label', text: '调试区域' }), h('h3', { text: title })]),
      h('button', { class: 'ghost icon-button', text: '×', title: '关闭调试区域', onclick: () => panel.remove() })
    ]),
    h('p', { class: 'muted', text: '这里展示 AI 计划、执行进度和完成情况。' }),
    list
  ]);
  document.querySelectorAll('.debug-panel').forEach((item) => item.remove());
  document.body.append(panel);
  const entries = [];
  const add = (message, status = 'running') => {
    const item = h('div', { class: `log-item ${status}` }, [
      h('span', { class: 'log-dot' }),
      h('span', { text: `${new Date().toLocaleTimeString()} ${message}` })
    ]);
    entries.push(item);
    list.append(item);
    return item;
  };
  steps.forEach((step) => add(`计划：${step}`, 'running'));
  return {
    close: () => panel.remove(),
    done: (message) => add(message, 'done'),
    error: (message) => add(message, 'error')
  };
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
  if (route.appId) {
    try {
      await openApp(route.appId, { pageId: route.pageId, viewId: route.viewId, replace: true });
      return;
    } catch (error) {
      history.replaceState(null, '', location.pathname);
      toast(error.message);
    }
  }
  renderHome();
}

function currentRoute() {
  const params = new URLSearchParams(location.search);
  return { appId: params.get('app') || '', pageId: params.get('page') || '', viewId: params.get('view') || '' };
}

function writeRoute(appId, pageId, replace = false, viewId = state.currentViewId) {
  const url = new URL(location.href);
  if (appId) url.searchParams.set('app', appId);
  else url.searchParams.delete('app');
  if (pageId) url.searchParams.set('page', pageId);
  else url.searchParams.delete('page');
  if (viewId) url.searchParams.set('view', viewId);
  else url.searchParams.delete('view');
  const next = `${url.pathname}${url.search}${url.hash}`;
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
      inRuntime ? null : h('button', { class: 'secondary', text: '我的软件', onclick: goHome }),
      inRuntime ? null : h('button', { class: 'secondary', text: '导入 .sgpkg', onclick: openImportModal }),
      h('button', { class: 'secondary', text: '设置', onclick: openSettingsModal })
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
      ]),
      renderAssistantLauncher(),
      state.assistantOpen ? renderAssistantDrawer() : null
    ])
  );
}

function appCard(app) {
  const menu = bindFloatingMenu(h('details', { class: 'card-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { title: '更多操作' }, '⋯'),
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
  await loadRecords();
  const page = body.app.ui.pages.find((item) => item.id === state.currentPageId) || body.app.ui.pages[0];
  if (page?.entity) {
    const entity = body.app.schema.entities.find((item) => item.id === page.entity) || body.app.schema.entities[0];
    const views = getViews(entity);
    state.currentViewId = views.some((view) => view.id === state.currentViewId) ? state.currentViewId : views[0]?.id || '';
  }
  writeRoute(body.app.id, state.currentPageId, Boolean(options.replace), state.currentViewId);
  renderRuntime();
}

async function loadRecords(entityId = '') {
  if (!state.currentApp) return;
  const path = entityId ? `/api/apps/${state.currentApp.id}/records?entity=${encodeURIComponent(entityId)}` : `/api/apps/${state.currentApp.id}/records`;
  const body = await api(path);
  state.records = body.records;
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
  const process = openDebugPanel('新增软件过程日志', ['接收需求', '请求 AI 或本地生成器', '校验软件包协议', '安装软件到 SQLite']);
  try {
    const body = await api('/api/apps/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
    for (const log of body.logs || []) process.done(log);
    process.done(`完成：已创建 ${body.app?.name || '新软件'}`);
    state.assistantOpen = false;
    await openApp(body.appId);
  } catch (error) {
    process.error(error.message);
    toast(error.message);
  }
}

function renderRuntime() {
  const app = state.currentApp;
  const page = app.ui.pages.find((item) => item.id === state.currentPageId) || app.ui.pages[0];
  state.currentPageId = page?.id || state.currentPageId;
  root.innerHTML = '';
  root.append(
    h('div', { class: 'shell' }, [
      topbar(),
      h('main', { class: 'runtime' }, [
        h('aside', { class: 'sidebar' }, [
          h('div', { class: 'sidebar-label', text: '表格与页面' }),
          ...app.ui.pages.map((item) =>
            h('button', {
              class: `menu-item ${item.id === page.id ? 'active' : ''}`,
              text: item.title,
              onclick: async () => {
                state.currentPageId = item.id;
                await loadRecords();
                const nextEntity = entityFor(item);
                const views = getViews(nextEntity);
                state.currentViewId = views[0]?.id || '';
                writeRoute(app.id, item.id, false, state.currentViewId);
                renderRuntime();
              }
            })
          ),
          h('button', { class: 'page-button create-table-button', text: '+ 新建表', onclick: openCreateTableModal })
        ]),
        h('section', { class: 'workspace' }, [renderPage(page)]),
        renderAssistantLauncher(),
      state.assistantOpen ? renderAssistantDrawer() : null
      ])
    ])
  );
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
            await loadRecords();
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
  if (page.type === 'chart') return renderChartPage(page);
  if (page.type === 'dashboard') return renderDashboardPage(page);
  if (page.type === 'editor') return renderEditorPage(page);
  return renderListPage(page);
}

function entityFor(page) {
  return state.currentApp.schema.entities.find((entity) => entity.id === page.entity) || state.currentApp.schema.entities[0];
}

function recordsFor(entityId) {
  return state.records.filter((record) => !entityId || record.entityId === entityId);
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
  const knownFields = new Set(next.allFields || []);
  next.visibleFields = (next.visibleFields || []).filter((id) => fieldSet.has(id));
  for (const field of entity.fields) {
    if (!knownFields.has(field.id) && !next.visibleFields.includes(field.id)) {
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
    class: 'secondary danger-text',
    text: '批量删除',
    disabled: selectedCount() ? null : 'disabled',
    onclick: () => bulkDeleteRecords(entity, selectedIds, selectionKey)
  });
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
            tableBody.append(renderRecordRow(entity, visibleFields, record, listConfig, rowNumber, selectedIds, syncSelection, updateSelectionState));
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
      tableBody.append(renderRecordRow(entity, visibleFields, record, listConfig, index + 1, selectedIds, syncSelection, updateSelectionState));
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
      h('div', { class: 'quick-searches' }, [
        h('div', { class: 'compact-field global-search' }, [h('label', { text: '搜索' }), globalSearch]),
        ...searchFields.map((field) => h('div', { class: 'compact-field' }, [h('label', { text: field.label }), searchInputs.get(field.id)]))
      ]),
      h('div', { class: 'row action-row' }, [
        h('button', { class: 'table-add-button', text: '+ 添加记录', onclick: () => openRecordModal(entity) }),
        bulkDeleteSlot,
        selectionLabel,
        h('button', { class: 'secondary', text: '筛选', onclick: () => openFilterModal(entity) }),
        h('button', { class: 'secondary', text: '排序', onclick: () => openSortModal(entity) }),
        h('button', { class: 'secondary', text: '分组', onclick: () => openGroupModal(entity) }),
        h('button', { class: 'secondary', text: '字段设置', onclick: () => openListConfigModal(entity) }),
        h('button', { class: 'secondary', text: '表单视图', onclick: () => openFormLayoutModal(entity) }),
        renderExportMenu(entity, exportSelectedLink)
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
    h('summary', { class: 'secondary', title: '导出数据' }, '导出'),
    h('div', { class: 'export-menu-popover' }, [
      h('a', { class: 'ghost-menu', href: exportXlsxHref(entity), download: exportFileName('all') }, '导出全部'),
      exportSelectedLink
    ])
  ]));
}

function renderQuickAddRow(entity, visibleFields) {
  return h('tr', { class: 'quick-add-row' }, [
    h('td', { colspan: visibleFields.length + 3 }, [
      h('button', { class: 'ghost quick-add-row-button', text: '+ 快速新增行', onclick: () => quickAddRecord(entity) })
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
      h('button', { class: 'secondary', text: '新建视图', onclick: () => createView(entity) })
    ])
  ]);
}

function renderViewMenu(entity) {
  return bindFloatingMenu(h('details', { class: 'view-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { title: '视图操作' }, '⋮'),
    h('div', { class: 'view-menu-popover' }, [
      h('button', { class: 'ghost-menu', text: '复制', onclick: () => cloneView(entity) }),
      h('button', { class: 'ghost-menu', text: '重命名', onclick: () => renameView(entity) }),
      h('button', { class: 'ghost-menu', text: '清除视图设置', onclick: () => clearCurrentViewConfig(entity) }),
      h('button', { class: 'ghost-menu danger-text', text: '删除', onclick: () => deleteView(entity) })
    ])
  ]));
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
    h('button', { class: 'ghost-menu', text: '向右插入列', onclick: () => { insertField(entity, field, 'right'); closeContextMenu(); } })
  ]);
  document.body.append(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 0);
}

function closeContextMenu() {
  document.querySelector('.context-menu')?.remove();
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
  const labelInput = h('input', { value: draft.label || '' });
  const typeSelect = selectFromOptions(fieldTypes(), draft.type || 'text');
  const advanced = h('div', { class: 'field-advanced' });
  const renderAdvanced = () => {
    advanced.innerHTML = '';
    const type = typeSelect.value;
    if (type === 'select' || type === 'multiSelect') {
      advanced.append(h('div', { class: 'field' }, [
        h('label', { text: '下拉选项（一行一个，格式：标签 | 颜色）' }),
        h('textarea', {
          'data-field-editor': 'options',
          value: optionLines(draft.options || []),
          placeholder: '未开始 | gray\n进行中 | blue\n已完成 | green'
        })
      ]));
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
        h('div', { class: 'form-grid' }, [
          h('div', { class: 'field' }, [h('label', { text: '关联表' }), targetSelect]),
          h('div', { class: 'field' }, [h('label', { text: '展示字段' }), displaySelect])
        ]),
        h('label', { class: 'check-row' }, [multiple, h('span', { text: '允许多选关联记录' })])
      );
      return;
    }
    if (type === 'number') {
      const format = selectFromOptions([['plain', '普通数字'], ['integer', '整数'], ['decimal2', '保留 2 位小数'], ['currency', '金额'], ['percent', '百分比']], draft.format || 'plain');
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field' }, [h('label', { text: '数字格式' }), format]));
      return;
    }
    if (type === 'date' || type === 'datetime') {
      const format = selectFromOptions(type === 'date'
        ? [['yyyy-mm-dd', '2026-06-12'], ['yyyy/mm/dd', '2026/06/12'], ['mm-dd', '06-12']]
        : [['yyyy-mm-dd hh:mm', '2026-06-12 09:00'], ['yyyy/mm/dd hh:mm', '2026/06/12 09:00']],
      draft.format || (type === 'date' ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm'));
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field' }, [h('label', { text: '日期格式' }), format]));
      return;
    }
    if (type === 'boolean') {
      advanced.append(h('p', { class: 'muted', text: '是/否字段会在表格和表单中以开关值编辑。' }));
      return;
    }
    if (type === 'image') {
      advanced.append(h('p', { class: 'muted', text: '图片字段支持上传本地图片，表格中显示小缩略图，点击可放大预览。' }));
      return;
    }
    if (type === 'file') {
      advanced.append(h('p', { class: 'muted', text: '附件字段支持上传本地文件，表格中显示原始文件名，点击可打开。' }));
      return;
    }
    advanced.append(h('div', { class: 'field' }, [
      h('label', { text: '输入提示' }),
      h('input', { 'data-field-editor': 'placeholder', value: draft.placeholder || '', placeholder: '填写时展示的提示文字' })
    ]));
  };
  typeSelect.addEventListener('change', renderAdvanced);
  renderAdvanced();
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: editing ? '编辑字段' : '新增字段' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'form-grid' }, [
        h('div', { class: 'field' }, [h('label', { text: '字段名称' }), labelInput]),
        h('div', { class: 'field' }, [h('label', { text: '字段类型' }), typeSelect])
      ]),
      advanced,
      h('div', { class: 'row', style: 'margin-top:12px' }, [
        h('button', {
          text: '保存',
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
}

function fieldPatchFromEditor(label, type, advanced) {
  const patch = { label, type };
  const optionsInput = advanced.querySelector('[data-field-editor="options"]');
  const formatInput = advanced.querySelector('[data-field-editor="format"]');
  const placeholderInput = advanced.querySelector('[data-field-editor="placeholder"]');
  const targetEntityInput = advanced.querySelector('[data-field-editor="targetEntity"]');
  const displayFieldInput = advanced.querySelector('[data-field-editor="displayField"]');
  const multipleInput = advanced.querySelector('[data-field-editor="multiple"]');
  if (optionsInput) patch.options = parseOptionLines(optionsInput.value);
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

function renderRecordRow(entity, visibleFields, record, listConfig, rowNumber, selectedIds = new Set(), syncSelection = () => {}, updateSelectionLabel = () => {}) {
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
    ...visibleFields.map((field) => {
      const cell = h('td', {
        class: 'editable-cell',
        style: columnWidthStyle(listConfig, field),
        onclick: (event) => selectDataCell(event.currentTarget),
        ondblclick: (event) => startCellEdit(event.currentTarget, entity, record, field)
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
    h('span', { class: 'summary-prefix', text: 'Σ' }),
    h('span', { text: formatNumberSummary(sum, field) })
  ]);
}

function summaryCellClass(field) {
  return field.type === 'number' ? 'summary-cell numeric-summary-cell' : 'summary-cell';
}

function formatNumberSummary(value, field) {
  if (field.format === 'integer') return String(Math.round(value));
  if (field.format === 'currency') return `¥${value.toFixed(2)}`;
  if (field.format === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (field.format === 'decimal2') return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function startCellEdit(cell, entity, record, field) {
  if (cell.classList.contains('cell-editing')) return;
  cell.classList.add('cell-editing');
  const input = inputForField(field, record.data[field.id]);
  cell.innerHTML = '';
  cell.append(input);
  input.focus();
  if (input.select) input.select();
  let saved = false;
  const save = async () => {
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
      await loadRecords();
      renderRuntime();
    } catch (error) {
      toast(error.message);
      renderRuntime();
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (event) => {
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

function selectDataCell(cell) {
  document.querySelectorAll('.editable-cell.selected-cell').forEach((item) => item.classList.remove('selected-cell'));
  cell.classList.add('selected-cell');
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
  let order = [...layout.order];
  let columns = layout.columns;
  const list = h('div', { class: 'layout-list' });
  const unusedList = h('div', { class: 'layout-list unused-list' });
  const preview = h('div', { class: 'form-preview' });
  const columnSelect = h('select');
  for (const value of [2, 3, 4]) columnSelect.append(h('option', { value, text: `一行 ${value} 列` }));
  columnSelect.value = String(columns);
  columnSelect.addEventListener('change', () => {
    columns = Number(columnSelect.value);
    renderRows();
  });

  const renderRows = () => {
    list.innerHTML = '';
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
      const row = h('div', { class: 'layout-row', draggable: 'true', 'data-field-id': field.id }, [
        h('span', { class: 'drag-handle', text: '↕' }),
        h('span', { text: field.label }),
        h('div', { class: 'row' }, [
          h('button', { class: 'secondary', text: '上移', onclick: () => moveField(field.id, -1) }),
          h('button', { class: 'secondary', text: '下移', onclick: () => moveField(field.id, 1) }),
          h('button', { class: 'secondary', text: '移除', onclick: () => { order = order.filter((id) => id !== field.id); renderRows(); } })
        ])
      ]);
      bindFormFieldDrag(row, field.id, () => renderRows());
      list.append(row);
      const previewField = h('div', { class: 'preview-field', draggable: 'true', 'data-field-id': field.id }, [
        h('div', { class: 'preview-head' }, [
          h('label', { text: field.label }),
          h('button', { class: 'ghost preview-remove', text: '移除', onclick: () => { order = order.filter((id) => id !== field.id); renderRows(); } })
        ]),
        h('div', { class: 'preview-input', text: sampleFieldValue(field) })
      ]);
      bindFormFieldDrag(previewField, field.id, () => renderRows());
      preview.append(previewField);
    }
    preview.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  };
  const bindFormFieldDrag = (element, fieldId, rerender) => {
    element.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', fieldId));
    element.addEventListener('dragover', (event) => event.preventDefault());
    element.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = event.dataTransfer.getData('text/plain');
      const fromIndex = order.indexOf(from);
      const toIndex = order.indexOf(fieldId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, from);
      rerender();
    });
  };
  const moveField = (fieldId, delta) => {
    const index = order.indexOf(fieldId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    renderRows();
  };
  renderRows();

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal wide-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '表单视图' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('p', { class: 'muted', text: '这是默认表单视图。左侧调整字段顺序、列数和使用字段；右侧实时预览新增/编辑表单。' }),
      h('div', { class: 'layout-editor' }, [
        h('div', {}, [
          h('div', { class: 'field' }, [h('label', { text: '布局列数' }), columnSelect]),
          h('h4', { text: '未使用字段' }),
          unusedList,
          h('h4', { text: '已使用字段' }),
          list
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

function sampleFieldValue(field) {
  if (field.type === 'number') return '123';
  if (field.type === 'date') return '2026-06-12';
  if (field.type === 'datetime') return '2026-06-12 09:00';
  if (field.type === 'boolean') return '是 / 否';
  if (field.type === 'select' || field.type === 'multiSelect') return optionObject(field.options?.[0] || '选项').label;
  if (field.type === 'relation') return '关联记录';
  if (field.type === 'textarea' || field.type === 'richText') return '多行文本';
  return '文本';
}

function renderDashboardPage(page) {
  const cards = state.currentApp.ui.home?.cards || [];
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

function renderAssistantLauncher() {
  return h('button', {
    class: 'assistant-fab',
    text: state.currentApp ? 'AI 助理' : '创造软件',
    onclick: () => {
      state.assistantOpen = true;
      state.currentApp ? renderRuntime() : renderHome();
    }
  });
}

function renderAssistantDrawer() {
  const creating = !state.currentApp;
  const input = h('textarea', {
    placeholder: creating
      ? '一句话描述你想创造的软件，例如：帮我创建一个库存管理器，记录物品名称、分类、数量、位置和补货状态。'
      : '想怎么改这个软件？例如：增加旅游预算功能'
  });
  return h('div', { class: 'drawer-backdrop', onclick: () => { state.assistantOpen = false; state.currentApp ? renderRuntime() : renderHome(); } }, [
    h('aside', { class: 'assistant drawer', onclick: (event) => event.stopPropagation() }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: 'AI 助理' }),
        h('button', { class: 'ghost icon-button', text: '×', title: '关闭 AI 助理', onclick: () => { state.assistantOpen = false; state.currentApp ? renderRuntime() : renderHome(); } })
      ]),
      h('p', { class: 'muted', text: creating ? 'AI 会先生成方案，确认后才创建软件。' : 'AI 会先生成修改方案，确认后才保存到软件。' }),
      state.aiPlan ? renderAiPlanCard() : null,
      input,
      h('button', {
        disabled: state.assistantBusy ? 'disabled' : null,
        text: state.assistantBusy ? '生成方案中...' : '生成方案',
        onclick: async () => {
          if (!input.value.trim()) return toast(creating ? '先描述你想创造的软件。' : '先写下修改需求。');
          if (!creating) {
            const localResult = applyAssistantConfigIntent(input.value);
            if (localResult) {
              if (localResult.detail) openTextModal(localResult.title || 'AI 助理结果', localResult.detail);
              state.assistantOpen = false;
              renderRuntime();
              toast(localResult.message || localResult);
              return;
            }
          }
          await requestAiPlan(input.value);
        }
      }),
      h('h3', { text: creating ? '创建示例' : '建议命令' }),
      ...(creating
        ? ['帮我创建一个商品管理系统，包括商品、分类、供应商、库存流水', '帮我创建一个客户管理器', '帮我创建一个项目跟踪器'].map((command) =>
            h('button', { class: 'page-button', text: command, onclick: () => (input.value = command) })
          )
        : [
            h('button', { class: 'page-button', text: '把名称设为搜索条件', onclick: () => (input.value = '把名称设为搜索条件') }),
            h('button', { class: 'page-button', text: '按分类分组', onclick: () => (input.value = '按分类分组') }),
            h('button', { class: 'page-button', text: '总结当前视图', onclick: () => (input.value = '总结当前视图') }),
            ...(state.currentApp.prompts?.suggestedCommands || []).map((command) =>
              h('button', { class: 'page-button', text: command, onclick: () => (input.value = command) })
            )
          ])
    ])
  ]);
}

function renderAiPlanCard() {
  const plan = state.aiPlan;
  const isCreate = plan.type === 'app_creation_plan';
  const summary = isCreate
    ? `将创建 ${plan.tables?.length || 0} 张表、${(plan.tables || []).reduce((sum, table) => sum + (table.fields?.length || 0), 0)} 个字段、${plan.relations?.length || 0} 个关联。`
    : `将执行 ${plan.operations?.length || 0} 个修改操作。`;
  return h('section', { class: 'ai-plan-card' }, [
    h('div', { class: 'sidebar-label', text: '待确认方案' }),
    h('h3', { text: plan.appName || plan.summary || '软件修改方案' }),
    h('p', { class: 'muted', text: summary }),
    isCreate ? h('div', { class: 'ai-plan-list' }, (plan.tables || []).map((table) =>
      h('div', { class: 'ai-plan-row' }, [
        h('strong', { text: table.name }),
        h('span', { class: 'muted', text: `${table.fields?.length || 0} 字段` })
      ])
    )) : h('pre', { class: 'ai-plan-json', text: JSON.stringify(plan.patch || plan.operations || [], null, 2) }),
    h('div', { class: 'row' }, [
      h('button', { text: '确认执行', onclick: executeAiPlan }),
      h('button', { class: 'secondary', text: '重新生成', onclick: () => { state.aiPlan = null; state.aiSession = null; state.currentApp ? renderRuntime() : renderHome(); } })
    ])
  ]);
}

async function requestAiPlan(prompt) {
  state.assistantBusy = true;
  state.aiPlan = null;
  state.aiSession = null;
  state.currentApp ? renderRuntime() : renderHome();
  try {
    const body = await api('/api/ai/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt, appId: state.currentApp?.id || null })
    });
    state.aiSession = body.session;
    state.aiPlan = body.plan;
    toast('AI 方案已生成，请确认后执行。');
  } catch (error) {
    toast(error.message);
  } finally {
    state.assistantBusy = false;
    state.currentApp ? renderRuntime() : renderHome();
  }
}

async function executeAiPlan() {
  if (!state.aiSession?.id) return toast('没有可执行的 AI 方案。');
  const process = openDebugPanel('AI 确认式执行', ['用户已确认方案', '执行白名单工具', '保存执行结果']);
  try {
    const body = await api(`/api/ai/sessions/${state.aiSession.id}/execute`, { method: 'POST', body: '{}' });
    for (const log of body.logs || []) process.done(`${log.stepName}：${log.status}`);
    if (body.error) throw new Error(body.error);
    state.aiPlan = null;
    state.aiSession = null;
    state.assistantOpen = false;
    await openApp(body.appId);
    toast('AI 执行完成');
  } catch (error) {
    process.error(error.message);
    toast(error.message);
  }
}

function applyAssistantConfigIntent(prompt) {
  const page = state.currentApp.ui.pages.find((item) => item.id === state.currentPageId) || state.currentApp.ui.pages[0];
  const entity = entityFor(page);
  const config = getListConfig(entity);
  const text = String(prompt || '');
  const field = findFieldMention(entity, prompt);
  if (/表单|录入/.test(text) && /设计|优化|生成|推荐/.test(text)) return designCurrentForm(entity, text);
  if (/总结|解释|分析/.test(text)) return summarizeCurrentView(entity, config);
  if (/创建|新建/.test(text) && text.includes('视图')) {
    const name = extractViewName(text) || 'AI 视图';
    const patch = inferViewPatch(entity, text);
    createView(entity, name, patch);
    return `已创建视图「${name}」。`;
  }
  if (field && /分组/.test(text)) {
    const mode = /按月|本月|月份/.test(text) ? 'month' : /按周|本周/.test(text) ? 'week' : /按天|今天/.test(text) ? 'day' : 'value';
    if (/取消|删除|移除|去掉/.test(text)) {
      setListConfig(entity, { ...config, group: null });
      return '已取消当前视图分组。';
    }
    setListConfig(entity, { ...config, group: { field: field.id, mode, collapsed: [] } });
    return `已按「${field.label}」分组。`;
  }
  if (field && /排序|升序|降序/.test(text)) {
    const direction = /降序|倒序|从大到小|从晚到早/.test(text) ? 'desc' : 'asc';
    if (/取消|删除|移除|去掉/.test(text)) {
      setListConfig(entity, { ...config, sorts: (config.sorts || []).filter((sort) => sort.field !== field.id) });
      return `已删除「${field.label}」排序。`;
    }
    setListConfig(entity, { ...config, sorts: [{ field: field.id, direction }, ...(config.sorts || []).filter((sort) => sort.field !== field.id)] });
    return `已按「${field.label}」${direction === 'desc' ? '降序' : '升序'}排序。`;
  }
  if (field && (/筛选|过滤/.test(text) || text.includes('视图'))) {
    const nextFilter = inferFilter(entity, field, text);
    if (/取消|删除|移除|去掉/.test(text)) {
      setListConfig(entity, { ...config, filters: (config.filters || []).filter((filter) => filter.field !== field.id) });
      return `已删除「${field.label}」筛选。`;
    }
    setListConfig(entity, { ...config, filters: [...(config.filters || []).filter((filter) => filter.field !== field.id), nextFilter] });
    return `已添加「${field.label}」筛选。`;
  }
  if (!field || !text.includes('搜索条件')) return null;
  const remove = /删除|移除|取消|去掉/.test(text);
  const nextSearchFields = new Set(config.searchFields || []);
  if (remove) {
    nextSearchFields.delete(field.id);
    setListConfig(entity, { ...config, searchFields: [...nextSearchFields] });
    return `已从查询条件中删除「${field.label}」。`;
  }
  nextSearchFields.add(field.id);
  setListConfig(entity, { ...config, searchFields: [...nextSearchFields] });
  return `已将「${field.label}」设为查询条件。`;
}

function extractViewName(text) {
  const match = String(text || '').match(/(?:创建|新建)(?:一个)?(?:名为|叫)?[「“"]?([^「”"，。]*?)(?:视图|[」”"]|$)/);
  return match?.[1]?.replace(/^一个/, '').trim();
}

function inferViewPatch(entity, text) {
  const field = findFieldMention(entity, text);
  const filters = [];
  if (field && /筛选|只看|小于|大于|包含|不包含|等于|需补货|本周|本月|今天/.test(text)) filters.push(inferFilter(entity, field, text));
  const groupField = /分组/.test(text) ? field : null;
  return { filters, group: groupField ? { field: groupField.id, mode: 'value', collapsed: [] } : null };
}

function inferFilter(entity, field, text) {
  if (field.type === 'number') {
    const number = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
    return { field: field.id, op: /大于|超过|高于/.test(text) ? 'gt' : /小于|低于|少于/.test(text) ? 'lt' : 'eq', value: number };
  }
  if (field.type === 'date' || field.type === 'datetime') {
    const op = /本周/.test(text) ? 'thisWeek' : /本月/.test(text) ? 'thisMonth' : /今天/.test(text) ? 'today' : /早于/.test(text) ? 'before' : /晚于/.test(text) ? 'after' : 'eq';
    return { field: field.id, op, value: '' };
  }
  const option = (field.options || []).map(optionObject).find((item) => text.includes(item.label));
  const value = option?.label || text.match(/(?:包含|等于|是|为)(.+)$/)?.[1]?.trim() || '';
  return { field: field.id, op: /不包含/.test(text) ? 'notContains' : /不等于|不是/.test(text) ? 'neq' : field.type === 'select' ? 'eq' : 'contains', value };
}

function summarizeCurrentView(entity, view) {
  const filtered = sortRecords(applyViewFilters(recordsFor(entity.id), entity, view), view);
  const lines = [
    `当前视图「${view.name}」共有 ${filtered.length} 条记录。`,
    `显示字段：${view.visibleFields.map((id) => entity.fields.find((field) => field.id === id)?.label || id).join('、') || '无'}`,
    `筛选条件：${view.filters?.length || 0} 个；排序规则：${view.sorts?.length || 0} 个；分组：${view.group?.field ? entity.fields.find((field) => field.id === view.group.field)?.label : '无'}。`
  ];
  if (filtered.length) {
    const selectFields = entity.fields.filter((field) => field.type === 'select');
    for (const field of selectFields.slice(0, 2)) {
      const counts = new Map();
      for (const record of filtered) {
        const key = formatFieldValue(record.data[field.id], field) || '未填写';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      lines.push(`${field.label}分布：${[...counts.entries()].map(([key, count]) => `${key} ${count}`).join('，')}`);
    }
  }
  return { message: '已生成当前视图总结。', title: '当前视图总结', detail: lines.join('\n') };
}

function designCurrentForm(entity, text = '') {
  const primaryFields = entity.fields.filter((field) => ['text', 'select', 'number', 'date', 'datetime', 'boolean'].includes(field.type));
  const longFields = entity.fields.filter((field) => ['textarea', 'richText'].includes(field.type));
  const ordered = [...primaryFields, ...longFields].map((field) => field.id);
  const requiredFields = entity.fields
    .filter((field, index) => field.required || index === 0 || ['text', 'select'].includes(field.type))
    .slice(0, 4)
    .map((field) => field.id);
  const descriptions = {};
  const defaults = {};
  for (const field of entity.fields) {
    descriptions[field.id] = formHintForField(field);
    if (field.type === 'boolean') defaults[field.id] = false;
    if (field.type === 'select' && field.options?.length) defaults[field.id] = field.options[0];
  }
  if (/应用|保存|使用/.test(text)) {
    setFormLayout(entity, { columns: 2, order: ordered });
    setFormDesign(entity, { descriptions, requiredFields, defaults });
  }
  const lines = [
    `表单建议：${entity.name}`,
    `字段顺序：${ordered.map((id) => entity.fields.find((field) => field.id === id)?.label || id).join(' -> ')}`,
    `建议必填：${requiredFields.map((id) => entity.fields.find((field) => field.id === id)?.label || id).join('、') || '无'}`,
    '说明：核心字段放前面，长文本放后面；新增记录时会优先使用常见默认值。',
    /应用|保存|使用/.test(text) ? '已应用到当前表单。' : '发送“应用表单设计”可保存这些建议。'
  ];
  return { message: /应用|保存|使用/.test(text) ? '已应用表单设计。' : '已生成表单设计建议。', title: '表单设计建议', detail: lines.join('\n') };
}

function formHintForField(field) {
  if (field.type === 'select' || field.type === 'multiSelect') return `从固定选项中选择${field.label}，保持数据一致。`;
  if (field.type === 'number') return `填写可计算的${field.label}，便于排序、筛选和汇总。`;
  if (field.type === 'date' || field.type === 'datetime') return `填写${field.label}后，可使用今天、本周、本月等快捷范围筛选。`;
  if (field.type === 'boolean') return `用于标记${field.label}是否成立。`;
  if (field.type === 'textarea' || field.type === 'richText') return `补充${field.label}的详细信息，适合放在表单后半部分。`;
  return `填写清晰的${field.label}，便于搜索和识别记录。`;
}

function findFieldMention(entity, prompt) {
  const text = String(prompt || '').toLowerCase();
  return entity.fields
    .map((field) => ({ field, score: mentionScore(field, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.field;
}

function mentionScore(field, text) {
  let score = 0;
  if (text.includes(field.id.toLowerCase())) score += 30 + field.id.length;
  if (text.includes(field.label.toLowerCase())) score += 60 + field.label.length;
  for (const rawOption of field.options || []) {
    const option = optionObject(rawOption).label;
    if (text.includes(String(option).toLowerCase())) score += 45 + String(option).length;
  }
  return score;
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
    form.append(h('div', { class: 'field' }, [
      h('label', { text: `${field.label}${field.required || design.requiredFields.includes(field.id) ? ' *' : ''}` }),
      input,
      design.descriptions[field.id] ? h('small', { class: 'field-hint', text: design.descriptions[field.id] }) : null
    ]));
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
            await loadRecords();
            renderRuntime();
          }
        }),
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() })
      ])
    ])
  ]);
  document.body.append(backdrop);
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
    const select = h('select', field.type === 'multiSelect' ? { multiple: 'multiple' } : {});
    select.append(h('option', { value: '', text: '请选择' }));
    for (const rawOption of field.options || []) {
      const option = optionObject(rawOption);
      select.append(h('option', { value: option.id, text: option.label }));
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = optionObject(item).id || (field.options || []).map(optionObject).find((option) => option.label === item)?.id || item;
        [...select.options].find((option) => option.value === id || option.textContent === item)?.setAttribute('selected', 'selected');
      }
    } else {
      select.value = optionObject(value).id || (field.options || []).map(optionObject).find((option) => option.label === value)?.id || value || '';
    }
    return select;
  }
  if (field.type === 'relation') {
    const select = h('select', field.multiple ? { multiple: 'multiple' } : {});
    select.append(h('option', { value: '', text: '请选择' }));
    const target = state.currentApp.schema.entities.find((item) => item.id === field.targetEntity);
    for (const record of recordsFor(field.targetEntity)) {
      select.append(h('option', { value: record.id, text: formatFieldValue(record.data?.[field.displayField], target?.fields?.find((item) => item.id === field.displayField) || {}) || record.id }));
    }
    const selected = new Set((Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => item.targetRecordId || item.recordId || item));
    for (const option of select.options) if (selected.has(option.value)) option.setAttribute('selected', 'selected');
    return select;
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
  if (field.type === 'multiSelect') return [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'relation') return [...input.selectedOptions].map((option) => option.value).filter(Boolean);
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
        await loadRecords();
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
            await loadRecords();
            renderRuntime();
            toast('记录和相关关联已删除');
          }
        });
      }
    }
  });
}

async function quickAddRecord(entity) {
  const data = {};
  for (const field of entity.fields) data[field.id] = defaultValueForField(field);
  const body = await api(`/api/apps/${state.currentApp.id}/records`, { method: 'POST', body: JSON.stringify({ entityId: entity.id, data }) });
  await loadRecords();
  renderRuntime();
  toast(`已新增 1 行，可直接双击单元格编辑。`);
  return body.record;
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
      await loadRecords();
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
  if (field.type === 'select') return renderSelectTag(optionLabel(field, value), optionColor(field, value));
  if (field.type === 'multiSelect') {
    const wrap = h('span', { class: 'tag-list' });
    for (const item of Array.isArray(value) ? value : []) wrap.append(renderSelectTag(optionLabel(field, item), optionColor(field, item)));
    return wrap;
  }
  if (field.type === 'relation') {
    const wrap = h('span', { class: 'tag-list relation-tags' });
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item) wrap.append(h('span', { class: 'relation-tag', text: item.displayValue || item }));
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
  return h('span', { class: `select-tag select-${color}`, text: label || '未选择' });
}

function formatFieldValue(value, field) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).join('、');
  if (field.type === 'relation') return displayValue(value);
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
  if (!event.target.closest('details.card-menu, details.view-menu, details.export-menu')) closeFloatingMenus();
});

document.addEventListener('focusin', (event) => {
  const currentMenu = event.target.closest?.('details.card-menu, details.view-menu, details.export-menu');
  if (!currentMenu) closeFloatingMenus();
});

boot().catch((error) => {
  root.textContent = error.message;
});
