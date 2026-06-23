import { register } from '../registry.js';
import { deleteRecordForApp } from '../../models/record.js';

register({
  name: 'delete_record',
  description: 'Delete a record and its relation references.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'delete_record',
      description: 'Delete a record',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          recordId: { type: 'string', description: 'Record ID to delete' }
        },
        required: ['appId', 'recordId']
      }
    }
  },
  handler: async (args) => {
    const deleted = deleteRecordForApp(args.appId, args.recordId, { force: true });
    return { ok: true, deleted: deleted ? 1 : 0 };
  }
});
