import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { deleteFieldInApp } from '../../services/operations.js';

register({
  name: 'remove_field',
  description: 'Delete a field from a table. Also removes related relation references.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'remove_field',
      description: 'Delete a field from a table',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          fieldId: { type: 'string', description: 'Field ID to delete' }
        },
        required: ['appId', 'entityId', 'fieldId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    return deleteFieldInApp(app, args.entityId, args.fieldId);
  }
});
