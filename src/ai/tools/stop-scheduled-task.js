import { register } from '../registry.js';
import { updateScheduledTask } from '../../models/scheduled-task.js';
import { requireCurrentApp, resolveScheduledTask } from './scheduled-task-utils.js';

register({
  name: 'stop_scheduled_task',
  description: 'Stop/disable an existing scheduled task by ID or exact name. Requires confirmation.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'stop_scheduled_task',
      description: 'Disable an existing scheduled task.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'Current app ID' },
          taskId: { type: 'string', description: 'Scheduled task ID. Prefer this when available.' },
          taskName: { type: 'string', description: 'Exact scheduled task name if taskId is not known.' }
        }
      }
    }
  },
  handler: async (args) => {
    requireCurrentApp(args.appId);
    const existing = resolveScheduledTask(args.appId, args);
    const task = updateScheduledTask(args.appId, existing.id, { enabled: false });
    return {
      success: true,
      appId: task.appId,
      taskId: task.id,
      taskName: task.name,
      enabled: task.enabled,
      nextRunAt: task.nextRunAt
    };
  }
});
