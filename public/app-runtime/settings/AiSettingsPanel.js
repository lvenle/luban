import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';

export function renderAiPanel(ai, backdrop) {
  const baseUrl = h('input', { value: ai.baseUrl || 'https://api.openai.com/v1' });
  const apiKey = h('input', { value: '', type: 'password', placeholder: ai.hasApiKey ? '已配置，留空保持不变' : '输入 API Key' });
  const model = h('input', { value: ai.model || 'gpt-4.1-mini' });
  const chatRuntime = h('select', {}, [
    h('option', { value: 'legacy', text: '经典 Runtime（默认）' }),
    h('option', { value: 'platform', text: '统一 Agent 底座（platform-chat）' })
  ]);
  chatRuntime.value = ai.chatRuntime === 'legacy' ? 'legacy' : 'platform';
  return h('div', {}, [
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { text: 'API Base URL' }), baseUrl]),
      h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey]),
      h('div', { class: 'field' }, [h('label', { text: 'Model' }), model]),
      h('div', { class: 'field' }, [
        h('label', { text: 'AI 对话 Runtime' }),
        chatRuntime,
        h('p', { class: 'field-hint', text: '统一底座会走 /api/ai/platform-chat，便于与旧入口对比验证。' })
      ])
    ]),
    h('div', { class: 'row settings-actions' }, [
      h('button', { text: '保存', onclick: async () => {
        const next = {
          baseUrl: baseUrl.value,
          model: model.value,
          chatRuntime: chatRuntime.value === 'platform' ? 'platform' : 'legacy'
        };
        if (apiKey.value) next.apiKey = apiKey.value;
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ai: next }) });
        backdrop.remove();
        toast('设置已保存');
      } })
    ])
  ]);
}
