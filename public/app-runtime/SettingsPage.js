import { h } from '../common/dom.js';
import { applicationPath } from '../common/application-base.js';
import { builderUi, enterpriseUi, navigateWorkspace } from '../common/workspace.js';
import { state, root, topbar } from '../app-context.js';
import { removeAssistantDrawer } from '../ai-assistant/index.js';
import { createSettingsView } from './SettingsModal.js';

export { openSettingsPage } from '../common/workspace.js';

export async function renderSettingsPage(kind) {
  removeAssistantDrawer();
  const title = kind === 'system' ? '系统设置' : '助手设置';
  const mount = h('section', { class: 'settings-page-panel', 'aria-label': title });
  const main = h('main', { class: 'container settings-page' }, [
    h('div', { class: 'settings-page-heading' }, [
      h('div', {}, [h('h1', { text: title }), h('p', { class: 'muted', text: kind === 'system' ? '管理账号、运行参数和应用样例。' : enterpriseUi() ? '配置助手的工作要求，模型由底座统一管理。' : '配置助手的模型连接与工作要求。' })]),
      h('button', { class: 'secondary', text: '返回', onclick: () => {
        if (history.state?.settingsReturnTo) history.back();
        else navigateWorkspace(builderUi() ? '/builder/' : '/');
      } })
    ]), mount
  ]);
  const shell = h('div', { class: `shell settings-page-shell ${builderUi() ? 'builder-shell' : ''}` }, [topbar(), main]);
  if (builderUi()) shell.prepend((await import('../builder/workspace.js')).navigation());
  if (enterpriseUi() && kind === 'system' && !state.workspace?.admin) {
    mount.replaceChildren(h('p', { role: 'alert', text: '没有系统设置访问权限。' })); root.replaceChildren(shell); return;
  }
  const path = applicationPath();
  async function load(tab = new URLSearchParams(location.search).get('tab') || (kind === 'system' ? 'runtime' : 'platform')) {
    mount.setAttribute('aria-busy', 'true');
    try {
      const view = await createSettingsView('', tab, {
        scope: kind,
        onSaved: activeTab => load(activeTab),
        onTabChange: activeTab => {
          const url = new URL(location.href); url.searchParams.set('tab', activeTab);
          history.replaceState(history.state, '', url.pathname + url.search);
        }
      });
      if (applicationPath() !== path) return;
      mount.replaceChildren(view.tabs, view.content);
      if (!shell.isConnected) root.replaceChildren(shell);
    } catch (error) {
      if (applicationPath() !== path) return;
      if (!shell.isConnected) root.replaceChildren(shell);
      mount.replaceChildren(h('p', { role: 'alert', text: error.message }), h('button', { class: 'secondary', text: '重新加载', onclick: () => load(tab) }));
    } finally { mount.removeAttribute('aria-busy'); }
  }
  await load();
}
