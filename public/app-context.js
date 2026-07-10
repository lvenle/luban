import { h, uiIcon, buttonLabel, svgIcon, svgPath, svgLine } from './common/dom.js';
import { api } from './common/api.js';
import { toast } from './common/toast.js';
import { openConfirmDialog, openTextModal, floatingMenus, closeFloatingMenus, bindFloatingMenu, bindDismissiblePopover, setupModalAccessibility } from './common/modal.js';
import { readStorage, writeStorage, globalStorageKey, clampSidebarWidth } from './common/storage.js';
import { formatFieldValue as formatDisplayFieldValue } from './common/field-format.js';
import { appCategory } from './common/app-metadata.js';
import { entityDisplayName as resolveEntityDisplayName } from './common/entity-display.js';
import { getClientRuntimeSettings } from './common/runtime-settings-store.js';
import { requestReminderNotificationPermission, showReminderNotification } from './common/notification-adapter.js';

const initialRuntimeSettings = getClientRuntimeSettings();

export const state = {
  apps: [], currentApp: null, currentPageId: null, records: [],
  inlineEditId: null, loading: false, appCategory: '全部', appSearch: '', appDragId: '', currentViewId: '',
  assistantOpen: false, pageDragId: '', cellSelection: null, cellClipboard: null,
  sidebarCollapsed: false, sidebarWidth: initialRuntimeSettings.sidebarWidth, sidebarCollapsedWidth: initialRuntimeSettings.sidebarCollapsedWidth, recordPagination: {}, loadingRecordPages: {},
  isMobile: window.innerWidth < 768, mobileDrawerOpen: false,
  runtimeSettings: initialRuntimeSettings, activeRecordLoadToken: ''
};

export const root = document.querySelector('#app');
export const APP_VERSION = '2026.06.27';

const shellActions = {
  goHome: () => {},
  renderHome: () => {},
  renderRuntime: () => {},
  saveCurrentPackage: async () => {}
};
export function configureAppShell(actions = {}) { Object.assign(shellActions, actions); }

const reminderCounts = new Map();
const knownReminderIds = new Set();
const initializedReminderApps = new Set();
const shownReminderBubbles = new Set();
const shownBrowserReminderNotifications = new Set();
const activeReminderBubbles = new Map();
const activeReminderNotifications = new Map();
const dismissedReminderBubbles = new Set();
let reminderPollTimer = null;
let reminderPollAppId = '';

export function toggleMobileDrawer() {
  state.mobileDrawerOpen = !state.mobileDrawerOpen;
  if (state.currentApp) {
    shellActions.renderRuntime();
  }
}

export function storageKey(scope, suffix = '') {
  const appId = state.currentApp?.id || 'global';
  const pageId = state.currentPageId || 'home';
  return `luban-ai:${appId}:${pageId}:${scope}${suffix ? `:${suffix}` : ''}`;
}

