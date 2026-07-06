import h from './dom.js';
import { humanizeMessage } from '../common/messages.js';

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
    if (data.status === 'success') {
      const toolName = existing.data.name || '';
      const input = existing.data.arguments || existing.data.args || {};
      appendOperationDetails(existing.card, data.output, input, toolName);
    }
    this.pendingToolCalls.delete(data.id);
    existing.card.classList.add('tool-done');
    return existing.card;
  }

  showHistoryLog(log) {
    if (!log?.toolName || log.status === 'running') return null;
    const titles = {
      create_app: '创建应用', add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
      add_page: '添加页面', update_page: '修改页面', add_view: '添加视图', add_record: '添加记录', add_action: '添加操作', update_entity: '修改表',
      update_field: '修改字段', update_record: '修改记录', remove_entity: '删除表',
      remove_field: '删除字段', remove_page: '删除页面', delete_record: '删除记录',
      query_data: '查询数据', design_form: '设计表单', create_view: '创建视图', create_rule: '创建业务规则', update_rule: '修改业务规则'
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
    if (status === 'success') appendOperationDetails(card, log.output, log.input, log.toolName);
    return card;
  }

  showConfirmModal(data) {
    const LABELS = {
      entityId: '表', fieldId: '字段', name: '名称', label: '显示名',
      type: '类型', description: '说明', sourceEntityId: '源表',
      targetEntityId: '目标表', recordId: '记录', multiple: '允许多选',
      pageId: '页面', title: '标题', value: '值', intent: '业务规则', ruleId: '规则'
    };
    const TITLES = {
      add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
      remove_entity: '删除表', remove_field: '删除字段', delete_record: '删除记录',
      update_entity: '修改表', update_field: '修改字段', add_page: '添加页面', add_view: '添加视图',
      remove_page: '删除页面', add_record: '添加记录', update_record: '修改记录', create_rule: '创建业务规则', update_rule: '修改业务规则'
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
    const rejectBtn = h('button', { class: 'tool-reject-btn', text: ['create_rule', 'update_rule'].includes(data.name) ? '修改' : '拒绝' });
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
    rejectBtn.onclick = () => { this.onConfirm(data.confirmId, false, data); card.remove(); };
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

/**
 * Resolve an entity's display name from the tool output.
 * Output may be a full app object (with schema.entities) or a create_app-style
 * result object (with an entities array directly).
 */
function findEntityName(output, entityId) {
  if (!entityId || !output) return null;
  const entities = output?.schema?.entities || output?.entities || [];
  const entity = entities.find((e) => e.id === entityId);
  return entity?.name || null;
}

/**
 * Build a meaningful detail string for the tool card header based on the
 * specific tool type, its input arguments, and its output.
 *
 * For tools whose output is the full app object (add_entity, update_entity,
 * add_page, etc.), we resolve entity/field IDs to names from the output.
 * For tools with structured output, we use their specific result fields.
 */
export function historyBusinessDetail(log = {}) {
  const toolName = log?.toolName || '';
  // Failed/cancelled tool logs legitimately persist null input/output values.
  // Destructuring defaults only apply to undefined, so normalize null (and
  // other non-object legacy values) before the tool-specific renderers read
  // properties such as output.name or input.label.
  const input = log?.input && typeof log.input === 'object' ? log.input : {};
  const output = log?.output && typeof log.output === 'object' ? log.output : {};

  switch (toolName) {
    case 'create_app': {
      // output: { name, entities: [{ id, name, fields }] }
      const appName = output.name || '';
      const tableNames = (output.entities || []).map((e) => e.name).filter(Boolean);
      const parts = [appName, ...tableNames].filter(Boolean);
      return parts.join(' · ');
    }

    case 'add_entity':
      // input: { name, description } — the table name is right there
      return input.name || findEntityName(output, input.entityId) || '';

    case 'add_field': {
      // input: { entityId, fields: [{ label }] }
      // output: { entityId, addedFields: [{ id, label, type }] }
      const fieldLabels = Array.isArray(input.fields)
        ? input.fields.map((f) => f.label || f.name || f.id).filter(Boolean)
        : [];
      const addedLabels = !fieldLabels.length && Array.isArray(output.addedFields)
        ? output.addedFields.map((f) => f.label || f.id).filter(Boolean)
        : [];
      const names = fieldLabels.length ? fieldLabels : addedLabels;
      const ename = findEntityName(output, input.entityId);
      return [ename, names.join('、')].filter(Boolean).join(' · ');
    }

    case 'add_relation':
      // input: { label, sourceEntityId, targetEntityId }
      return [
        input.label,
        findEntityName(output, input.sourceEntityId),
        '→',
        findEntityName(output, input.targetEntityId)
      ].filter(Boolean).join(' ');

    case 'add_page': {
      // input: { title, type, entityId }
      const typeLabels = { list: '列表', chart: '图表', dashboard: '看板', blank: '空白页', webpage: '网页' };
      return [input.title, typeLabels[input.type] || input.type].filter(Boolean).join(' · ');
    }

    case 'update_page':
      return input.title || (typeof input.content === 'string' ? '已更新页面内容' : '');

    case 'add_action':
      // input: { label, type, entityId }
      return input.label || '';

    case 'add_view':
    case 'create_view':
      // output: { name, type } or just viewId
      return output.name || input.name || '';

    case 'update_entity': {
      // input: { entityId, name }
      const oldName = findEntityName(output, input.entityId) || '';
      return [oldName, input.name ? `→ ${input.name}` : ''].filter(Boolean).join(' ');
    }

    case 'update_field': {
      // input: { entityId, fieldId, label }
      const ename = findEntityName(output, input.entityId) || '';
      return [ename, input.label || ''].filter(Boolean).join(' · ');
    }

    case 'remove_entity':
      // For deletes, the entity is no longer in the output. Use input.
      return findEntityName(output, input.entityId) || input.entityId || '';

    case 'remove_field':
      return [findEntityName(output, input.entityId) || input.entityId, input.fieldId].filter(Boolean).join(' · ');

    case 'remove_page':
      return '';

    case 'add_record':
    case 'update_record': {
      // output is the record object: { id, appId, entityId, data }
      const ename = findEntityName(output, input.entityId) || findEntityName(output, output.entityId) || '';
      const preview = input.data
        ? Object.values(input.data).find((v) => typeof v === 'string' && v.length < 40) || ''
        : '';
      return [ename, preview].filter(Boolean).join(' · ');
    }

    case 'delete_record':
      return input.recordId || '';

    case 'query_data':
      return `查询到 ${output.count || 0} 条`;

    case 'design_form':
      return [
        findEntityName(output, input.entityId),
        output.formLayout?.columns ? `${output.formLayout.columns}列布局` : ''
      ].filter(Boolean).join(' · ');

    case 'create_rule':
    case 'update_rule':
      return output.ruleName || input.intent || '';

    default:
      return input.label || input.title || input.name || output.name || input.entityId || '';
  }
}

/**
 * Append an expandable operation detail list below the tool card header.
 * This shows users exactly what was created/modified/deleted by each tool.
 */
function appendOperationDetails(card, output, input, toolName) {
  if (!output || !toolName) return;

  if (['create_rule', 'update_rule'].includes(toolName) && output.success) {
    card.append(h('div', { class: 'tool-card-operation-list' }, [
      h('div', { class: 'tool-card-operation' }, [
        h('span', { class: 'tool-card-operation-label', text: '已启用' }),
        h('span', { class: 'tool-card-operation-entity', text: output.ruleName || '' }),
        h('button', { class: 'ghost', text: '查看业务规则', onclick: () => import('../app-runtime/SettingsModal.js').then((module) => module.openSettingsModal(output.appId, 'rules')) })
      ])
    ]));
    return;
  }

  // ── create_app: show every table and its fields ──
  if (toolName === 'create_app' && Array.isArray(output.entities) && output.entities.length > 0) {
    const list = h('div', { class: 'tool-card-operation-list' });
    for (const entity of output.entities) {
      const fieldNames = (entity.fields || []).map((f) => f.label || f.id).filter(Boolean);
      const row = h('div', { class: 'tool-card-operation' }, [
        h('span', { class: 'tool-card-operation-label', text: '表' }),
        h('span', { class: 'tool-card-operation-entity', text: entity.name || entity.id || '' }),
        h('span', { class: 'tool-card-operation-fields', text: fieldNames.length ? fieldNames.join('、') : '' })
      ]);
      list.append(row);
    }
    if (list.children.length) card.append(list);
    return;
  }

  // ── add_field: show added field names ──
  if (toolName === 'add_field' && Array.isArray(output.addedFields) && output.addedFields.length > 0) {
    const list = h('div', { class: 'tool-card-operation-list' });
    const ename = findEntityName(output, input?.entityId) || input?.entityId || '';
    const fieldNames = output.addedFields.map((f) => f.label || f.id).filter(Boolean);
    if (fieldNames.length) {
      list.append(h('div', { class: 'tool-card-operation' }, [
        h('span', { class: 'tool-card-operation-label', text: '新建字段' }),
        h('span', { class: 'tool-card-operation-entity', text: ename }),
        h('span', { class: 'tool-card-operation-fields', text: fieldNames.join('、') })
      ]));
    }
    if (list.children.length) card.append(list);
    return;
  }

  // ── add_relation: show source → target ──
  if (toolName === 'add_relation' && input) {
    const list = h('div', { class: 'tool-card-operation-list' });
    const srcName = findEntityName(output, input.sourceEntityId) || input.sourceEntityId || '';
    const tgtName = findEntityName(output, input.targetEntityId) || input.targetEntityId || '';
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建关联' }),
      h('span', { class: 'tool-card-operation-entity', text: input.label || '' }),
      h('span', { class: 'tool-card-operation-fields', text: `${srcName} → ${tgtName}` })
    ]));
    card.append(list);
    return;
  }

  // ── add_entity: show the table name that was created ──
  if (toolName === 'add_entity' && input?.name) {
    const list = h('div', { class: 'tool-card-operation-list' });
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建表格' }),
      h('span', { class: 'tool-card-operation-entity', text: input.name }),
      h('span', { class: 'tool-card-operation-fields', text: input.description || '' })
    ]));
    card.append(list);
    return;
  }

  // ── add_page: show page title and type ──
  if (toolName === 'add_page' && input) {
    const typeLabels = { list: '列表页', chart: '图表页', dashboard: '看板', blank: '空白页', webpage: '网页' };
    const list = h('div', { class: 'tool-card-operation-list' });
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建页面' }),
      h('span', { class: 'tool-card-operation-entity', text: input.title || '' }),
      h('span', { class: 'tool-card-operation-fields', text: typeLabels[input.type] || input.type || '' })
    ]));
    card.append(list);
    return;
  }

  // ── add_action: show action label and type ──
  if (toolName === 'add_action' && input) {
    const actionTypeLabels = {
      create_record: '新增记录', export_csv: '导出 CSV', run_ai: 'AI 分析', run_script: '自定义脚本'
    };
    const list = h('div', { class: 'tool-card-operation-list' });
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建操作' }),
      h('span', { class: 'tool-card-operation-entity', text: input.label || '' }),
      h('span', { class: 'tool-card-operation-fields', text: actionTypeLabels[input.type] || input.type || '' })
    ]));
    card.append(list);
    return;
  }

  // ── add_view / create_view: show view name and type ──
  if ((toolName === 'add_view' || toolName === 'create_view') && (output?.name || input?.name)) {
    const list = h('div', { class: 'tool-card-operation-list' });
    const viewName = output.name || input.name || '';
    const viewTypeLabels = { list: '列表', quadrant: '四象限', gantt: '甘特图' };
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '新建视图' }),
      h('span', { class: 'tool-card-operation-entity', text: viewName }),
      h('span', { class: 'tool-card-operation-fields', text: viewTypeLabels[output.type] || output.type || '' })
    ]));
    card.append(list);
    return;
  }

  // ── design_form: show column count ──
  if (toolName === 'design_form' && output?.formLayout?.columns) {
    const list = h('div', { class: 'tool-card-operation-list' });
    list.append(h('div', { class: 'tool-card-operation' }, [
      h('span', { class: 'tool-card-operation-label', text: '表单布局' }),
      h('span', { class: 'tool-card-operation-entity', text: output.formLayout.columns + '列' }),
      h('span', { class: 'tool-card-operation-fields', text: '' })
    ]));
    card.append(list);
    return;
  }

  // ── update_entity: show name change ──
  if (toolName === 'update_entity' && input) {
    const list = h('div', { class: 'tool-card-operation-list' });
    const oldName = findEntityName(output, input.entityId) || '';
    if (input.name && oldName) {
      list.append(h('div', { class: 'tool-card-operation' }, [
        h('span', { class: 'tool-card-operation-label', text: '重命名' }),
        h('span', { class: 'tool-card-operation-entity', text: oldName }),
        h('span', { class: 'tool-card-operation-fields', text: `→ ${input.name}` })
      ]));
    }
    if (list.children.length) card.append(list);
    return;
  }

  // ── update_field: show what changed ──
  if (toolName === 'update_field' && input) {
    const list = h('div', { class: 'tool-card-operation-list' });
    const ename = findEntityName(output, input.entityId) || input.entityId || '';
    if (input.label) {
      list.append(h('div', { class: 'tool-card-operation' }, [
        h('span', { class: 'tool-card-operation-label', text: '修改字段' }),
        h('span', { class: 'tool-card-operation-entity', text: ename }),
        h('span', { class: 'tool-card-operation-fields', text: `→ ${input.label}` })
      ]));
    }
    if (list.children.length) card.append(list);
    return;
  }
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
  if (typeof error === 'string') return humanizeMessage(error);
  if (error?.message) return humanizeMessage(error.message);
  if (error && typeof error === 'object') {
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return error == null ? '' : String(error);
}
