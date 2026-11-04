import { openCreationDialog } from './builder/creation.js';
import { decorateBuilder, releaseDialog } from './builder/workspace.js';
import { enterpriseUi, builderUi, navigateWorkspace } from './common/workspace.js';
import { appUrl, applicationPath } from './common/application-base.js';
import { api } from './common/api.js';
import { toast } from './common/toast.js';
import { closeFloatingMenus, setupModalAccessibility } from './common/modal.js';
import {
  state, root, configureAppShell, currentRoute, topbar
} from './app-context.js';
import { renderHome, loadApps, goHome } from './app-home/index.js';
import { setClientRuntimeSettings } from './common/runtime-settings-store.js';
import { writeStorage } from './common/storage.js';

export * from './app-context.js';

document.addEventListener('luban-runtime-rendered',decorateBuilder);
document.addEventListener('luban-release-requested',()=>{if(state.currentApp)releaseDialog(state.currentApp).catch(e=>toast(e.message));});
document.addEventListener('luban-creation-proposal',event=>openCreationDialog(event.detail));
document.addEventListener('luban-application-created',async event=>{
  state.assistantOpen=false;state.apps=(await api('/api/apps')).apps;
  await (await import('./app-runtime/index.js')).openApp(event.detail.appId);
});

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
  const auth = await api('/api/auth/status').catch(() => ({ required: false, authenticated: true }));
  state.auth = auth;
  if (auth.required && !auth.authenticated) {
    state.currentApp = null;
    state.currentPageId = null;
    state.currentViewId = '';
    const { renderLogin } = await import('./auth/LoginView.js');
    renderLogin(root, boot);
    return;
  }
  if(enterpriseUi()) {
    document.body.classList.add('enterprise-hosted');
    state.workspace=await api('/api/workspace');
    document.body.classList.toggle('enterprise-runtime',!builderUi());
    if(builderUi()&&!state.workspace.canBuild) {root.textContent='没有构建后台访问权限';return;}
  }
  if (applicationPath() === '/rules/ai-config' || applicationPath() === '/rules/ai-config/') {
    state.currentApp = null;
    state.currentPageId = null;
    state.currentViewId = '';
    (await import('./rules/ai-config.js')).renderAiRuleConfig(root);
    return;
  }
  if (applicationPath() === '/rules' || applicationPath() === '/rules/') {
    state.currentApp = null;
    (await import('./rules/pages.js')).renderRuleList(root);
    return;
  }
  const ruleDetailMatch = applicationPath().match(/^\/rules\/([^/]+)\/?$/);
  if (ruleDetailMatch) {
    state.currentApp = null;
    (await import('./rules/pages.js')).renderRuleDetail(root, decodeURIComponent(ruleDetailMatch[1]));
    return;
  }
  try {
    const settings = await api('/api/settings');
    state.runtimeSettings = setClientRuntimeSettings(settings.runtime || {});
    state.sidebarWidth = state.runtimeSettings.sidebarWidth;
    state.sidebarCollapsedWidth = state.runtimeSettings.sidebarCollapsedWidth;
  } catch {}
  state.apps = (await api('/api/apps')).apps;
  const settingsPage = applicationPath().match(/^\/(?:builder\/)?settings\/(assistant|system)\/?$/);
  if (settingsPage) {
    state.currentApp = null;
    state.currentPageId = null;
    state.currentViewId = '';
    state.records = [];
    await (await import('./app-runtime/SettingsPage.js')).renderSettingsPage(settingsPage[1]);
    return;
  }
  const route = currentRoute();
  if (route.appId) {
    try {
      await (await import('./app-runtime/index.js')).openApp(route.appId, { pageId: route.pageId, viewId: route.viewId, replace: true });
      return;
    } catch (error) {
      history.replaceState(null, '', appUrl('/'));
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
  if (/\/settings\/(assistant|system)\/?$/.test(applicationPath())) return;
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
let verifyingForegroundApp = false;
async function verifyForegroundApplication() {
  if (!enterpriseUi() || builderUi() || document.visibilityState === 'hidden' || !state.currentApp || verifyingForegroundApp) return;
  verifyingForegroundApp = true;
  const currentId = state.currentApp.id;
  try {
    const visibleApps = (await api('/api/apps')).apps;
    if (state.currentApp?.id !== currentId) return;
    state.apps = visibleApps;
    if (!visibleApps.some(app => app.id === currentId)) {
      state.currentApp = null; state.currentPageId = null; state.currentViewId = ''; state.records = [];
      navigateWorkspace('/');
      toast('此应用已禁用或暂不可用。');
    }
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      state.currentApp = null; state.currentPageId = null; state.currentViewId = ''; state.records = [];
      navigateWorkspace('/');
      toast('此应用已禁用或暂不可用。');
    }
  } finally { verifyingForegroundApp = false; }
}
window.addEventListener('focus', verifyForegroundApplication);
document.addEventListener('visibilitychange', verifyForegroundApplication);
window.addEventListener('popstate', () => boot().catch((error) => { root.textContent = error.message; }));
document.addEventListener('click', (event) => { if (!event.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
document.addEventListener('pointerdown', (event) => { if (event.target instanceof HTMLElement && event.target.classList.contains('modal-backdrop')) event.target.remove(); }, true);
document.addEventListener('focusin', (event) => { if (!event.target.closest?.('details.card-menu, details.view-menu, details.export-menu, details.page-menu')) closeFloatingMenus(); });
document.addEventListener('runtime-settings-updated', async (event) => {
  state.runtimeSettings = setClientRuntimeSettings(event.detail || {});
  state.sidebarWidth = state.runtimeSettings.sidebarWidth;
  state.sidebarCollapsedWidth = state.runtimeSettings.sidebarCollapsedWidth;
  if (/\/settings\/(assistant|system)\/?$/.test(applicationPath())) return;
  if (state.currentApp?.id) {
    writeStorage(`luban-ai:${state.currentApp.id}:sidebar-width`, state.sidebarWidth);
    writeStorage(`luban-ai:${state.currentApp.id}:sidebar-collapsed-width`, state.sidebarCollapsedWidth);
    const runtime = await import('./app-runtime/index.js');
    runtime.renderRuntime();
  } else {
    renderHome();
  }
});
document.addEventListener('auth-login-required', async () => {
  document.querySelectorAll('.modal-backdrop').forEach((item) => item.remove());
  state.auth = { required: true, authenticated: false };
  state.currentApp = null;
  state.currentPageId = null;
  state.currentViewId = '';
  const { renderLogin } = await import('./auth/LoginView.js');
  renderLogin(root, boot);
});
import('./app-runtime/CellSelection.js')
  .then(({ bindCellSelectionEvents }) => bindCellSelectionEvents())
  .then(() => boot())
  .catch((error) => { root.textContent = error.message; });
