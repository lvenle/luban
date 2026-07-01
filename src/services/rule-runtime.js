import { withTransaction, triggerBackup } from '../storage/db.js';
import { createRecord, getRecordForApp, getRecordRelations, updateRecordForApp } from '../models/record.js';
import { getApp } from '../models/app.js';
import { listActiveRulesForEvent } from '../models/rule.js';
import { executeRuleEvent } from './rule-engine.js';
import { RuleRunRepository } from '../models/rule-run.js';
import { getRuleRecordState, upsertRuleRecordState } from '../models/rule-record-state.js';

class RuleMutationError extends Error {
  constructor(message, payload) {
    super(message);
    this.name = 'RuleMutationError';
    this.status = 409;
    this.payload = payload;
    this.details = { ruleId: payload.rule.id, ruleName: payload.rule.name, result: payload.result };
  }
}

function writeRolledBackRun(appId, event, rule, result) {
  new RuleRunRepository().createRun({
    appId,
    ruleId: rule.id,
    sourceEntity: event.entity,
    sourceRecordId: event.recordId,
    status: result.status,
    stepsJson: result.steps || [],
    inputSnapshotJson: { event },
    outputSnapshotJson: { rolledBack: true },
    errorMessage: result.errorMessage,
    idempotencyKey: `${rule.id}:${event.entity}:${event.recordId}`
  });
}

function isBlank(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function createdRuleDependencies(app, rule) {
  const entityId = rule.contractJson?.trigger?.entity;
  const entity = app?.schema?.entities?.find((item) => item.id === entityId);
  const fieldIds = new Set();
  const mapping = rule.schemaMappingJson || {};
  if (mapping.relation?.fieldId) fieldIds.add(mapping.relation.fieldId);
  if (mapping.source?.fieldId) fieldIds.add(mapping.source.fieldId);
  const contractText = JSON.stringify(rule.contractJson || {});
  for (const match of contractText.matchAll(/\{\{\s*trigger\.record\.([^}\s]+)\s*}}/g)) {
    if (match[1] !== 'id') fieldIds.add(match[1]);
  }
  return [...fieldIds].map((fieldId) => {
    const field = entity?.fields?.find((item) => item.id === fieldId);
    return { fieldId, label: field?.label || fieldId, type: field?.type || '' };
  });
}

function createdRuleReadiness(appId, app, rule, record) {
  const missingFields = [];
  for (const dependency of createdRuleDependencies(app, rule)) {
    const value = dependency.type === 'relation'
      ? getRecordRelations(record.id, dependency.fieldId, appId).map((item) => item.targetRecordId)
      : record.data?.[dependency.fieldId];
    if (isBlank(value)) missingFields.push({ fieldId: dependency.fieldId, label: dependency.label });
  }
  return { ready: missingFields.length === 0, missingFields };
}

function waitingResult(rule, missingFields) {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    status: 'waiting',
    missingFields,
    steps: [{
      stepId: 'rule_readiness',
      type: 'record.created',
      status: 'waiting',
      message: `等待补充：${missingFields.map((field) => field.label).join('、')}`
    }]
  };
}

function processCreatedRule({ database, appId, app, rule, record, event }) {
  const readiness = createdRuleReadiness(appId, app, rule, record);
  upsertRuleRecordState({
    appId,
    ruleId: rule.id,
    sourceEntity: record.entityId,
    sourceRecordId: record.id,
    state: 'waiting',
    missingFields: readiness.missingFields
  }, database);
  if (!readiness.ready) return waitingResult(rule, readiness.missingFields);
  const result = executeRuleEvent({ appId, rule, event, deferBackup: true });
  if (result.status === 'success') {
    upsertRuleRecordState({
      appId,
      ruleId: rule.id,
      sourceEntity: record.entityId,
      sourceRecordId: record.id,
      state: 'success',
      missingFields: []
    }, database);
  }
  return { ruleId: rule.id, ruleName: rule.name, ...result };
}

export function updateRecordWithRules(appId, recordId, data) {
  let failedPayload = null;
  try {
    const output = withTransaction((database) => {
      const before = getRecordForApp(appId, recordId);
      if (!before) {
        const error = new Error('找不到记录。');
        error.status = 404;
        throw error;
      }
      const app = getApp(appId);
      const entity = app?.schema?.entities?.find((item) => item.id === before.entityId);
      const relationValues = {};
      for (const field of (entity?.fields || []).filter((item) => item.type === 'relation')) {
        relationValues[field.id] = getRecordRelations(recordId, field.id, appId).map((item) => item.targetRecordId);
      }
      const merged = { ...before.data, ...relationValues, ...(data || {}) };
      const record = updateRecordForApp(appId, recordId, merged, { skipBackup: true });
      const event = {
        type: 'record.updated',
        entity: record.entityId,
        recordId: record.id,
        before: before.data,
        after: record.data
      };
      const results = [];
      for (const rule of listActiveRulesForEvent(appId, event)) {
        const result = executeRuleEvent({ appId, rule, event, deferBackup: true });
        results.push({ ruleId: rule.id, ruleName: rule.name, ...result });
        if (result.status === 'blocked' || result.status === 'failed') {
          failedPayload = { rule, result, event };
          throw new RuleMutationError(result.errorMessage || `业务规则“${rule.name}”阻止了本次修改。`, failedPayload);
        }
      }
      const createdEvent = {
        type: 'record.created',
        entity: record.entityId,
        recordId: record.id,
        before: {},
        after: record.data
      };
      for (const rule of listActiveRulesForEvent(appId, createdEvent)) {
        const state = getRuleRecordState(appId, rule.id, record.id, database);
        if (state?.state !== 'waiting') continue;
        const result = processCreatedRule({ database, appId, app, rule, record, event: createdEvent });
        results.push(result);
        if (result.status === 'blocked' || result.status === 'failed') {
          failedPayload = { rule, result, event: createdEvent };
          throw new RuleMutationError(result.errorMessage || `业务规则“${rule.name}”阻止了本次修改。`, failedPayload);
        }
      }
      return { record: getRecordForApp(appId, recordId), ruleResults: results };
    });
    triggerBackup();
    return output;
  } catch (error) {
    if (error instanceof RuleMutationError && failedPayload) {
      writeRolledBackRun(appId, failedPayload.event, failedPayload.rule, failedPayload.result);
      triggerBackup();
    }
    throw error;
  }
}

export function createRecordWithRules(appId, entityId, data, customCreatedAt) {
  let failedPayload = null;
  try {
    const output = withTransaction((database) => {
      const record = createRecord(appId, entityId, data, customCreatedAt, { skipBackup: true });
      const app = getApp(appId);
      const event = {
        type: 'record.created',
        entity: record.entityId,
        recordId: record.id,
        before: {},
        after: record.data
      };
      const results = [];
      for (const rule of listActiveRulesForEvent(appId, event)) {
        const result = processCreatedRule({ database, appId, app, rule, record, event });
        results.push(result);
        if (result.status === 'blocked' || result.status === 'failed') {
          failedPayload = { rule, result, event };
          throw new RuleMutationError(result.errorMessage || `业务规则“${rule.name}”阻止了本次新增。`, failedPayload);
        }
      }
      return { record: getRecordForApp(appId, record.id), ruleResults: results };
    });
    triggerBackup();
    return output;
  } catch (error) {
    if (error instanceof RuleMutationError && failedPayload) {
      writeRolledBackRun(appId, failedPayload.event, failedPayload.rule, failedPayload.result);
      triggerBackup();
    }
    throw error;
  }
}
