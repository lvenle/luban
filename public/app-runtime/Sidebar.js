import { h, svgIcon, svgPath, svgLine, buttonLabel } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog, openTextModal } from '../common/modal.js';
import { state, entityFor, recordsFor, storageKey, entityById, writeRoute, uniquePageId } from '../app-context.js';
import { toggleSidebarCollapsed } from './RuntimeFrame.js';
import { loadCurrentPageRecords, renderRuntime, saveCurrentPackage } from './runtime-actions.js';
import { getViews, selectFromOptions } from './ViewBar.js';
import { optionObject } from './FieldEditor.js';

export function clearPageDragStyles() {
  document.querySelectorAll('.page-nav-item').forEach((item) => {
    item.classList.remove('is-dragging', 'drop-before', 'drop-after');
    delete item.dataset.dropPosition;
  });
}

const OLD_TABLE_TYPES = ['table', 'list', 'kanban', 'grid', 'cards', 'calendar', 'timeline', 'gallery', 'spreadsheet', 'board'];
const OLD_PAGE_TYPES = ['page', 'blank', 'chart', 'editor', 'form', 'detail', 'stats', 'statistics', 'report', 'summary', 'canvas'];

export function pageNavKind(app, page) {
  // navKind is the source of truth — trust it first
  if (page?.navKind) return page.navKind;
  // Fallback for old page types (before normalizePackage runs)
  if (page?.source === 'table' || OLD_TABLE_TYPES.includes(page?.type)) return 'table';
  if (page?.source === 'link' || page?.type === 'link') return 'link';
  if (page?.type === 'dashboard') return 'dashboard';
  if (page?.source === 'page' || OLD_PAGE_TYPES.includes(page?.type)) return 'page';
  if (page.entity) return 'table';
  return 'page';
}

export function pageTypeIcon(navKind) {
  if (navKind === 'table') {
    return svgIcon('0 0 18 18', [
      svgLine(4, 5, 14, 5),
      svgLine(4, 9, 14, 9),
      svgLine(4, 13, 14, 13)
    ], 'page-type-svg');
  }
  if (navKind === 'link') {
    return svgIcon('0 0 18 18', [
      svgPath('M8.3 5.05a2.19 2.19 0 0 1 3.1 0l1.55 1.55a2.19 2.19 0 0 1 0 3.1l-1.04 1.04'),
      svgPath('M9.7 12.95a2.19 2.19 0 0 1-3.1 0L5.05 11.4a2.19 2.19 0 0 1 0-3.1l1.04-1.04'),
      svgLine(8.3, 6.8, 9.7, 11.2)
    ], 'page-type-svg');
  }
  if (navKind === 'dashboard') {
    return svgIcon('0 0 18 18', [
      svgPath('M2 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z'),
      svgPath('M9 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V3Z'),
      svgPath('M2 10a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5Z'),
      svgPath('M9 10a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5Z')
    ], 'page-type-svg');
  }
  if (navKind === 'markdown') {
    return svgIcon('0 0 18 18', [
      svgPath('M4 2.5h6l4 4V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z'),
      svgPath('M10 2.5V7h4'),
      svgPath('M5 12V9l1.5 1.7L8 9v3'),
      svgPath('m10 10 1.5 2 1.5-2')
    ], 'page-type-svg');
  }
  if (navKind === 'webpage') {
    return svgIcon('0 0 18 18', [
      svgPath('M3 3h12v12H3z'),
      svgLine(3, 6, 15, 6),
      svgPath('m7 9-2 1.5L7 12'),
      svgPath('m11 9 2 1.5-2 1.5')
    ], 'page-type-svg');
  }
  return svgIcon('0 0 18 18', [
    svgLine(5, 13, 13, 5),
    svgLine(9, 5, 13, 5),
    svgLine(13, 5, 13, 9)
  ], 'page-type-svg');
}

