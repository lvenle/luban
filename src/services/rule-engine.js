import { getDb, withTransaction, triggerBackup } from '../storage/db.js';
import { RuleRunRepository } from '../models/rule-run.js';

const SUPPORTED_STEP_TYPES = new Set(['read.records', 'read.related', 'aggregate.sum', 'condition', 'update.field', 'block', 'log.run']);

class RuleExecutionError extends Error {
  constructor(message, stepId = 'contract') {
    super(message);
    this.name = 'RuleExecutionError';
    this.stepId = stepId;
  }
}

class RuleBlockedError extends Error {
  constructor(message, stepId) {
    super(message);
    this.name = 'RuleBlockedError';
    this.stepId = stepId;
  }
}

function stepResult(step, status, message, input, output) {
  return {
    stepId: step.id,
    type: step.type,
    status,
    message,
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output })
  };
}

export function validateContract(contract, ruleId) {
  if (!ruleId || !contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new RuleExecutionError('Contract 缺少必要字段');
  }
  const trigger = contract.trigger;
  const validUpdatedTrigger = trigger?.type === 'record.updated' && trigger.field
    && trigger.from !== undefined && trigger.to !== undefined;
  const validCreatedTrigger = trigger?.type === 'record.created';
  if (!trigger?.entity || (!validUpdatedTrigger && !validCreatedTrigger) || !Array.isArray(contract.steps)
    || !contract.steps.length || !contract.idempotency?.key) {
    throw new RuleExecutionError('Contract 缺少必要字段');
  }
  const ids = new Set();
  for (const step of contract.steps) {
    if (!step?.id || !step.type) throw new RuleExecutionError('Contract Step 缺少 id 或 type');
    if (ids.has(step.id)) throw new RuleExecutionError(`Contract Step id 重复：${step.id}`, step.id);
    if (!SUPPORTED_STEP_TYPES.has(step.type)) throw new RuleExecutionError(`不支持的 Step 类型：${step.type}`, step.id);
    ids.add(step.id);
  }
  for (const step of contract.steps.filter((item) => item.type === 'condition')) {
    for (const branchId of [...(step.then || []), ...(step.else || [])]) {
      if (!ids.has(branchId)) throw new RuleExecutionError(`条件引用了不存在的 Step：${branchId}`, step.id);
      const branch = contract.steps.find((item) => item.id === branchId);
      if (!['update.field', 'block'].includes(branch.type)) {
        throw new RuleExecutionError(`condition 分支仅支持 update.field 或 block：${branchId}`, step.id);
      }
    }
  }
}

function triggerMatches(trigger, event) {
  if (event?.type !== trigger.type || event.entity !== trigger.entity) return false;
  if (trigger.type === 'record.created') return true;
  return event.before?.[trigger.field] === trigger.from && event.after?.[trigger.field] === trigger.to;
}

function readStoredRecord(database, appId, entityId, recordId) {
  const row = database.prepare('SELECT * FROM records WHERE appId = ? AND entityId = ? AND id = ?')
    .get(appId, entityId, recordId);
  if (!row) return null;
  return { id: row.id, appId: row.appId, entityId: row.entityId, data: JSON.parse(row.dataJson), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function recordBusinessLabel(database, appId, entityId, data) {
  const appRow = database.prepare('SELECT schemaJson FROM apps WHERE id = ?').get(appId);
  if (!appRow) return '';
  let schema;
  try { schema = JSON.parse(appRow.schemaJson); } catch { return ''; }
  const entity = schema?.entities?.find((item) => item.id === entityId);
  const fields = entity?.fields || [];
  const preferred = fields.find((field) => /(名称|姓名|标题|编号|单号|name|title|code)/i.test(`${field.label || ''} ${field.id || ''}`) && data?.[field.id] !== undefined && data?.[field.id] !== '')
    || fields.find((field) => ['text', 'select'].includes(field.type) && data?.[field.id] !== undefined && data?.[field.id] !== '');
  return preferred ? String(data[preferred.id]) : '';
}

function contextValue(path, state) {
  const parts = String(path || '').split('.');
  if (parts[0] === 'rule' && parts[1] === 'id') return state.ruleId;
  if (parts[0] === 'trigger' && parts[1] === 'entity') return state.event.entity;
  if (parts[0] === 'trigger' && parts[1] === 'record' && parts[2] === 'id') return state.event.recordId;
  if (parts[0] === 'trigger' && parts[1] === 'record' && parts[2]) return state.event.after?.[parts[2]];
  if (parts[0] === state.currentScope && state.currentItem) return state.currentItem[parts[1]];
  let value = state.context[parts.shift()];
  for (const part of parts) value = value?.[part];
  return value;
}

function resolveTemplate(value, state, stepId) {
  if (typeof value !== 'string') return value;
  const exact = value.match(/^{{\s*([^}]+?)\s*}}$/);
  if (exact) {
    const resolved = contextValue(exact[1], state);
    if (resolved === undefined) throw new RuleExecutionError(`无法解析占位符：${value}`, stepId);
    return resolved;
  }
  return value.replace(/{{\s*([^}]+?)\s*}}/g, (token, path) => {
    const resolved = contextValue(path, state);
    if (resolved === undefined) throw new RuleExecutionError(`无法解析占位符：${token}`, stepId);
    return String(resolved);
  });
}

