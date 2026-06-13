import { normalizeFieldId } from './ids.js';
import { normalizeOptions, preparePackage, SELECT_COLORS } from './packageProtocol.js';
import { pickSamplePackage } from './samplePackages.js';

export async function generatePackageFromPrompt(prompt, settings = {}) {
  if (!settings?.apiKey) return pickSamplePackage(prompt);
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件设计助手。只输出 JSON，不要 Markdown。顶层必须包含 manifest、schema、ui、actions、prompts。不要生成代码。'
      },
      { role: 'user', content: prompt }
    ]);
    return parseJsonContent(body.choices?.[0]?.message?.content || '{}');
  } catch (error) {
    console.warn(`AI package generation failed, using local fallback: ${error.message}`);
    return pickSamplePackage(prompt);
  }
}

export async function generatePatchFromPrompt(prompt, currentPackage, settings = {}) {
  if (!settings?.apiKey) return mockPatch(prompt, currentPackage);
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件进化助手。只输出 Patch JSON，顶层包含 summary 和 operations。operations 只能使用支持的 Patch 操作。'
      },
      { role: 'user', content: JSON.stringify({ currentPackage, request: prompt }) }
    ]);
    return parseJsonContent(body.choices?.[0]?.message?.content || '{}');
  } catch (error) {
    console.warn(`AI patch generation failed, using local fallback: ${error.message}`);
    return mockPatch(prompt, currentPackage);
  }
}

export async function generatePlanFromPrompt(prompt, settings = {}, currentPackage = null) {
  if (currentPackage) {
    const patch = await generatePatchFromPrompt(prompt, currentPackage, settings);
    const plan = {
      type: 'app_modification_plan',
      appId: currentPackage.manifest?.id,
      summary: patch.summary || '修改软件',
      patch,
      operations: patch.operations || []
    };
    validateAiPlan(plan);
    return plan;
  }
  if (!settings?.apiKey) {
    const plan = /商品|库存|供应商|分类|订单/.test(String(prompt || '')) ? productManagementPlan() : packageToPlan(pickSamplePackage(prompt));
    validateAiPlan(plan);
    return plan;
  }
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden V2 的多维表规划助手。只输出 JSON plan。创建应用时 type=app_creation_plan，包含 appName、description、tables、relations、views。字段类型只用 text、textarea、number、date、datetime、boolean、select、multiSelect、relation；select/multiSelect options 必须包含 id、label、color。不要执行，只规划。'
      },
      { role: 'user', content: prompt }
    ]);
    const plan = parseJsonContent(body.choices?.[0]?.message?.content || '{}');
    validateAiPlan(plan);
    return plan;
  } catch (error) {
    console.warn(`AI plan generation failed, using local fallback: ${error.message}`);
    const plan = packageToPlan(pickSamplePackage(prompt));
    validateAiPlan(plan);
    return plan;
  }
}

export function planToPackage(plan) {
  validateAiPlan(plan);
  if (plan.type !== 'app_creation_plan') throw new Error('只有应用创建方案可以转换为软件包。');
  const entities = [];
  for (const table of plan.tables) {
    const entityId = normalizeFieldId(table.tempId || table.id || table.name, 'table');
    entities.push({
      id: entityId,
      name: table.name,
      description: table.description || '',
      fields: (table.fields || [])
        .filter((field) => field.type !== 'relation')
        .map((field) => planFieldToPackageField(field))
    });
  }
  for (const relation of plan.relations || []) {
    const source = entities.find((entity) => entity.id === normalizeFieldId(relation.sourceTableTempId, 'table'));
    const targetEntity = normalizeFieldId(relation.targetTableTempId, 'table');
    const displayField = normalizeFieldId(relation.targetDisplayFieldTempId, 'field');
    source?.fields.push({
      id: normalizeFieldId(relation.fieldTempId || relation.fieldName, 'relation'),
      label: relation.fieldName,
      type: 'relation',
      targetEntity,
      displayField,
      multiple: Boolean(relation.multiple),
      allowCreateTargetRecord: Boolean(relation.allowCreateTargetRecord),
      enableSearch: relation.enableSearch ?? true
    });
  }
  const firstEntity = entities[0]?.id;
  return preparePackage({
    manifest: {
      packageVersion: '2.0',
      id: normalizeFieldId(plan.appName, 'app'),
      name: plan.appName,
      description: plan.description || '',
      icon: plan.icon || 'table',
      version: '2.0.0',
      author: 'local-user',
      createdBy: 'ai'
    },
    schema: { entities },
    ui: {
      home: { layout: 'dashboard', cards: firstEntity ? [{ type: 'stat', title: '记录总数', entity: firstEntity, operation: 'count' }] : [] },
      pages: (plan.views?.length ? plan.views : entities.map((entity) => ({ tableTempId: entity.id, name: `${entity.name}列表`, type: 'grid' }))).map((view) => ({
        id: `${normalizeFieldId(view.tableTempId, 'table')}-list`,
        title: view.name || '全部记录',
        type: 'list',
        entity: normalizeFieldId(view.tableTempId, 'table'),
        features: ['create', 'edit', 'delete', 'search', 'export']
      }))
    },
    actions: { actions: [{ id: 'export_records', name: '导出数据', type: 'export.csv', input: { records: firstEntity } }] },
    prompts: { systemPrompt: `你是${plan.appName}助手。`, suggestedCommands: ['总结当前视图', '设计当前表单'] }
  });
}

