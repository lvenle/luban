import { register } from '../registry.js';
import { getApp } from '../../db.js';
import { deleteTableInApp } from '../../operations.js';

register({
  name: 'remove_entity',
  description: 'Delete a table and all its data. This also removes related pages and relation references.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'remove_entity',
      description: 'Delete a table and its data',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID to delete' }
        },
        required: ['appId', 'entityId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    return deleteTableInApp(app, args.entityId);
  }
});
