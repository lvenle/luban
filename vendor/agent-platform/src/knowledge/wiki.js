import { embeddingFromEnvironment, vectorSearch } from './vector-index.js';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

function normalizedRelative(path) {
  const clean = String(path ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0];
  if (!clean || clean.includes('\\')) throw new Error('Invalid Wiki path');
  return clean.startsWith('wiki/') ? clean : `wiki/${clean}`;
}

/** 解析 YAML frontmatter 子集：标量与列表。返回 {meta, body, has}。 */
export function parseFrontmatter(text) {
  const source = String(text ?? '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: source, has: false };
  const meta = {};
  let currentKey = null;
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(item[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const value = kv[2].trim();
      meta[currentKey] = value === '' ? [] : value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: source.slice(match[0].length), has: true };
}

export function extractWikilinks(content) {
  const out = [];
  for (const match of String(content ?? '').matchAll(/\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g)) {
    const target = match[1].trim();
    if (target) out.push({ target, label: (match[2] || match[1]).trim() });
  }
  return out;
}

export function resolveWikilink(target) {
  try { return normalizedRelative(target); } catch { return null; }
}

/** 页面摘要（确定性提取，不编造）：优先取模型生成的"## 摘要"节内容，
 * 否则取正文（去 frontmatter 后）的首个非标题段落，超长截断。 */
export function extractPageSummary(content, maxChars = 300) {
  let { body } = parseFrontmatter(String(content ?? ''));
  body = body.replace(/<!doctype[^>]*>/gi, ' ').replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/section|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\r/g, '');
  const lines = body.split('\n');
  let text = '';
  const summaryStart = lines.findIndex(l => /^##\s*摘要\s*$/.test(l.trim()));
  if (summaryStart >= 0) {
    const collected = [];
    for (let i = summaryStart + 1; i < lines.length; i += 1) {
      if (/^#{1,6}\s/.test(lines[i].trim())) break;
      collected.push(lines[i]);
    }
    text = collected.join('\n').trim();
  }
  if (!text) {
    const collected = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t && collected.length) break;
      if (!t || t.startsWith('#') || /^(文档类型|依据|整理日期|来源索引)\s*[：:]/.test(t)) continue;
      collected.push(t);
      if (collected.join(' ').length >= maxChars) break;
    }
    text = collected.join(' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** Use the document's own heading as its knowledge-page title when available. */
export function extractPageTitle(content, fallback = '') {
  const { body, meta } = parseFrontmatter(String(content ?? ''));
  const heading = body.split('\n').map(line => line.match(/^#\s+(.+?)\s*#*\s*$/)?.[1]?.trim()).find(Boolean);
  if (heading) return heading;
  const htmlTitle = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/<[^>]+>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot);/g, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[entity]).trim();
  if (htmlTitle) return htmlTitle;
  if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim();
  return String(fallback || '').trim();
}

export function extractPageConcepts(content) {
  const { body } = parseFrontmatter(String(content ?? ''));
  const lines = body.split('\n');
  const start = lines.findIndex(line => /^##\s*关键概念\s*$/.test(line.trim()));
  if (start >= 0) {
    const collected = [];
    for (let i = start + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i].trim()); i += 1) collected.push(lines[i]);
    const concepts = collected.join('\n').split(/[、，,;；\n]+/).map(value => value.replace(/^\s*[-*\d.)、]+\s*/, '').trim()).filter(value => value && value !== '（无）');
    if (concepts.length) return [...new Set(concepts)].slice(0, 12);
  }
  const markdownHeadings = [...body.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map(match => match[1].trim());
  const htmlHeadings = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi)].map(match => match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim());
  const candidates = (markdownHeadings.length > 1 ? markdownHeadings : htmlHeadings).filter(value => !/^(原文|摘要|关键概念|目录|来源索引)$/.test(value));
  return [...new Set(candidates)].slice(0, 8);
}

/** 解析 log.md 的可解析时序记录：`- [ISO时间] 动作 明细`。 */
export function parseLogEntries(text) {
  const entries = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = line.match(/^-\s*\[([^\]]+)\]\s+(\S+)\s*(.*)$/);
    if (match) entries.push({ time: match[1], action: match[2], detail: match[3].trim() });
  }
  return entries.reverse();
}

