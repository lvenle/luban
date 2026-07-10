import { createId } from '../core/ids.js';
import { badRequest, notFound } from '../core/errors.js';
import { getDb, triggerBackup, withTransaction } from '../storage/db.js';
import { getApp } from './app.js';
import { listRecords, updateRecordForApp } from './record.js';

const TASK_TYPES = new Set(['reminder', 'tableReminder', 'tableUpdate']);
const TYPE_LABELS = {
  reminder: '定时提醒',
  tableReminder: '表格时间提醒',
  tableUpdate: '定时更新数据'
};

function now() {
  return new Date().toISOString();
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    name: row.name,
    type: row.type,
    enabled: Boolean(row.enabled),
    schedule: JSON.parse(row.scheduleJson),
    action: JSON.parse(row.actionJson),
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function rowToReminder(row) {
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    taskId: row.taskId,
    title: row.title,
    typeLabel: row.typeLabel,
    message: row.message,
    readAt: row.readAt,
    createdAt: row.createdAt,
    timeText: new Date(row.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  };
}

export function listScheduledTasks(appId) {
  return getDb().prepare('SELECT * FROM scheduled_tasks WHERE appId = ? ORDER BY createdAt DESC')
    .all(appId).map(rowToTask);
}

export function getScheduledTask(appId, taskId) {
  return rowToTask(getDb().prepare('SELECT * FROM scheduled_tasks WHERE appId = ? AND id = ?').get(appId, taskId));
}

export function createScheduledTask(appId, input) {
  const app = requireApp(appId);
  const draft = normalizeTaskInput(app, input);
  const id = createId('task');
  const createdAt = now();
  const nextRunAt = draft.enabled ? computeNextRunAt(draft.schedule, draft.type, new Date(createdAt)) : null;
  const columns = ['id', 'appId', 'name', 'type', 'enabled', 'scheduleJson', 'actionJson', 'nextRunAt', 'createdAt', 'updatedAt'];
  const values = [
    id, appId, draft.name, draft.type, draft.enabled ? 1 : 0,
    JSON.stringify(draft.schedule), JSON.stringify(draft.action), nextRunAt,
    createdAt, createdAt
  ];
  if (scheduledTasksHasColumn('status')) {
    columns.splice(4, 0, 'status');
    values.splice(4, 0, draft.enabled ? 'active' : 'disabled');
  }
  getDb().prepare(`
    INSERT INTO scheduled_tasks (${columns.join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `).run(...values);
  triggerBackup();
  return getScheduledTask(appId, id);
}

export function updateScheduledTask(appId, taskId, input) {
  const existing = getScheduledTask(appId, taskId);
  if (!existing) throw notFound('找不到定时任务。');
  const app = requireApp(appId);
  const draft = normalizeTaskInput(app, { ...existing, ...input });
  const updatedAt = now();
  const nextRunAt = draft.enabled ? computeNextRunAt(draft.schedule, draft.type, new Date(updatedAt)) : null;
  const statusSql = scheduledTasksHasColumn('status') ? ', status = ?' : '';
  const values = [
    draft.name, draft.type, draft.enabled ? 1 : 0,
    JSON.stringify(draft.schedule), JSON.stringify(draft.action),
    nextRunAt, updatedAt
  ];
  if (statusSql) values.push(draft.enabled ? 'active' : 'disabled');
  values.push(appId, taskId);
  getDb().prepare(`
    UPDATE scheduled_tasks
    SET name = ?, type = ?, enabled = ?, scheduleJson = ?, actionJson = ?,
        nextRunAt = ?, lastError = NULL, updatedAt = ?${statusSql}
    WHERE appId = ? AND id = ?
  `).run(...values);
  triggerBackup();
  return getScheduledTask(appId, taskId);
}

export function deleteScheduledTask(appId, taskId) {
  const result = getDb().prepare('DELETE FROM scheduled_tasks WHERE appId = ? AND id = ?').run(appId, taskId);
  if (!result.changes) throw notFound('找不到定时任务。');
  triggerBackup();
}

export function listScheduledReminders(appId, options = {}) {
  const unreadOnly = options.unreadOnly === true;
  const sql = unreadOnly
    ? 'SELECT * FROM scheduled_reminders WHERE appId = ? AND readAt IS NULL ORDER BY createdAt DESC LIMIT ?'
    : 'SELECT * FROM scheduled_reminders WHERE appId = ? ORDER BY createdAt DESC LIMIT ?';
  return getDb().prepare(sql).all(appId, clampLimit(options.limit)).map(rowToReminder);
}

export function markScheduledReminderRead(appId, reminderId) {
  const readAt = now();
  getDb().prepare('UPDATE scheduled_reminders SET readAt = ? WHERE appId = ? AND id = ?').run(readAt, appId, reminderId);
  triggerBackup();
}

export function markAllScheduledRemindersRead(appId) {
  getDb().prepare('UPDATE scheduled_reminders SET readAt = ? WHERE appId = ? AND readAt IS NULL').run(now(), appId);
  triggerBackup();
}

export function runScheduledTaskNow(appId, taskId) {
  const task = getScheduledTask(appId, taskId);
  if (!task) throw notFound('找不到定时任务。');
  return runTask(task, new Date(), { manual: true });
}

export function runDueScheduledTasks(referenceDate = new Date()) {
  const rows = getDb().prepare(`
    SELECT * FROM scheduled_tasks
    WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ?
    ORDER BY nextRunAt ASC
    LIMIT 50
  `).all(referenceDate.toISOString());
  return rows.map(rowToTask).map((task) => runTask(task, referenceDate));
}

function runTask(task, referenceDate, options = {}) {
  const ranAt = referenceDate.toISOString();
  try {
    const result = executeTask(task, referenceDate);
    const nextRunAt = task.enabled && !shouldDisableAfterRun(task)
      ? computeNextRunAt(task.schedule, task.type, new Date(referenceDate.getTime() + 1000))
      : null;
    const enabled = shouldDisableAfterRun(task) ? 0 : 1;
    const statusSql = scheduledTasksHasColumn('status') ? ', status = ?' : '';
    const values = [enabled, nextRunAt, ranAt, ranAt];
    if (statusSql) values.push(enabled ? 'active' : 'disabled');
    values.push(task.id);
    getDb().prepare(`
      UPDATE scheduled_tasks
      SET enabled = ?, nextRunAt = ?, lastRunAt = ?, lastError = NULL, updatedAt = ?${statusSql}
      WHERE id = ?
    `).run(...values);
    triggerBackup();
    return { taskId: task.id, ok: true, ...result, manual: options.manual === true };
  } catch (error) {
    getDb().prepare('UPDATE scheduled_tasks SET lastRunAt = ?, lastError = ?, updatedAt = ? WHERE id = ?')
      .run(ranAt, error.message, ranAt, task.id);
    triggerBackup();
    return { taskId: task.id, ok: false, error: error.message, manual: options.manual === true };
  }
}

function executeTask(task, referenceDate) {
  if (task.type === 'reminder') {
    createReminder({
      appId: task.appId,
      taskId: task.id,
      title: task.name,
      typeLabel: TYPE_LABELS[task.type],
      message: task.action?.message || '提醒已触发。'
    });
    return { remindersCreated: 1 };
  }
  if (task.type === 'tableReminder') return executeTableReminder(task, referenceDate);
  if (task.type === 'tableUpdate') return executeTableUpdate(task);
  throw badRequest('不支持的定时任务类型。');
}

function executeTableReminder(task, referenceDate) {
  const records = listRecords(task.appId, { entityId: task.action?.entityId, hydrateRelations: false });
  const leadMs = Math.max(0, Number(task.action?.leadMinutes || 0)) * 60_000;
  let count = 0;
  for (const record of records) {
    const raw = record.data?.[task.action?.fieldId];
    const due = parseDate(raw);
    if (!due || due.getTime() - leadMs > referenceDate.getTime()) continue;
    const template = task.action?.messageTemplate || '{{记录}} 到时间了';
    const message = template
      .replaceAll('{{记录}}', displayRecord(record))
      .replaceAll('{{时间}}', String(raw || ''));
    if (createReminder({
      appId: task.appId,
      taskId: task.id,
      title: task.name,
      typeLabel: TYPE_LABELS[task.type],
      message,
      dedupeKey: `${task.id}:${record.id}:${String(raw || '')}`
    })) count += 1;
  }
  return { remindersCreated: count };
}

function executeTableUpdate(task) {
  const records = listRecords(task.appId, { entityId: task.action?.entityId, hydrateRelations: false });
  let count = 0;
  for (const record of records) {
    updateRecordForApp(task.appId, record.id, {
      ...record.data,
      [task.action?.updateFieldId]: task.action?.updateValue ?? ''
    }, { skipBackup: true });
    count += 1;
  }
  triggerBackup();
  return { recordsUpdated: count };
}

function createReminder({ appId, taskId, title, typeLabel, message, dedupeKey = null }) {
  const createdAt = now();
  try {
    getDb().prepare(`
      INSERT INTO scheduled_reminders (id, appId, taskId, title, typeLabel, message, dedupeKey, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId('rem'), appId, taskId, title, typeLabel, message, dedupeKey, createdAt);
    return true;
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) return false;
    throw error;
  }
}

function normalizeTaskInput(app, input = {}) {
  const name = String(input.name || '').trim();
  const type = String(input.type || 'reminder');
  if (!name) throw badRequest('请填写任务名称。');
  if (!TASK_TYPES.has(type)) throw badRequest('不支持的定时任务类型。');
  const schedule = normalizeSchedule(type, input.schedule || {});
  const action = normalizeAction(app, type, input.action || {});
  return { name, type, enabled: input.enabled !== false, schedule, action };
}

function scheduledTasksHasColumn(columnName) {
  return getDb().prepare('PRAGMA table_info(scheduled_tasks)').all().some((column) => column.name === columnName);
}

function normalizeSchedule(type, schedule) {
  if (type === 'tableReminder') {
    return { mode: 'field', intervalMinutes: Math.max(1, Number(schedule.intervalMinutes || 5)) };
  }
  const mode = ['once', 'daily', 'weekly', 'monthly'].includes(schedule.mode) ? schedule.mode : 'once';
  return {
    mode,
    date: String(schedule.date || todayKey()),
    time: normalizedTime(schedule.time || '09:00'),
    weekdays: Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number).filter((item) => item >= 1 && item <= 7) : [1],
    monthDay: Math.max(1, Math.min(31, Number(schedule.monthDay || 1)))
  };
}

function normalizeAction(app, type, action) {
  if (type === 'reminder') return { message: String(action.message || '') };
  const entity = app.schema?.entities?.find((item) => item.id === action.entityId);
  if (!entity) throw badRequest('请选择数据表。');
  if (type === 'tableReminder') {
    const field = entity.fields?.find((item) => item.id === action.fieldId && ['date', 'datetime'].includes(item.type));
    if (!field) throw badRequest('请选择时间字段。');
    return {
      entityId: entity.id,
      fieldId: field.id,
      leadMinutes: Math.max(0, Number(action.leadMinutes || 0)),
      messageTemplate: String(action.messageTemplate || '{{记录}} 到时间了')
    };
  }
  const field = entity.fields?.find((item) => item.id === action.updateFieldId);
  if (!field) throw badRequest('请选择更新字段。');
  return { entityId: entity.id, updateFieldId: field.id, updateValue: action.updateValue ?? '' };
}

function computeNextRunAt(schedule, type, fromDate = new Date()) {
  if (type === 'tableReminder') {
    return new Date(fromDate.getTime() + Math.max(1, Number(schedule.intervalMinutes || 5)) * 60_000).toISOString();
  }
  const mode = schedule.mode || 'once';
  if (mode === 'once') {
    const next = buildDateTime(schedule.date || todayKey(), schedule.time || '09:00', fromDate, { allowPast: true });
    if (!next) return null;
    return (next > fromDate ? next : new Date(fromDate.getTime() + 1000)).toISOString();
  }
  for (let offset = 0; offset <= 370; offset++) {
    const candidate = new Date(fromDate);
    candidate.setDate(candidate.getDate() + offset);
    if (mode === 'weekly' && !(schedule.weekdays || [1]).includes(weekday(candidate))) continue;
    if (mode === 'monthly' && candidate.getDate() !== Number(schedule.monthDay || 1)) continue;
    const next = buildDateTime(dateKey(candidate), schedule.time || '09:00', fromDate);
    if (next && next > fromDate) return next.toISOString();
  }
  return null;
}

function shouldDisableAfterRun(task) {
  return task.type !== 'tableReminder' && task.schedule?.mode === 'once';
}

function buildDateTime(date, time, fromDate, options = {}) {
  const parsed = new Date(`${date}T${normalizedTime(time)}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed > fromDate || options.allowPast ? parsed : null;
}

function normalizedTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '09:00';
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayRecord(record) {
  const first = Object.values(record.data || {}).find((value) => value !== undefined && value !== null && value !== '');
  return String(first || record.id);
}

function requireApp(appId) {
  const app = getApp(appId);
  if (!app) throw notFound('找不到应用。');
  return app;
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(100, Number.isFinite(parsed) ? parsed : 50));
}

function todayKey() {
  return dateKey(new Date());
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}
