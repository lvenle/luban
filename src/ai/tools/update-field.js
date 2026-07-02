import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { updateFieldInApp } from '../../services/operations.js';
import { FIELD_TYPES } from '../../core/contract.js';

const TOOL_FIELD_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');

register({
  name: 'update_field',
  description: 'Modify an existing field: rename, change type, or update options.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'update_field',
      description: 'Modify an existing field',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          fieldId: { type: 'string', description: 'Field ID' },
          label: { type: 'string', description: 'New field display name' },
          type: { type: 'string', enum: TOOL_FIELD_TYPES, description: 'New field type' },
          options: { type: 'array', items: { type: 'string' }, description: 'New options for select/multiSelect' },
          autoNumber: { type: 'object', description: 'Auto-number settings: start, step, prefix' }
        },
        required: ['appId', 'entityId', 'fieldId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const patch = {};
    if (args.label) patch.label = args.label;
    if (args.type) patch.type = args.type;
    const options = args.options;
    if (options) patch.options = options.map((opt) => ({ id: opt, label: opt }));
    if (args.autoNumber) patch.autoNumber = args.autoNumber;
    return updateFieldInApp(app, args.entityId, args.fieldId, patch);
  }
});