export function validateAiPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') errors.push('AI Plan 必须是对象。');
  if (plan?.type === 'app_modification_plan') {
    if (!Array.isArray(plan.operations)) errors.push('修改方案必须包含 operations。');
  } else if (plan?.type === 'app_creation_plan') {
    if (!String(plan.appName || '').trim()) errors.push('appName 不能为空。');
    if (!Array.isArray(plan.tables) || plan.tables.length === 0) errors.push('至少需要一张表。');
    if ((plan.tables || []).length > 20) errors.push('单次最多创建 20 张表。');
    const tableIds = new Set((plan.tables || []).map((table) => normalizeFieldId(table.tempId || table.id || table.name, 'table')));
    const fieldIds = new Set();
    for (const table of plan.tables || []) {
      if (!String(table.name || '').trim()) errors.push('table.name 不能为空。');
      if ((table.fields || []).length > 100) errors.push(`表 ${table.name} 最多 100 个字段。`);
      for (const field of table.fields || []) {
        if (!String(field.name || field.label || '').trim()) errors.push(`表 ${table.name} 存在未命名字段。`);
        const type = normalizePlanFieldType(field.type);
        if (!['text', 'textarea', 'number', 'date', 'datetime', 'boolean', 'select', 'multiSelect', 'relation'].includes(type)) {
          errors.push(`字段 ${field.name || field.label} 类型不支持：${field.type}`);
        }
        if (type === 'select' || type === 'multiSelect') {
          for (const option of normalizeOptions(field.config?.options || field.options || [])) {
            if (!option.id || !option.label) errors.push(`字段 ${field.name || field.label} 的选项必须包含 id 和 label。`);
            if (!SELECT_COLORS.includes(option.color)) errors.push(`字段 ${field.name || field.label} 的颜色不支持：${option.color}`);
          }
        }
        fieldIds.add(normalizeFieldId(field.tempId || field.id || field.name || field.label, 'field'));
      }
    }
    if ((plan.relations || []).length > 100) errors.push('单次最多创建 100 个关联关系。');
    for (const relation of plan.relations || []) {
      if (!tableIds.has(normalizeFieldId(relation.sourceTableTempId, 'table'))) errors.push(`relation.sourceTableTempId 不存在：${relation.sourceTableTempId}`);
      if (!tableIds.has(normalizeFieldId(relation.targetTableTempId, 'table'))) errors.push(`relation.targetTableTempId 不存在：${relation.targetTableTempId}`);
      if (!fieldIds.has(normalizeFieldId(relation.targetDisplayFieldTempId, 'field'))) errors.push(`relation.targetDisplayFieldTempId 不存在：${relation.targetDisplayFieldTempId}`);
    }
  } else {
    errors.push(`AI Plan type 不支持：${plan?.type || ''}`);
  }
  if (errors.length) {
    const error = new Error(errors.join('\n'));
    error.details = errors;
    throw error;
  }
  return true;
}

