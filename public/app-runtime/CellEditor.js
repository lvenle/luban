import { h, svgIcon, svgPath } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state, entityDisplayName, recordsFor, dateKey } from '../app-context.js';
import { loadCurrentPageRecords, renderRuntime } from './runtime-actions.js';
import { optionObject, effectiveFieldType, clearActiveTableSelection, configureRuntimePorts } from './runtime-ports.js';
import { dateInputValue, dateInputLocale, formatDateFieldValue, bindDateTimePicker, showDateTimePicker } from './DateFormat.js';
import { normalizeChoiceInitialValue, relationChoicesFromValue, mergeChoiceOptions, relationValueId } from './ChoiceValues.js';
import { renderMarkdown } from './Markdown.js';
import { numberInputValue, storedNumberValue } from './NumberValues.js';
import { pushUndo } from '../common/UndoStack.js';
import { notifyRuleResults } from './RuleFeedback.js';

configureRuntimePorts({ defaultValueForField, fieldValuesEqual, relationDisplayValue, displayValue, hasDisplayValue, resolveAiPrompt });

export function startCellEdit(cell, entity, record, field) {
  if (cell.classList.contains('cell-editing')) return;
  if (field.type === 'formula') return toast('公式字段由系统实时计算，不能直接编辑。');
  if (field.type === 'autoNumber') return toast('自增序号由系统自动生成，不能手动修改。');
  if (field.type === 'ai') {
    import('./MarkdownEditor.js').then((m) => m.openMarkdownRecordEditor(entity, record, field)).catch((err) => console.error('[AI Trigger]', err));
    return;
  }
  if (field.type === 'select' || field.type === 'multiSelect' || field.type === 'relation') {
    const widget = createChoiceWidget(field, record.data[field.id], async (newValue) => {
      if (fieldValuesEqual(record.data[field.id], newValue)) {
        renderRuntime();
        return;
      }
      const oldData = { ...record.data };
      const data = { ...record.data, [field.id]: newValue };
      try {
        const body = await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
        pushUndo({ type: 'update', recordId: record.id, entityId: entity.id, oldData, newData: data, entityLabel: entityDisplayName(entity) });
        record.data = data; // update local ref for AI trigger
        import('./AITrigger.js').then((m) => m.checkAiTriggers(entity, record, oldData)).catch((err) => console.error('[AI Trigger]', err));
        await loadCurrentPageRecords();
        renderRuntime();
        notifyRuleResults(body.ruleResults || [], state.currentApp);
      } catch (error) {
        toast(error.message);
        renderRuntime();
      }
    });
    clearActiveTableSelection();
    cell.classList.add('cell-editing', 'choice-cell-editing');
    cell.innerHTML = '';
    cell.append(widget);
    widget._choiceCloseCallback = () => renderRuntime();
    setTimeout(() => widget.click(), 0);
    return;
  }
  cell.classList.add('cell-editing');
  const input = inputForField(field, record.data[field.id]);
  cell.innerHTML = '';
  cell.append(input);
  input.focus();
  if (input.select) input.select();
  if (input.type === 'date' || input.type === 'datetime-local') showDateTimePicker(input);
  let saved = false;
  let composing = false;
  let blurDuringComposition = false;
  const save = async () => {
    if (composing) {
      blurDuringComposition = true;
      return;
    }
    if (saved) return;
    saved = true;
    const nextValue = await valueFromInput(input, field);
    if (fieldValuesEqual(record.data[field.id], nextValue)) {
      cell.classList.remove('cell-editing');
      cell.replaceChildren(renderFieldValue(record.data[field.id], field));
      return;
    }
    const oldData = { ...record.data };
    const data = { ...record.data, [field.id]: nextValue };
    cell.classList.add('saving-cell');
    try {
      const body = await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, { method: 'PUT', body: JSON.stringify({ data }) });
      pushUndo({ type: 'update', recordId: record.id, entityId: entity.id, oldData, newData: data, entityLabel: entityDisplayName(entity) });
      record.data = data;
      import('./AITrigger.js').then((m) => m.checkAiTriggers(entity, record, oldData)).catch((err) => console.error('[AI Trigger]', err));
      // Local update only — avoid full re-render flash
      cell.classList.remove('cell-editing', 'saving-cell');
      cell.replaceChildren(renderFieldValue(record.data[field.id], field));
      notifyRuleResults(body.ruleResults || [], state.currentApp);
    } catch (error) {
      toast(error.message);
      cell.classList.remove('saving-cell');
      cell.classList.add('cell-error');
      saved = false;
      input.focus();
    }
  };
  input.addEventListener('compositionstart', () => {
    composing = true;
    blurDuringComposition = false;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    if (blurDuringComposition && document.activeElement !== input) {
      blurDuringComposition = false;
      input.focus();
    }
  });
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === 'Enter' && field.type !== 'textarea' && field.type !== 'richText') input.blur();
    if (event.key === 'Escape') {
      cell.classList.remove('cell-editing');
      cell.replaceChildren(renderFieldValue(record.data[field.id], field));
    }
  });
  if (input.tagName === 'SELECT' || input.type === 'checkbox') input.addEventListener('change', save);
  if (input.type === 'file') {
    input.addEventListener('change', async () => {
      saved = false;
      await save();
    });
  }
}

