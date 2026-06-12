import { normalizeFieldId, slugify } from './ids.js';

export const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'select',
  'multiSelect',
  'boolean',
  'relation',
  'image',
  'file',
  'richText'
]);

export const SELECT_COLORS = ['gray', 'blue', 'green', 'red', 'orange', 'yellow', 'purple', 'cyan', 'pink'];

export const PAGE_TYPES = new Set(['list', 'form', 'detail', 'dashboard', 'chart', 'editor']);

export const ACTION_TYPES = new Set([
  'ai.generateText',
  'ai.rewriteText',
  'ai.summarize',
  'data.createRecord',
  'data.updateRecord',
  'data.queryRecords',
  'export.markdown',
  'export.json',
  'export.csv'
]);

const PATCH_OPS = new Set([
  'renameApp',
  'updateDescription',
  'addEntity',
  'renameEntity',
  'addField',
  'updateField',
  'removeField',
  'addPage',
  'updatePage',
  'removePage',
  'addAction',
  'updateAction',
  'removeAction',
  'addSuggestedCommand'
]);

export function normalizePackage(pkg) {
  const next = structuredClone(pkg);
  next.manifest = next.manifest || {};
  next.schema = normalizeSchemaShape(next.schema || { entities: [] });
  next.ui = normalizeUiShape(next.ui || { pages: [] }, next.schema);
  next.actions = Array.isArray(next.actions) ? { actions: next.actions } : next.actions || { actions: [] };
  next.prompts = Array.isArray(next.prompts) ? { suggestedCommands: next.prompts } : next.prompts || {};

  next.manifest.packageVersion ||= '1.0';
  next.manifest.id = slugify(next.manifest.id || next.manifest.name || 'app');
  next.manifest.name = next.manifest.displayName || next.manifest.title || next.manifest.name || next.manifest.id;
  next.manifest.version ||= '1.0.0';
  next.manifest.author ||= 'local-user';
  next.manifest.createdBy ||= 'ai';
  next.manifest.tags ||= [];

  for (const entity of next.schema.entities || []) {
    entity.id = normalizeFieldId(entity.id || entity.name || entity.displayName, 'entity');
    entity.name = entity.displayName || entity.label || entity.name || entity.id;
    entity.fields ||= [];
    const fieldIds = new Set();
    for (const [index, field] of entity.fields.entries()) {
      field.id = normalizeFieldId(field.id || field.name || field.label || field.displayName, `field_${index + 1}`);
      if (fieldIds.has(field.id)) field.id = `${field.id}_${index + 1}`;
      fieldIds.add(field.id);
      field.label = field.label || field.displayName || field.name || field.id;
      field.type = normalizeFieldType(field.type || 'text');
      if (field.type === 'select' || field.type === 'multiSelect') {
        field.options = normalizeOptions(field.options || field.config?.options || []);
        field.config = { ...(field.config || {}), options: field.options };
      }
      if (field.type === 'relation') {
        normalizeRelationField(field);
      }
    }
  }

  next.ui.pages ||= [];
  for (const page of next.ui.pages) {
    page.id = slugify(page.id || page.name || page.title || page.displayName || page.type, 'page');
    page.title = page.title || page.displayName || page.name || page.id;
    page.type = normalizePageType(page.type || 'list');
    if (!page.entity && page.bindEntity) page.entity = normalizeFieldId(page.bindEntity, 'entity');
    if (page.entity) page.entity = normalizeFieldId(page.entity, 'entity');
  }
  if (!next.ui.home) {
    next.ui.home = { layout: 'dashboard', cards: [] };
  }
  for (const card of next.ui.home.cards || []) {
    if (card.entity) card.entity = normalizeFieldId(card.entity, 'entity');
  }

  next.actions.actions ||= [];
  for (const action of next.actions.actions) {
    action.id = normalizeFieldId(action.id || action.name || action.displayName, 'action');
    action.name = action.displayName || action.name || action.id;
    action.type = normalizeActionType(action.type || 'data.queryRecords');
  }

  next.prompts.systemPrompt ||= '你是这个软件的助手，负责帮助用户使用和改进该软件。';
  next.prompts.suggestedCommands ||= [];
  return next;
}

