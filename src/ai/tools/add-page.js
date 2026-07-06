import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'add_page',
  description: 'Create a new data page, dashboard, or complete HTML webpage. Use webpage with content when the user asks AI to create a web page. If the user asks to modify the current page, use update_page instead.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_page',
      description: 'Create a data page, dashboard, or HTML webpage',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID for a data page; omit for dashboard or webpage' },
          title: { type: 'string', description: 'Page title' },
          type: { type: 'string', enum: ['list', 'chart', 'dashboard', 'blank', 'webpage'], description: 'Page type. Use webpage for a complete standalone HTML page.' },
          content: { type: 'string', description: 'Complete HTML document source, required when type is webpage. Include <!doctype html>, head, responsive CSS, and body.' }
        },
        required: ['appId', 'title', 'type']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const pageId = `${args.entityId || args.type}-${Date.now()}`;
    let page;
    if (args.type === 'webpage') {
      if (!String(args.content || '').trim()) throw new Error('网页内容不能为空');
      page = { id: pageId, title: args.title, type: 'page', navKind: 'webpage', content: args.content };
    } else if (args.type === 'dashboard' || args.type === 'blank') {
      page = { id: pageId, title: args.title, type: args.type === 'dashboard' ? 'dashboard' : 'page', navKind: 'dashboard', cards: [] };
    } else {
      if (!args.entityId) throw new Error('数据页面需要指定数据表');
      page = {
        id: pageId,
        title: args.title,
        type: 'page',
        navKind: 'page',
        entity: args.entityId,
        features: ['create', 'edit', 'delete', 'search', 'export']
      };
    }
    pkg.ui.pages.push(page);
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