function packageToPlan(pkg) {
  const clean = preparePackage(pkg);
  const tables = clean.schema.entities.map((entity) => ({
    tempId: entity.id,
    name: entity.name,
    description: entity.description || '',
    fields: entity.fields
      .filter((field) => field.type !== 'relation')
      .map((field) => ({
        tempId: field.id,
        name: field.label || field.id,
        type: field.type,
        required: Boolean(field.required),
        config: field.type === 'select' || field.type === 'multiSelect' ? { options: normalizeOptions(field.options || []) } : {}
      }))
  }));
  const relations = clean.schema.entities.flatMap((entity) =>
    entity.fields
      .filter((field) => field.type === 'relation')
      .map((field) => ({
        sourceTableTempId: entity.id,
        fieldName: field.label,
        targetTableTempId: field.targetEntity,
        targetDisplayFieldTempId: field.displayField,
        multiple: Boolean(field.multiple)
      }))
  );
  return {
    type: 'app_creation_plan',
    appName: clean.manifest.name,
    description: clean.manifest.description || '',
    tables,
    relations,
    views: clean.ui.pages.filter((page) => page.type === 'list').map((page) => ({ tableTempId: page.entity, name: page.title, type: 'grid' }))
  };
}

function planFieldToPackageField(field) {
  const type = normalizePlanFieldType(field.type);
  const next = {
    id: normalizeFieldId(field.tempId || field.id || field.name || field.label, 'field'),
    label: field.name || field.label || field.id,
    type,
    required: Boolean(field.required)
  };
  if (type === 'select' || type === 'multiSelect') next.options = normalizeOptions(field.config?.options || field.options || []);
  return next;
}

function normalizePlanFieldType(type) {
  const map = { long_text: 'textarea', checkbox: 'boolean', multi_select: 'multiSelect' };
  return map[type] || type || 'text';
}

function productManagementPlan() {
  const options = (items) => normalizeOptions(items).map((option) => ({ id: option.id, label: option.label, color: option.color }));
  return {
    type: 'app_creation_plan',
    appName: '商品管理系统',
    description: '管理商品、分类、供应商、订单和库存流水。',
    tables: [
      {
        tempId: 'product',
        name: '商品表',
        fields: [
          { tempId: 'name', name: '商品名称', type: 'text', required: true },
          { tempId: 'sku', name: 'SKU', type: 'text' },
          { tempId: 'price', name: '价格', type: 'number' },
          { tempId: 'status', name: '状态', type: 'select', config: { options: options(['在售', '停售', '缺货']) } }
        ]
      },
      { tempId: 'category', name: '分类表', fields: [{ tempId: 'name', name: '分类名称', type: 'text', required: true }] },
      { tempId: 'supplier', name: '供应商表', fields: [{ tempId: 'name', name: '供应商名称', type: 'text', required: true }, { tempId: 'phone', name: '联系电话', type: 'text' }] },
      {
        tempId: 'inventory_log',
        name: '库存流水表',
        fields: [
          { tempId: 'date', name: '日期', type: 'date' },
          { tempId: 'quantity', name: '数量变化', type: 'number' },
          { tempId: 'type', name: '类型', type: 'select', config: { options: options(['入库', '出库', '盘点']) } }
        ]
      }
    ],
    relations: [
      { sourceTableTempId: 'product', fieldName: '商品分类', targetTableTempId: 'category', targetDisplayFieldTempId: 'name', multiple: false },
      { sourceTableTempId: 'product', fieldName: '供应商', targetTableTempId: 'supplier', targetDisplayFieldTempId: 'name', multiple: false },
      { sourceTableTempId: 'inventory_log', fieldName: '商品', targetTableTempId: 'product', targetDisplayFieldTempId: 'name', multiple: false }
    ],
    views: [
      { tableTempId: 'product', name: '全部商品', type: 'grid' },
      { tableTempId: 'category', name: '全部分类', type: 'grid' },
      { tableTempId: 'supplier', name: '全部供应商', type: 'grid' },
      { tableTempId: 'inventory_log', name: '库存流水', type: 'grid' }
    ]
  };
}

