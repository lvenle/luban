import { h, svgIcon, svgPath } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog } from '../common/modal.js';
import { state } from '../app.js';
import { getViews, setViews, normalizeView, getListConfig, setListConfig } from './ViewBar.js';
import { saveCurrentPackage, loadCurrentPageRecords, renderRuntime } from './index.js';

const OPTION_COLORS = [
  'gray', 'red', 'orange', 'yellow', 'lime', 'green', 
  'cyan', 'blue', 'purple', 'pink'
];

function selectFromOptions(options, value) {
  const select = h('select');
  for (const [optionValue, label] of options) select.append(h('option', { value: optionValue, text: label }));
  select.value = value;
  return select;
}

export function fieldTypes() {
  return [
    ['text', '文本'],
    ['textarea', '长文本'],
    ['url', '链接'],
    ['number', '数字'],
    ['select', '单选'],
    ['multiSelect', '多选'],
    ['relation', '关联记录'],
    ['image', '图片'],
    ['file', '附件'],
    ['date', '日期'],
    ['datetime', '日期时间'],
    ['formula', '公式'],
    ['ai', 'AI 字段']
  ];
}

export function fieldTypeLabel(type) {
  return fieldTypes().find(([value]) => value === type)?.[1] || type || '文本';
}

export function openFieldEditModal(entity, field = null, options = {}) {
  const fieldTypeArrowSvg = (() => {
    const s = svgIcon('0 0 16 16', [svgPath('M4 6l4 4 4-4')]);
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.style.width = '16px';
    s.style.height = '16px';
    s.style.display = 'block';
    return s;
  })();
  const editing = Boolean(field);
  const draft = field ? structuredClone(field) : { id: uniqueFieldId(entity, 'new_field'), label: '新字段', type: 'text' };
  if (!draft.options && draft.values) draft.options = draft.values;
  const labelInput = h('input', { value: draft.label || '', placeholder: '请输入字段标题' });
  const typeSelect = selectFromOptions(fieldTypes(), draft.type || 'text');
  const advanced = h('div', { class: 'field-advanced field-popover-section' });
  const typeLabel = h('span', { class: 'field-type-current', text: fieldTypeLabel(typeSelect.value) });
  const renderAdvanced = () => {
    advanced.innerHTML = '';
    const type = typeSelect.value;
    typeLabel.textContent = fieldTypeLabel(type);
    if (type === 'select' || type === 'multiSelect') {
      advanced.append(renderOptionEditor(draft.options || [], () => labelInput.value));
      return;
    }
    if (type === 'relation') {
      const targets = state.currentApp.schema.entities.filter((item) => item.id !== entity.id);
      const targetSelect = selectFromOptions(targets.map((item) => [item.id, item.name]), draft.targetEntity || targets[0]?.id || '');
      targetSelect.dataset.fieldEditor = 'targetEntity';
      const displaySelect = h('select', { 'data-field-editor': 'displayField' });
      const multiple = h('input', { type: 'checkbox', 'data-field-editor': 'multiple' });
      multiple.checked = Boolean(draft.multiple);
      const renderDisplayFields = () => {
        const target = state.currentApp.schema.entities.find((item) => item.id === targetSelect.value);
        displaySelect.innerHTML = '';
        for (const field of target?.fields || []) {
          if (field.type === 'relation') continue;
          displaySelect.append(h('option', { value: field.id, text: field.label || field.id }));
        }
        displaySelect.value = draft.displayField || displaySelect.options[0]?.value || '';
      };
      targetSelect.addEventListener('change', renderDisplayFields);
      renderDisplayFields();
      advanced.append(
        h('div', { class: 'field-popover-subtitle', text: '关联设置' }),
        h('div', { class: 'field-setting-list' }, [
          h('label', { class: 'field-setting-row' }, [h('span', { text: '关联表' }), targetSelect]),
          h('label', { class: 'field-setting-row' }, [h('span', { text: '展示字段' }), displaySelect])
        ]),
        h('label', { class: 'field-setting-check' }, [multiple, h('span', { text: '允许多选关联记录' })])
      );
      return;
    }
    if (type === 'number') {
      const format = selectFromOptions([['plain', '普通数字'], ['integer', '整数'], ['decimal2', '保留 2 位小数'], ['currency', '金额'], ['percent', '百分比']], draft.format || 'plain');
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field-setting-list' }, [
        h('label', { class: 'field-setting-row' }, [h('span', { text: '数字格式' }), format])
      ]));
      return;
    }
    if (type === 'formula') {
      const resultType = selectFromOptions([['number', '数字'], ['date', '日期'], ['text', '文本']], draft.formula?.resultType || 'number');
      resultType.dataset.fieldEditor = 'formulaResultType';
      const expression = h('textarea', { 'data-field-editor': 'formulaExpression', placeholder: '例如：{单价} * {数量} + 100' });
      expression.value = draft.formula?.expression || '';
      const tokens = h('div', { class: 'formula-field-tokens' }, state.currentApp.schema.entities
        .find((item) => item.id === entity.id)?.fields
        .filter((item) => item.id !== field?.id && !['formula', 'relation'].includes(item.type))
        .map((item) => h('button', { class: 'secondary formula-token', type: 'button', text: item.label, onclick: () => insertFormulaToken(expression, item.label) })) || []);
      advanced.append(
        h('div', { class: 'field-setting-list' }, [
          h('label', { class: 'field-setting-row' }, [h('span', { text: '结果类型' }), resultType]),
          h('label', { class: 'field formula-expression-field' }, [h('span', { text: '计算公式' }), expression])
        ]),
        h('div', { class: 'field-popover-subtitle', text: '插入字段' }),
        tokens,
        h('p', { class: 'field-help', text: '支持四则、比较、IF、ROUND、CONCAT、DATEADD、DATEDIFF、ABS、MIN、MAX、LEN、UPPER、LOWER、TODAY。' })
      );
      return;
    }
    if (type === 'ai') {
      const promptInput = h('textarea', { 'data-field-editor': 'aiPrompt', placeholder: '例如：根据{任务描述}生成一段工作进展汇报' });
      promptInput.value = draft.aiConfig?.prompt || '';
      const triggerContainer = h('div', { class: 'field-setting-list', 'data-field-editor': 'aiTriggers' });
      const triggerIds = new Set(draft.aiConfig?.triggerFieldIds || []);
      for (const f of entity.fields) {
        if (f.id === draft.id || f.type === 'ai' || f.type === 'relation') continue;
        const cb = h('input', { type: 'checkbox', 'data-trigger-id': f.id });
        cb.checked = triggerIds.has(f.id);
        triggerContainer.append(h('label', { class: 'field-setting-check' }, [cb, h('span', { text: f.label || f.id })]));
      }
      if (!entity.fields.some((f) => f.id !== draft.id && f.type !== 'ai' && f.type !== 'relation')) {
        triggerContainer.append(h('p', { class: 'muted field-hint', text: '当前没有可选字段作为触发条件。' }));
      }
      advanced.append(
        h('div', { class: 'field-popover-subtitle', text: 'AI 生成设置' }),
        h('div', { class: 'field-setting-list' }, [
          h('label', { class: 'field formula-expression-field' }, [
            h('span', { text: '生成提示词' }),
            promptInput,
            h('p', { class: 'field-help', text: '用 {字段名} 引用其他字段的值，当引用的字段从空变为有值时自动触发 AI 生成。' })
          ])
        ]),
        h('div', { class: 'field-popover-subtitle', text: '触发字段（从空→有值时触发）' }),
        triggerContainer
      );
      return;
    }

    if (type === 'date' || type === 'datetime') {
      const format = selectFromOptions(type === 'date'
        ? [['yyyy-mm-dd', '2026-06-12']]
        : [['yyyy-mm-dd hh:mm', '2026-06-12 09:00']],
      type === 'date' ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm');
      format.dataset.fieldEditor = 'format';
      advanced.append(h('div', { class: 'field-setting-list' }, [
        h('label', { class: 'field-setting-row' }, [h('span', { text: '日期格式' }), format])
      ]));
      return;
    }
    if (type === 'image') {
      advanced.append(h('p', { class: 'field-help', text: '图片字段支持上传本地图片，表格中显示小缩略图，点击可放大预览。' }));
      return;
    }
    if (type === 'file') {
      advanced.append(h('p', { class: 'field-help', text: '附件字段支持上传本地文件，表格中显示原始文件名，点击可打开。' }));
      return;
    }
    advanced.append(h('div', { class: 'field-setting-list' }, [
      h('label', { class: 'field-setting-row' }, [
        h('span', { text: '输入提示' }),
        h('input', { 'data-field-editor': 'placeholder', value: draft.placeholder || '', placeholder: '填写时展示的提示文字' })
      ])
    ]));
  };
  typeSelect.addEventListener('change', renderAdvanced);
  renderAdvanced();
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal field-settings-modal' }, [
      h('div', { class: 'field-settings-head' }, [
        h('h3', { text: editing ? '编辑字段' : '添加字段' }),
        h('button', { class: 'ghost icon-button', text: '×', title: '关闭字段设置', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'field-popover-section' }, [
        h('label', { class: 'field-popover-label', text: '标题' }),
        labelInput
      ]),
      h('div', { class: 'field-popover-section' }, [
        h('label', { class: 'field-popover-label', text: '字段类型' }),
        h('label', { class: 'field-type-picker' }, [
          typeLabel,
          typeSelect,
          h('span', { class: 'field-type-arrow' }, [fieldTypeArrowSvg])
        ])
      ]),
      advanced,
      h('div', { class: 'field-settings-footer' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '确定',
          onclick: async () => {
            const label = labelInput.value.trim();
            if (!label) return toast('字段名称不能为空。');
            const patch = fieldPatchFromEditor(label, typeSelect.value, advanced);
            if (editing) await updateField(entity.id, field.id, patch);
            else await createField(entity, patch, options.nearField, options.side);
            backdrop.remove();
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
  setTimeout(() => {
    labelInput.focus();
    labelInput.select();
  }, 0);
}

export function fieldPatchFromEditor(label, type, advanced) {
  const patch = { label, type };
  const formatInput = advanced.querySelector('[data-field-editor="format"]');
  const placeholderInput = advanced.querySelector('[data-field-editor="placeholder"]');
  const targetEntityInput = advanced.querySelector('[data-field-editor="targetEntity"]');
  const displayFieldInput = advanced.querySelector('[data-field-editor="displayField"]');
  const multipleInput = advanced.querySelector('[data-field-editor="multiple"]');
  if (type === 'select' || type === 'multiSelect') patch.options = collectOptionEditorValues(advanced);
  if (formatInput) patch.format = formatInput.value;
  if (placeholderInput) patch.placeholder = placeholderInput.value.trim();
  if (type === 'relation') {
    patch.targetEntity = targetEntityInput?.value || '';
    patch.displayField = displayFieldInput?.value || '';
    patch.multiple = Boolean(multipleInput?.checked);
    patch.enableSearch = true;
    patch.allowCreateTargetRecord = false;
  }
  if (type === 'formula') {
    patch.formula = {
      expression: advanced.querySelector('[data-field-editor="formulaExpression"]')?.value.trim() || '',
      resultType: advanced.querySelector('[data-field-editor="formulaResultType"]')?.value || 'number'
    };
    // Warn when formula returns string values but resultType isn't 'text'
    const expr = patch.formula.expression;
    const rt = patch.formula.resultType;
    if (rt !== 'text' && /["']/.test(expr)) {
      toast(`公式中包含文本字符串，但结果类型为「${rt === 'number' ? '数字' : '日期'}」。如公式返回的是文本值，请将结果类型改为「文本」。`);
    }
  }
  if (type === 'ai') {
    const promptEl = advanced.querySelector('[data-field-editor="aiPrompt"]');
    const triggerIds = [...advanced.querySelectorAll('[data-trigger-id]:checked')].map((cb) => cb.dataset.triggerId);
    patch.aiConfig = {
      prompt: promptEl?.value.trim() || '',
      triggerFieldIds: triggerIds
    };
  }
  if (type !== 'select' && type !== 'multiSelect') patch.options = [];
  return patch;
}

export function effectiveFieldType(field) {
  return field?.type === 'formula' ? field.formula?.resultType || 'number' : field?.type;
}

export function insertFormulaToken(input, label) {
  const token = `{${label}}`;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
  input.focus();
  input.setSelectionRange(start + token.length, start + token.length);
}

export function renderOptionEditor(options = [], labelGetter = () => '') {
  const list = h('div', { class: 'option-editor-list', 'data-field-editor': 'options-list' });
  const addRow = (option = {}) => {
    const normalized = optionObject(option);
    const row = optionEditorRow(normalized);
    list.append(row);
  };
  const clearAll = () => { list.innerHTML = ''; };
  const source = options.length ? options : ['选项 1', '选项 2'];
  source.forEach(addRow);
  const addButton = h('button', {
    class: 'option-add-button',
    type: 'button',
    text: '+ 添加选项',
    onclick: () => addRow({ label: `选项 ${list.children.length + 1}` })
  });
  const aiButton = h('button', { class: 'ghost option-ai-button', type: 'button', text: 'AI 生成选项' });
  aiButton.onclick = async () => {
    aiButton.disabled = true;
    aiButton.textContent = 'AI 生成中…';
    try {
      const body = await api('/api/ai/generate-options', {
        method: 'POST',
        body: JSON.stringify({ label: labelGetter(), context: state.currentApp?.name || '' })
      });
      if (body.options && body.options.length) {
        clearAll();
        body.options.forEach((opt) => addRow(opt));
        toast(`AI 生成了 ${body.options.length} 个选项`);
      } else {
        toast('AI 未返回有效选项，请重试。');
      }
    } catch (error) {
      toast(`生成失败：${error.message}`);
    } finally {
      aiButton.disabled = false;
      aiButton.textContent = 'AI 生成选项';
    }
  };
  return h('div', { class: 'option-editor' }, [
    h('div', { class: 'option-editor-head' }, [
      h('span', { text: '下拉选项内容' }),
      h('label', { class: 'option-reference' }, [h('input', { type: 'checkbox' }), h('span', { text: '引用选项' })])
    ]),
    h('div', { class: 'option-editor-toolbar' }, [
      addButton,
      aiButton
    ]),
    list
  ]);
}

export function optionEditorRow(option) {
  const initialColor = option.color || 'gray';
  let dragCounter = 0;
  const dragHandle = h('span', {
    class: 'option-drag',
    text: '⋮⋮',
    title: '拖动排序',
    draggable: 'true',
    ondragstart: (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
      row.classList.add('dragging');
      dragCounter = 0;
    },
    ondragend: () => {
      row.classList.remove('dragging');
      document.querySelectorAll('.option-editor-row.drag-over').forEach(el => el.classList.remove('drag-over'));
    },
    ondragover: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!row.classList.contains('dragging')) {
        dragCounter++;
        row.classList.add('drag-over');
      }
    },
    ondragleave: () => {
      dragCounter--;
      if (dragCounter <= 0) {
        row.classList.remove('drag-over');
        dragCounter = 0;
      }
    },
    ondrop: (event) => {
      event.preventDefault();
      row.classList.remove('drag-over');
      const dragged = document.querySelector('.option-editor-row.dragging');
      if (dragged && dragged !== row) {
        const parent = row.parentNode;
        const rows = [...parent.querySelectorAll('.option-editor-row')];
        const fromIndex = rows.indexOf(dragged);
        const toIndex = rows.indexOf(row);
        if (fromIndex < toIndex) {
          parent.insertBefore(dragged, row.nextSibling);
        } else {
          parent.insertBefore(dragged, row);
        }
      }
    }
  });
  const row = h('div', { class: 'option-editor-row' }, [
    dragHandle,
    h('div', { class: 'option-color-picker' }, [
      h('button', {
        class: 'option-color-current ghost',
        type: 'button',
        'data-option-color': initialColor,
        onclick: () => toggleColorPicker(row)
      }, [
        h('span', { class: `option-color-dot select-${initialColor}` })
      ]),
      h('div', { class: 'option-color-dropdown hidden' }, 
        OPTION_COLORS.map(color => 
          h('button', {
            class: 'option-color-option ghost',
            type: 'button',
            onclick: () => selectOptionColor(row, color)
          }, [
            h('span', { class: `option-color-dot select-${color}` })
          ])
        )
      )
    ]),
    h('input', { class: 'option-label-input', value: option.label || '', placeholder: '选项名称', 'data-option-label': 'true' }),
    h('button', {
      class: 'ghost option-remove',
      type: 'button',
      text: '×',
      title: '删除选项',
      onclick: () => row.remove()
    })
  ]);
  return row;
}

export function toggleColorPicker(row) {
  const dropdown = row.querySelector('.option-color-dropdown');
  document.querySelectorAll('.option-color-dropdown:not(.hidden)').forEach(el => el.classList.add('hidden'));
  dropdown.classList.toggle('hidden');
  const handleClickOutside = (event) => {
    if (!dropdown.contains(event.target) && !row.querySelector('.option-color-current').contains(event.target)) {
      dropdown.classList.add('hidden');
      document.removeEventListener('click', handleClickOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
}

export function selectOptionColor(row, color) {
  const dropdown = row.querySelector('.option-color-dropdown');
  const dot = row.querySelector('.option-color-dot');
  const currentDot = row.querySelector('.option-color-current .option-color-dot');
  dot.className = `option-color-dot select-${color}`;
  currentDot.className = `option-color-dot select-${color}`;
  row.querySelector('.option-color-current').dataset.optionColor = color;
  dropdown.classList.add('hidden');
}

export function collectOptionEditorValues(root) {
  return [...root.querySelectorAll('.option-editor-row')]
  .map((row) => ({
    label: row.querySelector('[data-option-label]')?.value.trim(),
    color: row.querySelector('[data-option-color]')?.dataset.optionColor || 'gray'
  }))
    .filter((option) => option.label)
    .map(optionObject);
}

export function colorLabel(color) {
  const labels = {
    gray: '灰色',
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    lime: '青柠',
    green: '绿色',
    cyan: '青色',
    blue: '蓝色',
    purple: '紫色',
    pink: '粉色'
  };
  return labels[color] || color;
}

export function optionLines(options) {
  return (options || []).map((option) => {
    const item = optionObject(option);
    return `${item.label} | ${item.color}`;
  }).join('\n');
}

export function parseOptionLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, color] = line.split('|').map((item) => item.trim());
      return optionObject({ label, color });
    });
}

export async function updateField(entityId, fieldId, patch) {
  await saveCurrentPackage((pkg) => {
    const entity = pkg.schema.entities.find((item) => item.id === entityId);
    const field = entity?.fields.find((item) => item.id === fieldId);
    if (!field) return;
    Object.assign(field, patch);
  });
  await loadCurrentPageRecords();
  renderRuntime();
}

export async function createField(entity, patch, nearField = null, side = 'right') {
  const id = uniqueFieldId(entity, patch.label.toLowerCase().replace(/[^\w]+/g, '_') || 'field');
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    const index = nearField ? target.fields.findIndex((item) => item.id === nearField.id) : target.fields.length - 1;
    target.fields.splice(Math.max(0, index + (side === 'right' ? 1 : 0)), 0, { id, ...patch });
  });
  addFieldToView(entity.id, id, nearField?.id || entity.fields.at(-1)?.id, side);
  await loadCurrentPageRecords();
  renderRuntime();
}

