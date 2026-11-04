import { enterpriseUi } from '../common/workspace.js';
import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { getClientRuntimeSettings } from '../common/runtime-settings-store.js';
import { loadApps } from '../app-home/home-actions.js';
import { renderAiPanel } from './settings/AiSettingsPanel.js';
import { renderAuthPanel } from './settings/AuthSettingsPanel.js';
import { renderRuntimePanel } from './settings/RuntimeSettingsPanel.js';
import { createSampleImporter } from './settings/SampleImportPanel.js';
import { renderAllRunsPanel, renderRulesPanel } from './settings/RuleSettingsPanels.js';
import { renderPlatformPanel } from './settings/PlatformSettingsPanel.js';

export async function createSettingsView(appId = '', initialTab = 'rules', { scope = 'all', onSaved = () => {}, onTabChange = () => {} } = {}) {
  const assistantOnly = scope === 'assistant';
  const systemOnly = scope === 'system';
  const [settings, rulesBody, runsBody, appBody, samplesBody, platform, business] = await Promise.all([
    appId || assistantOnly ? Promise.resolve({ ai: {} }) : api('/api/settings'),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rules`) : Promise.resolve({ rules: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rule-runs?limit=${getClientRuntimeSettings().ruleRunListLimit}`) : Promise.resolve({ runs: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}`) : Promise.resolve({ app: null }),
    appId || assistantOnly ? Promise.resolve({ samples: [] }) : api('/api/samples'),
    appId || systemOnly ? Promise.resolve({ agents: [] }) : api('/api/settings/platform'),
    !appId&&!systemOnly&&enterpriseUi()?api('/api/settings/business'):Promise.resolve(null)
  ]);
  const allowedTabs = appId ? ['rules', 'runs'] : assistantOnly ? (enterpriseUi() ? ['platform', 'business'] : ['platform']) : systemOnly ? (enterpriseUi() ? ['runtime', 'samples'] : ['auth', 'runtime', 'samples']) : ['samples', 'runtime', 'auth', 'platform', ...(enterpriseUi() ? ['business'] : [])];
  let activeTab = allowedTabs.includes(initialTab) ? initialTab : assistantOnly ? 'platform' : systemOnly ? 'runtime' : appId ? 'rules' : 'platform';
  let samplesImported = false;
  const content = h('div', { class: 'settings-modal-content' });
  const tabs = h('div', { class: 'settings-tabs' });
  const backdrop = { remove: () => onSaved(activeTab) };
  const close = async () => { if (samplesImported) await loadApps(); };
  const sampleImporter = createSampleImporter(samplesBody.samples || [], () => { samplesImported = true; });
  const render = () => {
    tabs.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
    if (activeTab === 'rules') renderRulesPanel(content, appId, appBody.app, rulesBody.rules || []);
    else if (activeTab === 'runs') renderAllRunsPanel(content, rulesBody.rules || [], runsBody.runs || [], appBody.app);
    else if (activeTab === 'samples') sampleImporter.render(content);
    else if (activeTab === 'runtime') content.replaceChildren(renderRuntimePanel(settings.runtime || {}, settings.runtimeSchema || [], (next) => { settings.runtime = next; }));
    else if (activeTab === 'auth') content.replaceChildren(renderAuthPanel(settings.auth || {}, (next) => { settings.auth = next; }));
    else if (activeTab === 'business') content.replaceChildren(renderPlatformPanel(business,backdrop));
    else if (activeTab === 'platform') content.replaceChildren(renderPlatformPanel(platform, backdrop));
    else content.replaceChildren(renderAiPanel(settings.ai || {}, backdrop));
  };
  const tab = (id, text) => h('button', { class: 'settings-tab', text, 'data-tab': id, onclick: () => { activeTab = id; render(); onTabChange(id); } });
  if (appId) {
    tabs.append(tab('rules', `业务规则 ${rulesBody.rules?.length ? `(${rulesBody.rules.length})` : ''}`));
    tabs.append(tab('runs', `执行记录 ${runsBody.runs?.length ? `(${runsBody.runs.length})` : ''}`));
  } else {
    if(!assistantOnly && !enterpriseUi()) tabs.append(tab('auth', '账号安全'));
    if(!assistantOnly) tabs.append(tab('runtime', '运行参数'));
    if(!assistantOnly) tabs.append(tab('samples', `样例导入 (${samplesBody.samples?.length || 0})`));
    if(!systemOnly) tabs.append(tab('platform', enterpriseUi()?'构建助手':'助手设置'));
    if(!systemOnly&&enterpriseUi())tabs.append(tab('business','业务助手'));
  }
  render();
  return { tabs, content, close };
}

// App-specific rules and run records keep their existing lightweight dialog.
export async function openSettingsModal(appId = '', initialTab = 'rules') {
  const backdrop = h('div', { class: 'modal-backdrop' });
  let view;
  const close = async () => { backdrop.remove(); await view?.close(); };
  view = await createSettingsView(appId, initialTab, { onSaved: close });
  backdrop.append(h('div', { class: 'modal app-settings-modal' }, [
    h('div', { class: 'toolbar app-settings-head' }, [h('h3', { text: appId ? '应用设置' : '系统设置' }), h('button', { class: 'ghost', text: '关闭', onclick: close })]),
    view.tabs, view.content
  ]));
  document.body.append(backdrop);
}
