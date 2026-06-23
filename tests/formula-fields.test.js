import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { calculateFormulaFields, compileFormula, evaluateFormulaField } from '../src/core/formula.js';
import { resetDbForTests, getDb, getPackageFromApp } from '../src/storage/db.js';
import { createAppFromPackage, updateAppPackage } from '../src/models/app.js';
import { createRecord, listRecords, updateRecord } from '../src/models/record.js';
import { deleteFieldInApp, updateFieldInApp } from '../src/services/operations.js';

const entity = {
  id: 'line',
  name: '明细',
  fields: [
    { id: 'price', label: '单价', type: 'number' },
    { id: 'quantity', label: '数量', type: 'number' },
    { id: 'name', label: '名称', type: 'text' },
    { id: 'start', label: '开始日期', type: 'date' }
  ]
};

test('formula engine evaluates operators, comparisons, text, dates, and functions', () => {
  assert.equal(evaluate('{单价} * {数量} + 100', 'number'), 130);
  assert.equal(evaluate('IF({数量} >= 3, ROUND({单价} / 3, 2), 0)', 'number'), 3.33);
  assert.equal(evaluate('CONCAT(UPPER({名称}), "-", LEN({名称}))', 'text'), 'ABC-3');
  assert.equal(evaluate('DATEDIFF(DATEADD({开始日期}, 10), {开始日期})', 'number'), 10);
  assert.equal(evaluate('MAX(ABS(-5), MIN(10, 3))', 'number'), 5);
  assert.equal(evaluate('TODAY()', 'date', { now: new Date('2026-06-21T16:30:00Z') }), '2026-06-22');
});

test('formula engine supports logical operators in nested quadrant IF formulas', () => {
  const quadrantEntity = {
    id: 'task', name: '任务', fields: [
      { id: 'urgency', label: '紧急程度', type: 'select', options: [{ id: 'urgent', label: '紧急' }, { id: 'not-urgent', label: '不紧急' }] },
      { id: 'importance', label: '重要程度', type: 'select', options: [{ id: 'important', label: '重要' }, { id: 'not-important', label: '不重要' }] }
    ]
  };
  const expression = 'IF({紧急程度}="紧急" && {重要程度}="重要", "第一象限-重要且紧急", IF({紧急程度}="不紧急" && {重要程度}="重要", "第二象限-重要不紧急", IF({紧急程度}="紧急" && {重要程度}="不重要", "第三象限-紧急不重要", "第四象限-不紧急不重要")))';
  const field = { id: 'quadrant', label: '象限', type: 'formula', formula: { expression, resultType: 'text' } };
  assert.equal(evaluateFormulaField(field, quadrantEntity, { urgency: '紧急', importance: '重要' }), '第一象限-重要且紧急');
  assert.equal(evaluateFormulaField(field, quadrantEntity, { urgency: '不紧急', importance: '重要' }), '第二象限-重要不紧急');
  assert.equal(evaluateFormulaField(field, quadrantEntity, { urgency: '紧急', importance: '不重要' }), '第三象限-紧急不重要');
  assert.equal(evaluateFormulaField(field, quadrantEntity, { urgency: '不紧急', importance: '不重要' }), '第四象限-不紧急不重要');
  assert.equal(evaluateFormulaField({ ...field, formula: { ...field.formula, expression: expression.replaceAll('&&', '&amp;&amp;') } }, quadrantEntity, { urgency: '紧急', importance: '重要' }), '第一象限-重要且紧急');
  const calculated = calculateFormulaFields({ ...quadrantEntity, fields: [...quadrantEntity.fields, field] }, { urgency: 'urgent', importance: 'important' });
  assert.equal(calculated.data.quadrant, '第一象限-重要且紧急');
  assert.deepEqual(calculated.formulaErrors, {});
});

test('formula engine rejects unsafe syntax and unsupported dependencies', () => {
  assert.throws(() => compileFormula('globalThis.process.exit()', entity), /不支持的函数|不支持的字符/);
  assert.throws(() => compileFormula('{不存在} + 1', entity), /找不到字段/);
  assert.throws(() => compileFormula('{关联}', { ...entity, fields: [...entity.fields, { id: 'rel', label: '关联', type: 'relation' }] }), /不能引用关联字段/);
});

test('formula values are calculated on read and never stored', () => {
  const dbPath = join(process.cwd(), 'data', 'test-formula-fields.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const app = createAppFromPackage(formulaPackage());
  const created = createRecord(app.id, 'line', { price: 10, quantity: 3, total: 999, name: 'abc', start: '2026-06-01' });
  assert.equal(created.data.total, 130);
  const stored = JSON.parse(getDb().prepare('SELECT dataJson FROM records WHERE id = ?').get(created.id).dataJson);
  assert.equal('total' in stored, false);
  const updated = updateRecord(created.id, { ...created.data, price: 20 });
  assert.equal(updated.data.total, 160);
  assert.equal(listRecords(app.id)[0].data.total, 160);
});

test('formula errors are isolated and source field dependencies are protected', () => {
  const dbPath = join(process.cwd(), 'data', 'test-formula-errors.sqlite');
  rmSync(dbPath, { force: true });
  resetDbForTests(dbPath);
  const pkg = formulaPackage();
  pkg.schema.entities[0].fields.find((field) => field.id === 'total').formula.expression = '{单价} / {数量}';
  const app = createAppFromPackage(pkg);
  const record = createRecord(app.id, 'line', { price: 10, quantity: 0 });
  assert.equal(record.data.total, null);
  assert.match(record.formulaErrors.total, /除以 0/);
  assert.throws(() => deleteFieldInApp(app, 'line', 'price'), /公式正在引用/);
  assert.throws(() => updateFieldInApp(app, 'line', 'price', { type: 'text' }), /公式正在引用/);
  const renamed = updateFieldInApp(app, 'line', 'price', { label: '价格' });
  assert.match(renamed.schema.entities[0].fields.find((field) => field.id === 'total').formula.expression, /\{价格\}/);
  const directPackage = getPackageFromApp(renamed);
  directPackage.schema.entities[0].fields.find((field) => field.id === 'price').type = 'text';
  assert.throws(() => updateAppPackage(renamed.id, directPackage), /公式正在引用/);
});

function evaluate(expression, resultType, options = {}) {
  const field = { id: 'formula', label: '公式', type: 'formula', formula: { expression, resultType } };
  return evaluateFormulaField(field, entity, { price: 10, quantity: 3, name: 'abc', start: '2026-06-01' }, options);
}

function formulaPackage() {
  return {
    manifest: { id: 'formula-test', name: '公式测试' },
    schema: { entities: [{ ...structuredClone(entity), fields: [
      ...structuredClone(entity.fields),
      { id: 'total', label: '总价', type: 'formula', formula: { expression: '{单价} * {数量} + 100', resultType: 'number' } }
    ] }] },
    ui: { pages: [{ id: 'line-list', title: '明细', type: 'list', entity: 'line' }] },
    actions: { actions: [] },
    prompts: { suggestedCommands: [] }
  };
}