export function inputForField(field, value) {
  if (field.type === 'formula') return h('input', { value: formatFieldValue(value, field), readonly: 'readonly', class: 'formula-readonly-input', title: '公式字段由系统实时计算' });
  if (field.type === 'autoNumber') return h('input', { value: value ?? '', readonly: 'readonly', class: 'formula-readonly-input', placeholder: '保存后自动生成', title: '自增序号由系统自动生成' });
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
  if (field.type === 'ai') return h('textarea', { value: value ?? '', readonly: 'readonly', placeholder: 'AI 字段由系统自动生成', title: '双击单元格可重新生成' });
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'url' ? 'url' : 'text';
  const inputValue = field.type === 'date' || field.type === 'datetime'
    ? dateInputValue(value, field.type)
    : field.type === 'number' ? numberInputValue(value, field) : value ?? '';
  const input = h('input', { type, value: inputValue, lang: dateInputLocale(field.type) || undefined, placeholder: field.placeholder || '' });
  return bindDateTimePicker(input);
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
  return h('input', { type, lang: dateInputLocale(field.type) || undefined, placeholder: `搜索${field.label}` });
}

export async function valueFromInput(input, field) {
  if (field.type === 'boolean') return input.checked;
  if (field.type === 'multiSelect') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : []) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'relation') return input._choiceValue !== undefined ? (Array.isArray(input._choiceValue) ? input._choiceValue : [input._choiceValue]) : [...input.selectedOptions].map((option) => option.value).filter(Boolean);
  if (field.type === 'select') return input._choiceValue !== undefined ? (input._choiceValue || '') : input.value;
  if (field.type === 'image' || field.type === 'file') return uploadValueFromInput(input, field);
  if (field.type === 'number') return storedNumberValue(input.value, field);
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

