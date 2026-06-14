import { normalizeFieldId } from './ids.js';
import { normalizeOptions, SELECT_COLORS } from './packageProtocol.js';
import { pickSamplePackage } from './samplePackages.js';

function firstEntity(pkg) {
  return pkg.schema.entities[0]?.id || 'record';
}

export function mockPatch(prompt, pkg) {
  let text = String(prompt || '');
  try {
    const parsed = JSON.parse(text);
    if (parsed.request) {
      text = parsed.request;
    }
  } catch {}

  let entity = null;
  for (const candidate of pkg.schema.entities) {
    if (text.includes(candidate.name) || text.includes(candidate.id)) {
      entity = candidate.id;
      break;
    }
  }
  if (!entity) entity = firstEntity(pkg);
  const entityDef = pkg.schema.entities.find((item) => item.id === entity) || pkg.schema.entities[0];
  if (/页面|入口|列表页|统计页|图表页|看板/.test(text) && /创建|新建|新增|增加|添加|生成/.test(text)) {
    const pageType = /统计|图表/.test(text) ? 'chart' : /看板|仪表盘/.test(text) ? 'dashboard' : /编辑/.test(text) ? 'editor' : 'list';
    const title = extractPageTitle(text, entityDef, pageType);
    const page = {
      id: uniqueMockPageId(pkg, entity, title),
      title,
      type: pageType,
      entity
    };
    if (pageType === 'list') page.features = ['create', 'edit', 'delete', 'search', 'export'];
    if (pageType === 'chart') {
      const groupField = chooseGroupField(entityDef);
      page.chart = { type: 'bar', groupBy: groupField.id, value: 'count' };
    }
    if (pageType === 'dashboard') {
      page.cards = [{ type: 'stat', title: `${entityDef?.name || '记录'}数量`, entity, operation: 'count' }];
    }
    return {
      summary: `增加${title}`,
      operations: [{ op: 'addPage', page }]
    };
  }
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

  let label = raw.replace(/[{}\[\]"']/g, '').trim();
  if (!label) return null;

  const type = inferFieldType(label);

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

function extractPageTitle(text, entityDef, pageType) {
  const clean = String(text || '')
    .replace(/帮我|请|给|为|新增|增加|添加|创建|新建|生成|一个|页面|入口/g, '')
    .replace(/绑定|基于/g, '')
    .replace(/[，。,.!！?？\s]+/g, '');
  const suffix = pageType === 'chart' ? '统计' : pageType === 'dashboard' ? '看板' : pageType === 'editor' ? '编辑' : '列表';
  const fallback = `${entityDef?.name || '记录'}${suffix}`;
  return clean && clean.length <= 14 ? clean : fallback;
}

function uniqueMockPageId(pkg, entity, title) {
  const used = new Set((pkg.ui?.pages || []).map((page) => page.id));
  const base = normalizeFieldId(`${entity}_${title}`, 'page').replaceAll('_', '-');
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function chooseGroupField(entityDef) {
  return entityDef?.fields?.find((field) => field.type === 'select' || field.type === 'boolean') || entityDef?.fields?.[0] || { id: 'status', label: '状态' };
}

function fieldLabel(field) {
  return field?.label || field?.id || '记录';
}
