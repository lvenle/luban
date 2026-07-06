import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'update_page',
  description: 'Modify the current page. For HTML webpages or Markdown documents, replace their complete source using content. For dashboards, append cards instead of replacing existing cards.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'update_page',
      description: 'Modify the current page, including complete HTML or Markdown source. Dashboard cards merge into existing content.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          pageId: { type: 'string', description: 'Page ID to modify' },
          title: { type: 'string', description: 'New page title (optional)' },
          type: { type: 'string', enum: ['list', 'chart', 'dashboard', 'blank', 'webpage', 'markdown'], description: 'New page type (optional)' },
          entityId: { type: 'string', description: 'Entity/table ID for the page (optional)' },
          content: { type: 'string', description: 'Complete replacement source for the current HTML webpage or Markdown document. Return the entire revised document, not a patch or excerpt.' },
          chart: {
            type: 'object',
            description: 'WARNING: This REPLACES the full page with a chart view. Do NOT use on pages that already have content. For adding a chart to an existing page, use cards instead with type:"chart". Example: {"groupBy": "field_id", "value": "count"}.',
            properties: {
              groupBy: { type: 'string', description: 'Field ID to group records by' },
              value: { type: 'string', description: '"count" for record count, or a numeric field ID to sum values' }
            }
          },
          cards: {
            type: 'array',
            description: 'Cards to APPEND to the page. Cards merge into existing content and do NOT replace it. Card types: stat (number card), chart (bar chart), pie (pie chart), line (line chart). stat example: {"type":"stat","entity":"task","operation":"count"}. chart/pie/line example: {"type":"chart","entity":"task","groupBy":"task_type"}. groupBy accepts field ID or field label.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Card display title' },
                type: { type: 'string', enum: ['stat', 'chart', 'pie', 'line'], description: '"stat" for number card, "chart" for bar chart, "pie" for pie chart, "line" for line chart' },
                entity: { type: 'string', description: 'Entity ID to count/sum records from' },
                operation: { type: 'string', enum: ['count', 'sum'], description: '"count" for record count, "sum" to sum a field (only for type=stat)' },
                field: { type: 'string', description: 'Field ID to sum (only when operation is "sum")' },
                groupBy: { type: 'string', description: 'Field ID to group by (only for type=chart)' },
                filter: { type: 'object', description: 'Optional filter to narrow records' }
              },
              required: ['title', 'entity']
            }
          }
        },
        required: ['appId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');

    const pkg = getPackageFromApp(app);
    // Try exact pageId match, then fallback to first page with matching entity
    let targetPage = pkg.ui.pages.find((p) => p.id === args.pageId);
    if (!targetPage && args.entityId) {
      targetPage = pkg.ui.pages.find((p) => p.entity === args.entityId);
    }
    if (!targetPage) throw new Error(`Page not found: ${args.pageId || args.entityId}`);

    if (args.title) targetPage.title = args.title;
    if (args.type === 'webpage') {
      targetPage.type = 'page';
      targetPage.navKind = 'webpage';
    } else if (args.type === 'markdown') {
      targetPage.type = 'page';
      targetPage.navKind = 'markdown';
    } else if (args.type === 'dashboard') {
      targetPage.type = 'dashboard';
      targetPage.navKind = 'dashboard';
    } else if (args.type) {
      targetPage.type = 'page';
      targetPage.navKind = 'page';
    }
    if (typeof args.content === 'string') {
      if (!['webpage', 'markdown'].includes(targetPage.navKind)) throw new Error('只有网页或 Markdown 文档支持直接修改完整内容');
      targetPage.content = args.content;
    }
    if (args.entityId) {
      targetPage.entity = args.entityId;
      targetPage.features = ['create', 'edit', 'delete', 'search', 'export'];
    }
    if (args.chart) {
      targetPage.chart = args.chart;
      targetPage.type = 'page';
      targetPage.navKind = 'page';
      if (!targetPage.entity && args.entityId) targetPage.entity = args.entityId;
    }
    if (args.cards) {
      const existing = targetPage.cards || [];
      const cardTitles = new Set(existing.map((c) => c.title));
      const newCards = args.cards.filter((c) => !cardTitles.has(c.title));
      targetPage.cards = [...existing, ...newCards];
      targetPage.type = 'page';
      targetPage.navKind = 'page';
      if (!targetPage.entity && args.entityId) targetPage.entity = args.entityId;
    }

    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