export function pageTypeLabel(page, navKind = 'page') {
  if (navKind === 'table') return '数据表';
  if (navKind === 'link') return '链接';
  if (navKind === 'dashboard') return '看板';
  if (navKind === 'markdown') return 'Markdown 文件';
  if (navKind === 'webpage') return '网页';
  return '页面';
}

export function renderMobileSidebar(app, page) {
  const drawerHead = h('div', { class: 'mobile-drawer-head' }, [
    h('span', { class: 'mobile-drawer-title', text: '数据与页面' }),
    h('button', { class: 'ghost', text: '✕', onclick: () => { state.mobileDrawerOpen = false; renderRuntime(); } })
  ]);
  const pageList = h('div', { class: 'mobile-drawer-list' }, app.ui.pages.map((item) => {
    const navKind = pageNavKind(app, item);
    return h('button', {
      class: `mobile-drawer-item ${item.id === page?.id ? 'active' : ''}`,
      onclick: async () => {
        if (navKind === 'link' && item.url) { if (item.target !== '_self') { window.open(item.url, '_blank', 'noopener'); return; } state.currentPageId = item.id; state.currentViewId = ''; writeRoute(app.id, item.id, false, ''); state.mobileDrawerOpen = false; renderRuntime(); return; }
        state.currentPageId = item.id;
        await loadCurrentPageRecords();
        if (item.entity) {
          const nextEntity = entityFor(item);
          const views = getViews(nextEntity);
          state.currentViewId = views[0]?.id || '';
        } else {
          state.currentViewId = '';
        }
        writeRoute(app.id, item.id, false, state.currentViewId);
        state.mobileDrawerOpen = false;
        renderRuntime();
      }
    }, [
      h('span', { class: 'mobile-drawer-item-icon' }, [pageTypeIcon(navKind)]),
      h('span', { text: item.title })
    ]);
  }));
  return [
    drawerHead,
    pageList,
    h('div', { class: 'mobile-drawer-actions' }, [
      h('button', { class: 'secondary', text: '+ 新建表', onclick: () => { state.mobileDrawerOpen = false; openCreateTableModal(); } }),
      h('button', { class: 'secondary', text: '+ 新增视图', onclick: () => { state.mobileDrawerOpen = false; openCreatePageModal(page); } }),
      h('button', { class: 'secondary', text: '+ 新建文档', onclick: () => { state.mobileDrawerOpen = false; openAddMarkdownFile(); } }),
      h('button', { class: 'secondary', text: '+ 新建看板', onclick: () => { state.mobileDrawerOpen = false; openCreateDashboardModal(); } }),
      h('button', { class: 'secondary', text: '+ 新建网页', onclick: () => { state.mobileDrawerOpen = false; openAddHtmlPage(); } }),
      h('button', { class: 'secondary', text: '+ 新增链接', onclick: () => { state.mobileDrawerOpen = false; openCreateLinkModal(); } })
    ])
  ];
}

let sidebarCreatePopover = null;

function closeSidebarCreateMenu() {
  if (!sidebarCreatePopover) return;
  sidebarCreatePopover.menu.remove();
  sidebarCreatePopover.trigger.setAttribute('aria-expanded', 'false');
  sidebarCreatePopover.controller.abort();
  sidebarCreatePopover = null;
}

