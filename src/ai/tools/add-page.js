import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'add_page',
  description: 'Create a new page for a table. Supports list (table view), chart (chart view), dashboard (dashboard with cards), and blank page types.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_page',
      description: 'Create a new page for a table',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID the page is for' },
          title: { type: 'string', description: 'Page title' },
          type: { type: 'string', enum: ['list', 'chart', 'dashboard', 'blank'], description: 'Page type' }
        },
        required: ['appId', 'entityId', 'title', 'type']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const pageId = `${args.entityId}-${args.type}-${Date.now()}`;
    const page = {
      id: pageId,
      title: args.title,
      type: args.type,
      entity: args.entityId,
      navKind: args.type === 'blank' ? 'page' : 'table'
    };
    if (args.type === 'list') page.features = ['create', 'edit', 'delete', 'search', 'export'];
    if (args.type === 'chart') page.charts = [];
    if (args.type === 'dashboard') page.cards = [];
    pkg.ui.pages.push(page);
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
