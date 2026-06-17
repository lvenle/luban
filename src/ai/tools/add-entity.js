import { register } from '../registry.js';
import { createTableInApp } from '../../operations.js';
import { getPackageFromApp } from '../../db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'add_entity',
  description: 'Create a new table/entity in an app. The table will automatically get a default list page.',
  risk: 'medium',
  schema: {
    type: 'function',
    function: {
      name: 'add_entity',
      description: 'Create a new table in the app',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          name: { type: 'string', description: 'Table name' },
          description: { type: 'string', description: 'Table description' }
        },
        required: ['appId', 'name']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    return createTableInApp(app, { name: args.name, description: args.description || '' });
  }
});
