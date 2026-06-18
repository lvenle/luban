import { register } from '../registry.js';
import { getDb } from '../../storage/db.js';

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
    const db = getDb();
    db.prepare('DELETE FROM record_relations WHERE appId = ? AND (sourceRecordId = ? OR targetRecordId = ?)').run(args.appId, args.recordId, args.recordId);
    const info = db.prepare('DELETE FROM records WHERE appId = ? AND id = ?').run(args.appId, args.recordId);
    if (info.changes === 0) throw new Error('Record not found');
    return { ok: true, deleted: info.changes };
  }
});