function normalizeSchemaShape(schema) {
  if (Array.isArray(schema.entities)) return schema;
  const entities = [];
  for (const [key, value] of Object.entries(schema.properties || {})) {
    if (value?.type !== 'array' || !value.items?.properties) continue;
    entities.push({
      id: key,
      name: value.displayName || value.label || value.description || key,
      fields: Object.entries(value.items.properties).map(([fieldKey, field]) => ({
        id: fieldKey,
        label: field.label || field.displayName || field.description || fieldKey,
        type: field.type || 'text',
        required: Boolean(field.required),
        options: field.options || field.values
      }))
    });
  }
  return { entities };
}

function normalizeUiShape(ui, schema) {
  if (Array.isArray(ui.pages) && ui.pages.length > 0) return ui;
  const firstEntity = schema.entities?.[0]?.id;
  if (!firstEntity) return { ...ui, pages: [] };
  return {
    ...ui,
    home: ui.home || {
      layout: 'dashboard',
      cards: [{ type: 'stat', title: '记录总数', entity: firstEntity, operation: 'count' }]
    },
    pages: [
      {
        id: `${firstEntity}-list`,
        title: schema.entities[0]?.name ? `${schema.entities[0].name}列表` : '记录列表',
        type: 'list',
        entity: firstEntity,
        features: ['create', 'edit', 'delete', 'search', 'export']
      }
    ]
  };
}

function normalizeFieldType(type) {
  const value = String(type || '').trim();
  const map = {
    string: 'text',
    enum: 'select',
    bool: 'boolean',
    checkbox: 'boolean',
    long_text: 'textarea',
    multi_select: 'multiSelect',
    multiselect: 'multiSelect',
    integer: 'number',
    float: 'number',
    decimal: 'number',
    markdown: 'richText'
  };
  return map[value] || value;
}

function normalizePageType(type) {
  const value = String(type || '').trim();
  const map = {
    table: 'list',
    kanban: 'list',
    stats: 'dashboard',
    statistics: 'chart'
  };
  return map[value] || value;
}

function normalizeActionType(type) {
  const value = String(type || '').trim();
  const map = {
    ai: 'ai.generateText',
    generateText: 'ai.generateText',
    query: 'data.queryRecords',
    exportCsv: 'export.csv',
    exportMarkdown: 'export.markdown'
  };
  return map[value] || value;
}

export function normalizeOptions(options) {
  return options.map((option) => {
    if (typeof option === 'string') return optionObject(option);
    if (option && typeof option === 'object') {
      return optionObject(option.label || option.name || option.value || option.id || JSON.stringify(option), option);
    }
    return optionObject(String(option));
  });
}

function optionObject(label, option = {}) {
  const cleanLabel = String(label || '').trim() || '未命名';
  const rawId = normalizeFieldId(option.id || option.value || cleanLabel, 'opt');
  return {
    id: rawId === 'opt' ? `opt_${Math.abs(hashText(cleanLabel)).toString(36)}` : rawId,
    label: cleanLabel,
    color: SELECT_COLORS.includes(option.color) ? option.color : defaultOptionColor(cleanLabel)
  };
}

function defaultOptionColor(label) {
  if (/完成|成功|正常|已成交|已通过|充足/.test(label)) return 'green';
  if (/进行|处理中|审核|跟进|运输|计划/.test(label)) return 'blue';
  if (/取消|失败|拒绝|异常|阻塞|逾期|失效/.test(label)) return 'red';
  if (/高|重要|重点|需/.test(label)) return 'orange';
  if (/中|一般/.test(label)) return 'yellow';
  if (/低|暂缓|未/.test(label)) return 'gray';
  return SELECT_COLORS[Math.abs(hashText(label)) % SELECT_COLORS.length];
}

