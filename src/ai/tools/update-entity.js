import { register } from '../registry.js';
import { updateTableInApp } from '../../operations.js';

register({
  name: 'update_entity',
  description: 'Rename or update description of an existing table/entity.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'update_entity',
      description: 'Update table name or description',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          name: { type: 'string', description: 'New table name' },
          description: { type: 'string', description: 'New description' }
        },
        required: ['appId', 'entityId']
      }
    }
  },
  handler: async (args, { app }) => {
    return updateTableInApp(app, args.entityId, { name: args.name, description: args.description });
  }
});
