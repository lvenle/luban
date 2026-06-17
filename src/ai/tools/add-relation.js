import { register } from '../registry.js';
import { getApp, getPackageFromApp, updateAppPackage } from '../../db.js';

register({
  name: 'add_relation',
  description: 'Create a relation field between two tables. The field is added to the source table.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_relation',
      description: 'Create a relation between two tables',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          sourceEntityId: { type: 'string', description: 'Source table ID (the table that will have the relation field)' },
          targetEntityId: { type: 'string', description: 'Target table ID (the table being referenced)' },
          label: { type: 'string', description: 'Field display name for the relation' },
          multiple: { type: 'boolean', description: 'Whether multiple records can be selected' }
        },
        required: ['appId', 'sourceEntityId', 'targetEntityId', 'label']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const entity = pkg.schema.entities.find((e) => e.id === args.sourceEntityId);
    if (!entity) throw new Error('Source entity not found');
    const targetEntity = pkg.schema.entities.find((e) => e.id === args.targetEntityId);
    if (!targetEntity) throw new Error('Target entity not found');
    const displayField = targetEntity.fields.find((f) => f.type === 'text' || f.type === 'textarea' || f.type === 'email' || f.type === 'phone') || targetEntity.fields[0];
    const id = `rel_${args.targetEntityId}`;
    entity.fields.push({
      id,
      label: args.label,
      type: 'relation',
      targetEntity: args.targetEntityId,
      multiple: args.multiple || false,
      displayField: displayField?.id || null
    });
    return updateAppPackage(app.id, pkg);
  }
});
