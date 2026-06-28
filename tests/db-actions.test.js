import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage, exportAppPayload } from '../src/models/app.js';
import { createRecord, listRecords, updateRecord } from '../src/models/record.js';
import { runAction } from '../src/services/actions.js';
import { createBudgetPackage } from '../src/ai/samplePackages.js';

test('stores app package and records in SQLite', () => {
  const dbPath = join(process.cwd(), 'data', 'test-db-actions.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const record = createRecord(app.id, 'transaction', { type: '支出', amount: 42, category: '餐饮', date: '2026-06-10' });
  assert.ok(record.id);
  const records = listRecords(app.id, { entityId: 'transaction' });
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

test('exports app structure by default', async () => {
  const dbPath = join(process.cwd(), 'data', 'test-export.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  createRecord(app.id, 'transaction', { type: '支出', amount: 12, date: '2026-06-10' });
  const payload = await exportAppPayload(app.id);
  assert.equal(payload.manifest.id, 'budget-book');
  assert.equal(payload.sampleData, undefined);
});

test('record no-op updates keep updatedAt stable', () => {
  const dbPath = join(process.cwd(), 'data', 'test-noop-update.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const record = createRecord(app.id, 'transaction', { type: '支出', amount: 42, category: '餐饮', date: '2026-06-10' });
  const updated = updateRecord(record.id, { type: '支出', amount: 42, category: '餐饮', date: '2026-06-10' });

  assert.equal(updated.updatedAt, record.updatedAt);
  assert.deepEqual(updated.data, record.data);
});

test('record updates do not change default list order', () => {
  const dbPath = join(process.cwd(), 'data', 'test-update-order.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(createBudgetPackage());
  const first = createRecord(app.id, 'transaction', { type: '支出', amount: 1, category: '餐饮', date: '2026-06-10' });
  const second = createRecord(app.id, 'transaction', { type: '支出', amount: 2, category: '交通', date: '2026-06-11' });

  updateRecord(first.id, { type: '支出', amount: 100, category: '餐饮', date: '2026-06-10' });
  const records = listRecords(app.id, { entityId: 'transaction' });

  assert.deepEqual(records.map((record) => record.id), [first.id, second.id]);
});
