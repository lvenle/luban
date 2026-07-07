import { h } from '../../common/dom.js';
import { api } from '../../common/api.js';
import { toast } from '../../common/toast.js';
import { entityDisplayName } from '../../common/entity-display.js';
import { editableFields, setSelectOptions } from './rule-formatters.js';

export function openManualRuleEditor(container, appId, app, rule, onCancel) {
  const intent = rule.businessIntentJson || {};
  const name = h('input', { value: rule.name });
  const triggerEvent = h('select');
  const triggerEntity = h('select');
  const triggerField = h('select');
  const fromValue = h('input', { value: intent.trigger?.from ?? '', placeholder: '原值或选项 ID' });
  const toValue = h('input', { value: intent.trigger?.to ?? '', placeholder: '新值或选项 ID' });
  const relationField = h('select');
  const targetField = h('select');
  const operation = h('select');
  const valueType = h('select');
  const sourceField = h('select');
  const literalValue = h('input', { value: intent.action?.value?.value ?? '', placeholder: '固定值' });
  const updatedOnly = h('div', { class: 'manual-rule-updated-fields' }, [
    h('div', { class: 'field' }, [h('label', { text: '触发字段' }), triggerField]),
    h('div', { class: 'field' }, [h('label', { text: '从' }), fromValue]),
    h('div', { class: 'field' }, [h('label', { text: '变为' }), toValue])
  ]);
  const sourceFieldWrap = h('div', { class: 'field' }, [h('label', { text: '取值字段' }), sourceField]);
  const literalWrap = h('div', { class: 'field' }, [h('label', { text: '固定值' }), literalValue]);
  const entities = app.schema?.entities || [];
  setSelectOptions(triggerEvent, [
    { value: 'record.created', label: '新增记录时' },
    { value: 'record.updated', label: '字段值变化时' }
  ], intent.trigger?.event || rule.contractJson?.trigger?.type || 'record.updated');
  setSelectOptions(triggerEntity, entities.map((entity) => ({ value: entity.id, label: entityDisplayName(app, entity) })), intent.trigger?.entity);
  setSelectOptions(operation, [
    { value: 'set', label: '设置为' }, { value: 'increment', label: '增加' }, { value: 'decrement', label: '减少' }
  ], intent.action?.operation || 'set');
  setSelectOptions(valueType, [
    { value: 'trigger.field', label: '使用触发记录字段' }, { value: 'literal', label: '使用固定值' }
  ], intent.action?.value?.type || 'trigger.field');

  const refresh = () => {
    const sourceEntity = entities.find((entity) => entity.id === triggerEntity.value) || entities[0];
    setSelectOptions(triggerField, editableFields(sourceEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), triggerField.dataset.ready ? triggerField.value : intent.trigger?.field);
    triggerField.dataset.ready = 'true';
    const relations = (sourceEntity?.fields || []).filter((field) => field.type === 'relation' && entities.some((entity) => entity.id === field.targetEntity));
    setSelectOptions(relationField, [
      { value: '', label: '当前记录' },
      ...relations.map((field) => ({ value: field.id, label: `${field.label} → ${entityDisplayName(app, field.targetEntity)}` }))
    ], relationField.dataset.ready ? relationField.value : (intent.target?.relationField || ''));
    relationField.dataset.ready = 'true';
    const relation = relations.find((field) => field.id === relationField.value);
    const targetEntity = relation ? entities.find((entity) => entity.id === relation.targetEntity) : sourceEntity;
    setSelectOptions(targetField, editableFields(targetEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), targetField.dataset.ready ? targetField.value : intent.target?.field);
    targetField.dataset.ready = 'true';
    setSelectOptions(sourceField, editableFields(sourceEntity).map((field) => ({ value: field.id, label: `${field.label} (${field.id})` })), sourceField.dataset.ready ? sourceField.value : intent.action?.value?.field);
    sourceField.dataset.ready = 'true';
    updatedOnly.hidden = triggerEvent.value !== 'record.updated';
    sourceFieldWrap.hidden = valueType.value !== 'trigger.field';
    literalWrap.hidden = valueType.value !== 'literal';
  };
  triggerEntity.onchange = () => { triggerField.dataset.ready = ''; relationField.dataset.ready = ''; targetField.dataset.ready = ''; sourceField.dataset.ready = ''; refresh(); };
  relationField.onchange = () => { targetField.dataset.ready = ''; refresh(); };
  triggerEvent.onchange = refresh;
  valueType.onchange = refresh;
  refresh();

  const save = h('button', { text: '保存修改', onclick: async () => {
    try {
      const sourceEntity = entities.find((entity) => entity.id === triggerEntity.value);
      const relation = (sourceEntity?.fields || []).find((field) => field.id === relationField.value && field.type === 'relation');
      const targetEntityId = relation?.targetEntity || sourceEntity?.id;
      const nextIntent = {
        supported: true,
        name: name.value.trim() || rule.name,
        summary: `手动修改规则：${name.value.trim() || rule.name}`,
        trigger: triggerEvent.value === 'record.created'
          ? { event: 'record.created', entity: sourceEntity.id }
          : { event: 'record.updated', entity: sourceEntity.id, field: triggerField.value, from: fromValue.value, to: toValue.value },
        target: { entity: targetEntityId, relationField: relation?.id || null, field: targetField.value },
        action: { operation: operation.value, value: valueType.value === 'trigger.field'
          ? { type: 'trigger.field', field: sourceField.value }
          : { type: 'literal', value: literalValue.value } }
      };
      const body = await api(`/api/apps/${encodeURIComponent(appId)}/rules/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sourceText: `手动修改：${nextIntent.name}`, businessIntentJson: nextIntent })
      });
      Object.assign(rule, body.rule);
      toast('业务规则已更新');
      onCancel();
    } catch (error) {
      toast(`保存失败：${error.message}`);
    }
  } });
  container.replaceChildren(h('div', { class: 'manual-rule-editor' }, [
    h('div', { class: 'business-rule-detail-head' }, [
      h('button', { class: 'ghost', text: '← 取消修改', onclick: onCancel }),
      save
    ]),
    h('h3', { text: '手动修改业务规则' }),
    h('p', { class: 'muted', text: '修改业务含义后，系统会重新生成并检查执行配置。' }),
    h('div', { class: 'manual-rule-grid' }, [
      h('div', { class: 'field manual-rule-wide' }, [h('label', { text: '规则名称' }), name]),
      h('div', { class: 'field' }, [h('label', { text: '触发方式' }), triggerEvent]),
      h('div', { class: 'field' }, [h('label', { text: '触发表' }), triggerEntity]),
      updatedOnly,
      h('div', { class: 'field' }, [h('label', { text: '影响对象' }), relationField]),
      h('div', { class: 'field' }, [h('label', { text: '目标字段' }), targetField]),
      h('div', { class: 'field' }, [h('label', { text: '操作' }), operation]),
      h('div', { class: 'field' }, [h('label', { text: '值来源' }), valueType]),
      sourceFieldWrap,
      literalWrap
    ])
  ]));
}
