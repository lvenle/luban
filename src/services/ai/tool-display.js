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
  const fieldLabels = Array.isArray(args.fields)
    ? args.fields.map((item) => item?.label || item?.name || item?.id).filter(Boolean)
    : [args.label || field?.label].filter(Boolean);
  const details = [];
  const appName = result?.name || app?.name;
  if (appName) details.push(appName);
  if (entity?.name) details.push(entity.name);
  if (targetEntity?.name && targetEntity.id !== entity?.id) details.push(`关联 ${targetEntity.name}`);
  if (fieldLabels.length) details.push(fieldLabels.join('、'));
  else if (args.title || args.name || args.intent) details.push(args.title || args.name || args.intent);
  return { title: labels[toolName] || toolName, detail: details.join(' · ') };
}
