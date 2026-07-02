// Protocol contract — single source of truth for the .sgpkg protocol metadata.
// Each registry supports both metadata lookup (FIELD_TYPES.text) and
// backward-compatible Set patterns (.has(), [Symbol.iterator], .size).

function createRegistry(entries) {
  const record = Object.fromEntries(entries.map(({ id, ...rest }) => [id, { id, ...rest }]));
  const registry = { ...record };
  Object.defineProperties(registry, {
    has: { value: (key) => key in record, enumerable: false, writable: true },
    keys: { value: () => Object.keys(record), enumerable: false, writable: true },
    values: { value: () => Object.values(record), enumerable: false, writable: true },
    entries: { value: () => Object.entries(record), enumerable: false, writable: true },
    size: { get: () => Object.keys(record).length, enumerable: false },
    [Symbol.iterator]: { value: function* () { yield* Object.keys(record); }, enumerable: false, writable: true }
  });
  return Object.freeze(registry);
}

// ── Field types ──────────────────────────────────────────────────────────

const FIELD_TYPES_RECORD = [
  { id: 'text',       label: '文本',     category: 'basic',    supportsDefault: true,  supportsFormula: false, toolAllowed: true, isTextLikeType: true,                 description: '单行文本' },
  { id: 'textarea',   label: '多行文本',   category: 'basic',    supportsDefault: true,  supportsFormula: false, toolAllowed: true, isTextLikeType: true,                 description: '多行文本' },
  { id: 'number',     label: '数字',     category: 'basic',    supportsDefault: true,  supportsFormula: true,  toolAllowed: true, isNumericType: true,                  description: '数值' },
  { id: 'autoNumber', label: '自增序号', category: 'computed', supportsDefault: false, supportsFormula: false, toolAllowed: true, isAutoNumberType: true,               description: '系统自动生成且不会重复使用的递增序号' },
  { id: 'date',       label: '日期',     category: 'basic',    supportsDefault: true,  supportsFormula: true,  toolAllowed: true, isDateType: true, isTemporalType: true,   description: '日期（不含时间）' },
  { id: 'datetime',   label: '日期时间',   category: 'basic',    supportsDefault: true,  supportsFormula: false, toolAllowed: true, isDateType: true, isDateTimeType: true, isTemporalType: true, description: '日期和时间' },
  { id: 'url',        label: '链接',     category: 'basic',    supportsDefault: false, supportsFormula: false, toolAllowed: true,                               description: '超链接' },
  { id: 'select',     label: '单选',     category: 'choice',   supportsDefault: false, supportsFormula: false, toolAllowed: true, isChoiceType: true, isSingleChoiceType: true, description: '下拉单选' },
  { id: 'multiSelect', label: '多选',    category: 'choice',   supportsDefault: false, supportsFormula: false, toolAllowed: true, isChoiceType: true, isMultiChoiceType: true,  description: '下拉多选' },
  { id: 'relation',   label: '关联',     category: 'relation', supportsDefault: false, supportsFormula: false, toolAllowed: true, isRelationType: true,               description: '关联到另一张表的记录' },
  { id: 'image',      label: '图片',     category: 'media',    supportsDefault: false, supportsFormula: false, toolAllowed: true, isFileLikeType: true,               description: '图片文件' },
  { id: 'file',       label: '文件',     category: 'media',    supportsDefault: false, supportsFormula: false, toolAllowed: true, isFileLikeType: true,               description: '附件文件' },
  { id: 'richText',   label: '富文本',    category: 'basic',    supportsDefault: false, supportsFormula: false, toolAllowed: true, isTextLikeType: true,               description: '支持 Markdown 的富文本' },
  { id: 'formula',    label: '公式',     category: 'computed', supportsDefault: false, supportsFormula: false, toolAllowed: true, isFormulaType: true,                description: '基于其他字段计算的公式' },
  { id: 'ai',         label: 'AI 字段',  category: 'computed', supportsDefault: false, supportsFormula: false, toolAllowed: false, isAiType: true,                     description: 'AI 自动生成内容' }
];

export const FIELD_TYPES = createRegistry(FIELD_TYPES_RECORD);
export const FIELD_TYPE_IDS = FIELD_TYPES_RECORD.map((e) => e.id);

// ── Field type helpers ───────────────────────────────────────────────────

export function getFieldTypeMeta(type) {
  return FIELD_TYPES[type] || null;
}

export function isFieldType(fieldOrType, prop) {
  const type = typeof fieldOrType === 'string' ? fieldOrType : fieldOrType?.type;
  return Boolean(getFieldTypeMeta(type)?.[prop]);
}

export function fieldTypeId(type) {
  return FIELD_TYPES[type]?.id || type || 'text';
}

// ── Table view types ─────────────────────────────────────────────────────

const TABLE_VIEW_TYPES_RECORD = [
  { id: 'list',     label: '列表',   category: 'standard',    description: '标准数据表格' },
  { id: 'quadrant', label: '四象限',  category: 'specialized', description: '四象限看板（基于 select 字段）' },
  { id: 'gantt',    label: '甘特图',  category: 'specialized', description: '甘特图（需两个日期字段）' }
];

export const TABLE_VIEW_TYPES = createRegistry(TABLE_VIEW_TYPES_RECORD);
export const TABLE_VIEW_TYPE_IDS = TABLE_VIEW_TYPES_RECORD.map((e) => e.id);

