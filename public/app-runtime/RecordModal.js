import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { openConfirmDialog, openTextModal } from '../common/modal.js';
import { state, entityDisplayName, getFormLayout, getFormDesign } from '../app-context.js';
import { writeStorage } from '../common/storage.js';
import { inputForField, valueFromInput, renderFormFieldBlock, defaultValueForField } from './CellEditor.js';
import { getCurrentView, getListConfig, updateCurrentView } from './ViewBar.js';
import { loadCurrentPageRecords, renderRuntime } from './runtime-actions.js';
import { pushUndo } from '../common/UndoStack.js';
import { notifyRuleResults } from './RuleFeedback.js';

export async function openRecordModal(entity, record = null, options = {}) {
  const tableName = entityDisplayName(entity);
  if (!record && !Object.prototype.hasOwnProperty.call(options, 'ruleDependencyFieldIds')) {
    try {
      const rulesBody = await api(`/api/apps/${state.currentApp.id}/rules`);
      options = { ...options, ruleDependencyFieldIds: createdRuleDependencyFieldIds(rulesBody.rules || [], entity.id) };
    } catch (error) {
      toast(`无法读取业务规则：${error.message}`);
      return null;
    }
  }
  const layout = getFormLayout(entity);
  const design = getFormDesign(entity);
  const ruleDependencyFieldIds = new Set(options.ruleDependencyFieldIds || []);
  const form = h('form', { class: 'form-grid', style: `grid-template-columns: repeat(${layout.columns}, minmax(0, 1fr))` });
  const inputs = {};
  const formFields = layout.order.map((fieldId) => entity.fields.find((field) => field.id === fieldId)).filter(Boolean);
  for (const field of formFields) {
    const value = record?.data?.[field.id] ?? (!record ? design.defaults[field.id] : undefined);
    const input = inputForField(field, value);
    inputs[field.id] = input;
    form.append(renderFormFieldBlock(field, input, design));
    if (ruleDependencyFieldIds.has(field.id)) {
      const label = form.lastElementChild?.querySelector('label');
      if (label) label.append(h('span', {
        class: 'rule-dependency-hint', text: '规则所需', title: '可以暂存为空；填写后将自动执行等待中的业务规则'
      }));
    }
  }
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: record ? `编辑${tableName}` : `新增${tableName}` }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      form,
      h('div', { class: 'modal-footer' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', {
          text: '保存',
          onclick: async (event) => {
            if (!form.reportValidity()) return;
            const button = event.currentTarget;
            button.disabled = true;
            const saveBtnText = button.textContent;
            button.textContent = '保存中…';
            try {
              const oldData = record ? { ...record.data } : null;
              const data = record ? { ...record.data } : {};
              for (const field of formFields) data[field.id] = await valueFromInput(inputs[field.id], field);
              const path = record ? `/api/apps/${state.currentApp.id}/records/${record.id}` : `/api/apps/${state.currentApp.id}/records`;
              const method = record ? 'PUT' : 'POST';
              const body = await api(path, { method, body: JSON.stringify({ entityId: entity.id, data }) });
              backdrop.remove();
              if (record) {
                pushUndo({ type: 'update', recordId: record.id, entityId: entity.id, oldData, newData: data, entityLabel: tableName });
                record.data = data;
                import('./AITrigger.js').then((m) => m.checkAiTriggers(entity, record, oldData)).catch((err) => console.error('[AI Trigger]', err));
              } else {
                const created = body.record;
                pushUndo({ type: 'create', recordId: created.id, entityId: entity.id, data: created.data, entityLabel: tableName });
                import('./AITrigger.js').then((m) => m.checkAiTriggers(entity, created, null)).catch((err) => console.error('[AI Trigger]', err));
              }
              await loadCurrentPageRecords();
              renderRuntime();
              notifyRuleResults(body.ruleResults || [], state.currentApp);
            } catch (error) {
              button.disabled = false;
              button.textContent = saveBtnText;
              toast(error.message);
            }
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
  return backdrop;
}

export async function removeRecord(recordId, entityId) {
  const record = state.records.find((r) => r.id === recordId);
  const entityName = entityDisplayName(entityId);
  const oldData = record?.data ? { ...record.data } : null;
  openConfirmDialog({
    title: '删除记录',
    message: '确定删除这条记录吗？',
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api(`/api/apps/${state.currentApp.id}/records/${recordId}`, { method: 'DELETE' });
        if (oldData) pushUndo({ type: 'delete', recordId, entityId, data: oldData, entityLabel: entityName });
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
            if (oldData) pushUndo({ type: 'delete', recordId, entityId, data: oldData, entityLabel: entityName });
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

    const created = body.record;
    pushUndo({ type: 'create', recordId: created.id, entityId: entity.id, data: created.data, entityLabel: entityDisplayName(entity) });
    import('./AITrigger.js').then((m) => m.checkAiTriggers(entity, created, null)).catch((err) => console.error('[AI Trigger]', err));

    const currentView = getCurrentView(entity);
    const hasFilters = currentView.filters && currentView.filters.length > 0;

    await loadCurrentPageRecords();
    renderRuntime();

    if (hasFilters) {
      toast(`已新增 1 行。注意：当前视图有筛选条件，新记录可能不在此视图中显示。`);
    } else {
      toast(`已新增 1 行，可直接双击单元格编辑。`);
    }
    notifyRuleResults(body.ruleResults || [], state.currentApp);

    return body.record;
  } catch (error) {
    toast(`新增行失败：${error.message}`);
    console.error('新增行错误：', error);
    throw error;
  }
}

export function createdRuleDependencyFieldIds(rules, entityId) {
  const fieldIds = new Set();
  for (const rule of rules || []) {
    if (rule.status !== 'active' || rule.contractJson?.trigger?.type !== 'record.created' || rule.contractJson.trigger.entity !== entityId) continue;
    const intent = rule.businessIntentJson || {};
    if (intent.target?.relationField) fieldIds.add(intent.target.relationField);
    if (intent.action?.value?.type === 'trigger.field' && intent.action.value.field) fieldIds.add(intent.action.value.field);
  }
  return [...fieldIds];
}

export async function bulkDeleteRecords(entity, selectedIds, selectionKey) {
  if (!selectedIds.size) return toast('先选择要删除的记录。');
  openConfirmDialog({
    title: '批量删除记录',
    message: `确定删除选中的 ${selectedIds.size} 条记录吗？`,
    confirmText: '批量删除',
    danger: true,
    onConfirm: async () => {
      await api(`/api/apps/${state.currentApp.id}/records/bulk-delete`, { method: 'POST', body: JSON.stringify({ recordIds: [...selectedIds] }) });
      writeStorage(selectionKey, []);
      await loadCurrentPageRecords();
      renderRuntime();
      toast('已删除选中记录');
    }
  });
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
