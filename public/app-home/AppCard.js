import { h } from '../common/dom.js';
import { bindFloatingMenu, openConfirmDialog } from '../common/modal.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';
import { appCategory as resolveAppCategory } from '../common/app-metadata.js';
import { startInlineRename } from '../common/inline-rename.js';
import { loadApps, openApp } from './home-actions.js';

export function appCard(app) {
  const title = h('h3', { text: app.name });
  const categoryPill = h('span', { class: 'category-pill', text: appCategory(app) });
  const menu = bindFloatingMenu(h('details', {
    class: 'card-menu',
    onclick: (event) => event.stopPropagation(),
    ondblclick: (event) => event.stopPropagation()
  }, [
    h('summary', { title: '更多操作' }, '⋮'),
      h('div', { class: 'card-menu-popover' }, [
      h('button', {
        class: 'ghost-menu',
        text: '重命名',
        onclick: (event) => {
          event.stopPropagation();
          menu.open = false;
          startInlineRename(title, {
            value: app.name,
            className: 'app-card-name-input',
            emptyMessage: '软件名称不能为空。',
            onSave: async (name) => {
              await api(`/api/apps/${app.id}`, {
                method: 'PUT',
                body: JSON.stringify({ name, expectedUpdatedAt: app.updatedAt })
              });
              await loadApps();
              toast('软件已重命名');
            }
          });
        }
      }),
      h('button', {
        class: 'ghost-menu',
        text: '修改分类',
        onclick: (event) => {
          event.stopPropagation();
          menu.open = false;
          startCategoryInlineEdit(categoryPill, app);
        }
      }),
      h('a', { href: `/api/apps/${app.id}/export`, download: `${app.slug}.sgpkg` }, '导出 .sgpkg'),
      h('button', {
        class: 'ghost-menu',
        text: app.enabled === false ? '启用' : '禁用',
        onclick: async (event) => {
          event.stopPropagation();
          await api(`/api/apps/${app.id}`, {
            method: 'PUT',
            body: JSON.stringify({ enabled: app.enabled === false, expectedUpdatedAt: app.updatedAt })
          });
          await loadApps();
          toast(app.enabled === false ? '软件已启用' : '软件已禁用');
        }
      }),
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
  let openTimer = null;
  const card = h('article', {
    class: `card app-card clickable-card ${app.enabled === false ? 'is-disabled' : ''}`,
    tabindex: '0',
    draggable: 'true',
    'data-app-id': app.id,
    onclick: () => {
      if (Date.now() < suppressCardOpenUntil) return;
      if (openTimer) clearTimeout(openTimer);
      openTimer = setTimeout(() => {
        if (app.enabled === false) return toast('该软件已禁用，请先启用后再打开。');
        openAppFromCard(app.id);
      }, 220);
    },
    ondblclick: (event) => {
      event.preventDefault();
      if (openTimer) clearTimeout(openTimer);
      if (event.target === categoryPill) startCategoryInlineEdit(categoryPill, app);
    },
    ondragstart: (event) => {
      if (openTimer) clearTimeout(openTimer);
      state.appDragId = app.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', app.id);
      card.classList.add('is-dragging');
    },
    ondragover: (event) => {
      const source = state.apps.find((item) => item.id === state.appDragId);
      if (!source || source.id === app.id || source.enabled !== app.enabled) return;
      event.preventDefault();
      card.classList.add('drag-target');
      event.dataTransfer.dropEffect = 'move';
    },
    ondragleave: () => card.classList.remove('drag-target'),
    ondrop: async (event) => {
      event.preventDefault();
      card.classList.remove('drag-target');
      const draggedId = event.dataTransfer.getData('text/plain') || state.appDragId;
      const source = state.apps.find((item) => item.id === draggedId);
      if (!source || source.id === app.id) return;
      if (source.enabled !== app.enabled) return toast('启用和禁用的软件不能跨区域排序。');
      const sourceIndex = state.apps.findIndex((item) => item.id === source.id);
      const targetIndex = state.apps.findIndex((item) => item.id === app.id);
      await api('/api/apps/order', {
        method: 'PUT',
        body: JSON.stringify({ appId: source.id, targetId: app.id, position: sourceIndex < targetIndex ? 'after' : 'before' })
      });
      suppressCardOpenUntil = Date.now() + 300;
      state.appDragId = '';
      await loadApps();
    },
    ondragend: () => {
      state.appDragId = '';
      card.classList.remove('is-dragging');
      document.querySelectorAll('.app-card.drag-target').forEach((item) => item.classList.remove('drag-target'));
    },
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (app.enabled === false) toast('该软件已禁用，请先启用后再打开。');
        else openAppFromCard(app.id);
      }
    }
  }, [
    h('div', { class: 'app-card-top' }, [
      h('div', { class: 'app-card-title' }, [
        title,
        categoryPill
      ]),
      menu
    ]),
    h('p', { class: 'muted app-card-description', text: app.description || '无描述' }),
    h('div', { class: 'app-card-footer' }, [
      h('span', { class: `app-status ${app.enabled === false ? 'disabled' : 'enabled'}`, text: app.enabled === false ? '已禁用' : '已启用' }),
      h('small', { class: 'muted', text: `更新于 ${new Date(app.updatedAt).toLocaleString()}` })
    ])
  ]);
  return card;
}

let suppressCardOpenUntil = 0;

function startCategoryInlineEdit(categoryPill, app) {
  const input = startInlineRename(categoryPill, {
    value: appCategory(app),
    className: 'app-card-category-input',
    emptyMessage: '分类不能为空。',
    onSave: async (category) => {
      await api(`/api/apps/${app.id}`, {
        method: 'PUT',
        body: JSON.stringify({ category, expectedUpdatedAt: app.updatedAt })
      });
      await loadApps();
      toast('分类已更新');
    }
  });
  input?.setAttribute('maxlength', '20');
}

async function openAppFromCard(appId) {
  await openApp(appId);
}

export function appCategories() {
  return ['全部', ...new Set(state.apps.map(appCategory))];
}

export function appCategory(app) {
  return resolveAppCategory(app);
}
