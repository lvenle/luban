import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog, openTextModal } from '../common/modal.js';
import { state, orderedFields, getFormLayout, getFormDesign, recordsFor } from '../app.js';
import { writeStorage } from '../common/storage.js';
import { relationDisplayValue, normalizeFileValue } from './CellEditor.js';
import { getCurrentView, getListConfig, updateCurrentView } from './ViewBar.js';
import { loadCurrentPageRecords, renderRuntime } from './index.js';
import { optionObject } from './FieldEditor.js';

export function openRecordModal(entity, record = null) {
  const layout = getFormLayout(entity);
  const design = getFormDesign(entity);
  const form = h('form', { class: 'form-grid', style: `grid-template-columns: repeat(${layout.columns}, minmax(0, 1fr))` });
  const inputs = {};
  for (const field of orderedFields(entity)) {
    const value = record?.data?.[field.id] ?? (!record ? design.defaults[field.id] : undefined);
    const input = inputForField(field, value);
    inputs[field.id] = input;
    form.append(renderFormFieldBlock(field, input, design));
  }
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: record ? `编辑${entity.name}` : `新增${entity.name}` }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      form,
      h('div', { class: 'row', style: 'margin-top:14px' }, [
        h('button', {
          text: '保存',
          onclick: async () => {
            const data = record ? { ...record.data } : {};
            for (const field of orderedFields(entity)) data[field.id] = await valueFromInput(inputs[field.id], field);
            const path = record ? `/api/apps/${state.currentApp.id}/records/${record.id}` : `/api/apps/${state.currentApp.id}/records`;
            const method = record ? 'PUT' : 'POST';
            await api(path, { method, body: JSON.stringify({ entityId: entity.id, data }) });
            backdrop.remove();
            await loadCurrentPageRecords();
            renderRuntime();
          }
        }),
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

export function renderFormFieldBlock(field, input, design = {}, options = {}) {
  const required = field.required || (design.requiredFields || []).includes(field.id);
  const label = h('label', { text: `${field.label}${required ? ' *' : ''}` });
  const labelNode = options.actions?.length
    ? h('div', { class: 'field-label-row' }, [label, ...options.actions])
    : label;
  const description = design.descriptions?.[field.id];
  return h('div', { class: `field ${options.className || ''}`.trim(), ...(options.attrs || {}) }, [
    labelNode,
    input,
    description ? h('small', { class: 'field-hint', text: description }) : null
  ]);
}

export function createChoiceWidget(field, initialValue, onChange) {
  const multiple = field.type === 'multiSelect' || (field.type === 'relation' && field.multiple);
  let currentValue = initialValue;

  let choices;
  if (field.type === 'relation') {
    const target = state.currentApp.schema.entities.find((e) => e.id === field.targetEntity);
    choices = recordsFor(field.targetEntity)
      .map((record) => ({
        id: record.id,
        label: relationDisplayValue(field, target, record),
        color: 'gray'
      }))
      .filter((c) => c.label && c.label !== c.id);
  } else {
    choices = (field.options || []).map(optionObject);
  }

  const selectedIds = () => {
    const vals = multiple ? (Array.isArray(currentValue) ? currentValue : []) : [currentValue].filter(Boolean);
    return vals.map((v) => {
      if (field.type === 'relation') return v.targetRecordId || v.recordId || v;
      return optionObject(v).id;
    }).filter(Boolean);
  };

  const tags = h('div', { class: 'cell-choice-editor-tags' });
  const arrow = h('span', { class: 'cell-choice-editor-arrow', text: '⌄' });
  const editor = h('div', { class: 'cell-choice-editor' }, [tags, arrow]);

  const renderTags = () => {
    tags.innerHTML = '';
    const ids = selectedIds();
    for (const choice of choices) {
      if (!ids.includes(choice.id)) continue;
      tags.append(h('span', { class: `cell-choice-editor-pill select-${choice.color || 'gray'}` }, [
        h('span', { text: choice.label }),
        h('button', { class: 'cell-choice-pill-remove', text: '×', title: '移除',
          onclick: (e) => { e.stopPropagation(); toggleOption(choice.id); }
        })
      ]));
    }
  };

  let dropdown = null;
  let outsideController = null;

  const closeDropdown = () => {
    outsideController?.abort();
    outsideController = null;
    if (dropdown) { dropdown.remove(); dropdown = null; }
  };

  const toggleOption = (id) => {
    const ids = selectedIds();
    let newVal;
    if (ids.includes(id)) {
      if (multiple) {
        const arr = Array.isArray(currentValue) ? [...currentValue] : [];
        const valIdx = arr.findIndex((v) => {
          const vid = field.type === 'relation' ? (v.targetRecordId || v.recordId || v) : optionObject(v).id;
          return vid === id;
        });
        if (valIdx >= 0) arr.splice(valIdx, 1);
        newVal = arr;
      } else {
        newVal = '';
      }
    } else {
      if (multiple) {
        const arr = Array.isArray(currentValue) ? [...currentValue] : [];
        arr.push(id);
        newVal = arr;
      } else {
        newVal = id;
      }
    }
    currentValue = newVal;
    editor._choiceValue = newVal;
    renderTags();
    if (dropdown) {
      dropdown.querySelectorAll('[data-choice-option]').forEach((row) => {
        const isSelected = selectedIds().includes(row.dataset.choiceOption);
        row.dataset.choiceSelected = isSelected ? 'true' : 'false';
        row.classList.toggle('selected', isSelected);
      });
    }
    if (onChange) onChange(newVal);
  };

  const openDropdown = () => {
    closeDropdown();
    const list = h('div', { class: 'cell-choice-list' });
    const ids = selectedIds();
    for (const choice of choices) {
      const selected = ids.includes(choice.id);
      list.append(h('button', {
        class: `cell-choice-row ${selected ? 'selected' : ''}`,
        type: 'button',
        'data-choice-option': choice.id,
        'data-choice-selected': selected ? 'true' : 'false',
        onclick: (e) => { e.preventDefault(); toggleOption(choice.id); if (!multiple) closeDropdown(); }
      }, [
        h('span', { class: `cell-choice-pill select-${choice.color || 'gray'}`, text: choice.label })
      ]));
    }
    dropdown = h('div', { class: 'cell-choice-dropdown' }, [list]);
    document.body.append(dropdown);
    const rect = editor.getBoundingClientRect();
    const dw = Math.max(rect.width, 180);
    dropdown.style.left = `${Math.min(window.innerWidth - dw - 8, Math.max(8, rect.left))}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.minWidth = `${dw}px`;
    dropdown.style.maxWidth = `${Math.min(320, window.innerWidth - 16)}px`;
    const ctrl = new AbortController();
    outsideController = ctrl;
    setTimeout(() => {
      if (ctrl.signal.aborted) return;
      document.addEventListener('pointerdown', (e) => {
        if (dropdown?.contains(e.target) || editor.contains(e.target)) return;
        closeDropdown();
        if (editor._choiceCloseCallback) editor._choiceCloseCallback();
      }, { capture: true, signal: ctrl.signal });
    }, 0);
    dropdown.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
        if (editor._choiceCloseCallback) editor._choiceCloseCallback();
      }
    });
  };

  renderTags();
  editor.addEventListener('click', openDropdown);
  editor._choiceValue = currentValue;

  return editor;
}

export function inputForField(field, value) {
  if (field.type === 'textarea' || field.type === 'richText') return h('textarea', { value: value ?? '', placeholder: field.placeholder || '' });
  if (field.type === 'image' || field.type === 'file') {
    const input = h('input', { type: 'file', accept: field.type === 'image' ? 'image/*' : '' });
    input.dataset.currentValue = JSON.stringify(normalizeFileValue(value) || null);
    input.title = normalizeFileValue(value)?.name || '选择文件';
    return input;
  }
  if (field.type === 'select' || field.type === 'multiSelect') {
    return createChoiceWidget(field, value ?? (field.type === 'multiSelect' ? [] : ''), null);
  }
  if (field.type === 'relation') {
    return createChoiceWidget(field, value ?? (field.multiple ? [] : ''), null);
  }
  if (field.type === 'boolean') {
    const input = h('input', { type: 'checkbox' });
    input.checked = Boolean(value);
    return input;
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return h('input', { type, value: value ?? '', placeholder: field.placeholder || '' });
}

export function searchInputForField(field) {
  if (field.type === 'select') {
    const select = h('select');
    select.append(h('option', { value: '', text: '全部' }));
    for (const rawOption of field.options || []) {
      const option = optionObject(rawOption);
      select.append(h('option', { value: option.label, text: option.label }));
    }
    return select;
  }
  if (field.type === 'boolean') {
    const select = h('select');
    select.append(h('option', { value: '', text: '全部' }));
    select.append(h('option', { value: '是', text: '是' }));
    select.append(h('option', { value: '否', text: '否' }));
    return select;
  }
  const type = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'number' ? 'number' : 'text';
  return h('input', { type, placeholder: `搜索${field.label}` });
}

export async function valueFromInput(input, field) {
  if (field.type === 'boolean') return input.checked;
  if (field.type === 'multiSelect') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : []) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'relation') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : [input._choiceValue]) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'select') return input._choiceValue !== undefined ? (input._choiceValue || '') : input.value;
  if (field.type === 'image' || field.type === 'file') return uploadValueFromInput(input, field);
  if (field.type === 'number') return input.value === '' ? null : Number(input.value);
  return input.value;
}

export async function uploadValueFromInput(input, field) {
  if (!input.files?.length) return JSON.parse(input.dataset.currentValue || 'null');
  const file = input.files[0];
  if (field.type === 'image' && !file.type.startsWith('image/')) {
    toast('图片字段只能上传图片文件。');
    return JSON.parse(input.dataset.currentValue || 'null');
  }
  const buffer = await file.arrayBuffer();
  const params = new URLSearchParams({ name: file.name });
  const body = await api(`/api/apps/${state.currentApp.id}/uploads?${params.toString()}`, {
    method: 'POST',
    body: buffer,
    headers: { 'content-type': file.type || 'application/octet-stream' }
  });
  input.dataset.currentValue = JSON.stringify(body.file);
  return body.file;
}

export async function removeRecord(recordId, entityId) {
  openConfirmDialog({
    title: '删除记录',
    message: '确定删除这条记录吗？',
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
        await loadCurrentPageRecords();
        renderRuntime();
        toast('记录已删除');
      } catch (error) {
        if (!/引用/.test(error.message)) throw error;
        openConfirmDialog({
          title: '删除被引用记录',
          message: `${error.message} 删除后这些关联字段会变为空，是否继续？`,
          confirmText: '继续删除',
          danger: true,
          onConfirm: async () => {
            await api(`/api/apps/${state.currentApp.id}/records/${recordId}?force=true`, { method: 'DELETE' });
            await loadCurrentPageRecords();
            renderRuntime();
            toast('记录和相关关联已删除');
          }
        });
      }
    }
  });
}

export async function quickAddRecord(entity) {
  try {
    const data = {};
    for (const field of entity.fields) data[field.id] = defaultValueForField(field);
    const body = await api(`/api/apps/${state.currentApp.id}/records`, { method: 'POST', body: JSON.stringify({ entityId: entity.id, data }) });
    
    const currentView = getCurrentView(entity);
    const hasFilters = currentView.filters && currentView.filters.length > 0;
    
    await loadCurrentPageRecords();
    renderRuntime();
    
    if (hasFilters) {
      toast(`已新增 1 行。注意：当前视图有筛选条件，新记录可能不在此视图中显示。`);
    } else {
      toast(`已新增 1 行，可直接双击单元格编辑。`);
    }
    
    return body.record;
  } catch (error) {
    toast(`新增行失败：${error.message}`);
    console.error('新增行错误：', error);
    throw error;
  }
}

export async function bulkDeleteRecords(entity, selectedIds, selectionKey) {
  if (!selectedIds.size) return toast('先选择要删除的记录。');
  openConfirmDialog({
    title: '批量删除记录',
    message: `确定删除选中的 ${selectedIds.size} 条记录吗？`,
    confirmText: '批量删除',
    danger: true,
    onConfirm: async () => {
      for (const recordId of selectedIds) {
        await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
      }
      writeStorage(selectionKey, []);
      await loadCurrentPageRecords();
      renderRuntime();
      toast('已删除选中记录');
    }
  });
}

export function defaultValueForField(field) {
  if (field.type === 'number') return null;
  if (field.type === 'boolean') return false;
  if (field.type === 'multiSelect') return [];
  if (field.type === 'select') return '';
  if (field.type === 'relation') return [];
  if (field.type === 'image' || field.type === 'file') return null;
  return '';
}

export async function runAppAction(actionId) {
  try {
    const body = await api(`/api/apps/${state.currentApp.id}/actions/${actionId}/run`, { method: 'POST', body: '{}' });
    openTextModal('Action 结果', typeof body.result === 'string' ? body.result : JSON.stringify(body.result, null, 2));
  } catch (error) {
    toast(error.message);
  }
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
