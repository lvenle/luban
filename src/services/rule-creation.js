import { normalizeFieldId } from '../core/ids.js';
import { validateContract } from './rule-engine.js';
import { createRule, updateRuleDefinition } from '../models/rule.js';

function findEntity(app, id) {
  return app?.schema?.entities?.find((entity) => entity.id === id);
}

function findField(entity, id) {
  return entity?.fields?.find((field) => field.id === id);
}

function displayChoice(field, value) {
  return field?.options?.find((option) => option.id === value || option.label === value)?.label || value;
}

export function compileBusinessRule(app, sourceText, businessIntent) {
  if (!businessIntent?.supported) throw new Error(businessIntent?.reason || '当前业务规则暂不支持。');
  const triggerType = businessIntent.trigger?.event || 'record.updated';
  if (!['record.created', 'record.updated'].includes(triggerType)) throw new Error(`不支持的触发类型：${triggerType}`);
  const triggerEntity = findEntity(app, businessIntent.trigger?.entity);
  const triggerField = triggerType === 'record.updated' ? findField(triggerEntity, businessIntent.trigger?.field) : null;
  const targetEntity = findEntity(app, businessIntent.target?.entity);
  const targetField = findField(targetEntity, businessIntent.target?.field);
  if (!triggerEntity) throw new Error(`触发表不存在：${businessIntent.trigger?.entity || ''}`);
  if (triggerType === 'record.updated' && !triggerField) throw new Error(`触发字段不存在：${businessIntent.trigger?.field || ''}`);
  if (!targetEntity) throw new Error(`目标表不存在：${businessIntent.target?.entity || ''}`);
  if (!targetField) throw new Error(`目标字段不存在：${businessIntent.target?.field || ''}`);
  if (['formula', 'relation', 'ai'].includes(targetField.type)) throw new Error(`目标字段“${targetField.label}”不能由业务规则直接修改。`);
  const operation = businessIntent.action?.operation;
  if (!['set', 'increment', 'decrement'].includes(operation)) throw new Error(`不支持的字段操作：${operation || ''}`);

  let relationField = null;
  if (businessIntent.target?.relationField) {
    relationField = findField(triggerEntity, businessIntent.target.relationField);
    if (!relationField || relationField.type !== 'relation' || relationField.targetEntity !== targetEntity.id) {
      throw new Error(`关联字段不能定位目标表：${businessIntent.target.relationField}`);
    }
  } else if (targetEntity.id !== triggerEntity.id) {
    throw new Error('跨表规则必须指定触发表上的 relation 字段。');
  }

  const valueSpec = businessIntent.action?.value || {};
  let contractValue;
  let sourceField = null;
  if (valueSpec.type === 'trigger.field') {
    sourceField = findField(triggerEntity, valueSpec.field);
    if (!sourceField) throw new Error(`来源字段不存在：${valueSpec.field || ''}`);
    if (['formula', 'relation', 'ai'].includes(sourceField.type)) throw new Error(`来源字段“${sourceField.label}”不能直接作为规则更新值。`);
    contractValue = `{{trigger.record.${sourceField.id}}}`;
  } else if (valueSpec.type === 'literal') {
    contractValue = valueSpec.value;
  } else {
    throw new Error(`不支持的值来源：${valueSpec.type || ''}`);
  }
  if (['increment', 'decrement'].includes(operation)) {
    if (targetField.type !== 'number') throw new Error(`目标字段“${targetField.label}”必须是数字字段。`);
    if (sourceField && sourceField.type !== 'number') throw new Error(`来源字段“${sourceField.label}”必须是数字字段。`);
    if (!sourceField && !Number.isFinite(Number(contractValue))) throw new Error('增加或减少的固定值必须是数字。');
  }

  const ruleId = normalizeFieldId(businessIntent.name || sourceText, 'rule');
  const steps = [];
  let recordTemplate = '{{trigger.record.id}}';
  if (relationField) {
    steps.push({
      id: 'read_targets', type: 'read.related', sourceEntity: triggerEntity.id,
      sourceRecord: '{{trigger.record.id}}', field: relationField.id, output: 'targets'
    });
    recordTemplate = '{{targets.id}}';
  }
  steps.push({
    id: 'update_target', type: 'update.field', entity: targetEntity.id,
    ...(relationField ? { scope: 'each targets' } : {}), record: recordTemplate,
    field: targetField.id, operation, value: contractValue
  });
  steps.push({ id: 'write_log', type: 'log.run' });
  const contract = {
    id: ruleId,
    name: businessIntent.name || '业务字段联动',
    trigger: triggerType === 'record.created'
      ? { type: 'record.created', entity: triggerEntity.id }
      : { type: 'record.updated', entity: triggerEntity.id, field: triggerField.id, from: businessIntent.trigger.from, to: businessIntent.trigger.to },
    steps,
    idempotency: { key: '{{rule.id}}:{{trigger.entity}}:{{trigger.record.id}}' }
  };
  validateContract(contract, ruleId);
  const mapping = {
    trigger: {
      type: triggerType, entityId: triggerEntity.id, entityName: triggerEntity.name,
      fieldId: triggerField?.id || null, fieldName: triggerField?.label || null
    },
    relation: relationField ? { fieldId: relationField.id, fieldName: relationField.label, targetEntityId: targetEntity.id } : null,
    source: sourceField ? { fieldId: sourceField.id, fieldName: sourceField.label } : { literal: contractValue },
    target: { entityId: targetEntity.id, entityName: targetEntity.name, fieldId: targetField.id, fieldName: targetField.label }
  };
  const preview = {
    when: businessIntent.display?.when || (triggerType === 'record.created'
      ? `新增一条${triggerEntity.name}记录`
      : `${triggerEntity.name}.${triggerField.label} 从“${displayChoice(triggerField, businessIntent.trigger.from)}”变为“${displayChoice(triggerField, businessIntent.trigger.to)}”`),
    then: businessIntent.display?.then || `${targetEntity.name}.${targetField.label}执行 ${operation}`
  };
  return { name: contract.name, businessIntent, schemaMapping: mapping, contract, preview };
}

