import { register } from '../registry.js';
import { getApp } from '../../models/app.js';
import { createFieldsInApp } from '../../services/operations.js';
import { FIELD_TYPES } from '../../core/contract.js';
import { isFormulaField } from '../../core/fieldTypeHelpers.js';

const TOOL_FIELD_TYPES = [...FIELD_TYPES].filter((t) => t !== 'ai');
const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Optional field ID' },
    label: { type: 'string', description: 'Field display name' },
    type: { type: 'string', enum: TOOL_FIELD_TYPES, description: 'Field type' },
    options: { type: 'array', items: { type: 'string' }, description: 'Options for select/multiSelect fields' },
    formula: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Formula using {field label} references' },
        resultType: { type: 'string', enum: ['number', 'date', 'text'] }
      },
      required: ['expression', 'resultType']
    },
    autoNumber: {
      type: 'object',
      properties: {
        start: { type: 'number', description: 'Starting integer, default 1' },
        step: { type: 'number', description: 'Positive increment, default 1' },
        prefix: { type: 'string', description: 'Optional fixed prefix' }
      }
    }
  },
  required: ['label', 'type']
};

register({
  name: 'add_field',
  description: 'Add one or more fields to a table in one call. Prefer the fields array whenever adding multiple fields.',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_field',
      description: 'Add one or more fields to a table. Batch all fields for the same table into fields.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'App ID' },
          entityId: { type: 'string', description: 'Entity/table ID' },
          fields: { type: 'array', minItems: 1, items: FIELD_SCHEMA, description: 'All fields to add in this single call' },
          label: { type: 'string', description: 'Field display name' },
          type: { type: 'string', enum: TOOL_FIELD_TYPES, description: 'Legacy single-field type' },
          options: { type: 'array', items: { type: 'string' }, description: 'Options for select/multiSelect fields' },
          formula: { type: 'object', description: 'Formula definition for formula fields' },
          autoNumber: { type: 'object', description: 'Auto-number settings: start, step, prefix' }
        },
        required: ['appId', 'entityId']
      }
    }
  },
  handler: async (args) => {
    const app = getApp(args.appId);
    if (!app) throw new Error('App not found');
    const requestedFields = Array.isArray(args.fields) && args.fields.length
      ? args.fields
      : [{ id: args.id, label: args.label, type: args.type, options: args.options, formula: args.formula, autoNumber: args.autoNumber }];
    const fields = requestedFields.map(normalizeToolField);
    const beforeIds = new Set(app.schema.entities.find((entity) => entity.id === args.entityId)?.fields.map((field) => field.id) || []);
    const nextApp = createFieldsInApp(app, args.entityId, fields);
    const entity = nextApp.schema.entities.find((item) => item.id === args.entityId);
    const addedFields = entity.fields.filter((field) => !beforeIds.has(field.id)).map((field) => ({ id: field.id, label: field.label, type: field.type }));
    return { appId: nextApp.id, entityId: args.entityId, count: addedFields.length, addedFields };
  }
});

function normalizeToolField(field) {
  const normalized = { id: field.id, label: field.label, type: field.type };
  if (field.options) normalized.options = field.options.map((option) => typeof option === 'string' ? { id: option, label: option } : option);
  if (isFormulaField(field)) normalized.formula = field.formula;
  if (field.type === 'autoNumber') normalized.autoNumber = field.autoNumber || field.config?.autoNumber;
  return normalized;
}
