import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serveStatic } from '../src/routes/_helpers.js';

const page = readFileSync(new URL('../public/rules/ai-config.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const helpers = readFileSync(new URL('../src/routes/_helpers.js', import.meta.url), 'utf8');
const rulePages = readFileSync(new URL('../public/rules/pages.js', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../public/rules/rule-repository.js', import.meta.url), 'utf8');
const simulatorView = readFileSync(new URL('../public/rules/simulation-view.js', import.meta.url), 'utf8');
const simulator = readFileSync(new URL('../public/rules/rule-simulator.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../src/services/rule-engine.js', import.meta.url), 'utf8');
const runtimeRoutes = readFileSync(new URL('../src/routes/runtime.js', import.meta.url), 'utf8');

test('M2 rule configuration, list and detail routes are wired as SPA pages', () => {
  assert.match(app, /location\.pathname === '\/rules\/ai-config'/);
  assert.match(app, /location\.pathname === '\/rules'/);
  assert.match(app, /ruleDetailMatch/);
  assert.match(helpers, /const isRuleSpaRoute = pathname === '\/rules'/);
  assert.ok(helpers.indexOf("pathname === '/rules'") < helpers.indexOf("const filePath = resolve"), 'SPA rule routes must be handled before the public/rules directory');
});

test('M2 direct rule URLs serve the SPA shell even though public/rules is a directory', () => {
  for (const pathname of ['/rules', '/rules/', '/rules/example-id']) {
    let status;
    let body = '';
    const response = {
      writeHead(value) { status = value; },
      end(value) { body = String(value); }
    };
    serveStatic(response, pathname);
    assert.equal(status, 200);
    assert.match(body, /<div id="app">/);
  }
});

test('rule JavaScript and CSS assets are served as static files, not the SPA shell', () => {
  for (const [pathname, expected] of [['/rules/ai-config.js', /renderAiRuleConfig/], ['/rules/pages.css', /\.rules-main/]]) {
    let status;
    let body = '';
    const response = {
      writeHead(value) { status = value; },
      end(value) { body = String(value); }
    };
    serveStatic(response, pathname);
    assert.equal(status, 200);
    assert.match(body, expected);
    assert.doesNotMatch(body, /<div id="app">/);
  }
});

test('M1 page exposes the required mock configuration journey', () => {
  assert.match(page, /出库确认后自动扣库存，库存不足不能出库/);
  assert.match(page, /AI 帮我配置/);
  assert.match(page, /AI 理解结果/);
  assert.match(page, /什么时候执行？/);
  assert.match(page, /需要检查什么？/);
  assert.match(page, /要做什么？/);
  assert.match(page, /Schema Mapping/);
  assert.match(page, /MOCK 匹配结果/);
  assert.match(simulatorView, /库存充足模拟/);
  assert.match(simulatorView, /库存不足模拟/);
  assert.match(page, /查看 Contract/);
  assert.match(page, /保存规则/);
});

test('M2 saves the required generated rule fields without runtime calls', () => {
  assert.match(page, /type: 'record\.updated'/);
  assert.match(page, /operation: 'decrease'/);
  assert.match(page, /message: '库存不足，无法出库'/);
  assert.match(page, /idempotency/);
  assert.match(page, /sourceText/);
  assert.match(page, /businessIntentJson/);
  assert.match(page, /schemaMappingJson/);
  assert.match(page, /contractJson/);
  assert.match(page, /ruleRepository\.createRule/);
  assert.doesNotMatch(page, /api\(/);
  assert.match(page, /不会执行或扣减真实库存/);
});

test('M2 exposes rule list, detail, formatted contract and all statuses', () => {
  assert.match(rulePages, /规则列表/);
  assert.match(rulePages, /用户原始输入/);
  assert.match(rulePages, /AI 理解结果/);
  assert.match(rulePages, /Schema Mapping/);
  assert.match(rulePages, /Contract JSON/);
  assert.match(rulePages, /JSON\.stringify\(value, null, 2\)/);
  assert.match(rulePages, /draft: '草稿'/);
  assert.match(rulePages, /active: '已启用'/);
  assert.match(rulePages, /disabled: '已停用'/);
});

test('M2 repository has replaceable persistence CRUD boundary', () => {
  assert.match(repository, /class LocalStorageRuleRepository/);
  assert.match(repository, /listRules\(\)/);
  assert.match(repository, /getRule\(id\)/);
  assert.match(repository, /createRule\(input\)/);
  assert.match(repository, /updateRule\(id, input\)/);
  assert.match(repository, /deleteRule\(id\)/);
});

test('M3 simulator is shown before save and on saved rule details', () => {
  assert.match(page, /renderRuleSimulation\(CONTRACT/);
  assert.ok(page.indexOf('renderRuleSimulation(CONTRACT') < page.indexOf("class: 'save-rule-area'"));
  assert.match(rulePages, /renderRuleSimulation\(rule\.contractJson/);
  assert.match(simulatorView, /库存充足模拟/);
  assert.match(simulatorView, /库存不足模拟/);
  assert.match(simulatorView, /执行步骤/);
  assert.match(simulatorView, /before \/ after/);
});

test('M3 simulator has no API or runtime integration', () => {
  assert.match(simulator, /simulateRule\(contractJson, sampleData\)/);
  assert.match(simulator, /Contract 缺少必要字段，无法模拟/);
  assert.doesNotMatch(simulator, /fetch\(|api\(|localStorage|inventory\.adjust\(/);
});

test('M4 exposes the generic Contract Interpreter and Rule Runs development entry', () => {
  for (const type of ['read.records', 'aggregate.sum', 'condition', 'update.field', 'block', 'log.run']) {
    assert.match(engine, new RegExp(type.replace('.', '\\.')));
  }
  assert.match(runtimeRoutes, /parts\[3\] === 'rules'.*parts\[4\] === 'execute'/s);
  assert.match(runtimeRoutes, /parts\[3\] === 'rule-runs'/);
  assert.match(rulePages, /开发调试入口/);
  assert.match(rulePages, /真实执行日志 \/ Rule Runs/);
  assert.match(rulePages, /规则名称 \/ ruleId/);
  assert.match(rulePages, /模拟触发真实执行/);
});

test('M4 engine does not hardcode inventory business or execute arbitrary JavaScript', () => {
  assert.doesNotMatch(engine, /stock_out|stock_out_items|products|inventory\.adjust|iPhone|AirPods/);
  assert.doesNotMatch(engine, /\beval\s*\(|new Function|node:vm/);
  assert.match(engine, /step\.entity/);
  assert.match(engine, /step\.field/);
  assert.match(engine, /\['set', 'increment', 'decrement'\]\.includes\(step\.operation\)/);
});