function openSidebarCreateMenu(event, page) {
  event.stopPropagation();
  const trigger = event.currentTarget;
  if (sidebarCreatePopover?.trigger === trigger) {
    closeSidebarCreateMenu();
    return;
  }
  closeSidebarCreateMenu();

  const controller = new AbortController();
  const run = (action) => {
    closeSidebarCreateMenu();
    action();
  };
  const item = (label, kind, action) => h('button', {
    class: 'ghost-menu sidebar-create-action',
    onclick: () => run(action)
  }, [
    h('span', { class: `button-icon ${kind}-icon` }, [pageTypeIcon(kind)]),
    h('span', { text: label })
  ]);
  const menu = h('div', { class: 'sidebar-create-dropdown', role: 'menu' }, [
    item('新建表', 'table', openCreateTableModal),
    item('新增视图', 'page', () => openCreatePageModal(page)),
    item('新建看板', 'dashboard', openCreateDashboardModal),
    item('新建文档', 'markdown', openAddMarkdownFile),
    item('新建网页', 'webpage', openAddHtmlPage),
    item('新增链接', 'link', openCreateLinkModal)
  ]);
  document.body.append(menu);

  const rect = trigger.getBoundingClientRect();
  const top = Math.min(rect.top, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${rect.right + 6}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  trigger.setAttribute('aria-expanded', 'true');
  sidebarCreatePopover = { menu, trigger, controller };

  document.addEventListener('pointerdown', (pointerEvent) => {
    if (!menu.contains(pointerEvent.target) && pointerEvent.target !== trigger) closeSidebarCreateMenu();
  }, { signal: controller.signal });
  document.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Escape') closeSidebarCreateMenu();
  }, { signal: controller.signal });
  window.addEventListener('resize', closeSidebarCreateMenu, { signal: controller.signal });
  window.addEventListener('scroll', closeSidebarCreateMenu, { capture: true, signal: controller.signal });
}

export function renderSidebarContent(app, page) {
  const toggle = h('button', {
    class: 'sidebar-toggle ghost icon-button',
    title: state.sidebarCollapsed ? '展开页面列表' : '折叠页面列表',
    'aria-label': state.sidebarCollapsed ? '展开页面列表' : '折叠页面列表',
    onclick: toggleSidebarCollapsed
  }, [svgIcon('0 0 18 18', [svgPath(state.sidebarCollapsed ? 'm7 4 5 5-5 5' : 'm11 4-5 5 5 5')], 'sidebar-toggle-icon')]);
  const footer = h('div', { class: 'sidebar-footer' }, [toggle]);
  if (state.sidebarCollapsed) {
    return [
      h('div', { class: 'page-list collapsed-page-list' }, app.ui.pages.map((item) => renderPageNavItem(app, page, item))),
      footer
    ];
  }
  const createMenu = h('button', {
    class: 'sidebar-create-trigger',
    title: '新建',
    'aria-label': '打开新建菜单',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    text: '+',
    onclick: (event) => openSidebarCreateMenu(event, page)
  });
  return [
    h('div', { class: 'sidebar-head' }, [
      h('div', { class: 'sidebar-label', text: '数据与页面' }),
      createMenu
    ]),
    h('div', { class: 'page-list' }, app.ui.pages.map((item) => renderPageNavItem(app, page, item))),
    footer
  ];
}

