import test from 'node:test';
import assert from 'node:assert/strict';
import { entityDisplayName } from '../public/common/entity-display.js';

test('data table display name follows its title in the page list', () => {
  const app = {
    schema: { entities: [{ id: 'orders', name: '内部订单实体' }] },
    ui: { pages: [
      { id: 'orders-detail', entity: 'orders', navKind: 'page', title: '订单详情' },
      { id: 'orders-table', entity: 'orders', navKind: 'table', title: '销售订单' }
    ] }
  };
  assert.equal(entityDisplayName(app, 'orders'), '销售订单');
  assert.equal(entityDisplayName(app, app.schema.entities[0]), '销售订单');
});

test('data table display name supports legacy pages and entity fallback', () => {
  const legacyApp = {
    schema: { entities: [{ id: 'customers', name: '客户' }] },
    ui: { pages: [{ id: 'customers-page', entity: 'customers', type: 'list', title: '客户档案' }] }
  };
  assert.equal(entityDisplayName(legacyApp, 'customers'), '客户档案');
  assert.equal(entityDisplayName({ schema: legacyApp.schema, ui: { pages: [] } }, 'customers'), '客户');
});
