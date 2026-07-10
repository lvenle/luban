import { getApp } from '../../models/app.js';
import { getScheduledTask, listScheduledTasks } from '../../models/scheduled-task.js';

export function requireCurrentApp(appId) {
  const app = getApp(appId);
  if (!app) throw new Error('请先打开需要操作定时任务的应用。');
  return app;
}

export function resolveScheduledTask(appId, { taskId, taskName } = {}) {
  if (taskId) {
    const task = getScheduledTask(appId, taskId);
    if (!task) throw new Error('找不到这个定时任务。');
    return task;
  }
  const name = String(taskName || '').trim();
  if (!name) throw new Error('请提供任务 ID 或任务名称。');
  const matches = listScheduledTasks(appId).filter((task) => task.name === name);
  if (!matches.length) throw new Error(`找不到名为“${name}”的定时任务。`);
  if (matches.length > 1) throw new Error(`存在多个名为“${name}”的定时任务，请指定任务 ID。`);
  return matches[0];
}