export function renderPageNavItem(app, activePage, item) {
  const entity = item.entity ? app.schema.entities.find((candidate) => candidate.id === item.entity) : null;
  const navKind = pageNavKind(app, item);
  const isTablePage = navKind === 'table';
  const btn = h('button', {
    class: 'page-menu ghost', title: '页面操作', text: '⋮',
    onclick: (event) => {
      event.stopPropagation();
      closePageMenus();
      const trigger = event.currentTarget;
      const rect = trigger.getBoundingClientRect();
      const run = (action) => {
        closePageMenus();
        action();
      };
      const popover = h('div', { class: 'page-menu-popover fixed-menu' }, [
        h('button', {
          class: 'ghost-menu', text: '重命名',
          onclick: () => run(() => renamePage(item))
        }),
        navKind !== 'link' ? h('button', {
          class: 'ghost-menu', text: '删除页面',
          onclick: () => run(() => deletePage(item))
        }) : h('button', {
          class: 'ghost-menu', text: '删除链接',
          onclick: () => run(() => deletePage(item))
        }),
        navKind === 'link' ? h('button', {
          class: 'ghost-menu', text: item.target === '_self' ? '切换：新页面打开' : '切换：当前页面打开',
          onclick: () => run(() => toggleLinkTarget(item))
        }) : null,
        isTablePage && entity ? h('button', {
          class: 'ghost-menu', text: '清除数据',
          onclick: () => run(() => clearTableData(entity))
        }) : null,
        isTablePage && entity ? h('button', {
          class: 'ghost-menu danger', text: '删除表',
          onclick: () => run(() => deleteTableAndData(entity))
        }) : null
      ].filter(Boolean));
      const popLeft = rect.right + 4;
      const popRight = window.innerWidth - popLeft - 160;
      popover.style.left = popRight > -10 ? `${popLeft}px` : `${window.innerWidth - 164}px`;
      popover.style.top = `${Math.min(rect.top, window.innerHeight - 200)}px`;
      document.body.append(popover);
      const controller = new AbortController();
      pageMenuController = controller;
      document.addEventListener('pointerdown', (pointerEvent) => {
        if (!popover.contains(pointerEvent.target) && pointerEvent.target !== trigger) closePageMenus();
      }, { signal: controller.signal });
      document.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Escape') closePageMenus();
      }, { signal: controller.signal });
      window.addEventListener('resize', closePageMenus, { signal: controller.signal });
      window.addEventListener('scroll', closePageMenus, { capture: true, signal: controller.signal });
    }
  });
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
        if (navKind === 'link' && item.url) {
          if (item.target !== '_self') { window.open(item.url, '_blank', 'noopener'); return; }
          state.currentPageId = item.id;
          state.currentViewId = '';
          writeRoute(app.id, item.id, false, '');
          renderRuntime();
          return;
        }
        state.currentPageId = item.id;
        await loadCurrentPageRecords();
        if (item.entity) {
          const nextEntity = entityFor(item);
          const views = getViews(nextEntity);
          state.currentViewId = views[0]?.id || '';
        } else {
          state.currentViewId = '';
        }
        writeRoute(app.id, item.id, false, state.currentViewId);
        renderRuntime();
      }
    }),
    btn
  ]);
  return row;
}

let pageMenuController = null;

function closePageMenus() {
  document.querySelectorAll('.page-menu-popover.fixed-menu').forEach((el) => el.remove());
  pageMenuController?.abort();
  pageMenuController = null;
}

export function closeAllMenus() {
  closePageMenus();
  document.querySelectorAll('.context-menu, .mobile-card-menu').forEach((el) => el.remove());
}

function toggleLinkTarget(item) {
  const next = item.target === '_self' ? '_blank' : '_self';
  saveCurrentPackage((pkg) => {
    const target = pkg.ui.pages.find((p) => p.id === item.id);
    if (target) target.target = next;
  }).then(() => {
    item.target = next;
    renderRuntime();
    toast(next === '_self' ? '已切换为当前页面打开' : '已切换为新页面打开');
  }).catch((err) => toast(err.message));
}

