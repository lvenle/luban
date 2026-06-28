import { normalizeFieldId } from '../core/ids.js';
import { normalizeFieldType, normalizeOptions, preparePackage, SELECT_COLORS } from '../core/packageProtocol.js';
import { FIELD_TYPES, PAGE_TYPES, ACTION_TYPES, PATCH_OPS } from '../core/contract.js';
import { pickSamplePackage } from './samplePackages.js';
import { mockPatch } from './mockPatch.js';

// ── Exported prompt-building helpers ──
// These produce structured descriptions from contract.js metadata,
// replacing hand-written type lists in AI prompts.

export function formatFieldTypesForPrompt(types) {
  return [...types].map((id) => `${FIELD_TYPES[id]?.label}(${id})`).join('、');
}

export function formatActionTypesForPrompt() {
  return [...ACTION_TYPES].map((id) => `${ACTION_TYPES[id]?.label}(${id})`).join('、');
}

export function formatPageTypesForPrompt() {
  return [...PAGE_TYPES].map((id) => `${PAGE_TYPES[id]?.label}(${id})`).join('、');
}

export function formatPatchOpsForPrompt(ops) {
  return ops.map((id) => `${PATCH_OPS[id]?.label}(${id})`).join('、');
}

// Internal filtered collections
const PROMPT_FIELD_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');
const PROMPT_FIELD_TYPES_STR = formatFieldTypesForPrompt(PROMPT_FIELD_TYPES);
const PROMPT_ACTION_TYPES_STR = formatActionTypesForPrompt();
const PROMPT_PAGE_TYPES_STR = formatPageTypesForPrompt();
const PROMPT_PATCH_OPS = ['addEntity', 'renameEntity', 'addField', 'updateField', 'removeField', 'addPage', 'updatePage', 'removePage', 'addAction', 'updateAction', 'removeAction', 'addSuggestedCommand'];
const PROMPT_PATCH_OPS_STR = formatPatchOpsForPrompt(PROMPT_PATCH_OPS);
const VALIDATE_PLAN_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');
const V2_PLAN_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');

const YES_NO_OPTIONS = () => normalizeOptions(['否', '是']);

export function normalizeAiCreatedPackage(pkg) {
  return structuredClone(pkg || {});
}

export function normalizeAiPatch(patch) {
  return structuredClone(patch || {});
}

export async function generatePackageFromPrompt(prompt, settings = {}) {
  if (!settings?.apiKey) return normalizeAiCreatedPackage(pickSamplePackage(prompt));
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件设计助手。只输出 JSON，不要 Markdown。\n\n输出 JSON 结构示例：\n{\n  "manifest": { "name": "应用名称", "description": "简短描述", "icon": "table" },\n  "schema": {\n    "entities": [\n      {\n        "id": "entity_唯一标识",\n        "name": "表名",\n        "fields": [\n          { "id": "field_唯一标识", "label": "字段名", "type": "text" }\n        ]\n      }\n    ]\n  },\n  "ui": {\n    "pages": [\n      { "id": "page_唯一标识", "title": "页面标题", "type": "table", "entity": "entity_唯一标识" }\n    ]\n  },\n  "actions": { "actions": [] },\n  "prompts": {}\n}\n\n要求：\n1. entity.id 和 field.id 使用唯一且有意义的 ID（如 entity_student, field_name），不能重复。\n2. field.type 只支持：' + PROMPT_FIELD_TYPES_STR + '。\n3. 每张表至少有一个 text 类型字段。\n4. manifest.name 和 entities 必须直接基于用户需求生成，不要添加用户没有提到的表或字段。\n5. 仔细理解用户的描述，只创建用户明确需要的表。例如如果用户说"创建作业管理"，就只创建作业/作业提交等相关表，不要创建账目、分类等无关表。\n6. 每个字段必须对应用户需求中的具体信息点，不要凭空添加额外字段。\n7. 做减法：宁可生成一个精准的表，也不要画蛇添足。\n8. 页面类型支持：' + PROMPT_PAGE_TYPES_STR + '。每张表至少生成一个 table 类型的数据页面。\n9. 所有 ID 都不能重复。\n10. actions.actions 中的 type 只支持：' + PROMPT_ACTION_TYPES_STR + '。如果不确定就用 data.createRecord。\n11. formula 字段的 expression 只支持 IF(条件, 是, 否) 条件判断、CONCAT 拼接、+ 运算符、{字段名} 引用字段。不要使用 & 运算符。可用函数：IF, CONCAT, ROUND, ABS, MIN, MAX, LEN, UPPER, LOWER, TODAY, DATEADD, DATEDIFF。公式中引用 select/multiSelect 字段做比较时，用选项的 label（显示值），不要用选项的 id。'
      },
      { role: 'user', content: prompt }
    ]);
    return normalizeAiCreatedPackage(parseJsonContent(body.choices?.[0]?.message?.content || '{}'));
  } catch (error) {
    throw new Error(`AI 生成失败，未使用 Mock 结果替代：${error.message}`);
  }
}