// ── Select option colors ─────────────────────────────────────────────────
// Array form for backward compat (indexing by position + .includes)

const SELECT_COLORS_RECORD = [
  { id: 'gray',   label: '灰色',   css: '#6b7280', category: 'neutral' },
  { id: 'red',    label: '红色',   css: '#ef4444', category: 'alert' },
  { id: 'orange', label: '橙色',   css: '#f97316', category: 'warm' },
  { id: 'yellow', label: '黄色',   css: '#eab308', category: 'warm' },
  { id: 'lime',   label: '青柠',   css: '#84cc16', category: 'vivid' },
  { id: 'green',  label: '绿色',   css: '#22c55e', category: 'positive' },
  { id: 'cyan',   label: '青色',   css: '#06b6d4', category: 'cool' },
  { id: 'blue',   label: '蓝色',   css: '#3b82f6', category: 'primary' },
  { id: 'purple', label: '紫色',   css: '#a855f7', category: 'vivid' },
  { id: 'pink',   label: '粉色',   css: '#ec4899', category: 'warm' }
];

export const SELECT_COLORS = SELECT_COLORS_RECORD.map((c) => c.id);
export const SELECT_COLORS_META = Object.fromEntries(
  SELECT_COLORS_RECORD.map((c) => [c.id, c])
);
export const SELECT_COLOR_IDS = SELECT_COLORS;

// ── Page types ───────────────────────────────────────────────────────────

const PAGE_TYPES_RECORD = [
  { id: 'page',      label: '页面',  category: 'content',     hasPageSize: true, description: '标准内容页面（form/detail/统计仪表台等均归一为 page）' },
  { id: 'table',     label: '数据表', category: 'content',     hasPageSize: true, description: '数据表格页面（含筛选/排序/分组/视图）' },
  { id: 'link',      label: '链接',  category: 'navigation',  hasPageSize: false, description: '外部或内部链接快捷入口' },
  { id: 'dashboard', label: '看板',  category: 'display',     hasPageSize: false, description: '统计卡片看板（独立渲染入口，不依赖 entity views）' }
];

export const PAGE_TYPES = createRegistry(PAGE_TYPES_RECORD);
export const PAGE_TYPE_IDS = PAGE_TYPES_RECORD.map((e) => e.id);

// ── Action types ─────────────────────────────────────────────────────────

const ACTION_TYPES_RECORD = [
  { id: 'ai.generateText',   label: 'AI 生成文本',  category: 'ai',     description: '使用 AI 生成文本内容' },
  { id: 'ai.rewriteText',    label: 'AI 改写文本',  category: 'ai',     description: '使用 AI 改写已有文本' },
  { id: 'ai.summarize',      label: 'AI 总结',     category: 'ai',     description: '使用 AI 总结数据' },
  { id: 'data.createRecord', label: '创建记录',    category: 'data',   description: '创建新记录' },
  { id: 'data.updateRecord', label: '更新记录',    category: 'data',   description: '更新已有记录' },
  { id: 'data.queryRecords', label: '查询记录',    category: 'data',   description: '查询满足条件的记录' },
  { id: 'data.deleteRecord', label: '删除记录',    category: 'data',   description: '删除记录' },
  { id: 'export.markdown',   label: '导出 Markdown', category: 'export', description: '导出为 Markdown' },
  { id: 'export.json',       label: '导出 JSON',   category: 'export', description: '导出为 JSON' },
  { id: 'export.csv',        label: '导出 CSV',    category: 'export', description: '导出为 CSV' }
];

export const ACTION_TYPES = createRegistry(ACTION_TYPES_RECORD);
export const ACTION_TYPE_IDS = ACTION_TYPES_RECORD.map((e) => e.id);

// ── Patch operations ─────────────────────────────────────────────────────

const PATCH_OPS_RECORD = [
  { id: 'renameApp',          label: '重命名应用',      category: 'app',    description: '修改应用名称' },
  { id: 'updateDescription',  label: '更新描述',        category: 'app',    description: '修改应用描述' },
  { id: 'addEntity',          label: '添加表',          category: 'entity', description: '添加新数据表' },
  { id: 'renameEntity',       label: '重命名表',        category: 'entity', description: '重命名已有数据表' },
  { id: 'addField',           label: '添加字段',        category: 'field',  description: '向表添加一个或多个字段' },
  { id: 'updateField',        label: '修改字段',        category: 'field',  description: '修改已有字段属性' },
  { id: 'removeField',        label: '删除字段',        category: 'field',  description: '从表删除字段' },
  { id: 'addPage',            label: '添加页面',        category: 'page',   description: '添加新页面入口' },
  { id: 'updatePage',         label: '修改页面',        category: 'page',   description: '修改页面属性' },
  { id: 'removePage',         label: '删除页面',        category: 'page',   description: '删除页面入口' },
  { id: 'addAction',          label: '添加 Action',     category: 'action', description: '添加预设操作' },
  { id: 'updateAction',       label: '修改 Action',     category: 'action', description: '修改预设操作' },
  { id: 'removeAction',       label: '删除 Action',     category: 'action', description: '删除预设操作' },
  { id: 'addSuggestedCommand', label: '添加建议命令',   category: 'other',  description: '添加 AI 建议命令' }
];

export const PATCH_OPS = createRegistry(PATCH_OPS_RECORD);
export const PATCH_OP_IDS = PATCH_OPS_RECORD.map((e) => e.id);
