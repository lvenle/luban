import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function renderPlatformPanel(platform, backdrop) {
  const agents = platform.agents || [];
  const selected = agents.find(agent => agent.id === platform.defaultAgentId) || agents[0];
  const select = h('select', {}, agents.map(agent => h('option', { value: agent.id, text: `${agent.name}（${agent.id}）`, selected: agent.id === selected?.id ? 'selected' : null })));
  const prompt = h('textarea', { rows: 14, value: selected?.draft?.system || '' });
  const save = async () => {
    const agent = agents.find(item => item.id === select.value);
    await api('/api/settings/platform', { method: 'PUT', body: JSON.stringify({
      defaultAgentId: select.value,
      agent: { id: agent.id, name: agent.name, description: agent.description, ...agent.draft, system: prompt.value }
    }) });
    toast('底座 Agent 设置已保存');
    backdrop.remove();
  };
  return h('div', { class: 'platform-settings-panel' }, [
    h('p', { class: 'muted', text: '这里配置的是 agent-platform 底座 Agent；鲁班会复用所选 Agent，并注入鲁班业务工具。' }),
    h('div', { class: 'field' }, [h('label', { text: '默认 Agent' }), select]),
    h('div', { class: 'field' }, [h('label', { text: 'Agent 系统提示词' }), prompt]),
    h('div', { class: 'row settings-actions' }, [h('button', { text: '保存到底座', onclick: save })])
  ]);
}