function searchTerms(query) {
  const value = String(query ?? '').toLowerCase().replace(/是什么|什么是|什么|请问|介绍一下|解释一下|如何|怎么|为什么|怎样|有哪些/g, ' ');
  const terms = new Set(value.match(/[a-z0-9]{2,}/g) ?? []);
  for (const run of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let index = 0; index + size <= run.length; index += 1) terms.add(run.slice(index, index + size));
    }
  }
  return [...terms].slice(0, 80);
}

const SPECIAL_PAGES = ['wiki/index.md', 'wiki/overview.md', 'wiki/log.md', 'wiki/purpose.md'];

export class WikiStore {
  constructor(root, { maxPageBytes = 200_000, maxGroundingBytes = 400_000, embedding = embeddingFromEnvironment(), vectorCacheDirectory, onRetrievalError } = {}) {
    if (typeof root !== 'string' || !root) throw new TypeError('Wiki root is required');
    this.root = resolve(root);
    this.embedding = embedding;
    this.vectorCacheDirectory = vectorCacheDirectory;
    this.onRetrievalError = onRetrievalError;
    this.maxPageBytes = maxPageBytes;
    this.maxGroundingBytes = maxGroundingBytes;
  }

  async catalog() {
    let purpose = null;
    try { purpose = await this.#readRelative('wiki/purpose.md'); } catch { /* 旧版本可能没有 */ }
    return {
      index: await this.#readRelative('wiki/index.md'),
      overview: await this.#readRelative('wiki/overview.md'),
      purpose,
      pages: await this.listPages(),
      summaries: await this.pageIndex()
    };
  }

  /** 页面摘要：路径/标题/类型，供目录树使用。 */
  async pageIndex() {
    const out = [];
    for (const path of await this.listPages()) {
      let content = '';
      try { content = await this.#readRelative(path); } catch { continue; }
      const { meta } = parseFrontmatter(content);
      const title = extractPageTitle(content, path);
      out.push({ path, title, type: typeof meta.type === 'string' ? meta.type : '', summary: extractPageSummary(content), concepts: extractPageConcepts(content) });
    }
    return out;
  }

  /** 内容页：wiki/sources 与 wiki/concepts 下的 Markdown。 */
  async listPages() {
    const out = [];
    for (const directory of ['wiki/sources', 'wiki/concepts']) {
      let entries = [];
      try { entries = await readdir(resolve(this.root, directory), { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; continue; }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) out.push(`${directory}/${entry.name}`);
      }
    }
    return out.sort();
  }

  async read(path) {
    const normalized = normalizedRelative(path);
    if (!normalized.endsWith('.md')) throw new Error('Only Wiki Markdown pages can be read');
    return { path: normalized, content: await this.#readRelative(normalized) };
  }

  /** 读取版本内的任意受控文件（raw/sources、wiki、schema 下的文本）。 */
  async readAny(relativePath) {    const clean = String(relativePath ?? '');
    if (!clean || clean.includes('\\') || clean.startsWith('/') ||
      clean.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid Wiki path');
    }
    if (!/^(raw|wiki|schema)\//.test(clean) || !/\.(md|txt)$/i.test(clean)) throw new Error('Invalid Wiki path');
    return { path: clean, content: await this.#readRelative(clean) };
  }

  /** 读不到返回 null（用于 index.md 等可选文件）。 */
  async readOptional(relativePath) {
    try { return (await this.readAny(relativePath)).content; }
    catch { return null; }
  }

  async search(query, { limit = 8 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid search limit');
    if (!String(query ?? '').trim()) {
      this.retrievalStatus = { mode: 'keyword', reason: 'empty-query' };
      return [];
    }
    const terms = searchTerms(query);
    const ranked = [];
    const documents = [];
    for (const path of await this.listPages()) {
      const content = await this.#readRelative(path);
      const { meta, body } = parseFrontmatter(content);
      documents.push({ path, title: extractPageTitle(content, path), body });
      const lower = `${typeof meta.title === 'string' ? meta.title : ''}\n${body}`.toLowerCase();
      const score = terms.reduce((sum, term) =>
        sum + (lower.split(term).length - 1) * Math.min(term.length, 4), 0);
      if (score) {
        const fallbackTitle = body.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() || path;
        ranked.push({
          path,
          score,
          title: typeof meta.title === 'string' && meta.title ? meta.title : fallbackTitle,
          preview: body.trim().slice(0, 800)
        });
      }
    }
    ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    this.retrievalStatus = { mode: 'keyword', reason: this.embedding ? null : 'embedding-not-configured' };
    if (!this.embedding) return ranked.slice(0, limit);
    try {
      const semantic = await vectorSearch(this.root, documents, String(query), {
        embedding: this.embedding, cacheDirectory: this.vectorCacheDirectory, limit: Math.max(32, limit * 4)
      });
      const fused = new Map();
      for (const [kind, hits] of [['keyword', ranked], ['vector', semantic]]) {
        hits.forEach((hit, index) => {
          const entry = fused.get(hit.path) || { ...hit, score: 0, retrieval: [] };
          entry.score += 1 / (60 + index + 1);
          entry.retrieval.push(kind);
          if (kind === 'vector') entry.distance = hit.distance;
          fused.set(hit.path, entry);
        });
      }
      this.retrievalStatus = { mode: 'hybrid', keywordMatches: ranked.length, vectorMatches: semantic.length };
      return [...fused.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
    } catch (error) {
      this.retrievalStatus = { mode: 'keyword', reason: 'vector-unavailable' };
      this.onRetrievalError?.(error);
      return ranked.slice(0, limit);
    }
  }

  async grounding(query, { limit = 3, maxPages = 8 } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 30) throw Error('Invalid page budget');
    const catalog = await this.catalog();
    const matches = await this.search(query, { limit });
    const pages = [];
    let usedBytes = Buffer.byteLength(catalog.index) + Buffer.byteLength(catalog.overview);
    if (usedBytes > this.maxGroundingBytes) throw Error('Wiki catalog exceeds grounding budget');
    const queue = matches.map(match => match.path), seen = new Set(), allowed = new Set(catalog.pages);
    let truncated = false;
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      if (pages.length >= maxPages) { truncated = true; break; }
      const page = await this.read(path);
      const bytes = Buffer.byteLength(page.content);
      if (usedBytes + bytes > this.maxGroundingBytes) { truncated = true; continue; }
      pages.push(page);
      usedBytes += bytes;
      for (const link of extractWikilinks(page.content)) {
        const target = resolveWikilink(link.target);
        // Only catalogued source pages can extend grounding; no filesystem traversal.
        if (target && allowed.has(target) && !seen.has(target)) queue.push(target);
      }
    }
    return {
      index: catalog.index,
      overview: catalog.overview,
      pages,
      matched: matches.length,
      retrieval: this.retrievalStatus,
      truncated
    };
  }

  async #readRelative(path) {
    const candidate = resolve(this.root, path);
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${sep}`)) {
      throw new Error('Wiki path escapes its root');
    }
    let current = this.root;
    for (const part of relative(this.root, candidate).split(sep)) {
      current = resolve(current, part);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Wiki paths cannot contain symbolic links');
    }
    const bytes = await readFile(candidate);
    if (bytes.length > this.maxPageBytes) throw new Error(`Wiki page exceeds limit: ${relative(this.root, candidate)}`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error(`Wiki page is not UTF-8: ${relative(this.root, candidate)}`); }
    if (text.includes('\0')) throw new Error('Wiki page contains invalid data');
    return text;
  }
}

/**
 * Lint：检查 Wiki 健康度。返回 issues 数组，每项：
 * {rule, level: 'error'|'warning', page, message, fixable, fixHint}
 * 规则：dead-link 死链 / orphan-page 孤立页面 / missing-frontmatter 缺头部 /
 *       not-in-index 目录未收录 / empty-page 空页面 / conflict 标题冲突（需人工裁决）
 */
export async function lintWiki(root) {
  const store = new WikiStore(root);
  const issues = [];
  const pages = [];
  const contents = new Map();
  for (const path of await store.listPages()) {
    let content = '';
    try { content = (await store.read(path)).content; } catch { /* 读失败记空页面 */ }
    contents.set(path, content);
    const { meta, body, has } = parseFrontmatter(content);
    const links = extractWikilinks(content).map(l => resolveWikilink(l.target)).filter(Boolean);
    const title = typeof meta.title === 'string' && meta.title ? meta.title
      : (body.split('\n').find(l => l.trim()) || '').replace(/^#\s*/, '').trim() || path;
    pages.push({ path, title, meta, links, hasFrontmatter: has });
  }
  const known = new Set(pages.map(p => p.path));
  let indexContent = await store.readOptional('wiki/index.md') || '';
  const indexLinks = new Set(extractWikilinks(indexContent).map(l => resolveWikilink(l.target)).filter(Boolean));
  const outLinks = new Map(), inCount = new Map();
  for (const page of pages) {
    const outs = new Set(page.links.filter(t => known.has(t) && t !== page.path));
    outLinks.set(page.path, outs);
    for (const target of outs) inCount.set(target, (inCount.get(target) || 0) + 1);
  }
  for (const page of pages) {
    const content = contents.get(page.path) || '';
    const bodyText = parseFrontmatter(content).body.trim();
    if (!bodyText) {
      issues.push({ rule: 'empty-page', level: 'warning', page: page.path, message: `「${page.title}」内容为空`, fixable: false, fixHint: '补充内容或删除该页面' });
    }
    if (!page.hasFrontmatter) {
      issues.push({ rule: 'missing-frontmatter', level: 'warning', page: page.path, message: `「${page.title}」缺少 YAML 头部（title/type/sources）`, fixable: true, fixHint: '自动补上最小头部' });
    }
    // 冲突策略（冻结 mark-both）：标题冲突的页面双方均保留，进检查视图人工裁决，不自动修复
    if (String(page.meta.conflict).toLowerCase() === 'true') {
      const rawSource = Array.isArray(page.meta.sources) && page.meta.sources.length ? String(page.meta.sources[0]) : null;
      const manualMatch = rawSource ? rawSource.match(/^raw\/sources\/manual\/([^/]+)\.md$/) : null;
      issues.push({
        rule: 'conflict', level: 'error', page: page.path,
        message: `「${page.title}」存在标题冲突：多个来源使用了相同标题，双方均已保留，请人工裁决`,
        fixable: false, fixHint: '删除其中一个来源，或修改手动导入资料的标题后重新构建',
        rawSource, manualImportId: manualMatch ? manualMatch[1] : null
      });
    }
    for (const link of page.links) {
      if (!known.has(link) && !SPECIAL_PAGES.includes(link)) {
        issues.push({ rule: 'dead-link', level: 'error', page: page.path, message: `「${page.title}」引用了不存在的页面 [[${link}]]`, fixable: true, fixHint: '移除失效引用（保留文字）', target: link });
      }
    }
    if (!indexLinks.has(page.path)) {
      issues.push({ rule: 'not-in-index', level: 'warning', page: page.path, message: `「${page.title}」未被目录（index.md）收录`, fixable: true, fixHint: '自动追加到目录' });
    }
    const degree = (outLinks.get(page.path)?.size || 0) + (inCount.get(page.path) || 0);
    if (degree === 0) {
      issues.push({ rule: 'orphan-page', level: 'warning', page: page.path, message: `「${page.title}」是孤立页面：没有引用其他页面，也没有被引用`, fixable: false, fixHint: '在相关页面中添加 [[wikilink]] 建立关联' });
    }
  }
  return issues;
}

/**
 * 知识图谱：Wiki 页面链接关系的可视化视图，不独立维护，边完全由 [[wikilink]] 派生。
 * 输入 pages: [{path,title,type,sources[],links[],summary}]（links 已解析为路径）。
 * 返回 {nodes, edges, communities, insights}。
 * nodes 含 summary（页面摘要）与 sources（来源回链），供节点详情展示。
 */
export function buildGraphData(pages) {
  const nodes = pages.map(p => ({
    path: p.path, title: p.title, type: p.type || '',
    sources: [...new Set(p.sources || [])],
    summary: typeof p.summary === 'string' ? p.summary : '',
    pagePaths: [...new Set(p.pagePaths || (p.pagePath ? [p.pagePath] : []))]
  }));
  const byPath = new Map(nodes.map(n => [n.path, n]));
  const adjacency = new Map(nodes.map(n => [n.path, new Set()]));
  const weight = new Map(); // key: a|b → {a, b, weight, signals:{direct}}
  for (const p of pages) {
    if (!byPath.has(p.path)) continue;
    for (const target of new Set(p.links || [])) {
      if (target === p.path || !byPath.has(target)) continue;
      const a = p.path < target ? p.path : target;
      const b = p.path < target ? target : p.path;
      const k = `${a}|${b}`;
      let entry = weight.get(k);
      if (!entry) { entry = { a, b, weight: 0, signals: { direct: 0 } }; weight.set(k, entry); }
      entry.weight += 1;
      entry.signals.direct += 1;
      adjacency.get(p.path).add(target);
      adjacency.get(target).add(p.path);
    }
  }
  const edges = [...weight.values()]
    .filter(e => e.weight > 0)
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  // 社区：标签传播（确定性顺序）
  const labels = new Map(nodes.map(n => [n.path, n.path]));
  const ordered = nodes.map(n => n.path).sort();
  for (let round = 0; round < 20; round += 1) {
    let changed = false;
    for (const path of ordered) {
      const scores = new Map();
      for (const [a, b, w] of edges.flatMap(e => [[e.a, e.b, e.weight], [e.b, e.a, e.weight]])) {
        if (a !== path) continue;
        const label = labels.get(b);
        scores.set(label, (scores.get(label) || 0) + w);
      }
      if (!scores.size) continue;
      let best = labels.get(path), bestScore = scores.get(best) || 0;
      for (const [label, score] of [...scores.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
        if (score > bestScore) { best = label; bestScore = score; }
      }
      if (best !== labels.get(path)) { labels.set(path, best); changed = true; }
    }
    if (!changed) break;
  }
  const communities = new Map();
  for (const n of nodes) {
    const label = labels.get(n.path);
    if (!communities.has(label)) communities.set(label, []);
    communities.get(label).push(n.path);
  }
  const communityList = [...communities.values()]
    .map(members => {
      const set = new Set(members);
      const internal = edges.filter(e => set.has(e.a) && set.has(e.b)).length;
      const possible = members.length * (members.length - 1) / 2;
      return { members: members.sort(), size: members.length, cohesion: possible ? Math.round(internal / possible * 100) / 100 : 0 };
    })
    .sort((a, b) => b.size - a.size);
  const nodeCommunity = new Map();
  communityList.forEach((c, index) => c.members.forEach(p => nodeCommunity.set(p, index)));
  const degree = new Map(nodes.map(n => [n.path, 0]));
  for (const e of edges) { degree.set(e.a, degree.get(e.a) + 1); degree.set(e.b, degree.get(e.b) + 1); }
  // 洞察
  const isolated = nodes.filter(n => degree.get(n.path) <= 1).map(n => n.path).sort();
  const sparse = communityList
    .filter(c => c.cohesion < 0.15 && c.size >= 3)
    .map((c, i) => ({ id: i, size: c.size, cohesion: c.cohesion, members: c.members }));
  const bridges = nodes.filter(n => {
    const touched = new Set();
    for (const e of edges) {
      if (e.a === n.path) touched.add(nodeCommunity.get(e.b));
      if (e.b === n.path) touched.add(nodeCommunity.get(e.a));
    }
    return touched.size >= 3;
  }).map(n => n.path).sort();
  const surprising = edges
    .filter(e => nodeCommunity.get(e.a) !== nodeCommunity.get(e.b))
    .slice(0, 5)
    .map(e => ({ a: e.a, b: e.b, weight: e.weight }));
  return {
    nodes: nodes.map(n => ({ ...n, degree: degree.get(n.path), community: nodeCommunity.get(n.path) })),
    edges,
    communities: communityList,
    insights: { isolated, sparse, bridges, surprising }
  };
}

export { searchTerms };