export async function duplicateField(entity, field) {
  const id = uniqueFieldId(entity, `${field.id}_copy`);
  await saveCurrentPackage((pkg) => {
    const target = pkg.schema.entities.find((item) => item.id === entity.id);
    const index = target.fields.findIndex((item) => item.id === field.id);
    target.fields.splice(index + 1, 0, { ...field, id, label: `${field.label} 副本` });
  });
  addFieldToView(entity.id, id, field.id, 'right');
  await loadCurrentPageRecords();
  toast('字段已复制');
  renderRuntime();
}

export function insertField(entity, nearField, side) {
  openFieldEditModal(entity, null, { nearField, side });
}

export function deleteField(entity, field) {
  if ((entity.fields || []).length <= 1) return toast('至少保留一个字段。');
  openConfirmDialog({
    title: '删除字段',
    message: `确定删除字段「${field.label}」？字段中的数据将永久丢失。`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        const body = await api(`/api/apps/${state.currentApp.id}/fields/${entity.id}/${field.id}`, { method: 'DELETE' });
        state.currentApp = body.app;
        state.apps = state.apps.map((a) => a.id === body.app.id ? body.app : a);
        const config = getListConfig(entity);
        const visibleFields = (config.visibleFields || []).filter((id) => id !== field.id);
        setListConfig(entity, { ...config, visibleFields });
        await loadCurrentPageRecords();
        toast('字段已删除');
        renderRuntime();
      } catch (error) {
        toast(error.message);
      }
    }
  });
}

