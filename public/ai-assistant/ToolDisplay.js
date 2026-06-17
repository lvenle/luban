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
    const LABELS = {
      entityId: '表', fieldId: '字段', name: '名称', label: '显示名',
      type: '类型', description: '说明', sourceEntityId: '源表',
      targetEntityId: '目标表', recordId: '记录', multiple: '允许多选',
      pageId: '页面', title: '标题', value: '值'
    };
    const TITLES = {
      add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
      remove_entity: '删除表', remove_field: '删除字段', delete_record: '删除记录',
      update_entity: '修改表', update_field: '修改字段', add_page: '添加页面',
      remove_page: '删除页面', add_record: '添加记录', update_record: '修改记录'
    };
    const args = data.friendlyArgs || data.arguments || {};
    const entries = Object.entries(args).filter(([k]) => k !== 'appId');
    const body = h('div', { class: 'confirm-body' });
    for (const [key, value] of entries) {
      const label = LABELS[key] || key;
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      body.append(h('p', { text: `${label}: ${display}` }));
    }
    const title = TITLES[data.name] || '执行操作';
    const confirmBtn = h('button', { class: 'tool-confirm-btn', text: '确认' });
    const rejectBtn = h('button', { class: 'tool-reject-btn', text: '拒绝' });
    const card = h('div', { class: 'tool-card tool-confirm-card' }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '📋' }),
        h('span', { class: 'tool-card-name', text: `确认${title}` })
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