export function renderFieldValue(value, field) {
  if (field.type === 'url') return renderUrlValue(value);
  if (field.type === 'select') {
    const label = optionLabel(field, value);
    return label ? renderSelectTag(label, optionColor(field, value)) : document.createTextNode('');
  }
  if (field.type === 'multiSelect') {
    const wrap = h('span', { class: 'tag-list' });
    for (const item of Array.isArray(value) ? value : []) {
      const label = optionLabel(field, item);
      if (label) wrap.append(renderSelectTag(label, optionColor(field, item)));
    }
    return wrap;
  }
  if (field.type === 'relation') {
    const wrap = h('span', { class: 'tag-list relation-tags' });
    for (const item of Array.isArray(value) ? value : [value]) {
      const label = relationFieldDisplayText(item);
      if (label) wrap.append(h('span', { class: 'relation-tag', text: label }));
    }
    return wrap;
  }
  if (field.type === 'image') return renderImageValue(value);
  if (field.type === 'file') return renderFileValue(value);
  if (field.type === 'ai') {
    const text = String(value || '');
    const isGenerating = text === '生成中…';
    const isFailed = text === '生成失败' || text === '生成超时';
    const cls = isGenerating ? 'ai-field-generating' : isFailed ? 'ai-field-failed' : '';
    const wrap = h('span', { class: `ai-field-value ${cls}`.trim(), style: 'display:inline-flex;align-items:center;gap:4px;max-width:100%' }, [
      h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: text || '' })
    ]);
    if (isGenerating) {
      const spinner = h('span', { class: 'ai-field-spinner', text: '⟳' });
      wrap.prepend(spinner);
    }
    if (isFailed) {
      wrap.title = '双击单元格可重新生成';
    }
    return wrap;
  }
  if (field.type === 'textarea' || field.type === 'richText') {
    const content = h('div', { class: 'markdown-cell-content' });
    content.innerHTML = renderMarkdown(value);
    content.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => event.stopPropagation()));
    return content;
  }
  if (isHttpUrl(value)) return h('a', { class: 'cell-link', href: value, target: '_blank', rel: 'noreferrer', text: value, onclick: (event) => event.stopPropagation() });
  return document.createTextNode(formatFieldValue(value, field));
}