export class ContractInterpreter {
  constructor(database, appId, ruleId, contract, event) {
    this.database = database;
    this.appId = appId;
    this.ruleId = ruleId;
    this.contract = contract;
    this.event = event;
    this.context = {};
    this.contextMeta = {};
    this.steps = [];
    this.updates = [];
    this.stepMap = new Map(contract.steps.map((step) => [step.id, step]));
    this.branchIds = new Set(contract.steps.filter((step) => step.type === 'condition')
      .flatMap((step) => [...(step.then || []), ...(step.else || [])]));
  }

  state() {
    return {
      ruleId: this.ruleId,
      event: this.event,
      context: this.context,
      currentScope: this.currentScope,
      currentItem: this.currentItem
    };
  }

  execute() {
    for (const step of this.contract.steps) {
      if (this.branchIds.has(step.id)) continue;
      this.executeStep(step);
    }
    return { steps: this.steps, context: this.context, updates: this.updates };
  }

  executeStep(step) {
    switch (step.type) {
      case 'read.records': return this.readRecords(step);
      case 'read.related': return this.readRelated(step);
      case 'aggregate.sum': return this.aggregateSum(step);
      case 'condition': return this.condition(step);
      case 'update.field': return this.updateField(step);
      case 'block': return this.block(step);
      case 'log.run':
        this.steps.push(stepResult(step, 'success', '业务处理已完成'));
        return;
      default: throw new RuleExecutionError(`不支持的 Step 类型：${step.type}`, step.id);
    }
  }

  readRecords(step) {
    if (!step.entity || !step.output || !step.where || typeof step.where !== 'object') {
      throw new RuleExecutionError('read.records 配置不完整', step.id);
    }
    const rows = this.database.prepare('SELECT * FROM records WHERE appId = ? AND entityId = ? ORDER BY createdAt ASC, rowid ASC')
      .all(this.appId, step.entity)
      .map((row) => ({ id: row.id, ...JSON.parse(row.dataJson) }));
    const where = Object.fromEntries(Object.entries(step.where).map(([field, value]) => [field, resolveTemplate(value, this.state(), step.id)]));
    const records = rows.filter((record) => Object.entries(where).every(([field, value]) => record[field] === value));
    this.context[step.output] = records;
    this.steps.push(stepResult(step, 'success', `已找到 ${records.length} 条符合条件的数据`, { entity: step.entity, where }, records));
  }

  readRelated(step) {
    if (!step.sourceEntity || !step.field || !step.output || !step.sourceRecord) {
      throw new RuleExecutionError('read.related 配置不完整', step.id);
    }
    const sourceRecordId = String(resolveTemplate(step.sourceRecord, this.state(), step.id));
    const rows = this.database.prepare(`
      SELECT targetRecordId FROM record_relations
      WHERE appId = ? AND sourceEntityId = ? AND sourceRecordId = ? AND fieldId = ?
      ORDER BY sortOrder ASC, createdAt ASC
    `).all(this.appId, step.sourceEntity, sourceRecordId, step.field);
    const records = rows.map((row) => ({ id: row.targetRecordId }));
    this.context[step.output] = records;
    this.steps.push(stepResult(step, 'success', `已找到 ${records.length} 条关联数据`, {
      sourceEntity: step.sourceEntity, sourceRecordId, field: step.field
    }, records));
  }

  aggregateSum(step) {
    const input = this.context[step.input];
    if (!Array.isArray(input) || !step.groupBy || !step.sum || !step.output) {
      throw new RuleExecutionError('aggregate.sum 配置或输入无效', step.id);
    }
    const grouped = new Map();
    for (const item of input) {
      const key = item?.[step.groupBy];
      const value = Number(item?.[step.sum]);
      if (key === undefined || !Number.isFinite(value)) throw new RuleExecutionError('aggregate.sum 遇到无效分组或数值', step.id);
      const current = grouped.get(key) || { [step.groupBy]: key, [step.sum]: 0 };
      current[step.sum] += value;
      grouped.set(key, current);
    }
    const output = [...grouped.values()];
    this.context[step.output] = output;
    this.contextMeta[step.output] = { groupBy: step.groupBy, sum: step.sum };
    this.steps.push(stepResult(step, 'success', `数据汇总完成，共 ${output.length} 组`, input, output));
  }

