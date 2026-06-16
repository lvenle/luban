import { register } from '../registry.js';
import { getApp, getPackageFromApp, updateAppPackage } from '../../db.js';

register({
  name: 'remove_page',
  description: 'Delete a page from the app.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'remove_page',
      description: 'Delete a page',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          pageId: { type: 'string', description: 'Page ID to delete' }
        },
        required: ['appId', 'pageId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    pkg.ui.pages = pkg.ui.pages.filter((p) => p.id !== args.pageId);
    return updateAppPackage(app.id, pkg);
  }
});
