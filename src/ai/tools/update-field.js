import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { updateFieldInApp } from '../../services/operations.js';

const FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'multiSelect', 'date', 'datetime', 'boolean', 'image', 'file', 'formula', 'richText', 'relation'];

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
          type: { type: 'string', enum: FIELD_TYPES, description: 'New field type' },
          options: { type: 'array', items: { type: 'string' }, description: 'New options for select/multiSelect' }
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
    return updateFieldInApp(app, args.entityId, args.fieldId, patch);
  }
});