export function createChoiceWidget(field, initialValue, onChange) {
  const multiple = field.type === 'multiSelect' || (field.type === 'relation' && field.multiple);
  let currentValue = normalizeChoiceInitialValue(field, initialValue);

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
    choices = mergeChoiceOptions(choices, relationChoicesFromValue(currentValue));
  } else {
    choices = (field.options || []).map(optionObject);
    // 标准化 currentValue：存的值可能是 label，转成 choice ID
    const toChoiceId = (v) => {
      if (v === undefined || v === null || v === '') return v;
      const opt = optionObject(v);
      const match = choices.find((c) => c.id === opt.id || c.label === opt.id || c.id === opt.label || c.label === opt.label);
      return match?.id || v;
    };
    currentValue = multiple && Array.isArray(currentValue)
      ? currentValue.map(toChoiceId).filter(Boolean)
      : toChoiceId(currentValue);
  }

  const selectedIds = () => {
    const vals = multiple ? (Array.isArray(currentValue) ? currentValue : []) : [currentValue].filter(Boolean);
    return vals.map((v) => {
      if (field.type === 'relation') return relationValueId(v);
      return optionObject(v).id;
    }).filter(Boolean);
  };

  const tags = h('div', { class: 'cell-choice-editor-tags' });
  const arrowSvg = svgIcon('0 0 16 16', [svgPath('M4 6l4 4 4-4')]);
  arrowSvg.setAttribute('fill', 'none');
  arrowSvg.setAttribute('stroke', 'currentColor');
  arrowSvg.setAttribute('stroke-width', '2');
  arrowSvg.style.display = 'block';
  const arrow = h('span', { class: 'cell-choice-editor-arrow' }, [arrowSvg]);
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
    const dropdownHost = editor.closest('.modal-backdrop') || document.body;
    dropdownHost.append(dropdown);
    const anchor = editor.closest('td') || editor;
    const rect = anchor.getBoundingClientRect();
    const dw = Math.min(320, Math.max(rect.width, 180));
    dropdown.style.left = `${Math.min(window.innerWidth - dw - 8, Math.max(8, rect.left))}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.width = `${Math.min(dw, window.innerWidth - 16)}px`;
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
  if (field.type === 'relation') loadRelationChoiceOptions(field, (loaded) => {
    choices = mergeChoiceOptions(loaded, choices);
    renderTags();
  });
  editor.addEventListener('click', openDropdown);
  editor._choiceValue = currentValue;

  return editor;
}

export function loadRelationChoiceOptions(field, onLoaded) {
  const sourceEntity = state.currentApp.schema.entities.find((entity) => entity.fields?.some((item) => item === field))
    || state.currentApp.schema.entities.find((entity) => entity.fields?.some((item) => item.id === field.id && item.targetEntity === field.targetEntity));
  if (!sourceEntity) return;
  api(`/api/apps/${state.currentApp.id}/fields/${sourceEntity.id}/${field.id}/relation-options`)
    .then((body) => onLoaded((body.options || []).map((option) => ({ id: option.recordId, label: option.displayValue, color: 'gray' }))))
    .catch((err) => console.error('[AI Trigger]', err));
}

export function fieldValuesEqual(currentValue, nextValue) {
  if (currentValue === nextValue) return true;
  if ((currentValue === undefined || currentValue === '') && nextValue === null) return true;
  if (currentValue === null && nextValue === '') return true;
  return JSON.stringify(currentValue ?? null) === JSON.stringify(nextValue ?? null);
}

export function renderFormFieldBlock(field, input, design = {}, options = {}) {
  const label = h('label', { text: field.label });
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

export function resolveAiPrompt(template, entity, record) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    const field = entity.fields.find((f) => f.label === name || f.id === name);
    if (!field) return `{${name}}`;
    const raw = record.data[field.id];
    if (raw === undefined || raw === null || raw === '') return '';
    if (field.type === 'select' || field.type === 'multiSelect') {
      const labels = (Array.isArray(raw) ? raw : [raw]).map((v) => optionLabel(field, v)).filter(Boolean);
      return labels.join('、');
    }
    if (field.type === 'relation') {
      const labels = (Array.isArray(raw) ? raw : [raw]).map(relationFieldDisplayText).filter(Boolean);
      return labels.join('、');
    }
    return String(raw);
  });
}

export function displayValue(value) {
  if (Array.isArray(value)) return value.map((item) => item?.displayValue || item?.label || item).join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.name || value.optionId || '';
  if (value === true) return '是';
  if (value === false) return '否';
  return value ?? '';
}

export function relationDisplayValue(relation, targetEntity, record) {
  if (!record) return '';
  const displayField = resolveRelationDisplayField(relation, targetEntity, record.data || {});
  const value = displayField ? record.data?.[displayField.id] : Object.values(record.data || {}).find(hasDisplayValue);
  return displayValue(value) || record.id;
}

export function resolveRelationDisplayField(relation, targetEntity, data = {}) {
  const fields = (targetEntity?.fields || []).filter((field) => field.type !== 'relation');
  const configured = fields.find((field) => field.id === relation?.displayField);
  if (configured && hasDisplayValue(data[configured.id])) return configured;
  const preferred = fields.find((field) => ['name', 'title'].includes(field.id) && hasDisplayValue(data[field.id]));
  if (preferred) return preferred;
  const labelPreferred = fields.find((field) => /名称|标题|姓名|名字|name|title/i.test(`${field.label || ''} ${field.id || ''}`) && hasDisplayValue(data[field.id]));
  if (labelPreferred) return labelPreferred;
  const textField = fields.find((field) => ['text', 'textarea', 'richText', 'select'].includes(field.type) && hasDisplayValue(data[field.id]));
  if (textField) return textField;
  return fields.find((field) => hasDisplayValue(data[field.id])) || configured || fields[0] || null;
}

export function hasDisplayValue(value) {
  return !(value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0));
}

export function normalizeFileValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return isHttpUrl(value) ? { url: value, name: value.split('/').pop() || value } : { name: value, url: '' };
  if (typeof value === 'object') return { url: value.url || '', name: value.name || value.filename || value.label || value.url || '', mimeType: value.mimeType || '', size: value.size || 0 };
  return null;
}

export function renderImageValue(value) {
  const file = normalizeFileValue(value);
  if (!file?.url) return document.createTextNode(file?.name || '');
  const image = h('img', {
    class: 'image-thumb',
    src: file.url,
    alt: file.name || '图片',
    loading: 'lazy',
    onclick: (event) => {
      event.stopPropagation();
      openImagePreview(file);
    }
  });
  return h('span', { class: 'image-cell' }, [image, h('span', { class: 'file-name', text: file.name || '图片' })]);
}

export function renderFileValue(value) {
  const file = normalizeFileValue(value);
  if (!file?.url) return document.createTextNode(file?.name || '');
  return h('a', {
    class: 'file-link',
    href: file.url,
    target: '_blank',
    rel: 'noreferrer',
    title: file.name || file.url,
    text: file.name || '附件',
    onclick: (event) => event.stopPropagation()
  });
}

export function renderUrlValue(value) {
  const text = String(value || '').trim();
  if (!text) return document.createTextNode('');
  return h('a', {
    class: 'cell-link url-link',
    href: text,
    target: '_blank',
    rel: 'noreferrer',
    text,
    onclick: (event) => event.stopPropagation()
  });
}

export function openImagePreview(file) {
  const backdrop = h('div', { class: 'modal-backdrop image-preview-backdrop', onclick: () => backdrop.remove() }, [
    h('div', { class: 'image-preview-modal', onclick: (event) => event.stopPropagation() }, [
      h('div', { class: 'toolbar image-preview-toolbar' }, [
        h('strong', { text: file.name || '图片预览' }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('img', { class: 'image-preview-full', src: file.url, alt: file.name || '图片预览' })
    ])
  ]);
  document.body.append(backdrop);
}

export function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export function renderSelectTag(label, color = 'gray') {
  return h('span', { class: `select-tag select-${color}`, text: label });
}

export function relationFieldDisplayText(value) {
  if (!value || typeof value !== 'object') return '';
  return value.displayValue || value.label || value.name || '';
}

export function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).map(optionObject).find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}

export function optionColor(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).map(optionObject).find((item) => item.id === raw || item.label === raw);
  return option?.color || 'gray';
}

export function matchesFilter(data, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => data[key] === value);
}

export function disablePreviewInput(input) {
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT' || input.tagName === 'SELECT') {
    input.disabled = true;
  }
}

export function sampleFieldValue(field) {
  if (field.type === 'autoNumber') return `${field.autoNumber?.prefix || ''}${field.autoNumber?.start ?? 1}`;
  if (field.type === 'number') return '123';
  if (field.type === 'date') return '2026-06-12';
  if (field.type === 'datetime') return '2026-06-12 09:00';
  if (field.type === 'select' || field.type === 'multiSelect') return optionObject(field.options?.[0] || '选项').label;
  if (field.type === 'relation') return '关联记录';
  if (field.type === 'url') return 'https://example.com';
  if (field.type === 'textarea' || field.type === 'richText') return '这是一段多行文本示例内容，\n展示长文本在表单中的实际所占高度。\n第三行内容。';
  return '文本';
}

export function formatFieldValue(value, field) {
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).filter(Boolean).join('、');
  if (field.type === 'relation') return (Array.isArray(value) ? value : [value]).map(relationFieldDisplayText).filter(Boolean).join('、');
  if (field.type === 'image' || field.type === 'file') return normalizeFileValue(value)?.name || '';
  if (field.type === 'formula') return formatFieldValue(value, { ...field, type: effectiveFieldType(field) });
  if (field.type === 'number') {
    const number = Number(value);
    if (Number.isNaN(number)) return displayValue(value);
    if (field.format === 'integer') return String(Math.round(number));
    if (field.format === 'decimal2') return number.toFixed(2);
    if (field.format === 'currency') return `¥${number.toFixed(2)}`;
    if (field.format === 'percent') return `${(number * 100).toFixed(2)}%`;
  }
  if (field.type === 'date' || field.type === 'datetime') return formatDateFieldValue(value, field);
  return displayValue(value);
}

export function defaultValueForField(field) {
  if (field.type === 'autoNumber') return '';
  if (field.type === 'number') return null;
  if (field.type === 'boolean') return false;
  if (field.type === 'multiSelect') return [];
  if (field.type === 'select') return '';
  if (field.type === 'relation') return [];
  if (field.type === 'image' || field.type === 'file') return null;
  return '';
}
