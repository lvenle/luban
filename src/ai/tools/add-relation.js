import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

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
          multiple: { type: 'boolean', description: 'Whether multiple records can be selected' },
          bidirectional: { type: 'boolean', description: 'If true, also creates an inverse relation field on the target table' }
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
    const sourceEntityDisplayField = entity.fields.find((f) => f.type === 'text' || f.type === 'textarea' || f.type === 'email' || f.type === 'phone') || entity.fields[0];
    const id = `rel_${args.targetEntityId}`;
    const reciprocal = args.bidirectional;
    entity.fields.push({
      id,
      label: args.label,
      type: 'relation',
      targetEntity: args.targetEntityId,
      multiple: args.multiple || false,
      displayField: displayField?.id || null,
      ...(reciprocal ? { reciprocalFieldId: `rel_${entity.id}` } : {})
    });
    if (reciprocal) {
      targetEntity.fields.push({
        id: `rel_${entity.id}`,
        label: `${entity.name || args.sourceEntityId}记录`,
        type: 'relation',
        targetEntity: entity.id,
        multiple: true,
        displayField: sourceEntityDisplayField?.id || null
      });
    }
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
