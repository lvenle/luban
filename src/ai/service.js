import { normalizeFieldId } from '../core/ids.js';
import { normalizeOptions, preparePackage, SELECT_COLORS } from '../core/packageProtocol.js';
import { pickSamplePackage } from './samplePackages.js';
import { mockPatch } from './mockPatch.js';

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
          '你是 Software Garden 的软件进化助手。只输出 Patch JSON，顶层包含 summary 和 operations。支持操作：addEntity、updateEntity、removeEntity、addField、updateField、removeField、addPage、updatePage、removePage、addAction、updateAction、removeAction。用户要求为已有表创建列表页、统计图表、看板或编辑入口时，使用 addPage；允许多个页面引用同一个 entity。'
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
          '你是 Software Garden V2 的多维表规划助手。只输出 JSON plan。创建应用时 type=app_creation_plan，包含 appName、description、tables、relations、views。views 可以包含多个页面，且允许多个页面引用同一张表；view.type 可用 grid/list、chart、dashboard、editor。字段类型只用 text、textarea、number、date、datetime、boolean、select、multiSelect、relation；select/multiSelect options 必须包含 id、label、color。不要执行，只规划。'
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
  const usedPageIds = new Set();
  const views = plan.views?.length ? plan.views : entities.map((entity) => ({ tableTempId: entity.id, name: `${entity.name}列表`, type: 'grid' }));
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
      pages: views.map((view) => planViewToPage(view, entities, usedPageIds))
    },
    actions: { actions: [{ id: 'export_records', name: '导出数据', type: 'export.csv', input: { records: firstEntity } }] },
    prompts: { systemPrompt: `你是${plan.appName}助手。`, suggestedCommands: ['总结当前视图', '设计当前表单'] }
  });
}

function planViewToPage(view, entities, usedPageIds) {
  const entityId = normalizeFieldId(view.tableTempId || view.entity || view.entityId, 'table');
  const entity = entities.find((item) => item.id === entityId) || entities[0];
  const type = normalizePlanViewType(view.type);
  const title = view.name || view.title || `${entity?.name || '记录'}${type === 'chart' ? '统计' : type === 'dashboard' ? '看板' : type === 'editor' ? '编辑' : '列表'}`;
  const page = {
    id: uniquePlanPageId(`${entityId}-${title}`, usedPageIds),
    title,
    type,
    entity: entity?.id || entityId
  };
  if (type === 'list') {
    page.features = ['create', 'edit', 'delete', 'search', 'export'];
  }
  if (type === 'chart') {
    const groupField = entity?.fields?.find((field) => ['select', 'multiSelect', 'boolean', 'date'].includes(field.type)) || entity?.fields?.[0];
    page.chart = { type: 'bar', groupBy: view.groupBy || groupField?.id || 'name', value: view.value || 'count' };
  }
  if (type === 'dashboard') {
    page.cards = view.cards || [{ type: 'stat', title: `${entity?.name || '记录'}数量`, entity: entity?.id || entityId, operation: 'count' }];
  }
  return page;
}

function normalizePlanViewType(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'chart' || value === 'dashboard' || value === 'editor') return value;
  return 'list';
}

function uniquePlanPageId(input, usedPageIds) {
  const base = normalizeFieldId(input, 'page').replaceAll('_', '-');
  let candidate = base;
  let index = 2;
  while (usedPageIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  usedPageIds.add(candidate);
  return candidate;
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

export function chatCompletionsUrl(baseUrl = 'https://api.openai.com/v1') {
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


