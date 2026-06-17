import { register } from '../registry.js';
import { listRecords } from '../../models/record.js';

register({
  name: 'query_data',
  description: 'Query records from a table. Returns the most recent records with their field values.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'query_data',
      description: 'Query records from a table',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID to query' },
          limit: { type: 'number', description: 'Max records to return (default 10)' },
          q: { type: 'string', description: 'Search query text' }
        },
        required: ['appId', 'entityId']
      }
    }
  },
  handler: async (args) => {
    const records = listRecords(args.appId, { entityId: args.entityId, q: args.q || null });
    const result = records.slice(0, args.limit || 10);
    return { count: result.length, total: records.length, records: result };
  }
});
