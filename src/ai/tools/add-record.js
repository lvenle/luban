import { register } from '../registry.js';
import { createRecord } from '../../models/record.js';

register({
  name: 'add_record',
  description: 'Add a new record to a table.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_record',
      description: 'Add a new record',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          data: { type: 'object', description: 'Record field values as key-value pairs', additionalProperties: true }
        },
        required: ['appId', 'entityId', 'data']
      }
    }
  },
  handler: async (args) => {
    return createRecord(args.appId, args.entityId, args.data);
  }
});
