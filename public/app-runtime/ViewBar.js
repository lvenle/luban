import { h, buttonLabel } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog, openConfigModal, closeTopModal, closeFloatingMenus } from '../common/modal.js';
import { readStorage, writeStorage } from '../common/storage.js';
import { state, writeRoute, formatFieldValue, dateKey, storageKey } from '../app.js';
import { renderRuntime, saveCurrentPackage } from './index.js';
import { optionObject, effectiveFieldType } from './FieldEditor.js';
import { dateInputValue } from './DateFormat.js';
import { reorderItemsById } from './Ordering.js';

function defaultView(entity) {
  const legacy = readStorage(storageKey('list', entity.id), null);
  return normalizeView(entity, {
    id: 'default',
    name: '全部记录',
    type: 'list',
    visibleFields: legacy?.visibleFields,
    fieldOrder: legacy?.fieldOrder,
    searchFields: legacy?.searchFields,
    columnWidths: legacy?.columnWidths,
    frozenFieldId: legacy?.frozenFieldId,
    sorts: legacy?.sort?.field ? [{ field: legacy.sort.field, direction: legacy.sort.direction || 'asc' }] : [],
    filters: [],
    group: null
  });
}

export function getViews(entity) {
  const page = currentViewPage(entity);
  if (Array.isArray(page?.views) && page.views.length) return page.views.map((view) => normalizeView(entity, view));
  const legacyKey = storageKey('views', entity.id);
  const stored = readStorage(legacyKey, null);
  const views = Array.isArray(stored) && stored.length ? stored : [defaultView(entity)];
  const normalized = views.map((view) => normalizeView(entity, view)).filter(Boolean);
  const result = normalized.length ? normalized : [defaultView(entity)];
  if (page) {
    page.views = result;
    if (Array.isArray(stored) && stored.length) persistViews(legacyKey);
  }
  return result;
}

export function setViews(entity, views) {
  const normalized = views.map((view) => normalizeView(entity, view));
  const page = currentViewPage(entity);
  if (page) {
    page.views = normalized;
    persistViews();
  } else {
    writeStorage(storageKey('views', entity.id), normalized);
  }
}

export function getCurrentView(entity) {
  const views = getViews(entity);
  const current = views.find((view) => view.id === state.currentViewId) || views[0];
  state.currentViewId = current.id;
  return current;
}

export function updateCurrentView(entity, updater) {
  const views = getViews(entity);
  const currentIndex = Math.max(0, views.findIndex((view) => view.id === state.currentViewId));
  const current = views[currentIndex] || views[0] || defaultView(entity);
  views[currentIndex] = normalizeView(entity, typeof updater === 'function' ? updater({ ...current }) : { ...current, ...updater });
  setViews(entity, views);
  state.currentViewId = views[currentIndex].id;
  return views[currentIndex];
}