  condition(step) {
    const scopeMatch = String(step.scope || '').match(/^each\s+([A-Za-z0-9_]+)$/);
    if (!scopeMatch || step.operator !== '>=' || !step.left || !step.right) {
      throw new RuleExecutionError('condition 仅支持 scope: each <context> 和 operator: >=', step.id);
    }
    const scope = scopeMatch[1];
    const items = this.context[scope];
    if (!Array.isArray(items)) throw new RuleExecutionError(`condition 找不到上下文：${scope}`, step.id);
    const [leftEntity, leftField] = String(step.left).split('.');
    if (!leftEntity || !leftField) throw new RuleExecutionError('condition left 必须为 entity.field', step.id);
    const groupBy = this.contextMeta[scope]?.groupBy;
    for (const item of items) {
      this.currentScope = scope;
      this.currentItem = item;
      const targetId = groupBy ? item[groupBy] : item.id;
      const target = readStoredRecord(this.database, this.appId, leftEntity, targetId);
      if (!target) throw new RuleExecutionError(`condition 找不到目标记录：${leftEntity}/${targetId}`, step.id);
      const left = Number(target.data[leftField]);
      const right = Number(contextValue(step.right, this.state()));
      if (!Number.isFinite(left) || !Number.isFinite(right)) throw new RuleExecutionError('condition 比较值必须是数值', step.id);
      const passed = left >= right;
      this.steps.push(stepResult(step, passed ? 'success' : 'blocked', `条件检查${passed ? '通过' : '未通过'}：当前值 ${left}，要求至少为 ${right}`, { left, right, recordId: targetId }, { passed }));
      for (const branchId of (passed ? step.then : step.else) || []) this.executeStep(this.stepMap.get(branchId));
    }
    this.currentScope = undefined;
    this.currentItem = undefined;
  }

  updateField(step) {
    const scopeMatch = String(step.scope || '').match(/^each\s+([A-Za-z0-9_]+)$/);
    if (scopeMatch && !this.currentScope) {
      const scope = scopeMatch[1];
      const items = this.context[scope];
      if (!Array.isArray(items) || !items.length) throw new RuleExecutionError(`update.field 找不到目标上下文：${scope}`, step.id);
      for (const item of items) {
        this.currentScope = scope;
        this.currentItem = item;
        this.updateField({ ...step, scope: undefined });
      }
      this.currentScope = undefined;
      this.currentItem = undefined;
      return;
    }
    if (!step.entity || !step.field || !['set', 'increment', 'decrement'].includes(step.operation)) {
      throw new RuleExecutionError('update.field 仅支持 set、increment、decrement 操作', step.id);
    }
    const recordId = String(resolveTemplate(step.record, this.state(), step.id));
    const resolvedValue = resolveTemplate(step.value, this.state(), step.id);
    const record = readStoredRecord(this.database, this.appId, step.entity, recordId);
    if (!record) throw new RuleExecutionError(`update.field 找不到记录：${step.entity}/${recordId}`, step.id);
    const rawBeforeValue = record.data?.[step.field];
    let afterValue;
    if (step.operation === 'set') {
      afterValue = resolvedValue;
    } else {
      const beforeValue = Number(rawBeforeValue);
      const delta = Number(resolvedValue);
      if (!Number.isFinite(beforeValue) || !Number.isFinite(delta) || delta < 0) {
        throw new RuleExecutionError('update.field 的 increment/decrement 字段和值必须是非负数值', step.id);
      }
      afterValue = step.operation === 'increment' ? beforeValue + delta : beforeValue - delta;
    }
    const before = { id: record.id, entityId: record.entityId, data: { ...record.data } };
    const afterData = { ...record.data, [step.field]: afterValue };
    this.database.prepare('UPDATE records SET dataJson = ?, updatedAt = ? WHERE appId = ? AND entityId = ? AND id = ?')
      .run(JSON.stringify(afterData), new Date().toISOString(), this.appId, step.entity, recordId);
    const after = { id: record.id, entityId: record.entityId, data: afterData };
    this.updates.push({
      stepId: step.id,
      entityId: step.entity,
      recordId,
      fieldId: step.field,
      operation: step.operation,
      recordLabel: recordBusinessLabel(this.database, this.appId, step.entity, record.data),
      beforeValue: rawBeforeValue,
      afterValue,
      before,
      after
    });
    this.steps.push(stepResult(step, 'success', `目标字段已由 ${String(rawBeforeValue ?? '空')} 变为 ${String(afterValue ?? '空')}`, before, after));
  }

