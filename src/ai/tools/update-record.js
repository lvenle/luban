import { register } from '../registry.js';
import { getRecordForApp } from '../../models/record.js';
import { updateRecordWithRules } from '../../services/rule-runtime.js';

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
    const record = getRecordForApp(args.appId, args.recordId);
    if (!record) throw new Error('Record not found');
    const merged = { ...record.data, ...args.data };
    return updateRecordWithRules(args.appId, args.recordId, merged).record;
  }
});