function hashText(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash;
}

function normalizeRelationField(field) {
  const config = { ...(field.config || {}) };
  field.targetEntity = normalizeFieldId(field.targetEntity || field.targetTableId || config.targetEntity || config.targetTableId, 'entity');
  field.displayField = normalizeFieldId(field.displayField || field.displayFieldId || config.displayField || config.displayFieldId, 'field');
  field.multiple = Boolean(field.multiple ?? config.multiple);
  field.allowCreateTargetRecord = Boolean(field.allowCreateTargetRecord ?? config.allowCreateTargetRecord);
  field.enableSearch = field.enableSearch ?? config.enableSearch ?? true;
  field.config = {
    ...config,
    targetEntity: field.targetEntity,
    displayField: field.displayField,
    multiple: field.multiple,
    allowCreateTargetRecord: field.allowCreateTargetRecord,
    enableSearch: field.enableSearch
  };
}

export function validatePackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object') errors.push('软件包必须是对象。');
  if (!pkg?.manifest?.name) errors.push('manifest.name 必填。');
  if (!pkg?.manifest?.id) errors.push('manifest.id 必填。');
  if (!Array.isArray(pkg?.schema?.entities) || pkg.schema.entities.length === 0) {
    errors.push('schema.entities 至少需要一个实体。');
  }
  const entityIds = new Set();
  const entities = pkg?.schema?.entities || [];
  for (const entity of pkg?.schema?.entities || []) {
    if (!entity.id) errors.push('entity.id 必填。');
    if (entityIds.has(entity.id)) errors.push(`实体 ID 重复：${entity.id}`);
    entityIds.add(entity.id);
    if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
      errors.push(`实体 ${entity.id} 至少需要一个字段。`);
    }
    const fieldIds = new Set();
    for (const field of entity.fields || []) {
      if (!field.id) errors.push(`实体 ${entity.id} 存在缺少 id 的字段。`);
      if (fieldIds.has(field.id)) errors.push(`实体 ${entity.id} 字段 ID 重复：${field.id}`);
      fieldIds.add(field.id);
      if (!FIELD_TYPES.has(field.type)) errors.push(`字段 ${field.id} 类型不支持：${field.type}`);
      if ((field.type === 'select' || field.type === 'multiSelect') && !Array.isArray(field.options)) {
        errors.push(`字段 ${field.id} 的 options 必须是数组。`);
      }
      if (field.type === 'select' || field.type === 'multiSelect') {
        for (const option of field.options || []) {
          if (!option?.id || !option?.label) errors.push(`字段 ${field.id} 的选项必须包含 id 和 label。`);
          if (!SELECT_COLORS.includes(option?.color)) errors.push(`字段 ${field.id} 的选项颜色不支持：${option?.color}`);
        }
      }
    }
  }
  for (const entity of entities) {
    for (const field of entity.fields || []) {
      if (field.type !== 'relation') continue;
      const target = entities.find((item) => item.id === field.targetEntity);
      if (!field.targetEntity || !target) errors.push(`关联字段 ${field.id} 引用了不存在的目标表：${field.targetEntity || ''}`);
      if (!field.displayField || (target && !target.fields?.some((item) => item.id === field.displayField))) {
        errors.push(`关联字段 ${field.id} 引用了不存在的展示字段：${field.displayField || ''}`);
      }
    }
  }
  const hasList = (pkg?.ui?.pages || []).some((page) => page.type === 'list');
  if (!hasList) errors.push('ui.pages 至少需要一个 list 页面。');
  for (const page of pkg?.ui?.pages || []) {
    if (!PAGE_TYPES.has(page.type)) errors.push(`页面 ${page.id} 类型不支持：${page.type}`);
    if (page.entity && !entityIds.has(page.entity)) errors.push(`页面 ${page.id} 引用了不存在的实体：${page.entity}`);
  }
  for (const action of pkg?.actions?.actions || []) {
    if (!ACTION_TYPES.has(action.type)) errors.push(`Action ${action.id} 类型不支持：${action.type}`);
  }
  if (errors.length) {
    const error = new Error(errors.join('\n'));
    error.details = errors;
    throw error;
  }
  return true;
}

