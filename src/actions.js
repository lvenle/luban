import { listRecords } from './models/record.js';
import { toCsv, toMarkdown } from './utils/export.js';

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