export async function generatePatchFromPrompt(prompt, currentPackage, settings = {}) {
  if (!settings?.apiKey) return normalizeAiPatch(mockPatch(prompt, currentPackage));
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden 的软件进化助手。只输出 Patch JSON，顶层包含 summary 和 operations。支持操作：' + PROMPT_PATCH_OPS_STR + '。页面类型支持：' + PROMPT_PAGE_TYPES_STR + '。用户要求为已有表创建列表页、统计图表、看板或编辑入口时，使用 addPage；允许多个页面引用同一个 entity。'
      },
      { role: 'system', content: '新增或修改字段时支持 url；是/否数据必须使用包含“否、是”的 select。' },
      { role: 'user', content: JSON.stringify({ currentPackage, request: prompt }) }
    ]);
    return normalizeAiPatch(parseJsonContent(body.choices?.[0]?.message?.content || '{}'));
  } catch (error) {
    throw new Error(`AI 修改失败，未使用 Mock Patch 替代：${error.message}`);
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
    const plan = /商品|库存|供应商|分类|订单/.test(String(prompt || '')) ? productManagementPlan() : packageToPlan(normalizeAiCreatedPackage(pickSamplePackage(prompt)));
    validateAiPlan(plan);
    return plan;
  }
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是 Software Garden V2 的多维表规划助手。只输出 JSON plan。创建应用时 type=app_creation_plan，包含 appName、description、tables、relations、views。views 可以包含多个页面，且允许多个页面引用同一张表；view.type 可用 grid/list、chart、dashboard、editor。页面类型统一为 ' + PROMPT_PAGE_TYPES_STR + '。字段类型可用 ' + formatFieldTypesForPrompt(V2_PLAN_TYPES) + '；formula 必须包含 config.expression 和 config.resultType(number/date/text)，表达式用 {字段名} 引用同表原始字段。select/multiSelect options 必须包含 id、label、color。不要执行，只规划。'
      },
      { role: 'system', content: '字段类型支持 url。是/否数据必须使用包含“否、是”的 select。' },
      { role: 'user', content: prompt }
    ]);
    const plan = parseJsonContent(body.choices?.[0]?.message?.content || '{}');
    validateAiPlan(plan);
    return plan;
  } catch (error) {
    throw new Error(`AI 规划失败，未使用 Mock 方案替代：${error.message}`);
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
    const groupField = entity?.fields?.find((field) => ['select', 'multiSelect', 'date'].includes(field.type)) || entity?.fields?.[0];
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
        if (!VALIDATE_PLAN_TYPES.includes(type)) {
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
    views: clean.ui.pages.filter((page) => page.type === 'table' || page.type === 'list' || (page.entity && !['link', 'page'].includes(page.type))).map((page) => ({ tableTempId: page.entity, name: page.title, type: 'grid' }))
  };
}

function planFieldToPackageField(field) {
  const sourceType = normalizeFieldType(field.type);
  const type = normalizePlanFieldType(field.type);
  const next = {
    id: normalizeFieldId(field.tempId || field.id || field.name || field.label, 'field'),
    label: field.name || field.label || field.id,
    type
  };
  if (type === 'select' || type === 'multiSelect') {
    next.options = sourceType === 'boolean'
      ? YES_NO_OPTIONS()
      : normalizeOptions(field.config?.options || field.options || []);
  }
  if (type === 'formula') next.formula = { expression: field.config?.expression || field.expression || '', resultType: field.config?.resultType || field.resultType || 'number' };
  return next;
}