export function preparePackage(pkg) {
  const normalized = normalizePackage(pkg);
  validatePackage(normalized);
  return normalized;
}

export function applyPatch(pkg, patch) {
  if (!patch || !Array.isArray(patch.operations)) {
    throw new Error('Patch 必须包含 operations 数组。');
  }
  const next = structuredClone(pkg);
  for (const rawOperation of patch.operations) {
    const operation = normalizePatchOperation(rawOperation, next);
    if (operation.op === 'noop') continue;
    if (!PATCH_OPS.has(operation.op)) {
      throw new Error(`不支持的 Patch 操作：${operation.op}`);
    }
    applyOperation(next, operation);
  }
  return preparePackage(next);
}

function normalizePatchOperation(operation, pkg) {
  const next = structuredClone(operation || {});
  next.op ||= next.action || next.operation;
  if (!next.op) return next;
  if (next.path) return normalizeJsonPatchOperation(next, pkg);
  if (PATCH_OPS.has(next.op)) return normalizePatchPayload(next);

  const verb = String(next.op).toLowerCase();
  const target = String(next.target || next.type || next.kind || inferPatchTarget(next)).toLowerCase();
  const map = {
    add: { entity: 'addEntity', field: 'addField', page: 'addPage', action: 'addAction', suggestedcommand: 'addSuggestedCommand' },
    create: { entity: 'addEntity', field: 'addField', page: 'addPage', action: 'addAction', suggestedcommand: 'addSuggestedCommand' },
    insert: { entity: 'addEntity', field: 'addField', page: 'addPage', action: 'addAction', suggestedcommand: 'addSuggestedCommand' },
    update: { field: 'updateField', page: 'updatePage', action: 'updateAction', description: 'updateDescription' },
    modify: { field: 'updateField', page: 'updatePage', action: 'updateAction', description: 'updateDescription' },
    remove: { field: 'removeField', page: 'removePage', action: 'removeAction' },
    delete: { field: 'removeField', page: 'removePage', action: 'removeAction' },
    rename: { app: 'renameApp', entity: 'renameEntity' }
  };
  const normalizedOp = map[verb]?.[target.replace(/[_\-\s]/g, '')];
  if (normalizedOp) next.op = normalizedOp;
  return normalizePatchPayload(next);
}

