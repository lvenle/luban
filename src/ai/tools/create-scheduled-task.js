import { register } from '../registry.js';
import { createScheduledTask } from '../../models/scheduled-task.js';
import { requireCurrentApp } from './scheduled-task-utils.js';

register({
  name: 'create_scheduled_task',
  description: 'Create a scheduled reminder, table-time reminder, or scheduled table update for the current app. Requires confirmation.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'create_scheduled_task',
      description: 'Create a scheduled task in the current app.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'Current app ID' },
          name: { type: 'string', description: 'Task name shown to the user' },
          type: { type: 'string', enum: ['reminder', 'tableReminder', 'tableUpdate'], description: 'reminder: fixed-time reminder; tableReminder: scan a date/datetime field; tableUpdate: update records on schedule' },
          enabled: { type: 'boolean', description: 'Whether the task starts enabled. Defaults to true.' },
          schedule: {
            type: 'object',
            description: 'For reminder/tableUpdate: {mode:"once|daily|weekly|monthly", date:"YYYY-MM-DD", time:"HH:mm", weekdays:[1-7], monthDay:1-31}. For tableReminder: {intervalMinutes:number}.',
            additionalProperties: true
          },
          action: {
            type: 'object',
            description: 'For reminder: {message}. For tableReminder: {entityId, fieldId, leadMinutes, messageTemplate}. For tableUpdate: {entityId, updateFieldId, updateValue}.',
            additionalProperties: true
          }
        },
        required: ['name', 'type', 'schedule', 'action']
      }
    }
  },
  handler: async (args) => {
    requireCurrentApp(args.appId);
    const task = createScheduledTask(args.appId, {
      name: args.name,
      type: args.type,
      enabled: args.enabled !== false,
      schedule: args.schedule,
      action: args.action
    });
    return {
      success: true,
      appId: task.appId,
      taskId: task.id,
      taskName: task.name,
      type: task.type,
      enabled: task.enabled,
      nextRunAt: task.nextRunAt
    };
  }
});