  block(step) {
    const message = String(step.message || '规则阻止执行');
    this.steps.push(stepResult(step, 'blocked', message));
    throw new RuleBlockedError(message, step.id);
  }
}

function normalizeRule(rule) {
  const contract = rule?.contractJson || rule;
  return { ruleId: rule?.id || contract?.id, contract };
}

function rollbackStepResults(steps) {
  return steps.map((step) => step.type === 'update.field' && step.status === 'success'
    ? { ...step, status: 'skipped', message: `${step.message}（本次处理未完成，数据已恢复）` }
    : step);
}

export class RuleEngine {
  executeRuleEvent({ appId, rule, event, deferBackup = false }) {
    const { ruleId, contract } = normalizeRule(rule);
    const base = { ruleId: ruleId || 'unknown', steps: [] };
    let idempotencyKey = `${ruleId || 'unknown'}:${event?.entity || 'unknown'}:${event?.recordId || 'unknown'}`;
    try {
      validateContract(contract, ruleId);
      idempotencyKey = resolveTemplate(contract.idempotency.key, { ruleId, event, context: {} }, 'idempotency');
      if (rule?.status && rule.status !== 'active') {
        const result = { ...base, status: 'skipped', steps: [stepResult({ id: 'rule_status', type: contract.trigger.type }, 'skipped', '这条规则当前未启用，本次没有执行')] };
        this.writeRun(appId, event, result, idempotencyKey);
        if (!deferBackup) triggerBackup();
        return result;
      }
      if (!triggerMatches(contract.trigger, event)) {
        const result = { ...base, status: 'skipped', steps: [stepResult({ id: 'trigger', type: contract.trigger.type }, 'skipped', '本次操作没有满足规则条件')] };
        this.writeRun(appId, event, result, idempotencyKey);
        if (!deferBackup) triggerBackup();
        return result;
      }

      const existing = new RuleRunRepository().findSuccessfulRun(appId, idempotencyKey);
      if (existing) {
        const result = { ...base, status: 'skipped', steps: [stepResult({ id: 'idempotency', type: 'log.run' }, 'skipped', '这条记录已经执行过该规则，本次不会重复处理')] };
        this.writeRun(appId, event, result, idempotencyKey);
        if (!deferBackup) triggerBackup();
        return result;
      }

      const execution = withTransaction((database) => {
        const interpreter = new ContractInterpreter(database, appId, ruleId, contract, event);
        try {
          if (!readStoredRecord(database, appId, event.entity, event.recordId)) {
            throw new RuleExecutionError(`找不到触发记录：${event.entity}/${event.recordId}`, 'trigger');
          }
          const triggerMessage = contract.trigger.type === 'record.created'
            ? '已检测到新增记录'
            : `触发字段已由 ${contract.trigger.from} 变为 ${contract.trigger.to}`;
          interpreter.steps.push(stepResult(
            { id: 'trigger', type: contract.trigger.type }, 'success', triggerMessage, event.before, event.after
          ));
          const output = interpreter.execute();
          const result = { ruleId, status: 'success', steps: output.steps, changes: output.updates };
          new RuleRunRepository(database).createRun(this.runInput(appId, event, result, idempotencyKey, { context: output.context, updates: output.updates }));
          return result;
        } catch (error) {
          error.interpreterSteps = interpreter.steps;
          error.interpreterUpdates = interpreter.updates;
          throw error;
        }
      });
      if (!deferBackup) triggerBackup();
      return execution;
    } catch (error) {
      const status = error instanceof RuleBlockedError ? 'blocked' : 'failed';
      const steps = error.interpreterSteps || [];
      const finalSteps = rollbackStepResults(steps.length ? steps : [stepResult(
        { id: error.stepId || 'contract', type: 'validation' }, status, error.message
      )]);
      const result = { ...base, status, steps: finalSteps, errorMessage: error.message };
      this.writeRun(appId, event, result, idempotencyKey);
      if (!deferBackup) triggerBackup();
      return result;
    }
  }

  runInput(appId, event, result, idempotencyKey, outputSnapshotJson) {
    return {
      appId,
      ruleId: result.ruleId,
      sourceEntity: event?.entity || '',
      sourceRecordId: event?.recordId || '',
      status: result.status,
      stepsJson: result.steps,
      inputSnapshotJson: { event },
      outputSnapshotJson,
      errorMessage: result.errorMessage,
      idempotencyKey
    };
  }

  writeRun(appId, event, result, idempotencyKey) {
    if (!appId || !event?.entity || !event?.recordId) return null;
    return new RuleRunRepository().createRun(this.runInput(appId, event, result, idempotencyKey));
  }
}

export const ruleEngine = new RuleEngine();

export function executeRuleEvent(input) {
  return ruleEngine.executeRuleEvent(input);
}
