import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { getDb } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord, getRecord } from '../src/models/record.js';
import { getTool } from '../src/ai/registry.js';
import { buildMessages } from '../src/services/ai/message-builder.js';
import {
  createScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  listScheduledReminders,
  markScheduledReminderRead,
  runScheduledTaskNow
} from '../src/models/scheduled-task.js';

await import('../src/ai/tools/create-scheduled-task.js');
await import('../src/ai/tools/stop-scheduled-task.js');
await import('../src/ai/tools/test-scheduled-task.js');

function reset() {
  const dbPath = join(process.cwd(), 'data', 'test-scheduled-tasks.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
}

function createTestApp() {
  return createAppFromPackage({
    manifest: { id: 'schedule-test', name: '定时任务测试', version: '1.0.0' },
    schema: {
      entities: [{
        id: 'task',
        name: '任务',
        fields: [
          { id: 'title', label: '标题', type: 'text' },
          { id: 'due', label: '到期时间', type: 'date' },
          { id: 'status', label: '状态', type: 'text' }
        ]
      }]
    },
    ui: { pages: [{ id: 'task-list', title: '任务列表', type: 'list', entity: 'task' }] },
    actions: [],
    prompts: {}
  });
}

test('scheduled reminders are created and marked read', () => {
  reset();
  const app = createTestApp();
  const task = createScheduledTask(app.id, {
    name: '喝水提醒',
    type: 'reminder',
    schedule: { mode: 'daily', time: '09:00' },
    action: { message: '该喝水了' }
  });

  const result = runScheduledTaskNow(app.id, task.id);
  assert.equal(result.ok, true);
  assert.equal(result.remindersCreated, 1);

  const reminders = listScheduledReminders(app.id, { unreadOnly: true });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].message, '该喝水了');

  markScheduledReminderRead(app.id, reminders[0].id);
  assert.equal(listScheduledReminders(app.id, { unreadOnly: true }).length, 0);
});

test('scheduled table update mutates records', () => {
  reset();
  const app = createTestApp();
  const record = createRecord(app.id, 'task', { title: '提交周报', status: '待办', due: '2026-07-08' });
  const task = createScheduledTask(app.id, {
    name: '批量完成',
    type: 'tableUpdate',
    schedule: { mode: 'daily', time: '09:00' },
    action: { entityId: 'task', updateFieldId: 'status', updateValue: '已完成' }
  });

  const result = runScheduledTaskNow(app.id, task.id);
  assert.equal(result.ok, true);
  assert.equal(result.recordsUpdated, 1);
  assert.equal(getRecord(record.id).data.status, '已完成');
});

test('scheduled table reminder scans due date fields once', () => {
  reset();
  const app = createTestApp();
  createRecord(app.id, 'task', { title: '合同续签', status: '待办', due: '2026-07-08' });
  const task = createScheduledTask(app.id, {
    name: '到期提醒',
    type: 'tableReminder',
    schedule: { intervalMinutes: 5 },
    action: { entityId: 'task', fieldId: 'due', leadMinutes: 0, messageTemplate: '{{记录}} 到期了' }
  });

  const first = runScheduledTaskNow(app.id, task.id);
  const second = runScheduledTaskNow(app.id, task.id);
  assert.equal(first.ok, true);
  assert.equal(first.remindersCreated, 1);
  assert.equal(second.remindersCreated, 0);
  assert.equal(listScheduledReminders(app.id, { unreadOnly: true }).length, 1);
});

test('scheduled tasks remain compatible with legacy status column', () => {
  reset();
  const db = getDb();
  db.exec("ALTER TABLE scheduled_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  const app = createTestApp();
  const task = createScheduledTask(app.id, {
    name: '兼容旧状态列',
    type: 'reminder',
    schedule: { mode: 'daily', time: '09:00' },
    action: { message: '测试' }
  });
  const row = db.prepare('SELECT status FROM scheduled_tasks WHERE id = ?').get(task.id);
  assert.equal(row.status, 'active');
});

test('AI tools create, stop, and test scheduled tasks', async () => {
  reset();
  const app = createTestApp();
  const createTool = getTool('create_scheduled_task');
  const stopTool = getTool('stop_scheduled_task');
  const testTool = getTool('test_scheduled_task');

  assert.equal(createTool.risk, 'high');
  assert.equal(stopTool.risk, 'high');
  assert.equal(testTool.risk, 'high');
  assert.deepEqual(createTool.schema.function.parameters.required, ['name', 'type', 'schedule', 'action']);

  const created = await createTool.handler({
    appId: app.id,
    name: 'AI 喝水提醒',
    type: 'reminder',
    schedule: { mode: 'daily', time: '10:30' },
    action: { message: '起来喝水' }
  });
  assert.equal(created.success, true);
  assert.equal(listScheduledTasks(app.id).length, 1);

  const tested = await testTool.handler({ appId: app.id, taskName: 'AI 喝水提醒' });
  assert.equal(tested.success, true);
  assert.equal(tested.result.remindersCreated, 1);
  assert.equal(listScheduledReminders(app.id, { unreadOnly: true })[0].message, '起来喝水');

  const stopped = await stopTool.handler({ appId: app.id, taskId: created.taskId });
  assert.equal(stopped.success, true);
  assert.equal(getScheduledTask(app.id, created.taskId).enabled, false);
});

test('AI prompt includes scheduled task guidance and current task list', () => {
  reset();
  const app = createTestApp();
  const task = createScheduledTask(app.id, {
    name: '上下文提醒',
    type: 'reminder',
    schedule: { mode: 'daily', time: '09:00' },
    action: { message: '测试上下文' }
  });
  const messages = buildMessages({ messages: [] }, '停止上下文提醒', '', app);
  const system = messages[0].content;
  assert.match(system, /Scheduled tasks/);
  assert.match(system, /create_scheduled_task/);
  assert.match(system, /stop_scheduled_task/);
  assert.match(system, /test_scheduled_task/);
  assert.match(system, new RegExp(task.id));
  assert.match(system, /上下文提醒/);
});
