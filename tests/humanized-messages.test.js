import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizeMessage } from '../public/common/messages.js';

test('business rule technical errors are converted to user language', () => {
  const message = humanizeMessage('update.field 找不到目标上下文：targets');
  assert.equal(message, '没有找到需要处理的关联数据，请检查关联字段是否已经填写。');
  assert.doesNotMatch(message, /update\.field|targets|上下文/);
});

test('rule contract errors suggest an understandable recovery action', () => {
  const message = humanizeMessage('Contract Step 缺少 id 或 type');
  assert.match(message, /业务规则/);
  assert.match(message, /重新编辑|AI 修复/);
  assert.doesNotMatch(message, /Contract|Step|type/);
});

test('common network and storage errors do not expose infrastructure terms', () => {
  assert.doesNotMatch(humanizeMessage('TypeError: Failed to fetch'), /fetch|TypeError/i);
  assert.doesNotMatch(humanizeMessage('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'), /SQLITE|FOREIGN KEY/i);
});

test('already friendly business messages remain unchanged', () => {
  assert.equal(humanizeMessage('记录已保存。'), '记录已保存。');
});

test('legacy rule logs hide table ids and execution internals', () => {
  assert.equal(humanizeMessage('新增 entity_out 记录'), '已检测到新增记录。');
  assert.equal(humanizeMessage('通过关联字段 entity_out.field_goods 找到 1 条目标记录'), '已找到相关联的数据。');
  assert.equal(humanizeMessage('entity_goods.field_stock 从 135 变为 125'), '目标字段已完成更新。');
  assert.equal(humanizeMessage('执行成功，日志在事务内写入'), '业务处理已完成。');
});