function normalizePlanFieldType(type) {
  const result = normalizeFieldType(type);
  return result === 'boolean' ? 'select' : result || 'text';
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
          { tempId: 'name', name: '商品名称', type: 'text' },
          { tempId: 'sku', name: 'SKU', type: 'text' },
          { tempId: 'price', name: '价格', type: 'number' },
          { tempId: 'status', name: '状态', type: 'select', config: { options: options(['在售', '停售', '缺货']) } }
        ]
      },
      { tempId: 'category', name: '分类表', fields: [{ tempId: 'name', name: '分类名称', type: 'text' }] },
      { tempId: 'supplier', name: '供应商表', fields: [{ tempId: 'name', name: '供应商名称', type: 'text' }, { tempId: 'phone', name: '联系电话', type: 'text' }] },
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

export async function generateOptions(prompt, settings = {}) {
  if (!settings?.apiKey) {
    const commonOptions = mockOptions(prompt);
    return commonOptions;
  }
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是一个下拉选项生成助手。根据用户提供的字段名和上下文，生成 2-8 个选项。' +
          '只输出 JSON 数组，每个对象格式：{ "label": "选项名称", "color": "blue" }。' +
          '可用颜色：gray, blue, green, yellow, orange, red, purple, teal, pink, indigo, cyan, lime。' +
          '选项名称要简洁、全面、不重复。输出示例：[{"label":"低","color":"green"},{"label":"中","color":"yellow"},{"label":"高","color":"red"}]'
      },
      { role: 'user', content: prompt }
    ]);
    const raw = body.choices?.[0]?.message?.content || '[]';
    return parseJsonContent(raw);
  } catch (error) {
    throw new Error(`AI 生成选项失败：${error.message}`);
  }
}

function mockOptions(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/性别|gender/.test(lower)) return [{ label: '男', color: 'blue' }, { label: '女', color: 'pink' }];
  if (/优先级|priority|重要|紧急|urgent/.test(lower)) return [
    { label: '低', color: 'green' }, { label: '中', color: 'yellow' }, { label: '高', color: 'orange' }, { label: '紧急', color: 'red' }
  ];
  if (/状态|status/.test(lower)) return [
    { label: '待开始', color: 'gray' }, { label: '进行中', color: 'blue' }, { label: '已完成', color: 'green' }, { label: '已暂停', color: 'yellow' }
  ];
  if (/部门|depart/.test(lower)) return [
    { label: '技术部', color: 'blue' }, { label: '市场部', color: 'green' }, { label: '财务部', color: 'yellow' }, { label: '人事部', color: 'orange' }, { label: '运营部', color: 'purple' }
  ];
  if (/分类|类别|category|type|类型/.test(lower)) return [
    { label: '类别 A', color: 'blue' }, { label: '类别 B', color: 'green' }, { label: '类别 C', color: 'yellow' }, { label: '类别 D', color: 'orange' }
  ];
  if (/等级|level|grade/.test(lower)) return [
    { label: '初级', color: 'green' }, { label: '中级', color: 'yellow' }, { label: '高级', color: 'orange' }, { label: '专家', color: 'red' }
  ];
  if (/周|week|day|天/.test(lower)) return [
    { label: '周一', color: 'blue' }, { label: '周二', color: 'green' }, { label: '周三', color: 'yellow' }, { label: '周四', color: 'orange' }, { label: '周五', color: 'red' }, { label: '周六', color: 'purple' }, { label: '周日', color: 'teal' }
  ];
  return [
    { label: '选项 1', color: 'blue' }, { label: '选项 2', color: 'green' }, { label: '选项 3', color: 'yellow' }
  ];
}

export async function generateFieldContent(prompt, settings = {}) {
  if (!settings?.apiKey) {
    return `(mock) AI 结果：${String(prompt).slice(0, 60)}`;
  }
  try {
    const body = await requestChatCompletion(settings, [
      {
        role: 'system',
        content:
          '你是一个 AI 字段生成助手。根据用户的提示词和提供的字段值，生成一段文本内容。' +
          '直接输出结果文本，不要加引号、不要加 Markdown 标记。字数控制在 500 字以内。'
      },
      { role: 'user', content: prompt }
    ]);
    return String(body.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    throw new Error(`AI 生成失败：${error.message}`);
  }
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
