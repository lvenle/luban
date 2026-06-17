import { register } from '../registry.js';
import { updateRecord, getRecord } from '../../models/record.js';

register({
  name: 'update_record',
  description: 'Update an existing record with new field values.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'update_record',
      description: 'Update a record',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          recordId: { type: 'string', description: 'Record ID to update' },
          data: { type: 'object', description: 'Field values to update', additionalProperties: true }
        },
        required: ['appId', 'recordId', 'data']
      }
    }
  },
  handler: async (args) => {
    const record = getRecord(args.appId, args.recordId);
    if (!record) throw new Error('Record not found');
    const merged = { ...record.data, ...args.data };
    return updateRecord(args.appId, args.recordId, merged);
  }
});