function slugifyLocal(input, fallback = 'page') {
  const value = String(input || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value || fallback;
}

export function uniquePageId(title, entityId = 'page') {
  const base = slugifyLocal(`${entityId}-${title || 'page'}`, `${entityId}-page`);
  const existing = new Set((state.currentApp?.ui?.pages || []).map((p) => p.id));
  if (!existing.has(base)) return base;
  let i = 2; while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function currentRoute() {
  const params = new URLSearchParams(location.search);
  const parts = location.pathname.split('/').filter(Boolean);
  let appId = '', pageId = '';
  if (parts[0] === 'app' && parts[1]) { appId = parts[1]; if (parts[2] === 'page' && parts[3]) pageId = parts[3]; }
  return { appId: appId || params.get('app') || '', pageId: pageId || params.get('page') || '', viewId: params.get('view') || '' };
}

export function writeRoute(appId, pageId, replace = false, viewId = state.currentViewId) {
  const params = viewId ? `?view=${encodeURIComponent(viewId)}` : '';
  const next = `${appId ? `/app/${appId}${pageId ? `/page/${pageId}` : ''}` : '/'}${params}`;
  if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
}

export function topbar() {
  const inRuntime = Boolean(state.currentApp);
  return h('header', { class: `topbar ${state.isMobile ? 'mobile-topbar' : ''}` }, [
    h('div', { class: 'topbar-left' }, [
      state.isMobile && inRuntime
        ? h('button', { class: 'hamburger ghost', title: '页面列表', onclick: toggleMobileDrawer }, [
            svgIcon('0 0 20 20', [
              svgLine(3, 5, 17, 5),
              svgLine(3, 10, 17, 10),
              svgLine(3, 15, 17, 15)
            ], 'hamburger-icon')
          ])
        : null,
      h('button', { class: 'brand brand-button', onclick: shellActions.goHome, title: '返回首页' }, [
        h('img', { class: 'brand-logo', src: '/images/logo.png', alt: '鲁班AI系统' }),
        h('div', { class: 'brand-title-group' }, [
          h('span', { text: '鲁班AI系统' }),
          h('span', { class: 'version-badge', text: `v${APP_VERSION}` })
        ])
      ]),
      inRuntime ? renderTopbarAppInfo(state.currentApp) : null
    ]),
    h('div', { class: 'top-actions' }, [
      h('button', {
        class: `secondary icon-label-button assistant-topbar-button ${state.assistantOpen ? 'active' : ''}`,
        onclick: () => { state.assistantOpen = !state.assistantOpen; if (state.currentApp) shellActions.renderRuntime(); else shellActions.renderHome(); }
      }, buttonLabel('assistant', 'AI 助理')),
      inRuntime
        ? h('button', {
            class: 'secondary icon-label-button scheduled-tasks-button',
            title: '定时任务',
            onclick: async () => {
              await requestBrowserReminderPermission();
              import('./app-runtime/ScheduledTasksPrototype.js').then(m => m.openScheduledTasksPrototype());
            }
          }, buttonLabel('schedule', '定时任务'))
        : null,
      inRuntime
        ? h('button', { class: 'secondary icon-label-button app-settings-button', title: '应用设置', onclick: () => import('./app-runtime/SettingsModal.js').then(m => m.openSettingsModal(state.currentApp.id, 'rules')) }, buttonLabel('settings', '应用设置'))
        : h('button', { class: 'secondary icon-label-button system-settings-button', title: '系统设置', onclick: () => import('./app-runtime/SettingsModal.js').then(m => m.openSettingsModal()) }, buttonLabel('settings', '系统设置')),
      inRuntime ? renderReminderBell(state.currentApp) : null
    ])
  ]);
}

function renderReminderBell(app) {
  ensureScheduledReminderPolling(app.id);
  queueMicrotask(() => refreshScheduledReminderIndicators(app.id, { showBubble: false, showBrowserNotification: false }).catch(() => {}));
  return h('div', { class: 'scheduled-reminder-entry' }, [
    h('button', {
      class: 'scheduled-reminder-button',
      title: '提醒列表',
      'aria-label': '提醒列表，当前 0 条',
      'data-scheduled-reminder-app': app.id,
      onclick: async (event) => {
        event.stopPropagation();
        await requestBrowserReminderPermission();
        openScheduledReminderPopover(event.currentTarget, app).catch((error) => toast(error.message));
      }
    }, [
      h('span', { class: 'scheduled-reminder-icon' }, [uiIcon('bell')]),
      h('span', { class: 'scheduled-reminder-count', 'data-scheduled-reminder-count': app.id, text: '0' })
    ])
  ]);
}

async function openScheduledReminderPopover(trigger, app) {
  document.querySelectorAll('.scheduled-reminder-popover').forEach((item) => item.remove());
  const reminders = await loadUnreadScheduledReminders(app.id);
  const popover = h('div', { class: 'scheduled-reminder-popover', role: 'dialog', 'aria-label': '提醒列表' }, [
    h('div', { class: 'scheduled-reminder-popover-head' }, [
      h('div', {}, [
        h('strong', { text: '提醒' }),
        h('span', { class: 'muted', text: `${reminders.length} 条记录` })
      ]),
      reminders.length
        ? h('button', {
            class: 'ghost',
            text: '清空',
            onclick: async () => {
              await markAllScheduledRemindersRead(app.id);
              await refreshScheduledReminderIndicators(app.id, { showBubble: false });
              popover.remove();
            }
          })
        : null
    ]),
    reminders.length
      ? h('div', { class: 'scheduled-reminder-popover-list' }, reminders.map((reminder) => renderReminderPopoverItem(reminder, async () => {
          await markScheduledReminderRead(app.id, reminder.id);
          await refreshScheduledReminderIndicators(app.id, { showBubble: false });
          popover.remove();
          openScheduledReminderPopover(trigger, app).catch((error) => toast(error.message));
        })))
      : h('div', { class: 'scheduled-reminder-popover-empty' }, [
          h('strong', { text: '暂无提醒' }),
          h('p', { class: 'muted', text: '定时任务触发后，会在这里集中展示。' })
        ])
  ]);
  document.body.append(popover);
  positionScheduledReminderPopover(popover, trigger);
  bindDismissiblePopover(popover, trigger);
}

function renderReminderPopoverItem(reminder, onRead) {
  return h('button', { class: 'scheduled-reminder-popover-item', onclick: onRead, title: '标记为已读' }, [
    h('div', { class: 'scheduled-reminder-popover-item-head' }, [
      h('strong', { text: reminder.title || '定时提醒' }),
      h('span', { class: 'muted', text: reminder.timeText || '' })
    ]),
    h('p', { text: reminder.message || '提醒已触发。' }),
    h('span', { class: 'schedule-type-pill', text: reminder.typeLabel || '定时任务' })
  ]);
}

function positionScheduledReminderPopover(popover, trigger) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  popover.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 120)}px`;
}

async function loadUnreadScheduledReminders(appId) {
  const body = await api(`/api/apps/${encodeURIComponent(appId)}/scheduled-reminders?unread=true&limit=50`);
  return body.reminders || [];
}

async function markScheduledReminderRead(appId, reminderId) {
  await api(`/api/apps/${encodeURIComponent(appId)}/scheduled-reminders/${encodeURIComponent(reminderId)}/read`, { method: 'POST' });
}

async function markAllScheduledRemindersRead(appId) {
  await api(`/api/apps/${encodeURIComponent(appId)}/scheduled-reminders/read-all`, { method: 'POST' });
}

export async function requestBrowserReminderPermission() {
  return requestReminderNotificationPermission();
}

export async function refreshScheduledReminderIndicators(appId = state.currentApp?.id, options = {}) {
  if (!appId) return;
  const reminders = await loadUnreadScheduledReminders(appId);
  const count = reminders.length;
  const isInitialSilentRefresh = !initializedReminderApps.has(appId)
    && options.showBubble === false
    && options.showBrowserNotification === false;
  const newReminders = isInitialSilentRefresh ? [] : reminders.filter((reminder) => !knownReminderIds.has(reminder.id));
  if (!initializedReminderApps.has(appId)) initializedReminderApps.add(appId);
  reminderCounts.set(appId, count);
  document.querySelectorAll(`[data-scheduled-reminder-count="${CSS.escape(appId)}"]`).forEach((item) => {
    item.textContent = String(count);
    item.closest('.scheduled-reminder-button')?.classList.toggle('has-reminders', count > 0);
    item.closest('.scheduled-reminder-button')?.setAttribute('aria-label', `提醒列表，当前 ${count} 条`);
  });
  const currentUnreadIds = new Set(reminders.map((reminder) => reminder.id));
  for (const [reminderId, bubble] of activeReminderBubbles.entries()) {
    if (!currentUnreadIds.has(reminderId)) {
      bubble.remove();
      activeReminderBubbles.delete(reminderId);
    }
  }
  if (isInitialSilentRefresh) {
    reminders.forEach((reminder) => knownReminderIds.add(reminder.id));
    return;
  }
  if (options.showBrowserNotification !== false) {
    for (const reminder of newReminders.slice().reverse()) {
      await notifyBrowserScheduledReminder(appId, reminder);
      if (!dismissedReminderBubbles.has(reminder.id) && !shownReminderBubbles.has(reminder.id)) {
        showScheduledReminderBubble(appId, reminder);
      }
    }
  }
  if (options.showBubble !== false && count > 0) {
    for (const reminder of newReminders.slice().reverse()) {
      if (!dismissedReminderBubbles.has(reminder.id) && !shownReminderBubbles.has(reminder.id)) {
        showScheduledReminderBubble(appId, reminder);
      }
    }
  }
  newReminders.forEach((reminder) => knownReminderIds.add(reminder.id));
}

window.addEventListener('luban-scheduled-reminders-updated', (event) => {
  refreshScheduledReminderIndicators(event.detail?.appId, { showBubble: true, showBrowserNotification: true }).catch(() => {});
});

function ensureScheduledReminderPolling(appId) {
  if (reminderPollTimer && reminderPollAppId === appId) return;
  if (reminderPollTimer) clearInterval(reminderPollTimer);
  reminderPollAppId = appId;
  reminderPollTimer = setInterval(() => {
    if (state.currentApp?.id !== reminderPollAppId) return;
    refreshScheduledReminderIndicators(reminderPollAppId, { showBubble: false, showBrowserNotification: true }).catch(() => {});
  }, 5000);
}

async function notifyBrowserScheduledReminder(appId, reminder) {
  if (shownBrowserReminderNotifications.has(reminder.id) || dismissedReminderBubbles.has(reminder.id)) return true;
  const notification = await showReminderNotification({
    id: reminder.id,
    title: reminder.title || '定时提醒',
    body: reminder.message || '提醒已触发。',
    onClick: () => {
      window.focus();
      const trigger = document.querySelector(`[data-scheduled-reminder-app="${CSS.escape(appId)}"]`);
      if (trigger && state.currentApp) openScheduledReminderPopover(trigger, state.currentApp).catch((error) => toast(error.message));
    },
    onClose: () => {
      activeReminderNotifications.delete(reminder.id);
      if (dismissedReminderBubbles.has(reminder.id)) return;
      acknowledgeScheduledReminder(appId, reminder.id).catch((error) => toast(error.message));
    }
  });
  if (!notification) return false;
  shownBrowserReminderNotifications.add(reminder.id);
  activeReminderNotifications.set(reminder.id, notification);
  return true;
}

function showScheduledReminderBubble(appId, reminder) {
  if (activeReminderBubbles.has(reminder.id) || shownReminderBubbles.has(reminder.id)) return;
  shownReminderBubbles.add(reminder.id);
  const container = ensureScheduledReminderBubbleStack();
  const bubble = h('div', {
    class: 'scheduled-reminder-bubble',
    role: 'button',
    tabindex: '0',
    title: '查看提醒',
    onclick: () => {
      const trigger = document.querySelector(`[data-scheduled-reminder-app="${CSS.escape(appId)}"]`);
      dismissScheduledReminderBubble(reminder.id);
      if (trigger && state.currentApp) openScheduledReminderPopover(trigger, state.currentApp).catch((error) => toast(error.message));
    },
    onkeydown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      bubble.click();
    }
  }, [
    h('span', { class: 'scheduled-reminder-bubble-kicker', text: reminder.typeLabel || '定时提醒' }),
    h('strong', { text: reminder.title || '提醒' }),
    h('span', { text: reminder.message || '提醒已触发。' })
  ]);
  const close = h('button', {
    class: 'scheduled-reminder-bubble-close',
    title: '关闭提醒',
    onclick: async (event) => {
      event.stopPropagation();
      acknowledgeScheduledReminder(appId, reminder.id).catch((error) => toast(error.message));
    }
  }, '×');
  bubble.append(close);
  container.append(bubble);
  activeReminderBubbles.set(reminder.id, bubble);
}

function ensureScheduledReminderBubbleStack() {
  let stack = document.querySelector('.scheduled-reminder-bubble-stack');
  if (!stack) {
    stack = h('div', { class: 'scheduled-reminder-bubble-stack' });
    document.body.append(stack);
  }
  return stack;
}

function removeScheduledReminderBubble(reminderId) {
  const bubble = activeReminderBubbles.get(reminderId);
  if (bubble) {
    bubble.remove();
    activeReminderBubbles.delete(reminderId);
  }
}

function dismissScheduledReminderBubble(reminderId) {
  dismissedReminderBubbles.add(reminderId);
  removeScheduledReminderBubble(reminderId);
}

async function acknowledgeScheduledReminder(appId, reminderId) {
  dismissScheduledReminderBubble(reminderId);
  const notification = activeReminderNotifications.get(reminderId);
  if (notification) {
    activeReminderNotifications.delete(reminderId);
    notification.close();
  }
  await markScheduledReminderRead(appId, reminderId);
  await refreshScheduledReminderIndicators(appId, { showBubble: false, showBrowserNotification: false });
}

function renderTopbarAppInfo(app) {
  return h('div', { class: 'topbar-app-info' }, [
    h('div', { class: 'topbar-app-heading' }, [
      inlineEditableText({ className: 'topbar-app-name', value: app.name, title: '双击编辑软件名称', onSave: (v) => saveAppMetadata(v, appCategory(app)) }),
      inlineEditableText({ className: 'category-pill compact', value: appCategory(app), title: '双击编辑分类', onSave: (v) => saveAppMetadata(app.name, v) })
    ]),
    inlineEditableText({ className: 'topbar-app-desc muted', value: app.description || app.manifest?.description || '双击添加介绍', title: '双击编辑介绍', onSave: (v) => saveAppMetadata(app.name, appCategory(app), v) })
  ]);
}

async function saveAppMetadata(name, category, description) {
  const nextDescription = description === undefined
    ? (state.currentApp.description || state.currentApp.manifest?.description || '')
    : description;
  const body = await api(`/api/apps/${state.currentApp.id}`, { method: 'PUT', body: JSON.stringify({ name, category, description: nextDescription, expectedUpdatedAt: state.currentApp.updatedAt }) });
  state.currentApp = body.app;
  state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
  shellActions.renderRuntime();
}

function inlineEditableText({ value, className = '', onSave, multiline = false }) {
  const display = h('span', { class: `inline-edit-text ${className}`, text: value || '', ondblclick: () => {
    const input = multiline ? h('textarea', { class: 'inline-edit-input' }) : h('input', { class: 'inline-edit-input', type: 'text' });
    input.value = display.textContent;
    display.replaceWith(input); input.focus(); if (input.select) input.select();
    let done = false;
    const finish = async (save) => { if (done) return; done = true; const next = input.value.trim(); if (save && next !== value) await onSave(next); else shellActions.renderRuntime(); };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) input.blur(); if (e.key === 'Escape') finish(false); });
  }});
  return display;
}

export function entityFor(page) { return state.currentApp.schema.entities.find((e) => e.id === page.entity) || state.currentApp.schema.entities[0]; }
export function currentPage() { return state.currentApp?.ui.pages.find((p) => p.id === state.currentPageId) || state.currentApp?.ui.pages[0] || null; }
export function pageEntityForRecordLoad(page) { if (!page || !state.currentApp) return null; if (page.entity) return entityFor(page); return null; }
export function recordsFor(entityId) { return state.records.filter((r) => !entityId || r.entityId === entityId); }
export function entityById(entityId) { return state.currentApp.schema.entities.find((e) => e.id === entityId); }
export function entityDisplayName(entityOrId, app = state.currentApp) { return resolveEntityDisplayName(app, entityOrId); }

export function formatFieldValue(value, field) {
  return formatDisplayFieldValue(value, field);
}

export function dateKey(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
}

// View system helpers (used by runtime modules)
export function defaultView(entity) {
  const legacy = readStorage(storageKey('list', entity.id), null);
  const fb = { id: 'default', name: '全部记录', visibleFields: entity.fields.map(f => f.id), fieldOrder: entity.fields.map(f => f.id), searchFields: [], columnWidths: {}, actionWidth: state.runtimeSettings.actionWidth, allFields: entity.fields.map(f => f.id), filters: [], sorts: [], group: null };
  return normalizeView(entity, { ...fb, visibleFields: legacy?.visibleFields, fieldOrder: legacy?.fieldOrder, searchFields: legacy?.searchFields, columnWidths: legacy?.columnWidths, sorts: legacy?.sort?.field ? [{ field: legacy.sort.field, direction: legacy.sort.direction || 'asc' }] : [] });
}

export function orderedFields(entity) {
  const layout = getFormLayout(entity);
  const byId = new Map(entity.fields.map(f => [f.id, f]));
  return layout.order.map(id => byId.get(id)).filter(Boolean);
}

export function viewOrderedFields(entity, view) {
  const byId = new Map(entity.fields.map(f => [f.id, f]));
  const ordered = (view.fieldOrder || []).map(id => byId.get(id)).filter(Boolean);
  orderedFields(entity).forEach(f => { if (!ordered.some(o => o.id === f.id)) ordered.push(f); });
  return ordered;
}

export function sortRecords(records, config) {
  const sorts = config.sorts?.length ? config.sorts : config.sort?.field ? [config.sort] : [];
  if (!sorts.length) return [...records];
  const basePos = new Map(records.map((r, i) => [r.id, i]));
  return [...records].sort((a, b) => {
    for (const s of sorts) {
      const dir = s.direction === 'desc' ? -1 : 1;
      const r = compareValues(a.data[s.field], b.data[s.field]);
      if (r !== 0) return r * dir;
    }
    return (basePos.get(a.id) ?? 0) - (basePos.get(b.id) ?? 0);
  });
}

export function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true });
}

export function applyViewFilters(records, entity, view) {
  const filters = view.filters || [];
  if (!filters.length) return records;
  const fields = new Map(entity.fields.map(f => [f.id, f]));
  return records.filter(r => filters.every(f => { const field = fields.get(f.field); return field && matchesViewFilter(r.data[field.id], field, f); }));
}

function matchesViewFilter(value, field, filter) {
  const op = filter.op || 'contains';
  if (op === 'empty') return value == null || value === '' || (Array.isArray(value) && !value.length);
  if (op === 'notEmpty') return !(value == null || value === '' || (Array.isArray(value) && !value.length));
  const e = filter.value;
  const fieldType = field.type === 'formula' ? field.formula?.resultType || 'number' : field.type;
  if (fieldType === 'number') { const a = Number(value), t = Number(e); if (Number.isNaN(a) || Number.isNaN(t)) return false; if (op === 'gt') return a > t; if (op === 'lt') return a < t; return a === t; }
  if (fieldType === 'date' || fieldType === 'datetime') { const a = dateKey(value), t = dateKey(e); if (!a) return false; if (op === 'today') return a === dateKey(new Date()); if (op === 'thisWeek') return sameWeek(a, new Date()); if (op === 'thisMonth') return a.slice(0, 7) === dateKey(new Date()).slice(0, 7); if (!t) return false; if (op === 'before') return a < t; if (op === 'after') return a > t; return a === t; }
  if (field.type === 'boolean') { const a = value === true || value === '是' || value === 'true'; const t = e === true || e === '是' || e === 'true'; return a === t; }
  const at = formatFieldValue(value, field).toLowerCase();
  const tt = String(e ?? '').toLowerCase();
  if (op === 'notContains' && tt) return !at.includes(tt);
  if (op === 'neq') return at !== tt;
  if (op === 'eq') return at === tt;
  return !tt || at.includes(tt);
}

function sameWeek(actualKey, now) {
  const a = new Date(actualKey), c = new Date(dateKey(now));
  const s = new Date(c); s.setDate(c.getDate() - (c.getDay() || 7) + 1);
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return a >= s && a <= e;
}

export function groupRecords(records, entity, group) {
  const field = entity.fields.find(f => f.id === group.field);
  const grouped = new Map();
  for (const r of records) {
    const k = groupKeyForRecord(r, field, group);
    if (!grouped.has(k.key)) grouped.set(k.key, { ...k, records: [] });
    grouped.get(k.key).records.push(r);
  }
  return [...grouped.values()];
}

function groupKeyForRecord(record, field, group) {
  const v = record.data[field?.id];
  if (!field) return { key: 'ungrouped', label: '未分组' };
  if (field.type === 'date' || field.type === 'datetime') {
    const k = dateKey(v); if (!k) return { key: 'empty', label: '未填写' };
    if (group.mode === 'month') return { key: k.slice(0, 7), label: k.slice(0, 7) };
    if (group.mode === 'week') { const d = new Date(k); d.setDate(d.getDate() - (d.getDay() || 7) + 1); const s = dateKey(d); return { key: `week:${s}`, label: `${s} 至 ${dateKey(new Date(new Date(s).getTime() + 6*86400000))}` }; }
    return { key: k, label: k };
  }
  const label = formatFieldValue(v, field) || '未填写';
  return { key: String(label), label: String(label) };
}

export function getFormLayout(entity) {
  const fb = { columns: 2, order: entity.fields.map(f => f.id) };
  const legacy = readStorage(storageKey('form-layout', entity.id), null);
  const stored = structuredClone(entity.formLayout || legacy || fb);
  stored.columns = [1, 2, 3, 4].includes(Number(stored.columns)) ? Number(stored.columns) : 2;
  stored.order = (stored.order || []).filter(id => new Set(entity.fields.map(f => f.id)).has(id));
  entity.fields.forEach(f => { if (!stored.order.includes(f.id)) stored.order.push(f.id); });
  return stored;
}

export async function setFormLayout(entity, layout) {
  const normalized = { columns: [1, 2, 3, 4].includes(Number(layout.columns)) ? Number(layout.columns) : 2, order: layout.order };
  entity.formLayout = normalized;
  await shellActions.saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    if (target) target.formLayout = normalized;
  });
  localStorage.removeItem(storageKey('form-layout', entity.id));
}
export function getFormDesign(entity) { return getFormDesignFromPatch(entity, entity.formDesign || readStorage(storageKey('form-design', entity.id), null)); }
export async function setFormDesign(entity, design) {
  const normalized = getFormDesignFromPatch(entity, design);
  await shellActions.saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    if (target) target.formDesign = normalized;
  });
  localStorage.removeItem(storageKey('form-design', entity.id));
}

function getFormDesignFromPatch(entity, design = {}) {
  const fSet = new Set(entity.fields.map(f => f.id));
  return { descriptions: Object.fromEntries(Object.entries(design?.descriptions || {}).filter(([id]) => fSet.has(id))), defaults: Object.fromEntries(Object.entries(design?.defaults || {}).filter(([id]) => fSet.has(id))) };
}

function normalizeView(entity, view) {
  const fIds = entity.fields.map(f => f.id), fSet = new Set(fIds);
  const fb = { visibleFields: [...fIds], fieldOrder: [...fIds], searchFields: [], columnWidths: {}, actionWidth: state.runtimeSettings.actionWidth, allFields: [...fIds], filters: [], sorts: [], group: null, id: `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: '全部记录' };
  const next = { ...fb, ...view };
  next.name = String(next.name || '未命名视图').trim() || '未命名视图';
  next.visibleFields = (next.visibleFields || []).filter(id => fSet.has(id));
  fIds.forEach(id => { if (!next.visibleFields.includes(id)) next.visibleFields.push(id); });
  if (!next.visibleFields.length) next.visibleFields = [...fIds];
  next.fieldOrder = (next.fieldOrder || []).filter(id => fSet.has(id));
  fIds.forEach(id => { if (!next.fieldOrder.includes(id)) next.fieldOrder.push(id); });
  next.searchFields = (next.searchFields || []).filter(id => fSet.has(id));
  next.columnWidths ||= {}; Object.keys(next.columnWidths).forEach(id => { if (!fSet.has(id)) delete next.columnWidths[id]; });
  next.actionWidth = Math.max(84, Number(state.runtimeSettings.actionWidth));
  next.filters = (next.filters || []).filter(f => fSet.has(f.field));
  next.sorts = (next.sorts || []).filter(s => fSet.has(s.field));
  if (next.group && !fSet.has(next.group.field)) next.group = null;
  next.group = next.group ? { field: next.group.field, mode: next.group.mode || 'value', collapsed: next.group.collapsed || [] } : null;
  return next;
}

