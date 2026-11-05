/** Read-only browser audit against an already running, authorized local suite.
 * Usage: UI_SUITE_URL=http://127.0.0.1:5299 node scripts/audit-workspace-ui.mjs
 * No forms are submitted and no model calls are made.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const base = process.env.UI_SUITE_URL;
if (!base) throw Error('Set UI_SUITE_URL to an already running, authorized suite.');
const output = resolve(process.env.UI_AUDIT_OUTPUT || join(tmpdir(), 'workspace-ui-audit'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage();
await page.emulateMedia({ reducedMotion: 'reduce' });
const failures = [], results = [];
page.on('pageerror', error => failures.push({ kind: 'javascript', message: error.message }));
page.on('response', response => {
  if (response.status() >= 400 && new URL(response.url()).pathname.endsWith('.css')) {
    failures.push({ kind: 'stylesheet', url: response.url(), status: response.status() });
  }
});
const pages = [
  ['platform/conversation'], ['platform/prompts'], ['platform/library'],
  ['platform/models', '添加模型'], ['platform/agent'], ['platform/agent/edit?group=custom', '新建 Agent'],
  ['platform/skill', '新建 Skill'], ['platform/knowledge', '新建知识库'],
  ['platform/tool', '新建工具'], ['platform/mcp', '添加 MCP 服务'],
  ['platform/tasks', '新建任务'], ['platform/logs'],
  ['luban/'], ['luban/builder/'], ['luban/builder/settings/assistant'],
  ['luban/builder/settings/system'], ['ai-db/']
];
async function inspect(path, width, state) {
  const geometry = await page.evaluate(() => {
    const rect = node => {
      const { x, y, right, bottom } = node.getBoundingClientRect();
      return { x, y, right, bottom };
    };
    const dialogs = [...document.querySelectorAll('.el-dialog, dialog[open]')]
      .filter(node => node.getBoundingClientRect().width && getComputedStyle(node).visibility !== 'hidden');
    const tinyText = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement;
      if (!node.textContent.trim() || !element || element.closest('script,style')) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if (range.getBoundingClientRect().width && parseFloat(getComputedStyle(element).fontSize) < 14) {
        tinyText.push({ text: node.textContent.trim().slice(0,60), font: getComputedStyle(element).fontSize });
      }
    }
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      bodyFont: getComputedStyle(document.body).fontSize,
      tinyText,
      areaSwitchHidden: !!document.querySelector('.aside .profile-area-entry') && !document.querySelector('.aside .profile-area-entry').getBoundingClientRect().width,
      dialogs: dialogs.map(node => ({ ...rect(node), overflow: node.scrollWidth > node.clientWidth + 2 })),
      title: document.title
    };
  });
  const result = { path, width, state, ...geometry };
  results.push(result);
  if (geometry.overflow || geometry.areaSwitchHidden || geometry.tinyText.length || geometry.dialogs.some(dialog => dialog.x < 0 || dialog.right > width + 1 || dialog.bottom > 902 || dialog.overflow)) failures.push(result);
  await page.screenshot({ path: join(output, `${path.replace(/[^a-zA-Z0-9-]/g, '-')}-${width}-${state}.png`), fullPage: true });
}
try {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, action] of pages) {
      await page.goto(new URL(path, base.endsWith('/') ? base : base + '/').href);
      await page.waitForLoadState('networkidle');
      await inspect(path, width, 'page');
      if (action) {
        const button = page.getByRole('button', { name: action, exact: false }).first();
        if (!await button.count()) { failures.push({ path, width, kind: 'missing-action', action }); continue; }
        await button.click();
        await page.locator('.el-dialog').waitFor({ state: 'visible' });
        await page.waitForTimeout(250);
        await inspect(path, width, 'dialog');
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'report.json'), JSON.stringify({ results, failures }, null, 2));
}
console.log(JSON.stringify({ checks: results.length, failures: failures.length, report: join(output, 'report.json') }));
if (failures.length) process.exitCode = 1;
