import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledReminders,
  listScheduledTasks,
  markAllScheduledRemindersRead,
  markScheduledReminderRead,
  runScheduledTaskNow,
  updateScheduledTask
} from '../../models/scheduled-task.js';
import { readJson, sendJson } from '../_helpers.js';

export async function handleScheduledTasksApi(req, res, method, parts, appId, url) {
  if (parts[3] === 'scheduled-tasks') {
    if (method === 'GET' && parts.length === 4) {
      sendJson(res, 200, { tasks: listScheduledTasks(appId) });
      return true;
    }
    if (method === 'POST' && parts.length === 4) {
      sendJson(res, 201, { task: createScheduledTask(appId, await readJson(req)) });
      return true;
    }
    if (method === 'PUT' && parts[4] && parts.length === 5) {
      sendJson(res, 200, { task: updateScheduledTask(appId, parts[4], await readJson(req)) });
      return true;
    }
    if (method === 'DELETE' && parts[4] && parts.length === 5) {
      deleteScheduledTask(appId, parts[4]);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && parts[4] && parts[5] === 'run') {
      sendJson(res, 200, { result: runScheduledTaskNow(appId, parts[4]) });
      return true;
    }
  }

  if (parts[3] === 'scheduled-reminders') {
    if (method === 'GET' && parts.length === 4) {
      sendJson(res, 200, {
        reminders: listScheduledReminders(appId, {
          unreadOnly: url.searchParams.get('unread') !== 'false',
          limit: url.searchParams.get('limit')
        })
      });
      return true;
    }
    if (method === 'POST' && parts[4] === 'read-all') {
      markAllScheduledRemindersRead(appId);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && parts[4] && parts[5] === 'read') {
      markScheduledReminderRead(appId, parts[4]);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
