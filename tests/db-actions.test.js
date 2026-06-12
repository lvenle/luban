import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createAppFromPackage, createRecord, exportAppPayload, listRecords, resetDbForTests } from '../src/db.js';
import { runAction } from '../src/actions.js';
import { createBudgetPackage } from '../src/samplePackages.js';

test('stores app package and records in SQLite', () => {
  const dbPath = join(process.cwd(), 'data', 'test-db-actions.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const record = createRecord(app.id, 'transaction', { type: '支出', amount: 42, category: '餐饮', date: '2026-06-10' });
  assert.ok(record.id);
  const records = listRecords(app.id, { entityId: 'transaction', q: '餐饮' });
  assert.equal(records.length, 1);
  assert.equal(records[0].data.amount, 42);
});

test('runs built-in actions without executing arbitrary code', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-actions.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  createRecord(app.id, 'transaction', { type: '支出', amount: 88, category: '交通', date: '2026-06-10' });
  const result = await runAction(app, 'monthly_summary');
  assert.equal(result.type, 'text');
  assert.match(result.result, /已分析 1 条记录/);
});

test('exports app structure by default', () => {
  const dbPath = join(process.cwd(), 'data', 'test-export.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  createRecord(app.id, 'transaction', { type: '支出', amount: 12 });
  const payload = exportAppPayload(app.id);
  assert.equal(payload.manifest.id, 'budget-book');
  assert.equal(payload.sampleData, undefined);
});