export async function reorderPage(draggedId, targetId, position = 'before') {
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

export function renamePage(page) {
  const input = h('input', { value: page.title || '', placeholder: '页面名称' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '重命名页面' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '页面名称' }), input]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '保存',
          onclick: async () => {
            const title = input.value.trim();
            if (!title) return toast('页面名称不能为空。');
            try {
              await saveCurrentPackage((pkg) => {
                const target = pkg.ui.pages.find((p) => p.id === page.id);
                if (target) target.title = title;
              });
              page.title = title;
              backdrop.remove();
              renderRuntime();
              toast('页面已重命名');
            } catch (error) {
              toast(error.message);
            }
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
  setTimeout(() => input.focus(), 0);
}

export function deletePage(page) {
  const app = state.currentApp;
  const pages = app.ui.pages || [];
  if (pages.length <= 1) return toast('至少保留一个页面。');
  const remainingPages = pages.filter((item) => item.id !== page.id);
  if (!remainingPages.some((item) => pageNavKind(app, item) !== 'link')) return toast('至少保留一个数据页面。');
  if (pageNavKind(app, page) !== 'link' && page.entity && !remainingPages.some((item) => pageNavKind(app, item) !== 'link' && item.entity === page.entity)) {
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

export function deleteTableAndData(entity) {
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

export function clearTableData(entity) {
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

export function showDeleteTableBlocked(error, entity, title = '不能删除表', footer = `请先清理这些关联记录，再删除「${entity.name}」表。`) {
  const references = error.details?.references || [];
  if (!references.length) return toast(error.message);
  const detail = references.map((reference) =>
    `「${reference.sourceEntityName}.${reference.fieldLabel}」已有 ${reference.count} 条记录引用「${entity.name}」的数据`
  ).join('\n');
  openTextModal(title, `${error.message}\n\n${detail}\n\n${footer}`);
}

export function buildBlankPage(title, navKind = 'page') {
  return {
    id: uniquePageId(title, navKind),
    title,
    type: 'page',
    navKind,
    cards: []
  };
}

export function buildMarkdownPage(fileName, content = '') {
  const normalizedName = fileName.trim() || '未命名文档';
  return {
    id: uniquePageId(normalizedName, 'markdown'),
    title: normalizedName,
    type: 'page',
    navKind: 'markdown',
    fileName: normalizedName,
    content
  };
}

export function buildHtmlPage(title, content = '') {
  const normalizedTitle = title.trim() || '未命名网页';
  return {
    id: uniquePageId(normalizedTitle, 'webpage'),
    title: normalizedTitle,
    type: 'page',
    navKind: 'webpage',
    content: content || `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${normalizedTitle}</title>
  <style>
    body { margin: 0; padding: 40px; font-family: system-ui, sans-serif; color: #202938; }
  </style>
</head>
<body>
  <main>
    <h1>${normalizedTitle}</h1>
    <p>切换到编辑模式开始编写网页，或打开 AI 助理描述你想要的页面。</p>
  </main>
</body>
</html>`
  };
}

export async function openAddMarkdownFile() {
  const page = buildMarkdownPage('未命名文档');
  try {
    await saveCurrentPackage((pkg) => { pkg.ui.pages.push(page); });
    state.currentPageId = page.id;
    state.currentViewId = '';
    writeRoute(state.currentApp.id, page.id, false, '');
    renderRuntime();
    toast('Markdown 文件已创建');
  } catch (error) {
    toast(error.message);
  }
}

export async function openAddHtmlPage() {
  const page = buildHtmlPage('未命名网页');
  try {
    await saveCurrentPackage((pkg) => { pkg.ui.pages.push(page); });
    state.currentPageId = page.id;
    state.currentViewId = '';
    writeRoute(state.currentApp.id, page.id, false, '');
    renderRuntime();
    toast('网页已创建');
  } catch (error) {
    toast(error.message);
  }
}

export function buildPageForEntity({ entity, title, view }) {
  return {
    id: uniquePageId(title, entity.id),
    title,
    type: 'page',
    entity: entity.id,
    navKind: 'page',
    features: ['create', 'edit', 'delete', 'search', 'export'],
    views: [view || { id: 'default', name: '全部记录', type: 'list' }]
  };
}

export function openCreatePageModal(sourcePage = null) {
  const nameInput = h('input', { placeholder: '例如：任务管理' });
  const entities = state.currentApp?.schema?.entities || [];
  if (!entities.length) return toast('请先创建一张数据表。');
  const entitySelect = h('select', { required: true }, [
    h('option', { value: '', text: '— 请选择数据表 —' }),
    ...entities.map((e) => h('option', { value: e.id, text: e.name }))
  ]);

  const typeSelect = selectFromOptions([
    ['', '— 请选择视图 —'],
    ['list', '表格视图'],
    ['quadrant', '四象限视图'],
    ['gantt', '甘特视图']
  ], '');
  typeSelect.style.width = '100%';

  const configWrapper = h('div', { class: 'view-type-config', style: 'margin-top:8px' });
  let createButton = null;

  const renderConfig = () => {
    configWrapper.innerHTML = '';
    const entityId = entitySelect.value;
    const entity = entityId ? entities.find((e) => e.id === entityId) : null;
    const type = typeSelect.value;
    if (!entity) {
      if (createButton) createButton.disabled = true;
      return;
    }

    if (type === 'quadrant') {
      const fields = entity.fields.filter((f) => f.type === 'select' && (f.options || []).length >= 4);
      const fieldSelect = selectFromOptions(fields.map((f) => [f.id, f.label]), fields[0]?.id || '');
      fieldSelect.dataset.viewConfig = 'quadrantField';
      configWrapper.append(
        h('label', { class: 'field' }, [h('span', { text: '四象限字段' }), fieldSelect]),
        fields.length
          ? h('p', { class: 'muted field-hint', text: '创建时锁定该字段的前 4 个选项。' })
          : h('p', { class: 'field-error', text: '需要至少一个包含 4 个选项的单选字段。' })
      );
    }

    if (type === 'gantt') {
      const titleFields = entity.fields.filter((f) => f.type !== 'formula' || f.formula?.resultType === 'text');
      const dateFields = entity.fields.filter((f) => ['date', 'datetime'].includes(f.type) || (f.type === 'formula' && f.formula?.resultType === 'date'));
      const progressFields = entity.fields
        .filter((f) => f.type === 'number' || (f.type === 'formula' && f.formula?.resultType === 'number'))
        .sort((a, b) => Number(b.format === 'percent' || /进度|progress/i.test(`${b.label} ${b.id}`)) - Number(a.format === 'percent' || /进度|progress/i.test(`${a.label} ${a.id}`)));
      const title = selectFromOptions(titleFields.map((f) => [f.id, f.label]), titleFields[0]?.id || '');
      const start = selectFromOptions(dateFields.map((f) => [f.id, f.label]), dateFields[0]?.id || '');
      const end = selectFromOptions(dateFields.map((f) => [f.id, f.label]), dateFields[1]?.id || dateFields[0]?.id || '');
      const progress = selectFromOptions([['', '自动识别或按日期计算'], ...progressFields.map((f) => [f.id, f.label])], '');
      title.dataset.viewConfig = 'titleField'; start.dataset.viewConfig = 'startField'; end.dataset.viewConfig = 'endField'; progress.dataset.viewConfig = 'progressField';
      configWrapper.append(...[
          h('label', { class: 'field' }, [h('span', { text: '标题字段' }), title]),
          h('label', { class: 'field' }, [h('span', { text: '开始日期' }), start]),
          h('label', { class: 'field' }, [h('span', { text: '结束日期' }), end]),
          h('label', { class: 'field' }, [h('span', { text: '进度字段（可选）' }), progress]),
          dateFields.length >= 2 ? null : h('p', { class: 'field-error', text: '甘特视图需要至少两个日期或日期时间字段。' })
        ].filter(Boolean));
    }

    if (createButton) {
      const invalidQuadrant = type === 'quadrant' && !configWrapper.querySelector('[data-view-config="quadrantField"]')?.value;
      const invalidGantt = type === 'gantt' && (dateFieldsInvalid());
      createButton.disabled = !entityId || !type || invalidQuadrant || invalidGantt;
    }
  };

  function dateFieldsInvalid() {
    const start = configWrapper.querySelector('[data-view-config="startField"]')?.value;
    const end = configWrapper.querySelector('[data-view-config="endField"]')?.value;
    return !start || !end || start === end;
  }

  const onChange = () => { renderConfig(); };
  entitySelect.addEventListener('change', onChange);
  typeSelect.addEventListener('change', onChange);

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新增视图' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '视图名称' }), nameInput]),
      h('div', { class: 'field' }, [h('label', { text: '数据表' }), entitySelect]),
      h('div', { class: 'field' }, [h('label', { text: '视图类型' }), typeSelect, configWrapper]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        createButton = h('button', {
          text: '创建',
          onclick: async () => {
            const title = nameInput.value.trim() || (entitySelect.value ? entities.find((e) => e.id === entitySelect.value)?.name || '页面' : '页面');
            const entityId = entitySelect.value;
            if (!entityId) return toast('请选择一个数据表。');
            const entity = entities.find((e) => e.id === entityId);
            const type = typeSelect.value;
            if (!type) return toast('请选择一个视图。');
            const view = { id: 'default', name: '全部记录', type };
            if (type === 'quadrant') {
              const field = entity.fields.find((f) => f.id === configWrapper.querySelector('[data-view-config="quadrantField"]')?.value);
              if (!field || (field.options || []).length < 4) return toast('请选择至少包含 4 个选项的单选字段。');
              view.quadrant = { fieldId: field.id, optionIds: field.options.slice(0, 4).map((opt) => optionObject(opt).id) };
            }
            if (type === 'gantt') {
              const titleField = configWrapper.querySelector('[data-view-config="titleField"]')?.value;
              const startField = configWrapper.querySelector('[data-view-config="startField"]')?.value;
              const endField = configWrapper.querySelector('[data-view-config="endField"]')?.value;
              const progressField = configWrapper.querySelector('[data-view-config="progressField"]')?.value || '';
              if (!titleField || !startField || !endField || startField === endField) return toast('请选择标题字段以及两个不同的日期字段。');
              view.gantt = { titleField, startField, endField, progressField };
            }
            const page = buildPageForEntity({ entity, title, view });
            try {
              await saveCurrentPackage((pkg) => {
                pkg.ui.pages.push(page);
              });
              state.currentPageId = page.id;
              state.currentViewId = 'default';
              await loadCurrentPageRecords();
              writeRoute(state.currentApp.id, state.currentPageId, false, 'default');
              backdrop.remove();
              renderRuntime();
              toast('视图已新增');
            } catch (error) {
              toast(error.message);
            }
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
  // Initial render after DOM append so config fields exist
  requestAnimationFrame(renderConfig);
}

export function openCreateDashboardModal() {
  const nameInput = h('input', { placeholder: '例如：经营看板' });
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新建看板' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '看板名称' }), nameInput]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '创建',
          onclick: async () => {
            const title = nameInput.value.trim() || '看板';
            const page = buildBlankPage(title, 'dashboard');
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
              toast('看板已创建');
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

export function openCreateTableModal() {
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

export function openCreateLinkModal() {
  const titleInput = h('input', { placeholder: '例如：帮助文档' });
  const urlInput = h('input', { placeholder: 'https://...' });
  const openInSelect = h('select', { style: 'width:100%' }, [
    h('option', { value: '_blank', text: '新页面（默认）' }),
    h('option', { value: '_self', text: '当前页面' })
  ]);
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新增链接' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '链接名称' }), titleInput]),
      h('div', { class: 'field' }, [h('label', { text: '链接地址' }), urlInput]),
      h('div', { class: 'field' }, [h('label', { text: '打开位置' }), openInSelect]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '创建',
          onclick: async () => {
            const title = titleInput.value.trim();
            const url = urlInput.value.trim();
            if (!title) return toast('请输入链接名称。');
            if (!url) return toast('请输入链接地址。');
            const fullUrl = url.match(/^https?:\/\//i) ? url : `https://${url}`;
            const linkPage = {
              id: uniquePageId(title, 'link'),
              title,
              url: fullUrl,
              target: openInSelect.value,
              navKind: 'link'
            };
            try {
              await saveCurrentPackage((pkg) => {
                pkg.ui.pages.push(linkPage);
              });
              backdrop.remove();
              renderRuntime();
              toast('链接已创建');
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
