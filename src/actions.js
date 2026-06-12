import { listRecords } from './db.js';

export async function runAction(app, actionId) {
  const action = app.actions.actions.find((item) => item.id === actionId);
  if (!action) throw new Error('找不到 Action。');
  const entityId = action.input?.records || app.schema.entities[0]?.id;
  const records = entityId ? listRecords(app.id, { entityId }) : [];
  const entity = app.schema.entities.find((item) => item.id === entityId);
  switch (action.type) {
    case 'data.queryRecords':
      return { type: 'json', result: records };
    case 'export.csv':
      return { type: 'text', result: toCsv(records, entity) };
    case 'export.json':
      return { type: 'json', result: records };
    case 'export.markdown':
      return { type: 'text', result: toMarkdown(records) };
    case 'ai.generateText':
    case 'ai.rewriteText':
    case 'ai.summarize':
      return { type: 'text', result: generateMockText(action, records) };
    default:
      throw new Error(`不支持的 Action 类型：${action.type}`);
  }
}

function generateMockText(action, records) {
  if (action.id.includes('article')) {
    const latest = records[0]?.data || {};
    return `# ${latest.topic || '一篇新的公众号文章'}\n\n## 大纲\n\n1. 读者痛点\n2. 核心观点\n3. 可执行建议\n\n## 正文\n\n这是一篇面向${latest.audience || '目标读者'}的${latest.style || '清晰'}风格文章。它围绕主题展开，先指出问题，再给出方法，最后留下一个可行动的结尾。`;
  }
  if (records.length === 0) return '目前还没有数据。先添加几条记录，我就能生成更有用的总结。';
  return `已分析 ${records.length} 条记录。整体数据已经保存，可继续补充记录或增加统计页面。`;
}

export function toCsv(records, entity = null) {
  const fields = entity?.fields?.length
    ? entity.fields
    : [...new Set(records.flatMap((record) => Object.keys(record.data)))].map((id) => ({ id, label: id }));
  const lines = [fields.map((field) => csvEscape(field.label || field.id)).join(',')];
  for (const record of records) {
    lines.push(fields.map((field) => csvEscape(displayExportValue(record.data[field.id], field))).join(','));
  }
  return lines.join('\n');
}

function displayExportValue(value, field = {}) {
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).join('、');
  if (field.type === 'relation') return (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => item.displayValue || item).join('、');
  if (field.type === 'image' || field.type === 'file') return fileLabel(value);
  if (Array.isArray(value)) return value.join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.optionId || '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value ?? '';
}

function fileLabel(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(fileLabel).filter(Boolean).join('、');
  if (typeof value === 'object') return value.name || value.filename || value.label || value.url || '';
  return value;
}

function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function toMarkdown(records) {
  return records
    .map((record, index) => {
      const lines = [`## 记录 ${index + 1}`];
      for (const [key, value] of Object.entries(record.data)) {
        lines.push(`- ${key}: ${displayExportValue(value)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}
