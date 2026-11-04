import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function renderPlatformPanel(platform, backdrop) {
  const agents = platform.agents || [];
  const selected = agents.find(agent => agent.id === platform.applicationAssistantId);
  const connection = (platform.connections || []).find(item => item.id === (selected?.draft?.connectionId || platform.defaultConnectionId)) || {};
  const name = h('input', { value: connection.name || '默认模型' });
  const baseUrl = h('input', { value: connection.baseUrl || '' });
  const model = h('input', { value: connection.model || '' });
  const apiKey = h('input', { type: 'password', placeholder: connection.credentialConfigured ? '已配置，留空保持不变' : '输入 API Key' });
  const prompt = h('textarea', { rows: 14, value: selected?.draft?.system || '' });
  const saveButton = h('button', { text: '保存助手设置' });
  saveButton.onclick = async () => {
    saveButton.disabled = true;
    try {
      await api(platform.settingsEndpoint || '/api/settings/platform', { method: 'PUT', body: JSON.stringify({
        revision: platform.revision,
        ...(platform.modelsManaged?{}:{connection: {
          id: connection.id, name: name.value, provider: connection.provider || 'openai-compatible',
          baseUrl: baseUrl.value, model: model.value, apiKey: apiKey.value
        }}),
        agent: { id: selected.id, system: prompt.value }
      }) });
      toast('助手设置已保存');
      backdrop.remove();
    } catch (error) { toast(error.message); }
    finally { saveButton.disabled = false; }
  };
  return h('div', { class: 'platform-settings-panel' }, [
    h('p', { class: 'muted', text: platform.modelsManaged?'设置助手的工作要求，保存后用于新发起的任务。':'配置鲁班助手使用的模型和工作要求，保存后用于新发起的任务。' }),
    h('div', { class: 'field' }, [h('label', { text: '应用助手' }), h('strong', { text: selected?.name || '助手未就绪' })]),
    platform.modelsManaged?h('p',{class:'shared-model-note',text:'模型由企业底座统一管理，当前使用底座默认模型。'}):h('h4', { text: '模型连接' }),
    platform.modelsManaged?null:h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { text: '连接名称' }), name]),
      h('div', { class: 'field' }, [h('label', { text: '模型' }), model]),
      h('div', { class: 'field' }, [h('label', { text: 'Base URL' }), baseUrl]),
      h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey])
    ]),
    h('div', { class: 'field' }, [h('label', { text: '助手工作要求' }), prompt]),
    h('div', { class: 'row settings-actions' }, [saveButton])
  ]);
}