function chatCompletionsUrl(baseUrl = 'https://api.openai.com/v1') {
  const clean = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (clean.endsWith('/chat')) return `${clean}/completions`;
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

async function assertAiResponse(response) {
  if (response.ok) return '';
  const text = await response.text().catch(() => '');
  const message = text ? `AI 请求失败：${response.status} ${text}` : `AI 请求失败：${response.status}`;
  throw new Error(message);
}

async function requestChatCompletion(settings, messages) {
  const payload = {
    model: settings.model || 'gpt-4.1-mini',
    messages,
    response_format: { type: 'json_object' }
  };
  const first = await sendChatCompletion(settings, payload);
  if (first.ok) return first.json();
  const errorText = await first.text();
  if (errorText.includes('response_format')) {
    const retryPayload = { ...payload };
    delete retryPayload.response_format;
    const retry = await sendChatCompletion(settings, retryPayload);
    if (retry.ok) return retry.json();
    await throwAiError(retry);
  }
  throw new Error(`AI 请求失败：${first.status} ${errorText}`);
}

function sendChatCompletion(settings, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  return fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  }).finally(() => clearTimeout(timeout));
}

async function throwAiError(response) {
  const text = await response.text().catch(() => '');
  throw new Error(text ? `AI 请求失败：${response.status} ${text}` : `AI 请求失败：${response.status}`);
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
    throw new Error('AI 返回内容不是合法 JSON。');
  }
}

function firstEntity(pkg) {
  return pkg.schema.entities[0]?.id || 'record';
}

function mockPatch(prompt, pkg) {
  // 提取实际用户输入：如果 prompt 是 JSON，只取 request 部分
  let text = String(prompt || '');
  try {
    const parsed = JSON.parse(text);
    if (parsed.request) {
      text = parsed.request;
    }
  } catch {}
  
  // 智能选择表：如果用户提到表名，选对应的表，否则选第一个表
  let entity = null;
  for (const candidate of pkg.schema.entities) {
    if (text.includes(candidate.name) || text.includes(candidate.id)) {
      entity = candidate.id;
      break;
    }
  }
  if (!entity) entity = firstEntity(pkg);
  const entityDef = pkg.schema.entities.find((item) => item.id === entity) || pkg.schema.entities[0];
  if (text.includes('旅游')) {
    return {
      summary: '增加旅游预算字段和统计页面',
      operations: [
        {
          op: 'addField',
          entity,
          field: { id: 'travel_budget', label: '是否计入旅游预算', type: 'boolean' }
        },
        {
          op: 'addPage',
          page: {
            id: 'travel-budget-chart',
            title: '旅游预算统计',
            type: 'chart',
            entity,
            chart: { type: 'bar', groupBy: 'travel_budget', value: 'count' }
          }
        }
      ]
    };
  }
  if (text.includes('今日')) {
    return {
      summary: '增加今日任务页面',
      operations: [
        {
          op: 'addPage',
          page: { id: 'today-list', title: '今日任务', type: 'list', entity, features: ['create', 'edit', 'delete', 'search'] }
        }
      ]
    };
  }
  if (text.includes('爆款') || text.includes('标题')) {
    return {
      summary: '增加爆款标题分析 Action',
      operations: [
        {
          op: 'addAction',
          action: {
            id: 'viral_title_analysis',
            name: '爆款标题分析',
            type: 'ai.generateText',
            input: { records: entity },
            prompt: '分析当前文章主题，给出 5 个更有传播力的公众号标题，并说明理由。'
          }
        }
      ]
    };
  }
  if (text.includes('提醒')) {
    return {
      summary: '增加跟进提醒日期字段',
      operations: [{ op: 'addField', entity, field: { id: 'follow_up_date', label: '跟进提醒日期', type: 'date' } }]
    };
  }
  if (text.includes('统计') || text.includes('图表') || text.includes('看板')) {
    const groupField = chooseGroupField(entityDef);
    return {
      summary: `增加${fieldLabel(groupField)}统计页面`,
      operations: [
        {
          op: 'addPage',
          page: {
            id: `${groupField.id}-chart`,
            title: `${fieldLabel(groupField)}统计`,
            type: 'chart',
            entity,
            chart: { type: 'bar', groupBy: groupField.id, value: 'count' }
          }
        }
      ]
    };
  }
  if (text.includes('导出')) {
    return {
      summary: '增加 CSV 导出 Action',
      operations: [
        {
          op: 'addAction',
          action: { id: `export_${entity}`, name: `导出${entityDef?.name || '记录'} CSV`, type: 'export.csv', input: { records: entity } }
        }
      ]
    };
  }
  if (text.includes('生成') || text.includes('总结') || text.includes('分析')) {
    return {
      summary: '增加 AI 分析 Action',
      operations: [
        {
          op: 'addAction',
          action: {
            id: 'ai_analysis',
            name: 'AI 分析',
            type: 'ai.generateText',
            input: { records: entity },
            prompt: `根据当前${entityDef?.name || '记录'}数据生成简洁分析和建议。`
          }
        }
      ]
    };
  }
  const requestedField = inferRequestedField(text);
  if (requestedField) {
    return {
      summary: `增加${requestedField.label}字段`,
      operations: [{ op: 'addField', entity, field: requestedField }]
    };
  }
  return {
    summary: '增加备注增强字段',
    operations: [{ op: 'addField', entity, field: { id: 'extra_note', label: '补充备注', type: 'textarea' } }]
  };
}

