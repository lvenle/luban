import { h, buttonLabel } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, entityDisplayName, refreshScheduledReminderIndicators, requestBrowserReminderPermission } from '../app-context.js';

const TASK_TYPES = [
  ['reminder', '定时提醒'],
  ['tableReminder', '表格时间提醒'],
  ['tableUpdate', '定时更新数据']
];

const SCHEDULE_MODES = [
  ['once', '一次性'],
  ['daily', '每天'],
  ['weekly', '每周'],
  ['monthly', '每月']
];

const WEEKDAYS = [
  [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [7, '日']
];

export function openScheduledTasksPrototype() {
  const app = state.currentApp;
  if (!app) return;
  let tasks = [];
  let selectedType = 'reminder';
  let editingTask = null;
  const list = h('div', { class: 'schedule-task-list' });
  const editor = h('div', { class: 'schedule-editor' });
  const stats = h('div', { class: 'schedule-summary' });

  const refreshTasks = async () => {
    try {
      tasks = await loadTasks(app.id);
      render();
    } catch (error) {
      toast(error.message);
    }
  };

  const render = () => {
    renderStats(stats, tasks);
    renderList(list, tasks, {
      onEdit: (task) => {
        editingTask = task;
        selectedType = task.type;
        renderEditor();
      },
      onToggle: async (task) => {
        try {
          await saveTask(app.id, task.id, { ...task, enabled: !task.enabled });
          await refreshTasks();
        } catch (error) {
          toast(error.message);
        }
      },
      onDelete: async (task) => {
        try {
          await deleteTask(app.id, task.id);
          if (editingTask?.id === task.id) editingTask = null;
          await refreshTasks();
          renderEditor();
        } catch (error) {
          toast(error.message);
        }
      },
      onRun: async (task) => {
        try {
          await requestBrowserReminderPermission();
          const body = await runTaskNow(app.id, task.id);
          await refreshScheduledReminderIndicators(app.id);
          window.dispatchEvent(new CustomEvent('luban-scheduled-reminders-updated', { detail: { appId: app.id } }));
          await refreshTasks();
          toast(runResultMessage(body.result));
        } catch (error) {
          toast(error.message);
        }
      }
    });
  };

  const renderEditor = () => {
    editor.innerHTML = '';
    editor.append(buildTaskEditor(app, selectedType, editingTask, {
      onTypeChange: (type) => {
        selectedType = type;
        editingTask = null;
        renderEditor();
      },
      onSave: async (draft) => {
        try {
          if (editingTask) await saveTask(app.id, editingTask.id, draft);
          else await createTask(app.id, draft);
          editingTask = null;
          await refreshTasks();
          renderEditor();
          toast('定时任务已保存');
        } catch (error) {
          toast(error.message);
        }
      },
      onCancel: () => {
        editingTask = null;
        renderEditor();
      }
    }));
  };

  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal scheduled-tasks-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('div', {}, [
          h('h3', { text: '定时任务' }),
          h('p', { class: 'muted schedule-modal-subtitle', text: '任务保存后由后端调度器按时间自动执行。' })
        ]),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'schedule-layout' }, [
        h('section', { class: 'schedule-panel schedule-list-panel' }, [
          stats,
          h('div', { class: 'schedule-section-title' }, [
            h('strong', { text: '任务列表' }),
            h('button', { class: 'secondary icon-label-button', onclick: () => { editingTask = null; selectedType = 'reminder'; renderEditor(); } }, buttonLabel('add', '新建'))
          ]),
          list
        ]),
        h('section', { class: 'schedule-panel schedule-editor-panel' }, [
          h('div', { class: 'schedule-section-title' }, [
            h('strong', { text: editingTask ? '编辑任务' : '新建任务' })
          ]),
          editor
        ])
      ])
    ])
  ]);
  document.body.append(backdrop);
  render();
  renderEditor();
  refreshTasks();
}

function renderStats(container, tasks) {
  const active = tasks.filter((task) => task.enabled).length;
  const disabled = tasks.length - active;
  const tableBound = tasks.filter((task) => task.type !== 'reminder').length;
  container.innerHTML = '';
  container.append(
    summaryItem('全部任务', tasks.length),
    summaryItem('启用中', active),
    summaryItem('已停用', disabled),
    summaryItem('绑定表格', tableBound)
  );
}

function summaryItem(label, value) {
  return h('div', { class: 'schedule-summary-item' }, [
    h('span', { class: 'muted', text: label }),
    h('strong', { text: String(value) })
  ]);
}

