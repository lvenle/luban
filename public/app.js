import { api } from './common/api.js';
import { toast } from './common/toast.js';
import { closeFloatingMenus, setupModalAccessibility } from './common/modal.js';
import {
  state, root, configureAppShell, currentRoute, topbar
} from './app-context.js';
import { renderHome, loadApps, goHome } from './app-home/index.js';

export * from './app-context.js';

configureAppShell({
  goHome,
  renderHome,
  renderRuntime: () => import('./app-runtime/index.js').then((runtime) => runtime.renderRuntime()),
  saveCurrentPackage: (mutate) => import('./app-runtime/index.js').then((runtime) => runtime.saveCurrentPackage(mutate))
});

document.addEventListener('open-ai-rule-edit', async (event) => {
  if (!state.currentApp) return;
  state.assistantOpen = true;
  const runtime = await import('./app-runtime/index.js');
  runtime.renderRuntime();
  const assistant = await import('./ai-assistant/index.js');
  assistant.setAssistantDraft(event.detail?.text || '请修改这条业务规则');
});

const mobileMq = window.matchMedia('(max-width: 767px)');
mobileMq.addEventListener('change', (event) => {
  state.isMobile = event.matches;
  if (!state.isMobile) state.mobileDrawerOpen = false;
  if (state.currentApp) import('./app-runtime/index.js').then((runtime) => runtime.renderRuntime());
});

async function boot() {
  setupModalAccessibility();
  if (location.pathname === '/rules/ai-config' || location.pathname === '/rules/ai-config/') {
    state.currentApp = null;
    state.currentPageId = null;
    state.currentViewId = '';
    (await import('./rules/ai-config.js')).renderAiRuleConfig(root);
    return;
  }
  if (location.pathname === '/rules' || location.pathname === '/rules/') {
    state.currentApp = null;
    (await import('./rules/pages.js')).renderRuleList(root);
    return;
  }
  const ruleDetailMatch = location.pathname.match(/^\/rules\/([^/]+)\/?$/);
  if (ruleDetailMatch) {
    state.currentApp = null;
    (await import('./rules/pages.js')).renderRuleDetail(root, decodeURIComponent(ruleDetailMatch[1]));
    return;
  }
  state.apps = (await api('/api/apps')).apps;
  const route = currentRoute();
  if (route.appId) {
    try {
      await (await import('./app-runtime/index.js')).openApp(route.appId, { pageId: route.pageId, viewId: route.viewId, replace: true });
      return;
    } catch (error) {
      history.replaceState(null, '', '/');
      toast(error.message);
    }
  }
  state.currentApp = null;
  state.currentPageId = null;
  state.currentViewId = '';
  state.records = [];
  state.inlineEditId = null;
  renderHome();
}

import('./app-runtime/UndoRedo.js').then(({ setupUndoShortcuts }) => setupUndoShortcuts()).catch(() => {});

document.body.addEventListener('ai-message-end', async () => {
  if (!state.currentApp) {
    await loadApps();
    return;
  }
  try {
    state.currentApp = (await api(`/api/apps/${state.currentApp.id}`)).app;
    const runtime = await import('./app-runtime/index.js');
    if (state.currentPageId && state.currentApp.ui.pages.some((page) => page.id === state.currentPageId)) await runtime.loadCurrentPageRecords();
    runtime.renderRuntime();
  } catch {}
});
window.addEventListener('popstate', () => boot().catch((error) => { root.textContent = error.message; }));
document.addEventListener('click', (event) => { if (!event.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
document.addEventListener('pointerdown', (event) => { if (event.target instanceof HTMLElement && event.target.classList.contains('modal-backdrop')) event.target.remove(); }, true);
document.addEventListener('focusin', (event) => { if (!event.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
import('./app-runtime/CellSelection.js')
  .then(({ bindCellSelectionEvents }) => bindCellSelectionEvents())
  .then(() => boot())
  .catch((error) => { root.textContent = error.message; });
