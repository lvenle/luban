import { h, svgIcon, svgPath, svgLine, buttonLabel } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog, openTextModal, bindFloatingMenu } from '../common/modal.js';
import { state, entityFor, recordsFor, storageKey, entityById, writeRoute, uniquePageId } from '../app.js';
import { toggleSidebarCollapsed } from './RuntimeFrame.js';
import { loadCurrentPageRecords, renderRuntime, saveCurrentPackage } from './index.js';
import { getViews } from './ViewBar.js';

export function clearPageDragStyles() {
  document.querySelectorAll('.page-nav-item').forEach((item) => {
    item.classList.remove('is-dragging', 'drop-before', 'drop-after');
    delete item.dataset.dropPosition;
  });
}

export function pageNavKind(app, page) {
  if (page?.navKind === 'table' || page?.source === 'table') return 'table';
  if (page?.navKind === 'link' || page?.source === 'link') return 'link';
  if (page?.navKind === 'page' || page?.source === 'page') return 'page';
  if (page?.type === 'list' && page.entity) {
    const entity = app.schema.entities.find((item) => item.id === page.entity);
    const firstEntityListPage = app.ui.pages.find((item) => item.type === 'list' && item.entity === page.entity);
    if (firstEntityListPage?.id === page.id) return 'table';
    if (page.id === `${page.entity}-list` || page.title === `${entity?.name || ''}列表`) return 'table';
  }
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
      svgPath('M7.25 6.1 6.1 7.25a3 3 0 0 0 4.24 4.24l1.15-1.15'),
      svgPath('M10.75 11.9 11.9 10.75a3 3 0 0 0-4.24-4.24L6.5 7.66'),
      svgLine(7.4, 10.6, 10.6, 7.4)
    ], 'page-type-svg');
  }
  return svgIcon('0 0 18 18', [
    svgPath('M4 2h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z'),
    svgPath('M10 2v4h4')
  ], 'page-type-svg');
}

export function pageTypeLabel(page, navKind = 'page') {
  if (navKind === 'table') return '数据表';
  if (navKind === 'link') return '链接';
  return '页面';
}

export function renderSidebarContent(app, page) {
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
    ]),
    h('button', { class: 'page-button create-link-button', onclick: openCreateLinkModal }, [
      h('span', { class: 'button-icon page-icon' }, [pageTypeIcon('link')]),
      h('span', { text: '+ 新增链接' })
    ])
  ];
}

export function renderPageNavItem(app, activePage, item) {
  const entity = item.entity ? app.schema.entities.find((candidate) => candidate.id === item.entity) : null;
  const navKind = pageNavKind(app, item);
  const menu = bindFloatingMenu(h('details', { class: 'page-menu', onclick: (event) => event.stopPropagation() }, [
    h('summary', { title: '页面操作' }, '⋮'),
    h('div', { class: 'page-menu-popover' }, [
      navKind === 'page' || navKind === 'link' ? h('button', {
        class: 'ghost-menu',
        text: navKind === 'link' ? '删除链接' : '删除页面',
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
        if (navKind === 'link' && item.url) {
          window.open(item.url, '_blank', 'noopener');
          return;
        }
        state.currentPageId = item.id;
        await loadCurrentPageRecords();
        const nextEntity = entityFor(item);
        const views = getViews(nextEntity);
        state.currentViewId = views[0]?.id || '';
        writeRoute(app.id, item.id, false, state.currentViewId);
        renderRuntime();
      }
    }),
    menu
  ]);
  return row;
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

export function deletePage(page) {
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

export function buildBlankPage(title) {
  return {
    id: uniquePageId(title, 'page'),
    title,
    type: 'blank',
    navKind: 'page',
    cards: []
  };
}

export function buildPageForEntity({ entity, title, type = 'list', navKind = 'page' }) {
  const page = {
    id: uniquePageId(title, entity.id),
    title,
    type,
    entity: entity.id,
    navKind
  };
  if (type === 'list') {
    page.features = ['create', 'edit', 'delete', 'search', 'export'];
    page.views = [{ id: 'default', name: '全部记录', type: 'list' }];
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

export function openCreatePageModal(sourcePage = null) {
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
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: '新增链接' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field' }, [h('label', { text: '链接名称' }), titleInput]),
      h('div', { class: 'field' }, [h('label', { text: '链接地址' }), urlInput]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '创建',
          onclick: async () => {
            const title = titleInput.value.trim();
            const url = urlInput.value.trim();
            if (!title) return toast('请输入链接名称。');
            if (!url) return toast('请输入链接地址。');
            const linkPage = {
              id: uniquePageId(title, 'link'),
              title,
              url,
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
