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
        h('span', { class: 'tool-card-name', text: data.display?.title || data.name }),
        h('span', { class: 'tool-card-business', text: data.display?.detail || '' }),
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
        h('span', { class: 'tool-card-name', text: data.display?.title || data.name }),
        h('span', { class: 'tool-card-business', text: data.display?.detail || '' }),
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
    const business = header.querySelector('.tool-card-business');
    if (business && data.display?.detail) business.textContent = data.display.detail;
    const name = header.querySelector('.tool-card-name');
    if (name && data.display?.title) name.textContent = data.display.title;
    existing.card.classList.remove('tool-pending');
    existing.card.classList.add(`tool-${data.status}`);
    if (data.status === 'error') appendToolError(existing.card, data.output);
    if (data.status === 'success') appendCreatedFieldDetails(existing.card, data.output);
    this.pendingToolCalls.delete(data.id);
    existing.card.classList.add('tool-done');
    return existing.card;
  }

  showHistoryLog(log) {
    if (!log?.toolName || log.status === 'running') return null;
    const titles = {
      create_app: '创建应用', add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
      add_page: '添加页面', add_record: '添加记录', add_action: '添加操作', update_entity: '修改表',
      update_field: '修改字段', update_record: '修改记录', remove_entity: '删除表',
      remove_field: '删除字段', remove_page: '删除页面', delete_record: '删除记录',
      query_data: '查询数据', design_form: '设计表单', create_view: '创建视图'
    };
    const status = log.status === 'success' ? 'success' : log.status === 'cancelled' ? 'rejected' : 'error';
    const statusIcon = status === 'success' ? '✅' : status === 'rejected' ? '⏭️' : '❌';
    const detail = historyBusinessDetail(log);
    const card = h('div', { class: `tool-card tool-${status} tool-done tool-history` }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '🔧' }),
        h('span', { class: 'tool-card-name', text: titles[log.toolName] || log.toolName }),
        h('span', { class: 'tool-card-business', text: detail }),
        h('span', { class: 'tool-card-spinner', text: statusIcon })
      ])
    ]);
    if (status === 'error') appendToolError(card, log.error || log.output);
    if (status === 'success') appendCreatedFieldDetails(card, log.output);
    return card;
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
    const title = data.display?.title || TITLES[data.name] || '执行操作';
    const confirmBtn = h('button', { class: 'tool-confirm-btn', text: '确认' });
    const rejectBtn = h('button', { class: 'tool-reject-btn', text: '拒绝' });
    const card = h('div', { class: 'tool-card tool-confirm-card' }, [
      h('div', { class: 'tool-card-header' }, [
        h('span', { class: 'tool-card-icon', text: '📋' }),
        h('span', { class: 'tool-card-name', text: `确认${title}` }),
        h('span', { class: 'tool-card-business', text: data.display?.detail || '' })
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

function historyBusinessDetail(log) {
  const input = log.input || {};
  const output = log.output || {};
  const fields = Array.isArray(input.fields)
    ? input.fields.map((field) => field?.label || field?.name || field?.id).filter(Boolean)
    : [];
  if (fields.length) return fields.join('、');
  if (Array.isArray(output.addedFields)) return output.addedFields.map((field) => field?.label || field?.id).filter(Boolean).join('、');
  return input.label || input.title || input.name || output.name || input.entityId || '';
}

function appendToolError(card, error) {
  const message = toolErrorMessage(error);
  if (!message) return;
  const existing = card.querySelector('.tool-card-error-detail');
  if (existing) {
    existing.textContent = message;
    return;
  }
  card.append(h('div', { class: 'tool-card-error-detail', text: message }));
}

function toolErrorMessage(error) {
  if (typeof error === 'string') return error.trim();
  if (error?.message) return String(error.message).trim();
  if (error && typeof error === 'object') {
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return error == null ? '' : String(error);
}

function appendCreatedFieldDetails(card, output) {
  if (!Array.isArray(output?.entities) || !output.entities.length) return;
  const list = h('div', { class: 'tool-card-operation-list' });
  for (const entity of output.entities) {
    const fieldNames = (entity.fields || []).map((field) => field?.label || field?.id).filter(Boolean);
    if (!fieldNames.length) continue;
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建字段' }),
      h('span', { class: 'tool-card-operation-entity', text: entity.name || entity.id || '' }),
      h('span', { class: 'tool-card-operation-fields', text: fieldNames.join('、') })
    ]));
  }
  if (list.children.length) card.append(list);
}