function renderList(container, tasks, actions) {
  container.innerHTML = '';
  if (!tasks.length) {
    container.append(h('div', { class: 'schedule-empty' }, [
      h('strong', { text: '还没有定时任务' }),
      h('p', { class: 'muted', text: '先在右侧创建一个提醒、表格时间提醒或定时更新任务。' })
    ]));
    return;
  }
  for (const task of tasks) {
    container.append(h('article', { class: `schedule-task-card${task.enabled ? '' : ' disabled'}` }, [
      h('div', { class: 'schedule-task-head' }, [
        h('div', {}, [
          h('strong', { text: task.name }),
          h('span', { class: 'schedule-type-pill', text: typeLabel(task.type) })
        ]),
        h('label', { class: 'schedule-switch', title: task.enabled ? '停用' : '启用' }, [
          h('input', { type: 'checkbox', checked: task.enabled ? 'checked' : null, onchange: () => actions.onToggle(task) }),
          h('span')
        ])
      ]),
      h('p', { class: 'schedule-task-meta muted', text: `${scheduleSummary(task)} · ${actionSummary(task)}` }),
      h('div', { class: 'schedule-task-actions' }, [
        h('button', { class: 'secondary', text: task.type === 'tableUpdate' ? '执行一次' : '触发一次', onclick: () => actions.onRun(task) }),
        h('button', { class: 'secondary', text: '编辑', onclick: () => actions.onEdit(task) }),
        h('button', { class: 'ghost danger-text', text: '删除', onclick: () => actions.onDelete(task) })
      ])
    ]));
  }
}

function buildTaskEditor(app, selectedType, task, actions) {
  const name = h('input', { value: task?.name || defaultTaskName(selectedType), placeholder: '任务名称' });
  const typeSelect = selectFromOptions(TASK_TYPES, selectedType);
  const scheduleBox = h('div', { class: 'schedule-config-box' });
  const actionBox = h('div', { class: 'schedule-config-box' });

  const renderDynamicFields = () => {
    scheduleBox.innerHTML = '';
    actionBox.innerHTML = '';
    scheduleBox.append(buildScheduleFields(task?.schedule || {}, selectedType));
    actionBox.append(buildActionFields(app, task?.action || {}, selectedType));
  };

  typeSelect.addEventListener('change', () => actions.onTypeChange(typeSelect.value));
  renderDynamicFields();

  return h('div', { class: 'schedule-editor-form' }, [
    h('label', { class: 'field' }, [h('span', { text: '任务名称' }), name]),
    h('label', { class: 'field' }, [h('span', { text: '任务类型' }), typeSelect]),
    h('div', { class: 'schedule-editor-group' }, [
      h('strong', { text: '触发时间' }),
      scheduleBox
    ]),
    h('div', { class: 'schedule-editor-group' }, [
      h('strong', { text: '任务内容' }),
      actionBox
    ]),
    h('div', { class: 'schedule-prototype-note' }, [
      h('strong', { text: '运行说明' }),
      h('span', { text: '保存后由后端调度器执行，也可以在任务列表中手动触发一次。' })
    ]),
    h('div', { class: 'row schedule-editor-actions' }, [
      h('button', { class: 'secondary', text: '取消', onclick: actions.onCancel }),
      h('button', { text: task ? '保存修改' : '创建任务', onclick: () => {
        const draft = collectTaskDraft(app, selectedType, name.value, scheduleBox, actionBox);
        if (!draft) return;
        actions.onSave(draft);
      } })
    ])
  ]);
}

function buildScheduleFields(schedule, type) {
  if (type === 'tableReminder') {
    const interval = h('input', { type: 'number', min: '1', max: '1440', value: schedule.intervalMinutes || 5, 'data-schedule': 'intervalMinutes' });
    return h('div', { class: 'schedule-grid-fields' }, [
      h('label', { class: 'field' }, [h('span', { text: '扫描间隔（分钟）' }), interval])
    ]);
  }
  const mode = selectFromOptions(SCHEDULE_MODES, schedule.mode || 'once');
  mode.dataset.schedule = 'mode';
  const date = h('input', { type: 'date', value: schedule.date || todayKey(), 'data-schedule': 'date' });
  const time = h('input', { type: 'time', value: schedule.time || '09:00', 'data-schedule': 'time' });
  const weekChecks = h('div', { class: 'schedule-check-row' }, WEEKDAYS.map(([value, label]) => {
    const input = h('input', { type: 'checkbox', value: String(value), 'data-weekday': String(value) });
    input.checked = (schedule.weekdays || [1]).includes(value);
    return h('label', {}, [input, h('span', { text: label })]);
  }));
  const monthDay = h('input', { type: 'number', min: '1', max: '31', value: schedule.monthDay || 1, 'data-schedule': 'monthDay' });
  const conditional = h('div', { class: 'schedule-conditional-fields' });
  const renderConditional = () => {
    conditional.innerHTML = '';
    if (mode.value === 'once') conditional.append(h('label', { class: 'field' }, [h('span', { text: '日期' }), date]));
    if (mode.value === 'weekly') conditional.append(h('label', { class: 'field wide-field' }, [h('span', { text: '每周几' }), weekChecks]));
    if (mode.value === 'monthly') conditional.append(h('label', { class: 'field' }, [h('span', { text: '每月几号' }), monthDay]));
  };
  mode.addEventListener('change', renderConditional);
  renderConditional();
  return h('div', { class: 'schedule-grid-fields' }, [
    h('label', { class: 'field' }, [h('span', { text: '周期' }), mode]),
    h('label', { class: 'field' }, [h('span', { text: '时间' }), time]),
    conditional
  ]);
}

