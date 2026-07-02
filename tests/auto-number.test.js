import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { resetDbForTests } from '../src/storage/db.js';
import { createAppFromPackage, getApp } from '../src/models/app.js';
import { createRecord, deleteRecord, getRecord, updateRecord } from '../src/models/record.js';
import { createFieldInApp, updateFieldInApp } from '../src/services/operations.js';

function appPackage(fields) {
  return {
    manifest: { id: 'auto-number-test', name: '自增序号测试' },
    schema: { entities: [{ id: 'orders', name: '订单', fields }] },
    ui: { pages: [{ id: 'orders-list', title: '订单', type: 'table', entity: 'orders' }] },
    actions: { actions: [] }
  };
}

function freshDb(name) {
  const path = join(process.cwd(), 'data', `test-auto-number-${name}.sqlite`);
  rmSync(path, { force: true });
  resetDbForTests(path);
}

test('auto number defaults to 1 and increments by 1 while ignoring supplied values', () => {
  freshDb('defaults');
  const app = createAppFromPackage(appPackage([
    { id: 'serial', label: '序号', type: 'autoNumber' },
    { id: 'name', label: '名称', type: 'text' }
  ]));
  const first = createRecord(app.id, 'orders', { serial: '手工编号', name: '第一条' });
  const second = createRecord(app.id, 'orders', { name: '第二条' });
  assert.equal(first.data.serial, '1');
  assert.equal(second.data.serial, '2');

  updateRecord(first.id, { ...first.data, serial: '999', name: '已修改' });
  assert.equal(getRecord(first.id).data.serial, '1');
});

test('custom start, step and prefix backfill existing rows and never reuse deleted values', () => {
  freshDb('custom');
  let app = createAppFromPackage(appPackage([{ id: 'name', label: '名称', type: 'text' }]));
  const oldOne = createRecord(app.id, 'orders', { name: '旧记录一' });
  const oldTwo = createRecord(app.id, 'orders', { name: '旧记录二' });

  app = createFieldInApp(app, 'orders', {
    id: 'order_no', label: '订单编号', type: 'autoNumber',
    autoNumber: { start: 10, step: 5, prefix: 'RK-' }
  });
  assert.equal(getRecord(oldOne.id).data.order_no, 'RK-10');
  assert.equal(getRecord(oldTwo.id).data.order_no, 'RK-15');

  const third = createRecord(app.id, 'orders', { name: '第三条' });
  assert.equal(third.data.order_no, 'RK-20');
  deleteRecord(third.id);
  const fourth = createRecord(app.id, 'orders', { name: '第四条' });
  assert.equal(fourth.data.order_no, 'RK-25');

  app = getApp(app.id);
  updateFieldInApp(app, 'orders', 'order_no', { autoNumber: { start: 100, step: 2, prefix: 'NEW-' } });
  const fifth = createRecord(app.id, 'orders', { name: '第五条' });
  assert.equal(fifth.data.order_no, 'NEW-30');
});

test('a populated normal field cannot be converted into an auto number field', () => {
  freshDb('conversion');
  const app = createAppFromPackage(appPackage([{ id: 'name', label: '名称', type: 'text' }]));
  createRecord(app.id, 'orders', { name: '已有内容' });
  assert.throws(
    () => updateFieldInApp(app, 'orders', 'name', { type: 'autoNumber', autoNumber: { start: 1, step: 1, prefix: '' } }),
    /已有数据，不能直接修改类型|已有数据，不能直接改为自增序号/
  );
});