function normalizeJsonPatchOperation(operation, pkg) {
  const verb = String(operation.op).toLowerCase();
  const path = String(operation.path || '');
  const fieldMatch = path.match(/^\/schema\/entities\/(\d+)\/fields(?:\/(\d+|-))?$/);
  if (fieldMatch) {
    const entity = pkg.schema.entities[Number(fieldMatch[1])];
    if (!entity) return { op: 'noop' };
    if (verb === 'add') {
      return normalizePatchPayload({ op: 'addField', entity: entity.id, field: operation.value });
    }
    const field = entity.fields[Number(fieldMatch[2])];
    if (!field) return { op: 'noop' };
    if (verb === 'replace') return normalizePatchPayload({ op: 'updateField', entity: entity.id, fieldId: field.id, field: operation.value });
    if (verb === 'remove') return normalizePatchPayload({ op: 'removeField', entity: entity.id, fieldId: field.id });
  }

  const pageMatch = path.match(/^\/ui\/pages(?:\/(\d+|-))?$/);
  if (pageMatch) {
    if (verb === 'add') return normalizePatchPayload({ op: 'addPage', page: operation.value });
    const page = pkg.ui.pages[Number(pageMatch[1])];
    if (!page) return { op: 'noop' };
    if (verb === 'replace') return normalizePatchPayload({ op: 'updatePage', pageId: page.id, page: operation.value });
    if (verb === 'remove') return normalizePatchPayload({ op: 'removePage', pageId: page.id });
  }

  const actionMatch = path.match(/^\/actions\/actions(?:\/(\d+|-))?$/);
  if (actionMatch) {
    if (verb === 'add') return normalizePatchPayload({ op: 'addAction', action: operation.value });
    const action = pkg.actions.actions[Number(actionMatch[1])];
    if (!action) return { op: 'noop' };
    if (verb === 'replace') return normalizePatchPayload({ op: 'updateAction', actionId: action.id, action: operation.value });
    if (verb === 'remove') return normalizePatchPayload({ op: 'removeAction', actionId: action.id });
  }

  if (path === '/manifest/name' && verb === 'replace') return normalizePatchPayload({ op: 'renameApp', name: operation.value });
  if (path === '/manifest/description' && verb === 'replace') return normalizePatchPayload({ op: 'updateDescription', description: operation.value });
  if (path === '/prompts/suggestedCommands/-' && verb === 'add') return normalizePatchPayload({ op: 'addSuggestedCommand', command: operation.value });
  return { op: 'noop' };
}

function inferPatchTarget(operation) {
  if (operation.field || operation.fieldId || operation.field_id || operation.fieldName) return 'field';
  if (operation.page || operation.pageId || operation.page_id) return 'page';
  if (operation.action && typeof operation.action === 'object') return 'action';
  if (operation.actionId || operation.action_id) return 'action';
  if (operation.entity && typeof operation.entity === 'object') return 'entity';
  if (operation.command) return 'suggestedCommand';
  if (operation.description) return 'description';
  if (operation.name) return 'app';
  return '';
}

function normalizePatchPayload(operation) {
  const next = structuredClone(operation);
  if (typeof next.entity === 'string') next.entity = normalizeFieldId(next.entity, 'entity');
  if (next.entityId && !next.entity) next.entity = normalizeFieldId(next.entityId, 'entity');
  if (next.entity_id && !next.entity) next.entity = normalizeFieldId(next.entity_id, 'entity');

  if (next.field && !next.field.id && (next.field.name || next.field.displayName)) {
    next.field.id = next.field.name || next.field.displayName;
  }
  if (!next.field && next.op?.endsWith('Field')) {
    const fieldId = next.fieldId || next.field_id || next.fieldName || next.name || next.id;
    if (fieldId && next.op === 'addField') {
      next.field = {
        id: fieldId,
        label: next.label || next.displayName || next.fieldLabel || next.description || fieldId,
        type: next.fieldType || next.dataType || next.valueType || next.inputType || next.type || 'text',
        options: next.options || next.values
      };
    }
    next.fieldId ||= normalizeFieldId(fieldId, 'field');
  }
  if (next.field) {
    next.field.id = normalizeFieldId(next.field.id || next.field.name || next.field.label, 'field');
    next.field.label ||= next.field.displayName || next.field.name || next.field.id;
    next.field.type = normalizeFieldType(next.field.type || 'text');
    if (next.field.type === 'select' || next.field.type === 'multiSelect') {
      next.field.options = normalizeOptions(next.field.options || next.field.values || []);
    }
    if (next.field.type === 'relation') normalizeRelationField(next.field);
  }
  if (next.fieldId) next.fieldId = normalizeFieldId(next.fieldId, 'field');

  if (next.page) {
    next.page.id = slugify(next.page.id || next.page.name || next.page.title || next.page.displayName || 'page', 'page');
    next.page.title ||= next.page.displayName || next.page.name || next.page.id;
    next.page.type = normalizePageType(next.page.type || 'list');
    if (!next.page.entity && next.entity) next.page.entity = next.entity;
    if (next.page.entity) next.page.entity = normalizeFieldId(next.page.entity, 'entity');
  }
  if (next.pageId) next.pageId = slugify(next.pageId, 'page');
  if (next.page_id && !next.pageId) next.pageId = slugify(next.page_id, 'page');

  if (next.action && typeof next.action === 'object') {
    next.action.id = normalizeFieldId(next.action.id || next.action.name || next.action.displayName, 'action');
    next.action.name = next.action.displayName || next.action.name || next.action.id;
    next.action.type = normalizeActionType(next.action.type || 'data.queryRecords');
  }
  if (next.actionId) next.actionId = normalizeFieldId(next.actionId, 'action');
  if (next.action_id && !next.actionId) next.actionId = normalizeFieldId(next.action_id, 'action');

  if (typeof next.entity === 'object') {
    next.entity.id = normalizeFieldId(next.entity.id || next.entity.name || next.entity.displayName, 'entity');
    next.entity.name = next.entity.displayName || next.entity.label || next.entity.name || next.entity.id;
  }
  return next;
}

