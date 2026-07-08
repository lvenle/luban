import { register } from '../registry.js';
import { getPackageFromApp } from '../../storage/db.js';
import { getApp, updateAppPackage } from '../../models/app.js';
import { normalizeFieldId } from '../../core/ids.js';
import { isSingleChoiceField, isTemporalField, isNumericField } from '../../core/fieldTypeHelpers.js';

register({
  name: 'add_view',
  description: 'Add a persisted list, quadrant, gantt, or calendar view to an existing table page.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_view',
      description: 'Create one typed table view. Keep this separate from add_page and add_field.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string' },
          entityId: { type: 'string', description: 'Table ID' },
          pageId: { type: 'string', description: 'Bound list page ID; optional when the table has one list page' },
          name: { type: 'string', description: 'View name' },
          type: { type: 'string', enum: ['list', 'quadrant', 'gantt', 'calendar'] },
          fieldId: { type: 'string', description: 'Select field for quadrant view' },
          titleField: { type: 'string', description: 'Title field for gantt view' },
          startField: { type: 'string', description: 'Start date field for gantt view' },
          endField: { type: 'string', description: 'End date field for gantt view' },
          progressField: { type: 'string', description: 'Optional numeric progress field for gantt view' },
          dateField: { type: 'string', description: 'Date field for calendar view' }
        },
        required: ['appId', 'entityId', 'name', 'type']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const pkg = getPackageFromApp(app);
    const entity = pkg.schema.entities.find((item) => item.id === args.entityId);
    if (!entity) throw new Error('找不到表。');
    const page = pkg.ui.pages.find((item) => item.id === args.pageId && item.entity === entity.id)
      || pkg.ui.pages.find((item) => (item.type === 'table' || item.type === 'list') && item.entity === entity.id);
    if (!page) throw new Error('找不到该表的表格页面。');
    const view = { id: uniqueViewId(page, args.name), name: args.name, type: args.type };
    if (args.type === 'quadrant') {
      const field = entity.fields.find((item) => item.id === args.fieldId);
      if (!isSingleChoiceField(field) || (field.options || []).length < 4) throw new Error('四象限视图需要包含至少 4 个选项的单选字段。');
      view.quadrant = { fieldId: field.id, optionIds: field.options.slice(0, 4).map((option) => option.id) };
    }
    if (args.type === 'gantt') {
      const title = entity.fields.find((item) => item.id === args.titleField);
      const start = entity.fields.find((item) => item.id === args.startField);
      const end = entity.fields.find((item) => item.id === args.endField);
      const progress = args.progressField ? entity.fields.find((item) => item.id === args.progressField) : null;
      if (!title || !dateLike(start) || !dateLike(end) || start.id === end.id) throw new Error('甘特视图需要标题字段和两个不同的日期字段。');
      if (args.progressField && !numberLike(progress)) throw new Error('甘特视图的进度字段必须是数值字段。');
      view.gantt = { titleField: title.id, startField: start.id, endField: end.id, progressField: progress?.id || '' };
    }
    if (args.type === 'calendar') {
      const title = entity.fields.find((item) => item.id === args.titleField) || entity.fields.find((item) => item.type !== 'formula');
      const date = entity.fields.find((item) => item.id === (args.dateField || args.startField));
      const end = args.endField ? entity.fields.find((item) => item.id === args.endField) : null;
      if (!title || !dateLike(date) || (args.endField && !dateLike(end))) throw new Error('日历视图需要标题字段和日期字段。');
      view.calendar = { titleField: title.id, dateField: date.id, endField: end?.id || '' };
    }
    page.views ||= [{ id: 'default', name: '全部记录', type: 'list' }];
    page.views.push(view);
    const nextApp = updateAppPackage(app.id, pkg, { expectedUpdatedAt: app.updatedAt });
    return { appId: nextApp.id, entityId: entity.id, pageId: page.id, viewId: view.id, name: view.name, type: view.type };
  }
});

function dateLike(field) { return isTemporalField(field) || (field?.type === 'formula' && ['date', 'datetime'].includes(field.formula?.resultType)); }
function numberLike(field) { return isNumericField(field) || (field?.type === 'formula' && field.formula?.resultType === 'number'); }
function uniqueViewId(page, name) {
  const base = normalizeFieldId(name, 'view');
  const ids = new Set((page.views || []).map((view) => view.id));
  let id = base; let index = 2;
  while (ids.has(id)) id = `${base}_${index++}`;
  return id;
}
