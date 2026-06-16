import { register } from '../registry.js';

register({
  name: 'design_form',
  description: 'Configure the form layout field order and column count for a table. This is a client-side operation executed in the browser.',
  risk: 'low',
  clientOnly: true,
  schema: {
    type: 'function',
    function: {
      name: 'design_form',
      description: 'Configure form layout field order and columns',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity ID' },
          fieldOrder: { type: 'array', items: { type: 'string' }, description: 'Field IDs in desired order' },
          columns: { type: 'number', enum: [1, 2, 3, 4], description: 'Number of columns' }
        },
        required: ['appId', 'entityId', 'fieldOrder']
      }
    }
  },
  handler: async () => {
    return { clientSide: true, message: 'This tool runs in the browser' };
  }
});
