import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';

export async function openSettingsModal() {
  const body = await api('/api/settings');
  const ai = body.ai || {};
  const baseUrl = h('input', { value: ai.baseUrl || 'https://api.openai.com/v1' });
  const apiKey = h('input', { value: '', type: 'password', placeholder: ai.hasApiKey ? '已配置，留空保持不变' : '输入 API Key' });
  const model = h('input', { value: ai.model || 'gpt-4.1-mini' });
  let clearApiKey = false;
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: 'AI 设置' }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('div', { class: 'form-grid' }, [
        h('div', { class: 'field' }, [h('label', { text: 'API Base URL' }), baseUrl]),
        h('div', { class: 'field' }, [h('label', { text: 'API Key' }), apiKey]),
        h('div', { class: 'field' }, [h('label', { text: 'Model' }), model])
      ]),
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: async () => {
            const next = { baseUrl: baseUrl.value, model: model.value, clearApiKey };
            if (apiKey.value) next.apiKey = apiKey.value;
            await api('/api/settings', { method: 'PUT', body: JSON.stringify({ ai: next }) });
            backdrop.remove();
            toast('设置已保存');
          }
        }),
        h('button', { class: 'secondary', text: '使用 Mock AI', onclick: () => { apiKey.value = ''; clearApiKey = true; apiKey.placeholder = '保存后将清除现有 Key'; } })
      ])
    ])
  ]);
  document.body.append(backdrop);
}
