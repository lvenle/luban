import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { getDb } from '../src/storage/db.js';
import { createAppFromPackage } from '../src/models/app.js';
import { createRecord, getRecord } from '../src/models/record.js';
import {
  createScheduledTask,
  listScheduledReminders,
  markScheduledReminderRead,
  runScheduledTaskNow
} from '../src/models/scheduled-task.js';

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
