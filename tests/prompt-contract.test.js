import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serviceJs = readFileSync(new URL('../src/ai/service.js', import.meta.url), 'utf8');
const contractJs = readFileSync(new URL('../src/core/contract.js', import.meta.url), 'utf8');

// ── Export existence ─────────────────────────────────────────────────────

test('formatFieldTypesForPrompt is exported', () => {
  assert.match(serviceJs, /export function formatFieldTypesForPrompt/);
});

test('formatActionTypesForPrompt is exported', () => {
  assert.match(serviceJs, /export function formatActionTypesForPrompt/);
});

test('formatPageTypesForPrompt is exported', () => {
  assert.match(serviceJs, /export function formatPageTypesForPrompt/);
});

test('formatPatchOpsForPrompt is exported', () => {
  assert.match(serviceJs, /export function formatPatchOpsForPrompt/);
});

// ── Helper references contract constants ─────────────────────────────────

test('formatFieldTypesForPrompt reads FIELD_TYPES[id]?.label', () => {
  assert.match(serviceJs, /FIELD_TYPES\[id\]\?\.label/);
});

test('formatActionTypesForPrompt reads ACTION_TYPES[id]?.label', () => {
  assert.match(serviceJs, /ACTION_TYPES\[id\]\?\.label/);
});

test('formatPageTypesForPrompt reads PAGE_TYPES[id]?.label', () => {
  assert.match(serviceJs, /PAGE_TYPES\[id\]\?\.label/);
});

test('formatPatchOpsForPrompt reads PATCH_OPS[id]?.label', () => {
  assert.match(serviceJs, /PATCH_OPS\[id\]\?\.label/);
});

// ── Runtime output verification ──────────────────────────────────────────

test('formatFieldTypesForPrompt produces label(id) for each field type', async () => {
  const { formatFieldTypesForPrompt } = await import('../src/ai/service.js');
  const result = formatFieldTypesForPrompt(['text', 'number', 'select']);
  assert.match(result, /文本\(text\)/);
  assert.match(result, /数字\(number\)/);
  assert.match(result, /单选\(select\)/);
  assert.match(result, /、/); // separator
});

test('formatActionTypesForPrompt produces label(id) for all action types', async () => {
  const { formatActionTypesForPrompt } = await import('../src/ai/service.js');
  const result = formatActionTypesForPrompt();
  assert.match(result, /创建记录\(data\.createRecord\)/);
  assert.match(result, /查询记录\(data\.queryRecords\)/);
  assert.match(result, /导出 CSV\(export\.csv\)/);
});

test('formatPageTypesForPrompt produces page/table/link/dashboard', async () => {
  const { formatPageTypesForPrompt } = await import('../src/ai/service.js');
  const result = formatPageTypesForPrompt();
  assert.match(result, /页面\(page\)/);
  assert.match(result, /数据表\(table\)/);
  assert.match(result, /链接\(link\)/);
  assert.match(result, /看板\(dashboard\)/);
});

test('formatPatchOpsForPrompt produces label(id) for patch ops', async () => {
  const { formatPatchOpsForPrompt } = await import('../src/ai/service.js');
  const ops = ['addEntity', 'addField', 'addPage', 'addAction', 'addSuggestedCommand'];
  const result = formatPatchOpsForPrompt(ops);
  assert.match(result, /添加表\(addEntity\)/);
  assert.match(result, /添加字段\(addField\)/);
  assert.match(result, /添加页面\(addPage\)/);
});

// ── Prompt source does NOT contain unsupported ops ───────────────────────

test('patch prompt does NOT contain updateEntity or removeEntity', () => {
  assert.doesNotMatch(serviceJs, /updateEntity/);
  assert.doesNotMatch(serviceJs, /removeEntity/);
});

test('create prompt references PROMPT_PAGE_TYPES_STR for page types', () => {
  assert.match(serviceJs, /PROMPT_PAGE_TYPES_STR/);
  assert.match(serviceJs, /每张表至少生成一个 table 类型的数据页面/);
});

test('patch prompt references PROMPT_PAGE_TYPES_STR', () => {
  assert.match(serviceJs, /页面类型支持：' \+ PROMPT_PAGE_TYPES_STR/);
});

test('V2 plan prompt references PROMPT_PAGE_TYPES_STR', () => {
  assert.match(serviceJs, /PROMPT_PAGE_TYPES_STR/);
});

test('V2 plan prompt uses formatFieldTypesForPrompt helper', () => {
  assert.match(serviceJs, /formatFieldTypesForPrompt\(V2_PLAN_TYPES\)/);
});

// ── Contract metadata completeness ───────────────────────────────────────

test('contract.js FIELD_TYPES has all metadata flags', () => {
  assert.match(contractJs, /isTextLikeType/);
  assert.match(contractJs, /isChoiceType/);
  assert.match(contractJs, /isRelationType/);
  assert.match(contractJs, /isFormulaType/);
  assert.match(contractJs, /isNumericType/);
  assert.match(contractJs, /isTemporalType/);
  assert.match(contractJs, /isFileLikeType/);
  assert.match(contractJs, /toolAllowed/);
});

// ── Prompt builders are used in actual prompts ───────────────────────────

test('create prompt uses PROMPT_FIELD_TYPES_STR', () => {
  assert.match(serviceJs, /field\.type 只支持：' \+ PROMPT_FIELD_TYPES_STR/);
});

test('create prompt uses PROMPT_ACTION_TYPES_STR', () => {
  assert.match(serviceJs, /actions 中的 type 只支持：' \+ PROMPT_ACTION_TYPES_STR/);
});

test('create prompt uses PROMPT_PAGE_TYPES_STR', () => {
  assert.match(serviceJs, /页面类型支持：' \+ PROMPT_PAGE_TYPES_STR/);
});

test('patch prompt uses PROMPT_PATCH_OPS_STR', () => {
  assert.match(serviceJs, /支持操作：' \+ PROMPT_PATCH_OPS_STR/);
});
