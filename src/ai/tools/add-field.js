import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { createFieldInApp } from '../../operations.js';

register({
  name: 'add_field',
  description: 'Add a new field to a table. Supports types: text, number, textarea, select, multiSelect, date, datetime, boolean, email, phone, url, color, rating, image, file, relation.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_field',
      description: 'Add a new field to a table',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          label: { type: 'string', description: 'Field display name' },
          type: { type: 'string', enum: ['text', 'number', 'textarea', 'select', 'multiSelect', 'date', 'datetime', 'boolean', 'email', 'phone', 'url', 'color', 'rating'], description: 'Field type' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options for select/multiSelect fields' },
          required: { type: 'boolean', description: 'Whether field is required' }
        },
        required: ['appId', 'entityId', 'label', 'type']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const field = { label: args.label, type: args.type };
    if (args.options) field.options = args.options.map((opt) => ({ id: opt, label: opt }));
    if (args.required) field.required = true;
    return createFieldInApp(app, args.entityId, field);
  }
});