// 页面渲染器注册表，替代 globalThis.__rt 全局变量
const pageRenderers = {};
export function setPageRenderers(renderers) {
  Object.assign(pageRenderers, renderers);
}

export function renderPage(page) {
  if (state.loading) return renderLoadingSkeleton();
  if (!page) return h('div', { class: 'panel', text: '这个软件还没有页面。' });
  const kind = page.navKind || 'page';
  if (kind === 'link' && page.target === '_self' && page.url) return renderLinkPage(page);
  if (kind === 'table') return (pageRenderers.renderListPage || (() => h('div', { text: '加载中...' })))(page);
  return (pageRenderers.renderPageCanvas || (() => h('div', { class: 'blank-page-canvas' })))(page);
}

function renderLinkPage(page) {
  return h('div', { class: 'panel link-page-panel' }, [
    h('div', { class: 'link-page-toolbar' }, [
      h('span', { class: 'link-page-url', text: page.url }),
      h('a', { class: 'secondary', href: page.url, target: '_blank', text: '新窗口打开' })
    ]),
    h('iframe', {
      class: 'link-page-iframe',
      src: page.url,
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups'
    })
  ]);
}

function renderLoadingSkeleton() {
  return h('div', { class: 'loading-overlay' }, [
    h('div', { class: 'loading-skeleton' }, [
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' }),
      h('div', { class: 'loading-bar' })
    ])
  ]);
}