function buildActionFields(app, action, type) {
  if (type === 'reminder') {
    const message = h('textarea', { rows: '4', placeholder: '提醒内容', 'data-action': 'message' });
    message.value = action.message || '该处理这件事了。';
    return h('div', { class: 'schedule-grid-fields' }, [
      h('label', { class: 'field wide-field' }, [h('span', { text: '提醒内容' }), message])
    ]);
  }

  const entities = app.schema?.entities || [];
  const entitySelect = selectFromOptions(entities.map((entity) => [entity.id, entityDisplayName(entity)]), action.entityId || entities[0]?.id || '');
  entitySelect.dataset.action = 'entityId';
  const dynamic = h('div', { class: 'schedule-dynamic-action wide-field' });
  const renderEntityFields = () => {
    const entity = entities.find((item) => item.id === entitySelect.value);
    dynamic.innerHTML = '';
    if (!entity) return;
    if (type === 'tableReminder') {
      const dateFields = entity.fields.filter((field) => ['date', 'datetime'].includes(field.type));
      const fieldSelect = selectFromOptions(dateFields.map((field) => [field.id, field.label]), action.fieldId || dateFields[0]?.id || '');
      const lead = h('input', { type: 'number', min: '0', value: action.leadMinutes || 0, 'data-action': 'leadMinutes' });
      const template = h('input', { value: action.messageTemplate || '{{记录}} 到时间了', placeholder: '提醒模板', 'data-action': 'messageTemplate' });
      fieldSelect.dataset.action = 'fieldId';
      dynamic.append(...[
        h('label', { class: 'field' }, [h('span', { text: '时间字段' }), fieldSelect]),
        h('label', { class: 'field' }, [h('span', { text: '提前分钟' }), lead]),
        h('label', { class: 'field wide-field' }, [h('span', { text: '提醒模板' }), template]),
        dateFields.length ? null : h('p', { class: 'field-error', text: '这张表还没有日期或日期时间字段。' })
      ].filter(Boolean));
    } else {
      const editableFields = entity.fields.filter((field) => !['formula', 'autoNumber', 'relation'].includes(field.type));
      const fieldSelect = selectFromOptions(editableFields.map((field) => [field.id, field.label]), action.updateFieldId || editableFields[0]?.id || '');
      const valueInput = h('input', { value: action.updateValue || '', placeholder: '更新后的值', 'data-action': 'updateValue' });
      fieldSelect.dataset.action = 'updateFieldId';
      dynamic.append(...[
        h('label', { class: 'field' }, [h('span', { text: '更新字段' }), fieldSelect]),
        h('label', { class: 'field wide-field' }, [h('span', { text: '更新为' }), valueInput]),
        editableFields.length ? h('p', { class: 'muted field-hint', text: '原型阶段先配置单字段批量更新。' }) : h('p', { class: 'field-error', text: '这张表没有可直接更新的字段。' })
      ].filter(Boolean));
    }
  };
  entitySelect.addEventListener('change', renderEntityFields);
  renderEntityFields();
  return h('div', { class: 'schedule-grid-fields' }, [
    h('label', { class: 'field wide-field' }, [h('span', { text: '数据表' }), entitySelect]),
    dynamic
  ]);
}

function collectTaskDraft(app, type, nameValue, scheduleBox, actionBox) {
  const name = String(nameValue || '').trim();
  if (!name) { toast('请填写任务名称。'); return null; }
  const schedule = collectSchedule(type, scheduleBox);
  const action = collectAction(type, actionBox);
  if (!action) return null;
  return {
    name,
    type,
    enabled: true,
    schedule,
    action,
    nextRunText: nextRunPreview(schedule, type)
  };
}

function collectSchedule(type, box) {
  if (type === 'tableReminder') {
    return { mode: 'field', intervalMinutes: Number(box.querySelector('[data-schedule="intervalMinutes"]')?.value || 5) };
  }
  const mode = box.querySelector('[data-schedule="mode"]')?.value || 'once';
  return {
    mode,
    date: box.querySelector('[data-schedule="date"]')?.value || todayKey(),
    time: box.querySelector('[data-schedule="time"]')?.value || '09:00',
    weekdays: [...box.querySelectorAll('[data-weekday]:checked')].map((item) => Number(item.value)),
    monthDay: Number(box.querySelector('[data-schedule="monthDay"]')?.value || 1)
  };
}

