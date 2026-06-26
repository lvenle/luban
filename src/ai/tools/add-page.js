import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'add_page',
  description: 'Create a new page for a table. Only use when the user EXPLICITLY asks to create a new page. If the user asks to add a chart or content to the CURRENT page, use update_page instead.',
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
      type: 'page',
      navKind: 'page',
      entity: args.entityId
    };
    if (args.entityId) page.features = ['create', 'edit', 'delete', 'search', 'export'];
    pkg.ui.pages.push(page);
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
