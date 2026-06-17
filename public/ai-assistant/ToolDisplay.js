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
    const args = data.arguments || {};
    const entries = Object.entries(args).filter(([k]) => k !== 'appId');
    const body = h('div', { class: 'confirm-body' });
    for (const [key, value] of entries) {
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      body.append(h('p', { text: `${key}: ${display}` }));
    }
    const confirmBtn = h('button', { class: 'tool-confirm-btn', text: '确认' });
    const rejectBtn = h('button', { class: 'tool-reject-btn', text: '拒绝' });
    const card = h('div', { class: 'tool-card tool-confirm-card' }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '📋' }),
        h('span', { class: 'tool-card-name', text: `确认${data.name === 'add_entity' ? '创建表' : '执行操作'}` })
      ]),
      body,
      h('div', { class: 'tool-confirm-actions' }, [rejectBtn, confirmBtn])
    ]);
    confirmBtn.onclick = () => { this.onConfirm(data.confirmId, true); card.remove(); };
    rejectBtn.onclick = () => { this.onConfirm(data.confirmId, false); card.remove(); };
    return card;
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