export function simulateCompiledRule(compiled) {
  validateContract(compiled?.contract, compiled?.contract?.id);
  const update = compiled.contract.steps.find((step) => step.type === 'update.field');
  const reads = compiled.contract.steps.filter((step) => step.type.startsWith('read.'));
  if (!update) throw new Error('Contract 缺少字段更新步骤，无法模拟。');
  return {
    status: 'success',
    summary: 'Contract 已通过非破坏性模拟校验，不会在保存前修改真实数据。',
    steps: [
      { type: 'trigger', status: 'success', message: compiled.preview.when },
      ...reads.map((step) => ({ type: step.type, status: 'success', message: '关联读取配置有效' })),
      { type: 'update.field', status: 'success', message: compiled.preview.then }
    ]
  };
}

export function saveCompiledRule(appId, sourceText, compiled) {
  simulateCompiledRule(compiled);
  return createRule({
    appId,
    name: compiled.name,
    description: compiled.businessIntent.summary || compiled.preview.then,
    status: 'active',
    sourceText,
    businessIntentJson: compiled.businessIntent,
    schemaMappingJson: compiled.schemaMapping,
    contractJson: compiled.contract
  });
}

export function updateCompiledRule(appId, ruleId, sourceText, compiled) {
  simulateCompiledRule(compiled);
  return updateRuleDefinition(appId, ruleId, {
    name: compiled.name,
    description: compiled.businessIntent.summary || compiled.preview.then,
    sourceText,
    businessIntentJson: compiled.businessIntent,
    schemaMappingJson: compiled.schemaMapping,
    contractJson: compiled.contract
  });
}
