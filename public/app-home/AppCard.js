import { h } from '../common/dom.js';
import { bindFloatingMenu, openConfirmDialog } from '../common/modal.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';
import { loadApps, openApp } from './home-actions.js';

export function appCard(app) {
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
  return h('article', { class: 'card app-card clickable-card', tabindex: '0', onclick: () => openAppFromCard(app.id), onkeydown: (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAppFromCard(app.id);
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

async function openAppFromCard(appId) {
  await openApp(appId);
}

export function appCategories() {
  return ['全部', ...new Set(state.apps.map(appCategory))];
}

export function appCategory(app) {
  if (app.manifest?.category) return app.manifest.category;
  const text = `${app.name || ''} ${(app.manifest?.tags || []).join(' ')} ${app.description || ''}`.toLowerCase();
  if (text.includes('crm') || text.includes('客户') || text.includes('线索')) return '客户';
  if (text.includes('finance') || text.includes('记账') || text.includes('预算') || text.includes('金额')) return '财务';
  if (text.includes('writing') || text.includes('文章') || text.includes('内容') || text.includes('脚本')) return '内容';
  if (text.includes('productivity') || text.includes('待办') || text.includes('任务') || text.includes('项目')) return '效率';
  if (text.includes('库存') || text.includes('资产') || text.includes('设备')) return '资产';
  return '通用';
}
