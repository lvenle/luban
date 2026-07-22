import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { getClientRuntimeSettings } from '../common/runtime-settings-store.js';
import { loadApps } from '../app-home/home-actions.js';
import { renderAiPanel } from './settings/AiSettingsPanel.js';
import { renderAuthPanel } from './settings/AuthSettingsPanel.js';
import { renderRuntimePanel } from './settings/RuntimeSettingsPanel.js';
import { createSampleImporter } from './settings/SampleImportPanel.js';
import { renderAllRunsPanel, renderRulesPanel } from './settings/RuleSettingsPanels.js';

export async function openSettingsModal(appId = '', initialTab = 'rules') {
  const [settings, rulesBody, runsBody, appBody, samplesBody] = await Promise.all([
    appId ? Promise.resolve({ ai: {} }) : api('/api/settings'),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rules`) : Promise.resolve({ rules: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}/rule-runs?limit=${getClientRuntimeSettings().ruleRunListLimit}`) : Promise.resolve({ runs: [] }),
    appId ? api(`/api/apps/${encodeURIComponent(appId)}`) : Promise.resolve({ app: null }),
    appId ? Promise.resolve({ samples: [] }) : api('/api/samples')
  ]);
  let activeTab = appId ? (initialTab === 'runs' ? 'runs' : 'rules') : (['samples', 'runtime', 'auth'].includes(initialTab) ? initialTab : 'ai');
  let samplesImported = false;
  const content = h('div', { class: 'settings-modal-content' });
  const tabs = h('div', { class: 'settings-tabs' });
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = async () => {
    backdrop.remove();
    if (samplesImported) await loadApps();
  };
  const sampleImporter = createSampleImporter(samplesBody.samples || [], () => { samplesImported = true; });
  const render = () => {
    tabs.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.tab === activeTab));
    if (activeTab === 'rules') renderRulesPanel(content, appId, appBody.app, rulesBody.rules || []);
    else if (activeTab === 'runs') renderAllRunsPanel(content, rulesBody.rules || [], runsBody.runs || [], appBody.app);
    else if (activeTab === 'samples') sampleImporter.render(content);
    else if (activeTab === 'runtime') content.replaceChildren(renderRuntimePanel(settings.runtime || {}, settings.runtimeSchema || [], (next) => { settings.runtime = next; }));
    else if (activeTab === 'auth') content.replaceChildren(renderAuthPanel(settings.auth || {}, (next) => { settings.auth = next; }));
    else content.replaceChildren(renderAiPanel(settings.ai || {}, backdrop));
  };
  const tab = (id, text) => h('button', { class: 'settings-tab', text, 'data-tab': id, onclick: () => { activeTab = id; render(); } });
  if (appId) {
    tabs.append(tab('rules', `业务规则 ${rulesBody.rules?.length ? `(${rulesBody.rules.length})` : ''}`));
    tabs.append(tab('runs', `执行记录 ${runsBody.runs?.length ? `(${runsBody.runs.length})` : ''}`));
  } else {
    tabs.append(tab('ai', 'AI 设置'));
    tabs.append(tab('auth', '账号安全'));
    tabs.append(tab('runtime', '运行参数'));
    tabs.append(tab('samples', `样例导入 (${samplesBody.samples?.length || 0})`));
  }
  backdrop.append(h('div', { class: 'modal app-settings-modal' }, [
    h('div', { class: 'toolbar app-settings-head' }, [h('h3', { text: appId ? '应用设置' : '系统设置' }), h('button', { class: 'ghost', text: '关闭', onclick: close })]),
    tabs,
    content
  ]));
  document.body.append(backdrop);
  render();
}
