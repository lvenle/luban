import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'design_form',
  description: 'Persist the form layout field order and column count for a table.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'design_form',
      description: 'Configure form layout field order and columns',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity ID' },
          fieldOrder: { type: 'array', items: { type: 'string' }, description: 'Field IDs in desired order' },
          columns: { type: 'number', enum: [1, 2, 3, 4], description: 'Number of columns' }
        },
        required: ['appId', 'entityId', 'fieldOrder']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const entity = pkg.schema.entities.find((item) => item.id === args.entityId);
    if (!entity) throw new Error('找不到表。');
    const fieldSet = new Set(entity.fields.map((field) => field.id));
    const order = [...new Set(args.fieldOrder || [])].filter((id) => fieldSet.has(id));
    for (const field of entity.fields) if (!order.includes(field.id)) order.push(field.id);
    entity.formLayout = { columns: [1, 2, 3, 4].includes(Number(args.columns)) ? Number(args.columns) : 2, order };
    const saved = updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
    return { appId: saved.id, entityId: entity.id, formLayout: entity.formLayout };
  }
});
