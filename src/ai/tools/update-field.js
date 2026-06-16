import { register } from '../registry.js';
import { getApp } from '../../db.js';
import { updateFieldInApp } from '../../operations.js';

register({
  name: 'update_field',
  description: 'Modify an existing field: rename, change type, update options, toggle required.',
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
          type: { type: 'string', description: 'New field type' },
          options: { type: 'array', items: { type: 'string' }, description: 'New options for select/multiSelect' },
          required: { type: 'boolean', description: 'Whether field is required' }
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
    if (args.options) patch.options = args.options.map((opt) => ({ id: opt, label: opt }));
    if (args.required !== undefined) patch.required = args.required;
    return updateFieldInApp(app, args.entityId, args.fieldId, patch);
  }
});