export function normalizeView(entity, view = {}) {
  const fieldIds = entity.fields.map((field) => field.id);
  const fieldSet = new Set(fieldIds);
  const fallback = {
    visibleFields: entity.fields.map((field) => field.id),
    fieldOrder: entity.fields.map((field) => field.id),
    searchFields: [],
    columnWidths: {},
    frozenFieldId: '',
    actionWidth: 112,
    allFields: entity.fields.map((field) => field.id),
    filters: [],
    sorts: [],
    group: null
  };
  const next = { ...fallback, ...view };
  next.id = next.id || makeViewId();
  next.name = String(next.name || '未命名视图').trim() || '未命名视图';
  next.type = ['list', 'quadrant', 'gantt'].includes(next.type) ? next.type : 'list';
  next.visibleFields = (next.visibleFields || []).filter((id) => fieldSet.has(id));
  const inputHadVisibleFields = Array.isArray(view.visibleFields);
  if (!inputHadVisibleFields || next.visibleFields.length === 0) {
    for (const field of entity.fields) {
      if (!next.visibleFields.includes(field.id)) {
        next.visibleFields.push(field.id);
      }
    }
  }
  if (next.visibleFields.length === 0) next.visibleFields = fallback.visibleFields;
  next.fieldOrder = (next.fieldOrder || []).filter((id) => fieldSet.has(id));
  for (const id of fieldIds) {
    if (!next.fieldOrder.includes(id)) next.fieldOrder.push(id);
  }
  next.searchFields = (next.searchFields || []).filter((id) => fieldSet.has(id));
  next.columnWidths ||= {};
  for (const id of Object.keys(next.columnWidths)) {
    if (!fieldSet.has(id)) delete next.columnWidths[id];
  }
  next.actionWidth = Math.max(84, Number(next.actionWidth || 112));
  next.frozenFieldId = fieldSet.has(next.frozenFieldId) ? next.frozenFieldId : '';
  next.filters = (next.filters || []).filter((filter) => fieldSet.has(filter.field));
  next.sorts = (next.sorts || []).filter((sort) => fieldSet.has(sort.field));
  if (next.group && !fieldSet.has(next.group.field)) next.group = null;
  next.group = next.group ? { field: next.group.field, mode: next.group.mode || 'value', collapsed: next.group.collapsed || [] } : null;
  if (next.type === 'quadrant') {
    next.quadrant = { fieldId: next.quadrant?.fieldId || '', optionIds: [...new Set(next.quadrant?.optionIds || [])].slice(0, 4) };
  }
  if (next.type === 'gantt') {
    next.gantt = {
      titleField: next.gantt?.titleField || '',
      startField: next.gantt?.startField || '',
      endField: next.gantt?.endField || '',
      progressField: next.gantt?.progressField || ''
    };
  }
  next.allFields = fieldIds;
  return next;
}

