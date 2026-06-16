import { register } from '../registry.js';

register({
  name: 'create_view',
  description: 'Create a new table view with specific visible fields, filters, sorts. This is a client-side operation executed in the browser.',
  risk: 'low',
  clientOnly: true,
  schema: {
    type: 'function',
    function: {
      name: 'create_view',
      description: 'Create a table view',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity ID' },
          name: { type: 'string', description: 'View name' },
          visibleFields: { type: 'array', items: { type: 'string' }, description: 'Field IDs to show' },
          sorts: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } }, description: 'Sort config' }
        },
        required: ['appId', 'entityId', 'name']
      }
    }
  },
  handler: async () => {
    return { clientSide: true, message: 'This tool runs in the browser' };
  }
});
