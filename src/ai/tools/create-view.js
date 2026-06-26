import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';
import { normalizeFieldId } from '../../core/ids.js';

register({
  name: 'create_view',
  description: 'Create a persisted list view with specific visible fields and sorts.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'create_view',
      description: 'Create a table view',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity ID' },
          name: { type: 'string', description: 'View name' },
          visibleFields: { type: 'array', items: { type: 'string' }, description: 'Field IDs to show' },
          sorts: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } }, description: 'Sort config' }
        },
        required: ['appId', 'entityId', 'name']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const entity = pkg.schema.entities.find((item) => item.id === args.entityId);
    if (!entity) throw new Error('找不到表。');
    const page = pkg.ui.pages.find((item) => (item.type === 'table' || item.type === 'list') && item.entity === entity.id);
    if (!page) throw new Error('找不到该表的列表页面。');
    const ids = new Set((page.views || []).map((view) => view.id));
    const base = normalizeFieldId(args.name, 'view');
    let id = base; let index = 2;
    while (ids.has(id)) id = `${base}_${index++}`;
    const fieldSet = new Set(entity.fields.map((field) => field.id));
    const visibleFields = (args.visibleFields || entity.fields.map((field) => field.id)).filter((fieldId) => fieldSet.has(fieldId));
    const sorts = (args.sorts || []).filter((sort) => fieldSet.has(sort.field) && ['asc', 'desc'].includes(sort.direction));
    page.views ||= [];
    page.views.push({ id, name: args.name, type: 'list', visibleFields, fieldOrder: visibleFields, sorts });
    const saved = updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
    return { appId: saved.id, entityId: entity.id, pageId: page.id, viewId: id };
  }
});