export function makeViewId() {
  return `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getListConfig(entity) {
  return getCurrentView(entity);
}

export function setListConfig(entity, config) {
  updateCurrentView(entity, config);
}

export function renderViewBar(entity, currentView) {
  const views = getViews(entity);
  return h('div', { class: 'view-bar' }, [
    h('div', { class: 'view-tabs', role: 'tablist', 'aria-label': '数据视图' }, views.map((view) => {
      const tab =
      h('button', {
        class: `view-tab ${view.id === currentView.id ? 'active' : ''}`,
        role: 'tab',
        'aria-selected': view.id === currentView.id ? 'true' : 'false',
        'data-view-id': view.id,
        ondblclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.currentViewId = view.id;
          startViewNameEdit(event.currentTarget, entity, view);
        },
        onclick: () => {
          state.currentViewId = view.id;
          writeRoute(state.currentApp.id, state.currentPageId, false, view.id);
          renderRuntime();
        },
        onkeydown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          state.currentViewId = view.id;
          writeRoute(state.currentApp.id, state.currentPageId, false, view.id);
          renderRuntime();
        }
      }, [h('span', { class: 'view-tab-name', text: view.name })]);
      const shell = h('div', { class: 'view-tab-shell', draggable: 'true', 'data-view-id': view.id }, [
        tab,
        view.id === currentView.id ? renderViewMenu(entity) : null
      ]);
      bindViewTabDrag(shell, entity, view, views);
      return shell;
    })),
    h('div', { class: 'row' }, [
      h('button', { class: 'secondary icon-label-button', onclick: () => openCreateViewModal(entity) }, buttonLabel('add', '新建视图'))
    ])
  ]);
}

export function bindViewTabDrag(tab, entity, view, views) {
  tab.addEventListener('dragstart', (event) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', view.id);
    tab.classList.add('view-tab-dragging');
  });
  tab.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = tab.getBoundingClientRect();
    tab.dataset.dropSide = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  });
  tab.addEventListener('dragleave', () => delete tab.dataset.dropSide);
  tab.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceViewId = event.dataTransfer.getData('text/plain');
    const reordered = reorderViews(views, sourceViewId, view.id, tab.dataset.dropSide || 'before');
    delete tab.dataset.dropSide;
    if (reordered === views) return;
    setViews(entity, reordered);
    renderRuntime();
  });
  tab.addEventListener('dragend', () => {
    tab.classList.remove('view-tab-dragging');
    document.querySelectorAll('.view-tab-shell').forEach((item) => delete item.dataset.dropSide);
  });
}

export function reorderViews(views = [], sourceViewId, targetViewId, side = 'before') {
  return reorderItemsById(views, sourceViewId, targetViewId, side);
}

export function renderViewMenu(entity) {
  return h('button', {
    class: 'view-menu-trigger',
    title: '视图操作',
    onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openViewMenu(event.currentTarget, entity);
    }
  }, '⋮');
}

export function openViewMenu(trigger, entity) {
  closeFloatingMenus();
  document.querySelector('.view-menu-popover')?.remove();
  const menu = h('div', { class: 'view-menu-popover floating-view-menu' }, [
    h('button', { class: 'ghost-menu', text: '复制', onclick: () => { closeViewMenu(); cloneView(entity); } }),
    h('button', { class: 'ghost-menu', text: '重命名', onclick: () => { closeViewMenu(); renameView(entity); } }),
    h('button', { class: 'ghost-menu', text: '清除视图设置', onclick: () => { closeViewMenu(); clearCurrentViewConfig(entity); } }),
    h('button', { class: 'ghost-menu danger-text', text: '删除', onclick: () => { closeViewMenu(); deleteView(entity); } })
  ]);
  document.body.append(menu);
  positionViewMenu(trigger, menu);
  setTimeout(() => document.addEventListener('click', closeViewMenu, { once: true }), 0);
}

export function positionViewMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(menu.offsetWidth, 128);
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right + 6));
  const top = Math.min(window.innerHeight - menu.offsetHeight - 8, Math.max(8, rect.top));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function closeViewMenu() {
  document.querySelector('.view-menu-popover')?.remove();
}

export function startViewNameEdit(button, entity, view) {
  const input = h('input', { class: 'view-name-input', value: view.name });
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name) {
      state.currentViewId = view.id;
      updateCurrentView(entity, { name });
    }
    renderRuntime();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') finish(false);
  });
}

export function createView(entity, name = '新视图', patch = {}) {
  const views = getViews(entity);
  const view = normalizeView(entity, { ...defaultView(entity), ...patch, id: makeViewId(), name });
  views.push(view);
  setViews(entity, views);
  state.currentViewId = view.id;
  writeRoute(state.currentApp.id, state.currentPageId, false, view.id);
  renderRuntime();
}

export function openCreateViewModal(entity) {
  const nameInput = h('input', { value: '新视图', placeholder: '视图名称' });
  const typeSelect = selectFromOptions([
    ['list', '表格视图'],
    ['quadrant', '四象限视图'],
    ['gantt', '甘特视图']
  ], 'list');
  const config = h('div', { class: 'view-type-config' });
  let createButton = null;
  const renderConfig = () => {
    config.innerHTML = '';
    if (typeSelect.value === 'quadrant') {
      const fields = entity.fields.filter((field) => field.type === 'select' && (field.options || []).length >= 4);
      const fieldSelect = selectFromOptions(fields.map((field) => [field.id, field.label]), fields[0]?.id || '');
      fieldSelect.dataset.viewConfig = 'quadrantField';
      config.append(h('label', { class: 'field' }, [h('span', { text: '四象限字段' }), fieldSelect]),
        fields.length ? h('p', { class: 'muted field-hint', text: '创建时锁定该字段的前 4 个选项。' }) : h('p', { class: 'field-error', text: '需要至少一个包含 4 个选项的单选字段。' }));
    }
    if (typeSelect.value === 'gantt') {
      const titleFields = entity.fields.filter((field) => field.type !== 'formula' || field.formula?.resultType === 'text');
      const dateFields = entity.fields.filter((field) => ['date', 'datetime'].includes(field.type) || (field.type === 'formula' && field.formula?.resultType === 'date'));
      const progressFields = entity.fields
        .filter((field) => field.type === 'number' || (field.type === 'formula' && field.formula?.resultType === 'number'))
        .sort((a, b) => Number(b.format === 'percent' || /进度|progress/i.test(`${b.label} ${b.id}`)) - Number(a.format === 'percent' || /进度|progress/i.test(`${a.label} ${a.id}`)));
      const title = selectFromOptions(titleFields.map((field) => [field.id, field.label]), titleFields[0]?.id || '');
      const start = selectFromOptions(dateFields.map((field) => [field.id, field.label]), dateFields[0]?.id || '');
      const end = selectFromOptions(dateFields.map((field) => [field.id, field.label]), dateFields[1]?.id || dateFields[0]?.id || '');
      const progress = selectFromOptions([['', '自动识别或按日期计算'], ...progressFields.map((field) => [field.id, field.label])], '');
      title.dataset.viewConfig = 'titleField'; start.dataset.viewConfig = 'startField'; end.dataset.viewConfig = 'endField'; progress.dataset.viewConfig = 'progressField';
      config.append(
        h('label', { class: 'field' }, [h('span', { text: '标题字段' }), title]),
        h('label', { class: 'field' }, [h('span', { text: '开始日期' }), start]),
        h('label', { class: 'field' }, [h('span', { text: '结束日期' }), end]),
        h('label', { class: 'field' }, [h('span', { text: '进度字段（可选）' }), progress]),
        h('p', { class: 'muted field-hint', text: '百分比格式按 0–1 读取；普通数值可使用 0–1 或 0–100。' }),
        dateFields.length >= 2 ? null : h('p', { class: 'field-error', text: '甘特视图需要至少两个日期或日期时间字段。' })
      );
    }
    if (createButton) {
      const invalidQuadrant = typeSelect.value === 'quadrant' && !config.querySelector('[data-view-config="quadrantField"]')?.value;
      const start = config.querySelector('[data-view-config="startField"]')?.value;
      const end = config.querySelector('[data-view-config="endField"]')?.value;
      const invalidGantt = typeSelect.value === 'gantt' && (!start || !end || start === end);
      createButton.disabled = invalidQuadrant || invalidGantt;
    }
  };
  typeSelect.addEventListener('change', renderConfig);
  createButton = h('button', { text: '创建', onclick: () => {
    const type = typeSelect.value;
    const patch = { type };
    if (type === 'quadrant') {
      const field = entity.fields.find((item) => item.id === config.querySelector('[data-view-config="quadrantField"]')?.value);
      if (!field || (field.options || []).length < 4) return toast('请选择至少包含 4 个选项的单选字段。');
      patch.quadrant = { fieldId: field.id, optionIds: field.options.slice(0, 4).map((option) => optionObject(option).id) };
    }
    if (type === 'gantt') {
      const titleField = config.querySelector('[data-view-config="titleField"]')?.value;
      const startField = config.querySelector('[data-view-config="startField"]')?.value;
      const endField = config.querySelector('[data-view-config="endField"]')?.value;
      const progressField = config.querySelector('[data-view-config="progressField"]')?.value || '';
      if (!titleField || !startField || !endField || startField === endField) return toast('请选择标题字段以及两个不同的日期字段。');
      patch.gantt = { titleField, startField, endField, progressField };
    }
    createView(entity, nameInput.value.trim() || '新视图', patch);
    backdrop.remove();
  } });
  renderConfig();
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal compact-modal' }, [
      h('div', { class: 'toolbar' }, [h('h3', { text: '新建视图' }), h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })]),
      h('label', { class: 'field' }, [h('span', { text: '视图名称' }), nameInput]),
      h('label', { class: 'field' }, [h('span', { text: '视图类型' }), typeSelect]),
      config,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        createButton
      ])
    ])
  ]);
  document.body.append(backdrop);
  nameInput.focus(); nameInput.select();
}

function currentViewPage(entity) {
  return state.currentApp?.ui?.pages?.find((page) => page.id === state.currentPageId && page.entity === entity.id) || null;
}

let persistTimer = null;
function persistViews(legacyKey = '') {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      await saveCurrentPackage(() => {});
      if (legacyKey) localStorage.removeItem(legacyKey);
    } catch (error) {
      toast(`视图保存失败：${error.message}`);
    }
  }, 80);
}

export function cloneView(entity) {
  const current = getCurrentView(entity);
  createView(entity, `${current.name} 副本`, { ...current, id: makeViewId(), name: `${current.name} 副本` });
}

export function renameView(entity) {
  const current = getCurrentView(entity);
  const tab = document.querySelector('.view-tab.active');
  if (tab) startViewNameEdit(tab, entity, current);
}

export function deleteView(entity) {
  const views = getViews(entity);
  if (views.length <= 1) return toast('至少保留一个视图。');
  const current = getCurrentView(entity);
  openConfirmDialog({
    title: '删除视图',
    message: `确定删除视图「${current.name}」吗？`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      const nextViews = views.filter((view) => view.id !== current.id);
      setViews(entity, nextViews);
      state.currentViewId = nextViews[0]?.id || '';
      writeRoute(state.currentApp.id, state.currentPageId, false, state.currentViewId);
      renderRuntime();
      toast('视图已删除');
    }
  });
}

export function openFilterModal(entity) {
  let filters = [...(getCurrentView(entity).filters || [])];
  const body = h('div', { class: 'config-list' });
  const controls = new Map();
  const renderRows = () => {
    body.innerHTML = '';
    controls.clear();
    if (!filters.length) body.append(h('p', { class: 'muted', text: '暂无筛选条件。' }));
    filters.forEach((filter, index) => {
      const field = entity.fields.find((item) => item.id === filter.field) || entity.fields[0];
      filter.field = field.id;
      const fieldSelect = selectFromOptions(entity.fields.map((item) => [item.id, item.label]), filter.field);
      const opSelect = selectFromOptions(filterOperators(field).map((item) => [item.op, item.label]), filter.op || filterOperators(field)[0].op);
      const valueInput = filterValueInput(field, filter);
      fieldSelect.addEventListener('change', () => {
        filters[index] = { field: fieldSelect.value, op: filterOperators(entity.fields.find((item) => item.id === fieldSelect.value) || entity.fields[0])[0].op, value: '' };
        renderRows();
      });
      opSelect.addEventListener('change', () => {
        filters[index].op = opSelect.value;
        renderRows();
      });
      valueInput?.addEventListener('input', () => (filters[index].value = valueFromFilterInput(valueInput, field)));
      valueInput?.addEventListener('change', () => (filters[index].value = valueFromFilterInput(valueInput, field)));
      controls.set(index, { fieldSelect, opSelect, valueInput });
      body.append(h('div', { class: 'config-row' }, [
        fieldSelect,
        opSelect,
        valueInput || h('span', { class: 'muted', text: '无需填写值' }),
        h('button', { class: 'secondary', text: '删除', onclick: () => { filters.splice(index, 1); renderRows(); } })
      ]));
    });
  };
  const collectFilters = () => filters.map((filter, index) => {
    const control = controls.get(index);
    if (!control) return filter;
    const field = entity.fields.find((item) => item.id === control.fieldSelect.value) || entity.fields[0];
    return {
      field: field.id,
      op: control.opSelect.value,
      value: control.valueInput ? valueFromFilterInput(control.valueInput, field) : ''
    };
  });
  renderRows();
  openConfigModal('筛选条件', body, [
    h('button', { class: 'secondary', text: '添加条件', onclick: () => { filters.push({ field: entity.fields[0].id, op: filterOperators(entity.fields[0])[0].op, value: '' }); renderRows(); } }),
    h('button', { text: '保存', onclick: () => { updateCurrentView(entity, { filters: collectFilters() }); closeTopModal(); renderRuntime(); } })
  ]);
}

export function openSortModal(entity) {
  let sorts = [...(getCurrentView(entity).sorts || [])];
  const body = h('div', { class: 'config-list' });
  const renderRows = () => {
    body.innerHTML = '';
    if (!sorts.length) body.append(h('p', { class: 'muted', text: '暂无排序规则。' }));
    sorts.forEach((sort, index) => {
      const fieldSelect = selectFromOptions(entity.fields.map((item) => [item.id, item.label]), sort.field || entity.fields[0].id);
      const directionSelect = selectFromOptions([['asc', '升序'], ['desc', '降序']], sort.direction || 'asc');
      fieldSelect.addEventListener('change', () => (sorts[index].field = fieldSelect.value));
      directionSelect.addEventListener('change', () => (sorts[index].direction = directionSelect.value));
      body.append(h('div', { class: 'config-row' }, [
        fieldSelect,
        directionSelect,
        h('button', { class: 'secondary', text: '删除', onclick: () => { sorts.splice(index, 1); renderRows(); } })
      ]));
    });
  };
  renderRows();
  openConfigModal('排序规则', body, [
    h('button', { class: 'secondary', text: '添加排序', onclick: () => { sorts.push({ field: entity.fields[0].id, direction: 'asc' }); renderRows(); } }),
    h('button', { text: '保存', onclick: () => { updateCurrentView(entity, { sorts }); closeTopModal(); renderRuntime(); } })
  ]);
}

export function openGroupModal(entity) {
  const current = getCurrentView(entity).group || {};
  const groupableFields = entity.fields.filter((field) => ['select', 'boolean', 'date', 'datetime'].includes(field.type));
  const fieldSelect = selectFromOptions([['', '不分组'], ...groupableFields.map((field) => [field.id, field.label])], current.field || '');
  const modeSelect = selectFromOptions([['value', '按值'], ['day', '按天'], ['week', '按周'], ['month', '按月']], current.mode || 'value');
  const body = h('div', { class: 'config-list' }, [
    h('div', { class: 'field' }, [h('label', { text: '分组字段' }), fieldSelect]),
    h('div', { class: 'field' }, [h('label', { text: '日期分组方式' }), modeSelect]),
    h('p', { class: 'muted', text: '单选和布尔字段按值分组；日期字段可按天、周、月分组。' })
  ]);
  openConfigModal('分组设置', body, [
    h('button', { text: '保存', onclick: () => {
      const group = fieldSelect.value ? { field: fieldSelect.value, mode: modeSelect.value, collapsed: current.collapsed || [] } : null;
      updateCurrentView(entity, { group });
      closeTopModal();
      renderRuntime();
    } })
  ]);
}

export function clearCurrentViewConfig(entity) {
  const config = getListConfig(entity);
  updateCurrentView(entity, {
    ...config,
    filters: [],
    sorts: [],
    group: null,
    searchFields: []
  });
  renderRuntime();
  toast('已清除当前视图的筛选、排序、分组和搜索条件。');
}

export function selectFromOptions(options, value) {
  const select = h('select');
  for (const [optionValue, label] of options) select.append(h('option', { value: optionValue, text: label }));
  select.value = value;
  return select;
}

export function filterOperators(field) {
  const type = effectiveFieldType(field);
  if (type === 'number') return [
    { op: 'eq', label: '等于' },
    { op: 'gt', label: '大于' },
    { op: 'lt', label: '小于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (type === 'date' || type === 'datetime') return [
    { op: 'eq', label: '等于' },
    { op: 'before', label: '早于' },
    { op: 'after', label: '晚于' },
    { op: 'today', label: '今天' },
    { op: 'thisWeek', label: '本周' },
    { op: 'thisMonth', label: '本月' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (field.type === 'select') return [
    { op: 'eq', label: '等于' },
    { op: 'neq', label: '不等于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  if (field.type === 'boolean') return [
    { op: 'eq', label: '等于' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
  return [
    { op: 'contains', label: '包含' },
    { op: 'notContains', label: '不包含' },
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ];
}

export function filterValueInput(field, filter) {
  if (['empty', 'notEmpty', 'today', 'thisWeek', 'thisMonth'].includes(filter.op)) return null;
  if (field.type === 'select') {
    const select = selectFromOptions([['', '请选择'], ...(field.options || []).map((option) => [optionObject(option).label, optionObject(option).label])], filter.value || '');
    return select;
  }
  if (field.type === 'boolean') return selectFromOptions([['true', '是'], ['false', '否']], String(filter.value ?? 'true'));
  const effectiveType = effectiveFieldType(field);
  const type = effectiveType === 'number' ? 'number' : effectiveType === 'date' ? 'date' : effectiveType === 'datetime' ? 'datetime-local' : 'text';
  const inputValue = effectiveType === 'date' || effectiveType === 'datetime' ? dateInputValue(filter.value, effectiveType) : filter.value || '';
  return h('input', { type, value: inputValue });
}

export function valueFromFilterInput(input, field) {
  if (field.type === 'boolean') return input.value === 'true';
  if (effectiveFieldType(field) === 'number') return input.value === '' ? '' : Number(input.value);
  return input.value;
}
