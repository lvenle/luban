import h from './dom.js';

export default class ToolDisplay {
  constructor(onConfirm) {
    this.onConfirm = onConfirm;
    this.pendingToolCalls = new Map();
  }

  showToolUse(data) {
    const id = data.id;
    const card = h('div', { class: 'tool-card tool-pending' }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '🔧' }),
        h('span', { class: 'tool-card-name', text: data.name }),
        h('span', { class: 'tool-card-spinner', text: '⏳' })
      ])
    ]);
    this.pendingToolCalls.set(id, { card, data });
    return card;
  }

  showToolClient(data) {
    const card = h('div', { class: 'tool-card tool-pending' }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '🌐' }),
        h('span', { class: 'tool-card-name', text: data.name }),
        h('span', { class: 'tool-card-spinner', text: '⏳' })
      ])
    ]);
    this.pendingToolCalls.set(data.id, { card, data });
    return card;
  }

  showToolResult(data) {
    const existing = this.pendingToolCalls.get(data.id);
    if (!existing) return null;
    const statusIcon = data.status === 'success' ? '✅' : data.status === 'rejected' ? '⏭️' : '❌';
    const header = existing.card.querySelector('.tool-card-header');
    const spinner = header.querySelector('.tool-card-spinner');
    if (spinner) spinner.textContent = statusIcon;
    existing.card.classList.remove('tool-pending');
    existing.card.classList.add(`tool-${data.status}`);
    this.pendingToolCalls.delete(data.id);
    existing.card.classList.add('tool-done');
    return existing.card;
  }

  showConfirmModal(data) {
    const backdrop = h('div', { class: 'confirm-backdrop' }, [
      h('div', { class: 'confirm-modal' }, [
        h('div', { class: 'confirm-header', text: '确认执行操作' }),
        h('div', { class: 'confirm-body' }, [
          h('p', { text: `AI 将执行以下高风险操作:` }),
          h('div', { class: 'confirm-tool-info' }, [
            h('strong', { text: data.name }),
            h('pre', { text: JSON.stringify(data.arguments, null, 2) })
          ])
        ]),
        h('div', { class: 'confirm-actions' }, [
          h('button', { class: 'secondary', text: '拒绝', onclick: () => { backdrop.remove(); this.onConfirm(data.confirmId, false); } }),
          h('button', { text: '确认执行', onclick: () => { backdrop.remove(); this.onConfirm(data.confirmId, true); } })
        ])
      ])
    ]);
    document.body.append(backdrop);
  }

  formatArgs(args) {
    if (!args || typeof args !== 'object') return document.createTextNode('');
    const lines = [];
    for (const [key, value] of Object.entries(args)) {
      if (key === 'appId') continue;
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      lines.push(`${key}: ${display}`);
    }
    return h('pre', { text: lines.join('\n') });
  }
}