export function uniqueFieldId(entity, base) {
  const existing = new Set(entity.fields.map((field) => field.id));
  let clean = String(base || 'field').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
  let id = clean;
  let index = 2;
  while (existing.has(id)) {
    id = `${clean}_${index}`;
    index += 1;
  }
  return id;
}

export function addFieldToView(entityId, fieldId, nearFieldId, side) {
  const entity = state.currentApp.schema.entities.find((item) => item.id === entityId);
  if (!entity) return;
  const views = getViews(entity).map((view) => {
    const visibleFields = view.visibleFields.includes(fieldId) ? view.visibleFields : [...view.visibleFields];
    const fieldOrder = view.fieldOrder.includes(fieldId) ? view.fieldOrder : [...view.fieldOrder];
    const nearIndex = fieldOrder.indexOf(nearFieldId);
    const insertAt = nearIndex >= 0 ? nearIndex + (side === 'right' ? 1 : 0) : fieldOrder.length;
    fieldOrder.splice(insertAt, 0, fieldId);
    visibleFields.splice(Math.min(insertAt, visibleFields.length), 0, fieldId);
    return normalizeView(entity, { ...view, visibleFields: [...new Set(visibleFields)], fieldOrder: [...new Set(fieldOrder)] });
  });
  setViews(entity, views);
}

export function renderSelectTag(label, color = 'gray') {
  return h('span', { class: `select-tag select-${color}`, text: label });
}

export function optionObject(option) {
  if (typeof option === 'string') return { id: option, label: option, color: 'gray' };
  return {
    id: option?.id || option?.optionId || option?.value || option?.label || '',
    label: option?.label || option?.name || option?.optionId || option?.value || option?.id || '',
    color: option?.color || 'gray'
  };
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
