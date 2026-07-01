import { getDb } from '../storage/db.js';
import { createId } from '../core/ids.js';

function parseJson(value) {
  return value ? JSON.parse(value) : undefined;
}

function rowToRuleRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    appId: row.appId,
    ruleId: row.ruleId,
    sourceEntity: row.sourceEntity,
    sourceRecordId: row.sourceRecordId,
    status: row.status,
    stepsJson: parseJson(row.stepsJson) || [],
    inputSnapshotJson: parseJson(row.inputSnapshotJson),
    outputSnapshotJson: parseJson(row.outputSnapshotJson),
    errorMessage: row.errorMessage || undefined,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt
  };
}

export class RuleRunRepository {
  constructor(database = getDb()) {
    this.database = database;
  }

  findSuccessfulRun(appId, idempotencyKey) {
    return rowToRuleRun(this.database.prepare(
      "SELECT * FROM rule_runs WHERE appId = ? AND idempotencyKey = ? AND status = 'success' ORDER BY createdAt DESC LIMIT 1"
    ).get(appId, idempotencyKey));
  }

  createRun(input) {
    const run = {
      id: createId('run'),
      appId: input.appId,
      ruleId: input.ruleId,
      sourceEntity: input.sourceEntity,
      sourceRecordId: input.sourceRecordId,
      status: input.status,
      stepsJson: input.stepsJson || [],
      inputSnapshotJson: input.inputSnapshotJson,
      outputSnapshotJson: input.outputSnapshotJson,
      errorMessage: input.errorMessage || null,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString()
    };
    this.database.prepare(`
      INSERT INTO rule_runs (
        id, appId, ruleId, sourceEntity, sourceRecordId, status, stepsJson,
        inputSnapshotJson, outputSnapshotJson, errorMessage, idempotencyKey, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.appId, run.ruleId, run.sourceEntity, run.sourceRecordId, run.status,
      JSON.stringify(run.stepsJson),
      run.inputSnapshotJson === undefined ? null : JSON.stringify(run.inputSnapshotJson),
      run.outputSnapshotJson === undefined ? null : JSON.stringify(run.outputSnapshotJson),
      run.errorMessage, run.idempotencyKey, run.createdAt
    );
    return { ...run, errorMessage: run.errorMessage || undefined };
  }

  listRuns(appId, options = {}) {
    const conditions = ['appId = ?'];
    const params = [appId];
    if (options.ruleId) {
      conditions.push('ruleId = ?');
      params.push(options.ruleId);
    }
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    params.push(limit);
    return this.database.prepare(
      `SELECT * FROM rule_runs WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC, rowid DESC LIMIT ?`
    ).all(...params).map(rowToRuleRun);
  }
}

export function listRuleRuns(appId, options = {}) {
  return new RuleRunRepository().listRuns(appId, options);
}
