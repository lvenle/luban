import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePackageFromPrompt, generatePatchFromPrompt } from '../src/ai/service.js';
import { applyPatch, preparePackage } from '../src/core/packageProtocol.js';
import { allSamplePackages } from '../src/ai/samplePackages.js';

const GENERATION_SCENARIOS = allSamplePackages().map((pkg) => `帮我创建一个${pkg.manifest.name}，${pkg.manifest.description}`);

test('generates valid runnable packages for at least 50 demand scenarios', async () => {
  const names = new Set();
  for (const prompt of GENERATION_SCENARIOS) {
    const pkg = preparePackage(await generatePackageFromPrompt(prompt, {}));
    names.add(pkg.manifest.name);
    assert.ok(pkg.schema.entities.length >= 1, prompt);
    assert.ok(pkg.schema.entities[0].fields.length >= 4, prompt);
    assert.ok(pkg.ui.pages.some((page) => page.type === 'list'), prompt);
    assert.ok(pkg.actions.actions.length >= 1, prompt);
  }
  assert.ok(GENERATION_SCENARIOS.length >= 50);
  assert.ok(names.size >= 50);
});

test('fallback modifier supports common natural-language app changes', async () => {
  const base = preparePackage(await generatePackageFromPrompt('帮我创建一个项目跟踪器', {}));
  const changes = [
    '增加负责人字段',
    '增加优先级字段',
    '增加金额字段',
    '增加完成日期',
    '增加备注字段',
    '增加状态统计页面',
    '增加导出功能',
    '增加 AI 总结分析'
  ];
  let current = base;
  for (const change of changes) {
    const patch = await generatePatchFromPrompt(change, current, {});
    current = applyPatch(current, patch);
  }
  const fields = current.schema.entities[0].fields.map((field) => field.id);
  assert.ok(fields.includes('owner'));
  assert.ok(fields.includes('priority'));
  assert.ok(fields.includes('amount'));
  assert.ok(current.ui.pages.some((page) => page.type === 'chart'));
  assert.ok(current.actions.actions.some((action) => action.type === 'export.csv'));
  assert.ok(current.actions.actions.some((action) => action.type === 'ai.generateText'));
});
