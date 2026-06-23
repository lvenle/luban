import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, root, topbar } from '../app.js';
import { setAssistantMode, renderAssistantDrawer, removeAssistantDrawer } from '../ai-assistant/index.js';
import { appCard, appCategories, appCategory } from './AppCard.js';
import { openImportModal } from './ImportModal.js';

export function renderHome() {
  setAssistantMode({ mode: 'create' });
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
          h('h1', { text: '鲁班AI系统' }),
          h('p', { text: 'AI 原生软件自定义平台，用自然语言创建、运行和持续改造属于你的业务软件。' }),
          h('div', { class: 'hero-meta' }, [
            h('button', {
              text: 'AI助理创建软件',
              class: 'primary',
              onclick: () => {
                state.assistantOpen = !state.assistantOpen;
                renderHome();
              }
            }),
            h('button', { class: 'secondary', text: '导入 .sgpkg', onclick: openImportModal }),
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
  } else {
    removeAssistantDrawer();
  }
}

export async function loadApps() {
  const body = await api('/api/apps');
  state.apps = body.apps;
  renderHome();
}

export function goHome() {
  state.currentApp = null;
  state.currentPageId = null;
  state.currentViewId = '';
  state.records = [];
  state.inlineEditId = null;
  setAssistantMode({ mode: 'create' });
  window.history.pushState(null, '', '/');
  loadApps();
}

export async function createAppFromPrompt(prompt) {
  try {
    const body = await api('/api/apps/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
    const { openApp } = await import('../app-runtime/index.js');
    await openApp(body.appId);
    toast(`已创建 ${body.app?.name || '新软件'}`);
  } catch (error) {
    toast(error.message);
  }
}
