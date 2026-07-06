import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, root, topbar } from '../app-context.js';
import { setAssistantMode, renderAssistantDrawer, removeAssistantDrawer } from '../ai-assistant/index.js';
import { appCard, appCategories, appCategory } from './AppCard.js';
import { openImportModal } from './ImportModal.js';
import { configureHomeActions } from './home-actions.js';

configureHomeActions({ loadApps, openApp: (appId) => import('../app-runtime/index.js').then((runtime) => runtime.openApp(appId)) });

export function renderHome() {
  setAssistantMode({ mode: 'create' });
  root.innerHTML = '';
  const categories = appCategories();
  if (!categories.includes(state.appCategory)) state.appCategory = '全部';
  const categoryApps = state.appCategory === '全部' ? state.apps : state.apps.filter((app) => appCategory(app) === state.appCategory);
  const matchesSearch = (app, value = state.appSearch) => {
    const keyword = value.trim().toLowerCase();
    if (!keyword) return true;
    return `${app.name || ''} ${app.description || ''} ${appCategory(app)} ${(app.manifest?.tags || []).join(' ')}`.toLowerCase().includes(keyword);
  };
  const cardElements = categoryApps.map((app) => {
    const card = appCard(app);
    card.hidden = !matchesSearch(app);
    return card;
  });
  const cards = h('div', { class: 'grid' }, cardElements);
  const emptyResults = h('div', { class: 'home-empty-results', text: '没有找到匹配的软件。' });
  emptyResults.hidden = cardElements.some((card) => !card.hidden);
  const searchInput = h('input', {
    class: 'app-search-input',
    type: 'search',
    value: state.appSearch,
    placeholder: '搜索软件…',
    'aria-label': '搜索软件',
    oninput: (event) => {
      const value = event.currentTarget.value;
      state.appSearch = value;
      let visibleCount = 0;
      cardElements.forEach((card, index) => {
        const visible = matchesSearch(categoryApps[index], value);
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      emptyResults.hidden = visibleCount > 0;
    }
  });
  root.append(
    h('div', { class: 'shell' }, [
      topbar(),
      h('main', { class: 'container' }, [
        h('section', { class: 'hero' }, [
          h('h1', { text: '鲁班AI 原生软件创作平台' }),
          h('p', { text: '用自然语言创建、运行和持续改造属于你的业务软件。' }),
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
        h('div', { class: 'section-heading home-section-heading' }, [
          h('h2', { class: 'section-title', text: '我的软件' }),
          h('div', { class: 'home-list-controls' }, [
            searchInput,
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
          ])
        ]),
        cards,
        emptyResults
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
