import { register } from '../registry.js';
import { runScheduledTaskNow } from '../../models/scheduled-task.js';
import { requireCurrentApp, resolveScheduledTask } from './scheduled-task-utils.js';

register({
  name: 'test_scheduled_task',
  description: 'Run a scheduled task immediately once for testing. This may create reminders or update table data, so it requires confirmation.',
  risk: 'high',
  schema: {
    type: 'function',
    function: {
      name: 'test_scheduled_task',
      description: 'Run a scheduled task immediately once for testing.',
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
    const task = resolveScheduledTask(args.appId, args);
    const result = runScheduledTaskNow(args.appId, task.id);
    return {
      success: result.ok === true,
      appId: args.appId,
      taskId: task.id,
      taskName: task.name,
      result
    };
  }
});
