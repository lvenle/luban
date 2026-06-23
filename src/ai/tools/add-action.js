import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';

register({
  name: 'add_action',
  description: 'Add a button/action to a table. Types: create_record (open add form), export_csv (download CSV), run_ai (AI analysis), run_script (custom script).',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_action',
      description: 'Add an action button to a table',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          label: { type: 'string', description: 'Button label' },
          type: { type: 'string', enum: ['create_record', 'export_csv', 'run_ai', 'run_script'], description: 'Action type' },
          color: { type: 'string', enum: ['brand', 'danger', 'secondary'], description: 'Button color' }
        },
        required: ['appId', 'entityId', 'label', 'type']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    if (!pkg.actions) pkg.actions = [];
    pkg.actions.push({
      id: `act_${args.label.replace(/\s+/g, '_')}`,
      label: args.label,
      type: args.type,
      entity: args.entityId,
      color: args.color || 'brand'
    });
    return updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
  }
});