function inferRequestedField(text) {
  // 更精确地匹配，支持各种句式
  const patterns = [
    /(?:增加|添加|新增|加入|新建|创建)(?:\s*一个)?(?:个)?(?:\s*字段|字段)?\s*(.+?)(?:\s*(?:字段|列|属性))?$/,
    /(?:加|增加|添加|新增|加入)\s*(.+?)(?:\s*(?:到|在))?(?:\s*(?:表|里面|中))?$/,
  ];
  
  let match = null;
  for (const pattern of patterns) {
    match = text.match(pattern);
    if (match) break;
  }
  
  if (!match) return null;
  const raw = (match[1] || match[2] || '').trim();
  if (!raw) return null;
  
  // 清理掉可能残留的JSON痕迹
  let label = raw.replace(/[{}\[\]"']/g, '').trim();
  if (!label) return null;
  
  const type = inferFieldType(label);
  
  // 确保id干净，不会产生乱码
  let id = translateKnownField(label);
  if (id === label) {
    id = normalizeFieldId(label, fallbackFieldId(label, type));
  }
  
  return {
    id,
    label,
    type,
    options: inferFieldOptions(label)
  };
}

function translateKnownField(label) {
  const known = {
    标签: 'tag',
    分类: 'category',
    状态: 'status',
    优先级: 'priority',
    评分: 'rating',
    金额: 'amount',
    价格: 'price',
    数量: 'quantity',
    日期: 'date',
    时间: 'time',
    负责人: 'owner',
    备注: 'note'
  };
  return known[label] || label;
}

function inferFieldType(label) {
  if (label.includes('日期')) return 'date';
  if (label.includes('时间')) return 'datetime';
  if (/(金额|价格|数量|评分|分数|时长|预算|进度)/.test(label)) return 'number';
  if (/(是否|完成|启用)/.test(label)) return 'boolean';
  if (/(状态|优先级|分类|类型|标签|来源)/.test(label)) return 'select';
  if (/(备注|说明|描述|复盘|步骤)/.test(label)) return 'textarea';
  return 'text';
}

function inferFieldOptions(label) {
  if (label.includes('状态')) return ['未开始', '进行中', '已完成'];
  if (label.includes('优先级')) return ['低', '中', '高'];
  if (label.includes('分类') || label.includes('类型') || label.includes('标签')) return ['默认', '重要', '其他'];
  if (label.includes('来源')) return ['线上', '线下', '其他'];
  return undefined;
}

function fallbackFieldId(label, type) {
  if (label.includes('日期')) return 'date_field';
  if (label.includes('时间')) return 'time_field';
  if (label.includes('金额')) return 'amount';
  if (label.includes('数量')) return 'quantity';
  if (label.includes('评分')) return 'rating';
  if (label.includes('状态')) return 'status';
  if (label.includes('分类')) return 'category';
  if (label.includes('优先级')) return 'priority';
  if (label.includes('负责人')) return 'owner';
  if (label.includes('备注')) return 'note';
  return `${type || 'text'}_field`;
}

function chooseGroupField(entityDef) {
  return entityDef?.fields?.find((field) => field.type === 'select' || field.type === 'boolean') || entityDef?.fields?.[0] || { id: 'status', label: '状态' };
}

function fieldLabel(field) {
  return field?.label || field?.id || '记录';
}
