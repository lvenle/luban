import {withModernDialogs} from './modern-dialogs.js';
import { readFileSync } from 'node:fs';

/** v18 新版控制台：完整按原型三栏布局重做，旧版 renderPlatformConsole 保留不动。 */
export function renderConsoleV18({ productName, returnPath, apiBase = '/api/agent/v1' } = {}) {
  for (const path of [apiBase, returnPath].filter(x => x !== undefined)) {
    if (typeof path !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(path)) throw Error('Console paths must be safe same-origin paths');
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  let html = readFileSync(new URL('./console-v18.html', import.meta.url), 'utf8');
  html = html.split("fetch('/api/agent/v1'+path").join(`fetch('${apiBase}'+path`)
             .split("fetch('/api/agent/v1' + path").join(`fetch('${apiBase}' + path`);
  if (productName) html = html.replace('Agent 底座·控制台', escape(productName) + ' · 产品实例');
  if (returnPath) html = html.replace('</aside>', `<a style="margin:16px" href="${returnPath}">返回产品</a></aside>`);
  return withModernDialogs(html);
}
/** One page for standalone and product hosts. Paths are same-origin only. */
export function renderPlatformConsole({ productName, returnPath, apiBase = '/api/agent/v1' } = {}) {
  for (const path of [apiBase, returnPath].filter(x => x !== undefined)) {
    if (typeof path !== 'string' || !/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(path)) throw Error('Console paths must be safe same-origin paths');
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  let html = readFileSync(new URL('./console.html', import.meta.url), 'utf8');
  html = html.replace("fetch('/api/agent/v1'+path", `fetch('${apiBase}'+path`);
  if (productName) html = html.replace('独立运行 / 产品共用服务', escape(productName) + ' · 产品实例');
  if (returnPath) html = html.replace('</header>', `<a style="margin-left:20px" href="${returnPath}">返回产品</a></header>`);
  return withModernDialogs(html);
}
