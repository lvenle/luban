import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function renderPlatformPanel(platform, backdrop) {
  const agents = platform.agents || [];
  const selected = agents.find(agent => agent.id === platform.defaultAgentId) || agents[0];
  const connection = (platform.connections || []).find(item => item.id === platform.defaultConnectionId) || platform.connections?.[0] || {};
  const name = h('input', { value: connection.name || '默认模型' });
  const baseUrl = h('input', { value: connection.baseUrl || '' });
  const model = h('input', { value: connection.model || '' });
  const apiKey = h('input', { type: 'password', placeholder: connection.credentialConfigured ? '已配置，留空保持不变' : '输入 API Key' });
  const select = h('select', {}, agents.map(agent => h('option', { value: agent.id, text: `${agent.name}（${agent.id}）`, selected: agent.id === selected?.id ? 'selected' : null })));
  const prompt = h('textarea', { rows: 14, value: selected?.draft?.system || '' });
  const save = async () => {
    const agent = agents.find(item => item.id === select.value);
    await api('/api/settings/platform', { method: 'PUT', body: JSON.stringify({ connection: {
      id: connection.id, name: name.value, provider: connection.provider || 'openai-compatible', baseUrl: baseUrl.value, model: model.value, apiKey: apiKey.value, isDefault: true
    },
      defaultAgentId: select.value,
      agent: { id: agent.id, name: agent.name, description: agent.description, ...agent.draft, system: prompt.value }
    }) });
    toast('底座 Agent 设置已保存');
    backdrop.remove();
  };
  return h('div', { class: 'platform-settings-panel' }, [
    h('p', { class: 'muted', text: '鲁班使用独立的底座实例。模型、Agent、技能和知识库设置在此管理，不影响 AI工作台。' }),
    h('div', { class: 'row settings-actions' }, [h('button', { text: '打开底座设置页面', onclick: () => window.open(platform.consoleUrl, '_blank', 'noopener') })]),
    h('div', { class: 'field' }, [h('label', { text: '默认 Agent' }), select]),
    h('h4', { text: '模型连接（底座统一管理）' }),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { text: '连接名称' }), name]),
      h('div', { class: 'field' }, [h('label', { text: '模型' }), model]),
      h('div', { class: 'field' }, [h('label', { text: 'Base URL' }), baseUrl]),
      h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey])
    ]),
    h('div', { class: 'field' }, [h('label', { text: 'Agent 系统提示词' }), prompt]),
    h('div', { class: 'row settings-actions' }, [h('button', { text: '保存到底座', onclick: save })])
  ]);
}
