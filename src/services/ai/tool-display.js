import { getScheduledTask } from '../../models/scheduled-task.js';

export function mergeBatchableToolCalls(toolCalls) {
  const merged = [];
  const addFieldGroups = new Map();
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name !== 'add_field') {
      merged.push(toolCall);
      continue;
    }
    let args;
    try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch { args = {}; }
    const key = String(args.entityId || '');
    if (!key) {
      merged.push(toolCall);
      continue;
    }
    const fields = Array.isArray(args.fields) && args.fields.length
      ? args.fields
      : [{ id: args.id, label: args.label, type: args.type, options: args.options, formula: args.formula }];
    const existing = addFieldGroups.get(key);
    if (existing) {
      existing.args.fields.push(...fields);
      existing.toolCall.function.arguments = JSON.stringify(existing.args);
      continue;
    }
    const mergedArgs = { appId: args.appId, entityId: args.entityId, fields };
    const mergedCall = { ...toolCall, function: { ...toolCall.function, arguments: JSON.stringify(mergedArgs) } };
    addFieldGroups.set(key, { toolCall: mergedCall, args: mergedArgs });
    merged.push(mergedCall);
  }
  return merged;
}

export function buildToolDisplayInfo(toolName, args = {}, app = null, result = null) {
  const labels = {
    create_app: '创建应用', add_entity: '创建表', add_field: '添加字段', add_relation: '添加关联',
    add_page: '添加页面', update_page: '修改页面', add_view: '添加视图', add_record: '添加记录', add_action: '添加操作', update_entity: '修改表',
    update_field: '修改字段', update_record: '修改记录', remove_entity: '删除表',
    remove_field: '删除字段', remove_page: '删除页面', delete_record: '删除记录',
    query_data: '查询数据', design_form: '设计表单', create_view: '创建视图', create_rule: '创建业务规则', update_rule: '修改业务规则',
    create_scheduled_task: '创建定时任务', stop_scheduled_task: '停止定时任务', test_scheduled_task: '测试定时任务'
  };
  const entities = app?.schema?.entities || [];
  const entityId = args.entityId || args.sourceEntityId || '';
  const entity = entities.find((item) => item.id === entityId);
  const targetEntity = entities.find((item) => item.id === args.targetEntityId);
  const field = entity?.fields?.find((item) => item.id === args.fieldId);
  const task = findScheduledTask(app, args);
  const fieldLabels = Array.isArray(args.fields)
    ? args.fields.map((item) => item?.label || item?.name || item?.id).filter(Boolean)
    : [args.label || field?.label].filter(Boolean);
  const details = [];
  const appName = result?.name || app?.name;
  if (appName) details.push(appName);
  if (entity?.name) details.push(entity.name);
  if (targetEntity?.name && targetEntity.id !== entity?.id) details.push(`关联 ${targetEntity.name}`);
  if (fieldLabels.length) details.push(fieldLabels.join('、'));
  else if (task?.name || args.taskName) details.push(task?.name || args.taskName);
  else if (args.title || args.name || args.intent) details.push(args.title || args.name || args.intent);
  return {
    title: labels[toolName] || toolName,
    detail: details.join(' · '),
    confirmationLines: buildConfirmationLines(toolName, args, app, { entity, field, task })
  };
}

function findScheduledTask(app, args = {}) {
  const tasks = app?.scheduledTasks || [];
  if (args.taskId) return tasks.find((task) => task.id === args.taskId) || (app?.id ? getScheduledTask(app.id, args.taskId) : null);
  if (args.taskName) return tasks.find((task) => task.name === args.taskName) || null;
  return null;
}

function buildConfirmationLines(toolName, args = {}, app = null, context = {}) {
  if (toolName === 'create_scheduled_task') {
    return [
      `将创建定时任务「${args.name || '未命名任务'}」。`,
      `任务类型：${scheduledTypeLabel(args.type)}`,
      scheduleText(args.schedule, args.type),
      actionText(args.action, args.type, app),
      args.enabled === false ? '创建后保持停用。' : '创建后立即启用。'
    ].filter(Boolean);
  }
  if (toolName === 'stop_scheduled_task') {
    const name = context.task?.name || args.taskName || '所选任务';
    return [
      `将停止定时任务「${name}」。`,
      '停止后不会再按计划自动触发。',
      '已有提醒记录不会被删除。'
    ];
  }
  if (toolName === 'test_scheduled_task') {
    const task = context.task;
    const name = task?.name || args.taskName || '所选任务';
    const lines = [`将立即测试执行定时任务「${name}」一次。`];
    if (task?.type === 'tableUpdate') lines.push('这会立刻更新符合条件的数据记录。');
    else lines.push('这会立刻生成一次提醒，用来验证任务效果。');
    return lines;
  }
  if (toolName === 'create_rule' || toolName === 'update_rule') {
    return [`请确认这条业务规则理解是否正确：${args.intent || ''}`].filter(Boolean);
  }
  if (toolName === 'delete_record') return ['将删除所选记录。删除后无法从界面直接恢复。'];
  if (toolName === 'remove_entity') return [`将删除表「${context.entity?.name || args.entityId || '所选表'}」。表内数据也会一起删除。`];
  if (toolName === 'remove_field') return [`将删除字段「${context.field?.label || args.fieldId || '所选字段'}」。该字段已有数据会一起移除。`];
  if (toolName === 'remove_page') return [`将删除页面「${args.title || args.pageId || '所选页面'}」。`];
  return [];
}

function scheduledTypeLabel(type) {
  return { reminder: '定时提醒', tableReminder: '按表格时间提醒', tableUpdate: '定时更新数据' }[type] || type || '定时任务';
}

function scheduleText(schedule = {}, type = '') {
  if (!schedule || typeof schedule !== 'object') return '';
  if (type === 'tableReminder') return `扫描频率：每 ${schedule.intervalMinutes || 5} 分钟检查一次。`;
  const time = schedule.time || '09:00';
  if (schedule.mode === 'once') return `提醒时间：${schedule.date || '指定日期'} ${time}`;
  if (schedule.mode === 'daily') return `提醒时间：每天 ${time}`;
  if (schedule.mode === 'weekly') return `提醒时间：每周${weekdayText(schedule.weekdays)} ${time}`;
  if (schedule.mode === 'monthly') return `提醒时间：每月 ${schedule.monthDay || 1} 号 ${time}`;
  return `提醒时间：${time}`;
}

function weekdayText(weekdays = []) {
  const labels = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
  const values = Array.isArray(weekdays) && weekdays.length ? weekdays : [1];
  return values.map((day) => labels[day] || day).join('、');
}

function actionText(action = {}, type = '', app = null) {
  if (!action || typeof action !== 'object') return '';
  if (type === 'reminder') return `提醒内容：${action.message || '提醒已触发。'}`;
  const entity = app?.schema?.entities?.find((item) => item.id === action.entityId);
  if (type === 'tableReminder') {
    const field = entity?.fields?.find((item) => item.id === action.fieldId);
    return `提醒来源：检查「${entity?.name || action.entityId || '数据表'}」中的「${field?.label || action.fieldId || '时间字段'}」。`;
  }
  if (type === 'tableUpdate') {
    const field = entity?.fields?.find((item) => item.id === action.updateFieldId);
    return `更新内容：把「${entity?.name || action.entityId || '数据表'}」中的「${field?.label || action.updateFieldId || '字段'}」改为「${action.updateValue ?? ''}」。`;
  }
  return '';
}