function findEntity(pkg, entityId) {
  const entity = pkg.schema.entities.find((item) => item.id === entityId);
  if (!entity) throw new Error(`找不到实体：${entityId}`);
  return entity;
}

function applyOperation(pkg, operation) {
  switch (operation.op) {
    case 'renameApp':
      pkg.manifest.name = operation.name || pkg.manifest.name;
      return;
    case 'updateDescription':
      pkg.manifest.description = operation.description || '';
      return;
    case 'addEntity':
      pkg.schema.entities.push(operation.entity);
      return;
    case 'renameEntity': {
      const entity = findEntity(pkg, operation.entity);
      entity.name = operation.name || entity.name;
      return;
    }
    case 'addField': {
      const entity = findEntity(pkg, operation.entity);
      const field = structuredClone(operation.field);
      field.id = normalizeFieldId(field.id || field.label, 'field');
      if (!entity.fields.some((item) => item.id === field.id)) entity.fields.push(field);
      return;
    }
    case 'updateField': {
      const entity = findEntity(pkg, operation.entity);
      const field = entity.fields.find((item) => item.id === operation.fieldId);
      if (!field) throw new Error(`找不到字段：${operation.fieldId}`);
      Object.assign(field, operation.field || {});
      return;
    }
    case 'removeField': {
      const entity = findEntity(pkg, operation.entity);
      entity.fields = entity.fields.filter((item) => item.id !== operation.fieldId);
      return;
    }
    case 'addPage':
      if (!pkg.ui.pages.some((page) => page.id === operation.page.id)) pkg.ui.pages.push(operation.page);
      return;
    case 'updatePage': {
      const page = pkg.ui.pages.find((item) => item.id === operation.pageId);
      if (!page) throw new Error(`找不到页面：${operation.pageId}`);
      Object.assign(page, operation.page || {});
      return;
    }
    case 'removePage':
      pkg.ui.pages = pkg.ui.pages.filter((item) => item.id !== operation.pageId);
      return;
    case 'addAction':
      if (!pkg.actions.actions.some((action) => action.id === operation.action.id)) pkg.actions.actions.push(operation.action);
      return;
    case 'updateAction': {
      const action = pkg.actions.actions.find((item) => item.id === operation.actionId);
      if (!action) throw new Error(`找不到 Action：${operation.actionId}`);
      Object.assign(action, operation.action || {});
      return;
    }
    case 'removeAction':
      pkg.actions.actions = pkg.actions.actions.filter((item) => item.id !== operation.actionId);
      return;
    case 'addSuggestedCommand':
      pkg.prompts.suggestedCommands ||= [];
      if (operation.command && !pkg.prompts.suggestedCommands.includes(operation.command)) {
        pkg.prompts.suggestedCommands.push(operation.command);
      }
      return;
    default:
      throw new Error(`不支持的 Patch 操作：${operation.op}`);
  }
}