function collectAction(type, box) {
  if (type === 'reminder') {
    return { message: box.querySelector('[data-action="message"]')?.value || '' };
  }
  const entityId = box.querySelector('[data-action="entityId"]')?.value || '';
  if (!entityId) { toast('请选择数据表。'); return null; }
  if (type === 'tableReminder') {
    const fieldId = box.querySelector('[data-action="fieldId"]')?.value || '';
    if (!fieldId) { toast('请选择时间字段。'); return null; }
    return {
      entityId,
      fieldId,
      leadMinutes: Number(box.querySelector('[data-action="leadMinutes"]')?.value || 0),
      messageTemplate: box.querySelector('[data-action="messageTemplate"]')?.value || ''
    };
  }
  const updateFieldId = box.querySelector('[data-action="updateFieldId"]')?.value || '';
  if (!updateFieldId) { toast('请选择更新字段。'); return null; }
  return {
    entityId,
    updateFieldId,
    updateValue: box.querySelector('[data-action="updateValue"]')?.value || ''
  };
}

function scheduleSummary(task) {
  const s = task.schedule || {};
  if (s.mode === 'field') return `每 ${s.intervalMinutes || 5} 分钟扫描表格时间字段`;
  if (s.mode === 'once') return `${s.date || '未选日期'} ${s.time || '09:00'} 提醒`;
  if (s.mode === 'daily') return `每天 ${s.time || '09:00'} 触发`;
  if (s.mode === 'weekly') return `每周 ${weekdayText(s.weekdays)} ${s.time || '09:00'} 触发`;
  if (s.mode === 'monthly') return `每月 ${s.monthDay || 1} 号 ${s.time || '09:00'} 触发`;
  return '未配置触发时间';
}

function actionSummary(task) {
  if (task.type === 'reminder') return task.action?.message || '提醒一件事';
  if (task.type === 'tableReminder') return `根据表格字段提醒：${fieldLabel(task.action?.entityId, task.action?.fieldId)}`;
  return `定时更新字段：${fieldLabel(task.action?.entityId, task.action?.updateFieldId)}`;
}

function nextRunPreview(schedule, type) {
  if (type === 'tableReminder') return `约每 ${schedule.intervalMinutes || 5} 分钟扫描`;
  return scheduleSummary({ schedule });
}

function weekdayText(values = []) {
  const labels = new Map(WEEKDAYS);
  return (values.length ? values : [1]).map((value) => labels.get(value)).filter(Boolean).join('、');
}

function selectFromOptions(options, value) {
  const select = h('select');
  for (const [optionValue, label] of options) select.append(h('option', { value: optionValue, text: label }));
  select.value = value;
  return select;
}

async function loadTasks(appId) {
  const body = await api(`/api/apps/${encodeURIComponent(appId)}/scheduled-tasks`);
  return body.tasks || [];
}

async function createTask(appId, draft) {
  return api(`/api/apps/${encodeURIComponent(appId)}/scheduled-tasks`, {
    method: 'POST',
    body: JSON.stringify(draft)
  });
}

async function saveTask(appId, taskId, draft) {
  return api(`/api/apps/${encodeURIComponent(appId)}/scheduled-tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify(draft)
  });
}

async function deleteTask(appId, taskId) {
  return api(`/api/apps/${encodeURIComponent(appId)}/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

async function runTaskNow(appId, taskId) {
  return api(`/api/apps/${encodeURIComponent(appId)}/scheduled-tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
}

function runResultMessage(result = {}) {
  if (result.recordsUpdated !== undefined) return `已执行，更新 ${result.recordsUpdated} 条记录`;
  if (result.remindersCreated !== undefined) return result.remindersCreated ? `已生成 ${result.remindersCreated} 条提醒` : '已执行，没有新的提醒';
  if (result.ok === false) return result.error || '执行失败';
  return '定时任务已执行';
}

function entityById(app, entityId) {
  return app.schema?.entities?.find((entity) => entity.id === entityId) || null;
}

function fieldById(entity, fieldId) {
  return entity?.fields?.find((field) => field.id === fieldId) || null;
}

function fieldLabel(entityId, fieldId) {
  const entity = entityById(state.currentApp, entityId);
  return fieldById(entity, fieldId)?.label || fieldId || '未选字段';
}

function typeLabel(type) {
  return TASK_TYPES.find(([value]) => value === type)?.[1] || '定时任务';
}

function defaultTaskName(type) {
  if (type === 'tableReminder') return '表格时间提醒';
  if (type === 'tableUpdate') return '定时更新数据';
  return '定时提醒';
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
