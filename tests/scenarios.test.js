import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePackageFromPrompt } from '../src/ai/service.js';
import { preparePackage } from '../src/core/packageProtocol.js';
import { allAppTemplates, pickAppTemplate } from '../src/templates/appTemplates.js';

test('explicit template catalog contains at least 50 valid runnable packages', () => {
  const templates = allAppTemplates();
  const names = new Set();
  for (const template of templates) {
    const pkg = preparePackage(template);
    names.add(pkg.manifest.name);
    assert.ok(pkg.schema.entities.length >= 1);
    assert.ok(pkg.ui.pages.some((page) => page.type === 'table' || (page.entity && page.type === 'page')));
  }
  assert.ok(templates.length >= 50);
  assert.ok(names.size >= 50);
  assert.match(pickAppTemplate('创建项目跟踪器').manifest.name, /项目/);
});

test('production AI generation never substitutes a template when unconfigured', async () => {
  await assert.rejects(() => generatePackageFromPrompt('创建项目跟踪器', {}), /配置 AI API Key/);
});
