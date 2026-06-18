const INTENTS = [
  'CreateApp',
  'CreateTable',
  'CreatePage',
  'AddField',
  'CreateRelation',
  'ModifySchema',
  'DeleteSchema',
  'QuerySchema',
  'AnalyzeData',
  'GeneralChat'
];

export function understandAgentRequest(prompt, { app = null, session = null } = {}) {
  const text = String(prompt || '').trim();
  const mergedText = mergeConversationText(text, session);
  const intent = detectIntent(mergedText, app);
  const context = buildAgentContext({ app, session });
  const clarification = clarifyRequest({ intent, text: mergedText, app, context });
  return {
    state: clarification.questions.length ? 'CLARIFY' : 'PLAN',
    intent,
    context,
    clarification
  };
}

export function buildPlanningPrompt(prompt, { app = null, session = null, intent = 'GeneralChat', context = null } = {}) {
  const recentMessages = (session?.messages || [])
    .slice(-20)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
  return JSON.stringify({
    request: String(prompt || '').trim(),
    intent,
    guidance: app
      ? '修改已有应用时，如果用户要为已有表创建列表、图表、看板或编辑入口，请使用 addPage 操作；允许多个页面引用同一张表。'
      : '创建应用时，views 可以包含多个引用同一张表的页面，页面名称必须彼此区分。',
    context: context || buildAgentContext({ app, session }),
    recentMessages
  });
}

export function describePlan(plan) {
  if (!plan) return '尚未生成方案。';
  if (plan.type === 'app_creation_plan') {
    const tables = plan.tables || [];
    const fieldCount = tables.reduce((sum, table) => sum + (table.fields?.length || 0), 0);
    return `创建「${plan.appName}」：${tables.length} 张表、${fieldCount} 个字段、${plan.relations?.length || 0} 个关联。`;
  }
  if (plan.type === 'app_modification_plan') {
    return `${plan.summary || '修改软件'}：${plan.operations?.length || 0} 个操作。`;
  }
  return plan.summary || '已生成方案。';
}

function mergeConversationText(text, session) {
  const previousUserText = (session?.messages || [])
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => message.content)
    .filter(Boolean);
  return [...previousUserText, text].join('\n').trim();
}

function detectIntent(text, app) {
  const normalized = String(text || '').toLowerCase();
  if (/删除|移除/.test(normalized) && /表|字段|关系|关联/.test(normalized)) return 'DeleteSchema';
  if (/页面|入口|看板|图表|列表页|统计页/.test(normalized) && /创建|新增|增加|添加|生成/.test(normalized) && app) return 'CreatePage';
  if (/关联|关系/.test(normalized) && /创建|新增|增加|建立/.test(normalized)) return 'CreateRelation';
  if (/字段|列/.test(normalized) && /创建|新增|增加|添加/.test(normalized)) return 'AddField';
  if (/表/.test(normalized) && /创建|新增|增加|添加/.test(normalized)) return app ? 'CreateTable' : 'CreateApp';
  if (/查询|有哪些|结构|schema|字段|表/.test(normalized) && /查看|列出|告诉|查询|有哪些/.test(normalized)) return 'QuerySchema';
  if (/分析|统计|总结|趋势|洞察/.test(normalized)) return 'AnalyzeData';
  if (/修改|调整|优化|改造|增加|添加|重命名|改成|支持/.test(normalized) && app) return 'ModifySchema';
  if (/创建|生成|做一个|搭建|新建|开发|设计/.test(normalized)) return 'CreateApp';
  return 'GeneralChat';
}

function buildAgentContext({ app = null, session = null } = {}) {
  const tables = (app?.schema?.entities || []).map((entity) => ({
    id: entity.id,
    name: entity.name,
    fields: (entity.fields || []).map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      targetEntity: field.targetEntity || null
    }))
  }));
  return {
    app: app
      ? {
          id: app.id,
          name: app.name,
          description: app.description || '',
          tableCount: tables.length,
          tables
        }
      : null,
    recentMessages: (session?.messages || []).slice(-20).map((message) => ({
      role: message.role,
      content: message.content
    }))
  };
}

function clarifyRequest({ intent, text, app, context }) {
  const questions = [];
  const normalized = String(text || '').trim();
  const hasBusinessNoun = /客户|商品|库存|订单|项目|任务|预算|记账|文章|内容|供应商|员工|课程|报名|合同|资产|设备|线索|工单/.test(normalized);
  const mentionsTable = context.app?.tables?.some((table) => normalized.includes(table.name) || normalized.includes(table.id));
  const mentionsField = context.app?.tables?.some((table) => table.fields.some((field) => normalized.includes(field.label) || normalized.includes(field.id)));

  if (!normalized) questions.push('你希望我创建、修改、查询，还是分析当前软件？');
  if (intent === 'CreateApp' && !hasBusinessNoun) {
    questions.push('这个软件主要服务什么业务场景？例如客户管理、商品库存、项目跟踪或内容生产。');
  }
  if (intent === 'CreateApp' && !/记录|管理|跟踪|统计|流程|审批|生成|导出|看板|提醒/.test(normalized)) {
    questions.push('你希望它至少完成哪 2-3 个核心工作流？');
  }
  if (['CreateTable', 'CreatePage', 'AddField', 'CreateRelation', 'ModifySchema', 'DeleteSchema'].includes(intent) && !app) {
    questions.push('你想修改哪个已有软件？请先打开一个软件后再让 AI 调整结构。');
  }
  if (intent === 'CreatePage' && app && context.app?.tableCount > 1 && !mentionsTable) {
    questions.push('这个新页面要绑定哪张表？');
  }
  if (intent === 'AddField' && app && !mentionsTable && context.app?.tableCount > 1) {
    questions.push('这个字段要加到哪张表？');
  }
  if (intent === 'CreateRelation' && app && context.app?.tableCount > 1 && !mentionsTable) {
    questions.push('要建立哪两张表之间的关联？');
  }
  if (intent === 'DeleteSchema' && app && !mentionsTable && !mentionsField) {
    questions.push('要删除哪张表或哪个字段？删除前我会先检查关联冲突。');
  }
  if (intent === 'ModifySchema' && app && isVagueModification(normalized)) {
    questions.push('你希望优先优化结构、表单录入、列表视图，还是自动化动作？');
  }

  return {
    required: questions.length > 0,
    questions,
    guidance: questions.length ? '信息还不够，我会先追问，不会直接执行。' : '信息足够，下一步生成可确认方案。'
  };
}

function isVagueModification(text) {
  return /^(优化|调整|改一下|升级|完善|变聪明|更好用|帮我优化)(这个)?(软件|应用|系统)?[。.!！?？\s]*$/.test(text);
}

export { INTENTS };
