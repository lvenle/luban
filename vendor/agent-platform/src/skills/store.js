import { parse, stringify } from 'yaml';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile, copyFile, chmod } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createZip, extractArchive } from './archive.js';
import { parseSkillDoc, compareVersions, VERSION_PATTERN, SKILL_ID_PATTERN } from './skill-format.js';

const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'bundled');
const BUNDLED_SOURCE = '内置';
const BUNDLED_MANIFEST = '.bundled.json';
const META_FILE = '.meta.json';
const VERSIONS_DIR = '.versions';
const MANIFEST_FILE = 'manifest.json';

const validId = id => SKILL_ID_PATTERN.test(id || '');
const safeRelative = path => typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') &&
  !path.split('/').some(part => !part || part === '.' || part === '..' || part === META_FILE || part === VERSIONS_DIR || part === '.lock');
const MAX_FILE = 200_000, MAX_TOTAL = 2_000_000, MAX_FILES = 100;

const PACKAGE_EXCLUDED = new Set([META_FILE, VERSIONS_DIR, BUNDLED_MANIFEST, '.lock']);
function normalizedSkillId(value) {
  const id = String(value || '').split('/').at(-1).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return /^[a-z0-9]/.test(id) ? id : '';
}

async function plain(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('技能不支持符号链接或特殊文件。');
  if (!directory && info.size > MAX_FILE) throw new Error('技能单个文件不能超过 200 KB。');
}

async function checkedPath(root, path) {
  if (!safeRelative(path)) throw new Error('技能文件路径无效。');
  await plain(root, true);
  const parts = path.split('/'); let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]); await plain(current, index < parts.length - 1);
  }
  return current;
}

export class SkillStore {
  constructor(workspace, { inheritGlobal = true, resolveExecutable = null, environment = () => process.env } = {}) {
    this.workspace = workspace; this.root = join(workspace, '.skills'); this.globalRoot = join(dirname(workspace), '.skills');
    this.inheritGlobal = inheritGlobal;
    this.resolveExecutable = resolveExecutable;
    this.environment = environment;
  }

  async prepare() {
    try { await plain(this.root, true); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { if (!this.inheritGlobal) throw Error('Instance-local skills only'); await plain(this.globalRoot, true); this.root = this.globalRoot; }
      catch { await mkdir(this.root, { recursive: true, mode: 0o700 }); }
    }
    await plain(this.root, true);
    await this.seedBundled();
  }

  // 内置技能只播种一次：已播种过的（用户可能已修改/删除）不再覆盖；用户自装了同名技能的不覆盖。
  async seedBundled() {
    let bundled = [];
    try { bundled = (await readdir(BUNDLED_DIR, { withFileTypes: true })).filter(e => e.isDirectory() && validId(e.name)).map(e => e.name).sort(); }
    catch { return; }
    if (!bundled.length) return;
    let manifest = [];
    try { const raw = JSON.parse(await readFile(join(this.root, BUNDLED_MANIFEST), 'utf8')); if (Array.isArray(raw)) manifest = raw.filter(id => typeof id === 'string'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const seeded = new Set(manifest);
    let changed = false;
    for (const id of bundled) {
      if (seeded.has(id)) continue;
      try { await plain(join(this.root, id), true); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await this.copyTree(join(BUNDLED_DIR, id), join(this.root, id));
        await writeFile(join(this.root, id, META_FILE), JSON.stringify({ status: 'published', debugTarget: 'live', updatedAt: new Date().toISOString() }, null, 2));
        // 内置技能开箱即用：以 v1.0 发布为不可变版本。
        await this.publish(id, 'v1.0', { note: '内置技能初始版本' });
      }
      seeded.add(id); changed = true;
    }
    if (changed) await writeFile(join(this.root, BUNDLED_MANIFEST), JSON.stringify([...seeded].sort(), null, 2));
  }

  async copyTree(source, target) {
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const item of await readdir(source, { withFileTypes: true })) {
      const from = join(source, item.name), to = join(target, item.name);
      if (item.isDirectory()) await this.copyTree(from, to);
      else if (item.isFile()) { await plain(from); await copyFile(from, to); }
    }
  }

  /** Copy a complete portable Skill tree, excluding only platform-private state. */
  async copyPackage(source, target) {
    const walk = async (from, to, depth = 0) => {
      if (depth > 12) throw new Error('Skill 目录层级超过限制。');
      await mkdir(to, { recursive: true, mode: 0o700 });
      for (const item of await readdir(from, { withFileTypes: true })) {
        if (PACKAGE_EXCLUDED.has(item.name)) continue;
        const src = join(from, item.name), dst = join(to, item.name);
        if (item.isSymbolicLink()) throw new Error('Skill 包不支持符号链接。');
        if (item.isDirectory()) await walk(src, dst, depth + 1);
        else if (item.isFile()) { await plain(src); await copyFile(src, dst); }
        else throw new Error('Skill 包包含特殊文件。');
      }
    };
    await walk(source, target);
  }

  directory(id) { if (!validId(id)) throw new Error('技能 ID 无效。'); return join(this.root, id); }

  async #readMeta(directory) {
    try {
      const meta = JSON.parse(await readFile(join(directory, META_FILE), 'utf8'));
      if (meta && typeof meta === 'object') return meta;
    } catch {}
    return {};
  }

  async #writeMeta(directory, meta) {
    const tmp = join(directory, `${META_FILE}.${randomUUID()}`);
    try {
      await writeFile(tmp, JSON.stringify(meta, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(tmp, join(directory, META_FILE));
    } finally { await rm(tmp, { force: true }); }
  }

  async #readManifest(directory) {
    try {
      const raw = JSON.parse(await readFile(join(directory, VERSIONS_DIR, MANIFEST_FILE), 'utf8'));
      if (raw && Array.isArray(raw.versions)) return raw;
    } catch {}
    return { versions: [] };
  }

  async #writeManifest(directory, manifest) {
    await mkdir(join(directory, VERSIONS_DIR), { recursive: true, mode: 0o700 });
    const tmp = join(directory, VERSIONS_DIR, `${MANIFEST_FILE}.${randomUUID()}`);
    try {
      await writeFile(tmp, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(tmp, join(directory, VERSIONS_DIR, MANIFEST_FILE));
    } finally { await rm(tmp, { force: true }); }
  }

  /** Read and validate the portable Skill entrypoint. */
  async readDraftPackage(directory) {
    const doc = parseSkillDoc(await readFile(await checkedPath(directory, 'SKILL.md'), 'utf8'));
    return { doc };
  }

  /** Validate a portable Skill package and its resource limits. */
  async validateDraft(id) {
    const directory = this.directory(id);
    const { doc } = await this.readDraftPackage(directory);
    if (doc.id !== id) throw new Error('技能目录与 SKILL.md 的 name 不一致。');
    const files = await this.listFiles(id);
    if (files.length > MAX_FILES) throw new Error('Skill 文件数超过 100 个。');
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) throw new Error('Skill 包总大小超过 2 MB。');
    return { doc };
  }

  async entry(id) {
    const directory = this.directory(id);
    await plain(directory, true);
    const meta = await this.#readMeta(directory);
    const manifest = await this.#readManifest(directory);
    const versions = manifest.versions.map(v => v.version).sort(compareVersions);
    const latest = versions[versions.length - 1] || '';
    let doc;
    try { doc = parseSkillDoc(await readFile(await checkedPath(directory, 'SKILL.md'), 'utf8')); }
    catch { doc = { id, description: '草稿无效', version: '' }; }
    const status = meta.status || (latest ? 'published' : 'draft');
    return {
      id, description: doc.description, version: latest, draftVersion: doc.version || '',
      status, enabled: status !== 'disabled',
      source: (await this.#isBundled(id)) ? BUNDLED_SOURCE : '手动安装',
      versions, latest, debugTarget: meta.debugTarget || 'live',
    };
  }

  async #isBundled(id) {
    try {
      const raw = JSON.parse(await readFile(join(this.root, BUNDLED_MANIFEST), 'utf8'));
      return Array.isArray(raw) && raw.includes(id);
    } catch { return false; }
  }


  async list() {
    await this.prepare(); const entries = [];
    for (const item of (await readdir(this.root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!validId(item.name)) continue;
      try { entries.push(await this.entry(item.name)); }
      catch (error) { entries.push({ id: item.name, description: '技能文件无效', enabled: false, error: error.message, status: 'invalid', versions: [] }); }
    }
    return entries;
  }

  /** 新建草稿：脚手架包结构。 */
  async createDraft(id, { description = '新技能' } = {}) {
    if (!validId(id)) throw new Error('技能 ID 无效。');
    const safeDescription = String(description).replace(/[\r\n]+/g, ' ').slice(0, 200) || '新技能';
    return this.locked(async () => {
      const directory = this.directory(id);
      try { await lstat(directory); throw new Error('同名技能已存在。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const skillMd = '---\n' + stringify({ name: id, description: safeDescription }).trimEnd() + '\n---\n' + `\n# ${safeDescription}\n\n## When to use\n\nDescribe the requests for which this skill is relevant.\n\n## Instructions\n\n1. Understand the user\'s goal and constraints.\n2. Use only capabilities available and authorized in the current environment.\n3. Verify the result and explain any limitations.\n`;
      await writeFile(join(directory, 'SKILL.md'), skillMd, { mode: 0o600 });
      await this.#writeMeta(directory, { status: 'draft', debugTarget: 'draft', updatedAt: new Date().toISOString() });
      return this.entry(id);
    });
  }

  /**
   * 发布不可变版本：草稿 → 调试 → 发布（vX.Y）。发布前做完整校验；
   * 版本目录一经发布不再写入。
   */
  async publish(id, version, { note = '' } = {}) {
    if (!VERSION_PATTERN.test(version || '')) throw new Error('发布版本号须为 vX.Y 格式（如 v2.1）。');
    return this.locked(async () => {
      const directory = this.directory(id);
      await plain(directory, true);
      const { doc } = await this.validateDraft(id);
      const manifest = await this.#readManifest(directory);
      if (manifest.versions.some(v => v.version === version)) throw new Error(`版本 ${version} 已发布（不可变），请使用新的版本号。`);
      const target = join(directory, VERSIONS_DIR, version);
      await this.copyPackage(directory, target);
      // 发布即冻结：去掉写权限，强化不可变。
      const freeze = async dir => {
        for (const item of await readdir(dir, { withFileTypes: true })) {
          const full = join(dir, item.name);
          if (item.isDirectory()) await freeze(full);
          else await chmod(full, 0o400).catch(() => {});
        }
      };
      await freeze(target);
      manifest.versions.push({ version, publishedAt: new Date().toISOString(), note: String(note).slice(0, 200) });
      manifest.versions.sort((a, b) => compareVersions(a.version, b.version));
      await this.#writeManifest(directory, manifest);
      const meta = await this.#readMeta(directory);
      await this.#writeMeta(directory, { ...meta, status: meta.status === 'disabled' ? 'disabled' : 'published', updatedAt: new Date().toISOString() });
      return { id, version, published: true };
    });
  }

  async listVersions(id) {
    const directory = this.directory(id); await plain(directory, true);
    const manifest = await this.#readManifest(directory);
    const versions = manifest.versions.map(v => ({ ...v }));
    const latest = versions.map(v => v.version).sort(compareVersions).pop();
    return versions.map(v => ({ ...v, latest: v.version === latest }));
  }

  /** 读取不可变版本包（运行时解释执行用）。停用状态不影响已发布快照。 */
  async getVersion(id, version) {
    const directory = this.directory(id); await plain(directory, true);
    const manifest = await this.#readManifest(directory);
    if (!manifest.versions.some(v => v.version === version)) throw new Error(`技能版本不存在：${id}@${version}`);
    const versionDir = join(directory, VERSIONS_DIR, version);
    const { doc } = await this.readDraftPackage(versionDir);
    return { id, version, description: doc.description, metadata: doc.metadata, body: doc.body, dir: versionDir };
  }

  /**
   * 解析绑定引用：'latest'（或缺省）→ 最新发布版；显式版本须已发布。
   * 停用不影响快照解析（已发布 Agent 线上不受影响）。
   */
  async resolveBinding(id, versionRef) {
    const directory = this.directory(id); await plain(directory, true);
    const manifest = await this.#readManifest(directory);
    const versions = manifest.versions.map(v => v.version).sort(compareVersions);
    const version = !versionRef || versionRef === 'latest' ? versions[versions.length - 1] : versionRef;
    if (!version) throw new Error(`技能尚未发布任何版本：${id}`);
    return this.getVersion(id, version);
  }

  /**
   * 回滚 = 基于历史建新版本（不删历史）：把历史版本内容恢复为草稿，
   * 用户确认后再 publish 为新版本号。
   */
  async rollback(id, fromVersion) {
    return this.locked(async () => {
      const directory = this.directory(id); await plain(directory, true);
      const pkg = await this.getVersion(id, fromVersion);
      for (const name of await readdir(directory)) if (!PACKAGE_EXCLUDED.has(name) && name !== VERSIONS_DIR) await rm(join(directory, name), { recursive: true, force: true });
      await this.copyPackage(pkg.dir, directory);
      const meta = await this.#readMeta(directory);
      await this.#writeMeta(directory, { ...meta, status: 'draft', debugTarget: 'draft', updatedAt: new Date().toISOString() });
      return { id, fromVersion, draft: true };
    });
  }

  async setDisabled(id, disabled) {
    if (typeof disabled !== 'boolean') throw new Error('启用状态无效。');
    return this.locked(async () => {
      const directory = this.directory(id); await plain(directory, true);
      const meta = await this.#readMeta(directory);
      const manifest = await this.#readManifest(directory);
      const fallback = manifest.versions.length ? 'published' : 'draft';
      await this.#writeMeta(directory, { ...meta, status: disabled ? 'disabled' : (meta.status === 'disabled' ? fallback : (meta.status || fallback)), updatedAt: new Date().toISOString() });
      return { id, disabled };
    });
  }

  /** 兼容旧接口：enable(id, enabled)。 */
  async enable(id, enabled) { return this.setDisabled(id, !enabled); }

  /** 调试状态：可切换测草稿 / 测线上版。 */
  async setDebugTarget(id, target) {
    if (!['draft', 'live'].includes(target)) throw new Error('调试目标须为 draft（测草稿）或 live（测线上版）。');
    return this.locked(async () => {
      const directory = this.directory(id); await plain(directory, true);
      const meta = await this.#readMeta(directory);
      await this.#writeMeta(directory, { ...meta, status: 'debugging', debugTarget: target, updatedAt: new Date().toISOString() });
      return { id, debugTarget: target };
    });
  }

  /**
   * 校验 Agent 绑定：[{ id, version? } | 'skill-id']。
   * 阻断：不存在 / 已停用 / 版本未发布。返回快照归一化后的绑定
   * （Agent 发布时冻结版本号，如 xxx@v2.1）。
   */
  async validateBindings(bindings) {
    const list = Array.isArray(bindings) ? bindings : [];
    const out = [];
    for (const item of list) {
      const binding = typeof item === 'string' ? { id: item } : item;
      if (!binding || !validId(binding.id)) throw new Error(`技能绑定无效：${JSON.stringify(binding)}`);
      const directory = this.directory(binding.id);
      try { await plain(directory, true); } catch { throw new Error(`绑定的技能不存在：${binding.id}`); }
      const meta = await this.#readMeta(directory);
      if ((meta.status || 'draft') === 'disabled') throw new Error(`技能已停用，不可绑定：${binding.id}（请替换后重新发布 Agent）`);
      const pkg = await this.resolveBinding(binding.id, binding.version);
      out.push({ id: binding.id, version: pkg.version });
    }
    return out;
  }

  /**
   * 引用方"可升级"标记：Skill 发新版后，已绑定旧版的引用方显示可升级到最新版。
   */
  async bindingUpgrades(bindings) {
    const list = Array.isArray(bindings) ? bindings : [];
    const out = [];
    for (const item of list) {
      const binding = typeof item === 'string' ? { id: item } : item;
      if (!binding || !validId(binding.id)) continue;
      try {
        const directory = this.directory(binding.id); await plain(directory, true);
        const meta = await this.#readMeta(directory);
        const manifest = await this.#readManifest(directory);
        const versions = manifest.versions.map(v => v.version).sort(compareVersions);
        const latest = versions[versions.length - 1] || '';
        const current = binding.version && versions.includes(binding.version) ? binding.version : latest;
        out.push({ id: binding.id, version: current, latest, disabled: (meta.status || '') === 'disabled',
          upgradable: Boolean(latest && current && compareVersions(latest, current) > 0) });
      } catch { out.push({ id: binding.id, missing: true }); }
    }
    return out;
  }

  async locked(action) {
    await this.prepare(); const lock = join(this.root, '.lock');
    try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('技能正在修改，请稍后重试。'); throw error; }
    try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
  }

  async uninstall(id) {
    return this.locked(async () => { const path = this.directory(id); await plain(path, true); const trash = join(this.root, `.removed-${randomUUID()}`);
      await rename(path, trash); await rm(trash, { recursive: true, force: true }); return { id, removed: true }; });
  }

  async install(source, signal) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('请提供本地技能目录或 GitHub 链接。');
    source = source.trim(); await this.prepare(); const stage = await mkdtemp(join(this.root, '.install-')); let count = 0, total = 0;
    // 支持自然语言安装提示词：从句子中提取 SkillHub 包名或链接。
    const packageMention = source.match(/@[a-z0-9_-]+\/[a-z0-9][a-z0-9_-]+/i)?.[0];
    const skillHubLink = source.match(/https:\/\/skillhub\.cn\/skills\/[^\s)】]+/i)?.[0]?.replace(/[。。，,]+$/, '');
    if (packageMention) source = packageMention;
    else if (skillHubLink) source = skillHubLink;
    const save = async (path, bytes) => { if (signal?.aborted) throw new Error('安装已取消。');
      if (!safeRelative(path) || bytes.length > MAX_FILE || ++count > MAX_FILES || (total += bytes.length) > MAX_TOTAL) throw new Error('技能包超限或包含无效路径（最多 100 文件 / 2 MB）。');
      const target = join(stage, path); await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); };
    try {
      if (source.startsWith('@')) {
        await this.#downloadSkillHub(source, save, signal);
      } else if (/^https:\/\/skillhub\.cn\/skills\//i.test(source)) {
        const match = source.match(/\/skills\/([^/]+)\/([^/?#]+)/i);
        if (!match) throw new Error('SkillHub 链接格式无效。');
        await this.#downloadSkillHub(`@${match[1]}/${match[2]}`, save, signal);
      } else if (source.startsWith('https://')) await this.#downloadGithub(source, save, signal); else await this.#copyLocal(source, save);
      return await this.#finalizeStaged(stage, source, signal);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }

  async #finalizeStaged(stage, source, signal) {
    let skillText;
    try { skillText = await readFile(join(stage, 'SKILL.md'), 'utf8'); }
    catch { throw new Error('技能包缺少 SKILL.md（须在包根目录）。'); }
    // 上传 ZIP、本地目录和远程包统一在解析前规范化 name，避免任一路径遗漏。
    const header = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (header) {
      const metadata = parse(header[1], { maxAliasCount: 20 });
      if (!SKILL_ID_PATTERN.test(metadata?.name || metadata?.id || '')) {
        const id = normalizedSkillId(metadata?.name || metadata?.id || source.split('/').at(-1));
        if (!id) throw new Error('技能 name 无法规范化为合法 Skill ID。');
        metadata.name = id; delete metadata.id;
        skillText = `---\n${stringify(metadata).trimEnd()}\n---\n${skillText.slice(header[0].length)}`;
        await writeFile(join(stage, 'SKILL.md'), skillText, { mode: 0o600 });
      }
    }
    let meta;
    try { meta = parseSkillDoc(skillText); }
    catch (error) {
      const header = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!header) throw error;
      const metadata = parse(header[1], { maxAliasCount: 20 });
      const id = normalizedSkillId(metadata?.name || metadata?.id || source.split('/').at(-1));
      if (!id) throw error;
      metadata.name = id; delete metadata.id;
      skillText = `---\n${stringify(metadata).trimEnd()}\n---\n${skillText.slice(header[0].length)}`;
      await writeFile(join(stage, 'SKILL.md'), skillText, { mode: 0o600 });
      meta = parseSkillDoc(skillText);
    }
    await this.#validateStagedPackage(stage, meta.id);
    const installed = await this.locked(async () => { const target = this.directory(meta.id);
      try { await lstat(target); throw new Error('同名技能已安装，请先卸载后再安装。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (signal?.aborted) throw new Error('安装已取消。'); await rename(stage, target);
      await this.#writeMeta(target, { status: 'draft', debugTarget: 'draft', source, updatedAt: new Date().toISOString() });
      return { id: meta.id, description: meta.description, source, path: target };
    });
    await this.publish(meta.id, 'v1.0', { note: '导入时创建初始版本' });
    return installed;
  }

  async #validateStagedPackage(stage, id) {
    const { doc } = await this.readDraftPackage(stage);
    if (doc.id !== id) throw new Error('技能目录与 SKILL.md 的 name 不一致。');
    let files = 0, total = 0;
    const walk = async dir => { for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name); if (item.isSymbolicLink()) throw new Error('Skill 包不支持符号链接。');
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) { const size = (await stat(path)).size; if (size > MAX_FILE || ++files > MAX_FILES || (total += size) > MAX_TOTAL) throw new Error('技能包超限（最多 100 文件 / 2 MB，单个文件 200 KB）。'); }
      else throw new Error('Skill 包包含特殊文件。');
    } };
    await walk(stage);
  }

  async #downloadSkillHub(packageName, save, signal) {
    if (!/^@[a-z0-9_-]+\/[a-z0-9][a-z0-9_-]+$/i.test(packageName)) throw new Error('SkillHub 技能标识格式无效，应为 @组织/技能名。');
    const timeout = AbortSignal.timeout(60_000), fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    // SkillHub 下载接口会将包转发到对象存储；允许其返回的受控重定向完成下载。
    const response = await globalThis.fetch(`https://api.skillhub.cn/api/v1/download?slug=${encodeURIComponent(packageName)}`, { signal: fetchSignal, redirect: 'follow' });
    if (!response.ok) throw new Error(`SkillHub 下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error('SkillHub 技能包不能超过 5 MB。');
    for (const file of extractArchive(bytes, `${packageName}.zip`)) await save(file.path, file.bytes);
  }

  async upload(bytes, filename, signal) {
    if (!bytes || !bytes.length) throw new Error('上传文件为空。');
    if (bytes.length > 5 * 1024 * 1024) throw new Error('技能包不能超过 5 MB。');
    const files = extractArchive(bytes, filename);
    await this.prepare(); const stage = await mkdtemp(join(this.root, '.install-')); let count = 0, total = 0;
    try {
      for (const f of files) {
        if (signal?.aborted) throw new Error('安装已取消。');
        if (!safeRelative(f.path) || f.bytes.length > MAX_FILE || ++count > MAX_FILES || (total += f.bytes.length) > MAX_TOTAL)
          throw new Error('技能包超限或包含无效路径（最多 100 文件 / 2 MB，单个文件 200 KB）。');
        const target = join(stage, f.path); await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
        await writeFile(target, f.bytes, { flag: 'wx', mode: 0o600 });
      }
      return await this.#finalizeStaged(stage, '上传：' + (filename || '技能包'), signal);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }

  // ---- Portable Skill package file browser ----

  async #assertWritable(id) {
    const directory = this.directory(id); await plain(directory, true);
    return directory;
  }

  async listFiles(id) {
    const directory = this.directory(id); await plain(directory, true);
    const out = [];
    const walk = async (dir, rel) => {
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (PACKAGE_EXCLUDED.has(item.name)) continue;
        const relPath = rel ? rel + '/' + item.name : item.name;
        const full = join(dir, item.name);
        if (item.isDirectory()) { out.push({ path: relPath, isDirectory: true, mtime: (await stat(full)).mtimeMs }); await walk(full, relPath); }
        else if (item.isFile()) { const st = await stat(full); out.push({ path: relPath, isDirectory: false, size: st.size, mtime: st.mtimeMs }); }
      }
    };
    await walk(directory, '');
    return out;
  }

  async searchSkills(query = '', { ids = null, limit = 10 } = {}) {
    const needle = String(query).trim().toLocaleLowerCase();
    const allowed = ids ? new Set(ids) : null;
    const matches = (await this.list()).filter(item => item.enabled && !item.error && (!allowed || allowed.has(item.id))
      && (!needle || `${item.id} ${item.description}`.toLocaleLowerCase().includes(needle)));
    const selected = matches.slice(0, Math.max(1, Math.min(Number(limit) || 10, 20)));
    return Promise.all(selected.map(async ({ id, description, version }) => {
      let body = '';
      try { body = (await this.readSkillFile(id, 'SKILL.md')).text.split(/\r?\n##? /, 2)[1]?.slice(0, 1200) || ''; } catch {}
      return { id, description, version, summary: body.trim() };
    }));
  }

  async readResource(id, version, relPath) {
    if (!safeRelative(relPath)) throw new Error('Skill 资源路径无效。');
    const pkg = await this.resolveBinding(id, version);
    const full = await checkedPath(pkg.dir, relPath);
    const bytes = await readFile(full);
    if (bytes.length > MAX_FILE) throw new Error('Skill 资源超过单文件读取上限。');
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error('binary');
      return { id, version: pkg.version, path: relPath, encoding: 'utf-8', content: text };
    } catch {
      return { id, version: pkg.version, path: relPath, encoding: 'base64', content: bytes.toString('base64') };
    }
  }

  async exportPackage(id, { version = 'draft' } = {}) {
    const directory = this.directory(id); await plain(directory, true);
    let source = directory, selected = 'draft';
    if (version !== 'draft') {
      const pkg = await this.getVersion(id, version);
      source = pkg.dir; selected = pkg.version;
    }
    const entries = [];
    const walk = async (dir, prefix = '') => {
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (PACKAGE_EXCLUDED.has(item.name)) continue;
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (!safeRelative(rel)) throw new Error('Skill 文件路径无效。');
        const full = join(dir, item.name);
        if (item.isSymbolicLink()) throw new Error(`拒绝导出符号链接：${rel}`);
        if (item.isDirectory()) await walk(full, rel);
        else if (item.isFile()) { await plain(full); entries.push({ path: rel, bytes: await readFile(full) }); }
        else throw new Error(`拒绝导出特殊文件：${rel}`);
      }
    };
    await walk(source);
    if (!entries.some(entry => entry.path === 'SKILL.md')) throw new Error('Skill 包缺少 SKILL.md。');
    if (entries.length > MAX_FILES || entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > MAX_TOTAL) throw new Error('Skill 包超过导出限制。');
    return { id, version: selected, filename: `${id}${selected === 'draft' ? '-draft' : `-${selected}`}.zip`, mimeType: 'application/zip', dataBase64: createZip(entries).toString('base64'), files: entries.map(entry => entry.path) };
  }

  async readSkillFile(id, relPath) {
    const directory = this.directory(id);
    const full = await checkedPath(directory, relPath);
    const bytes = await readFile(full);
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('只能查看 UTF-8 文本文件。'); }
    if (text.includes('\0')) throw new Error('只能查看文本文件。');
    return { path: relPath, text };
  }

  /** Compatibility read for product agents that still use the pre-versioned API. */
  async load(id, relPath = 'SKILL.md') {
    await this.prepare();
    const entry = await this.entry(id);
    if (!entry.enabled) throw new Error('该技能已禁用。');
    const resource = await this.readSkillFile(id, relPath);
    return { id, path: relPath, directory: this.directory(id), text: resource.text,
      instruction: '按技能说明使用现有工具完成任务；技能不授予额外权限，不执行安装脚本。' };
  }

  /** Product execution hook: reject disabled skill scripts before launching them. */
  async checkExecution(paths) {
    if (!this.resolveExecutable) return;
    const root = await realpath(this.root);
    for (const path of paths || []) {
      if (!isAbsolute(path)) continue;
      const canonical = await realpath(path).catch(() => null);
      if (!canonical) continue;
      const relativePath = relative(root, canonical);
      const id = relativePath.split('/')[0];
      if (!id || id.startsWith('.') || !validId(id)) continue;
      const entry = await this.entry(id);
      if (!entry.enabled) throw new Error('该技能已禁用');
    }
  }

  async saveSkillFile(id, relPath, content) {
    if (typeof content !== 'string') throw new Error('文件内容无效。');
    if (!safeRelative(relPath)) throw new Error('技能文件路径无效。');
    if (Buffer.byteLength(content) > MAX_FILE) throw new Error('单个文件不能超过 200 KB。');
    return this.locked(async () => {
      const directory = await this.#assertWritable(id);
      const full = join(directory, relPath);
      const resolved = resolve(full);
      if (resolved !== directory && !resolved.startsWith(directory + '/')) throw new Error('技能文件路径无效。');
      await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
      await writeFile(resolved, content, { mode: 0o600 });
      return { path: relPath, ok: true };
    });
  }

  async createFolder(id, relPath) {
    const name = String(relPath || '').trim();
    if (!name || !safeRelative(name) || name === 'SKILL.md') throw new Error('文件夹名称无效。');
    return this.locked(async () => {
      const directory = await this.#assertWritable(id);
      const resolved = resolve(join(directory, name));
      if (resolved !== directory && !resolved.startsWith(directory + '/')) throw new Error('文件夹路径无效。');
      await mkdir(resolved, { recursive: true, mode: 0o700 });
      return { path: name, ok: true };
    });
  }

  async deleteSkillFile(id, relPath) {
    if (relPath === 'SKILL.md' || !safeRelative(relPath)) throw new Error('SKILL.md 不可删除。');
    return this.locked(async () => {
      const directory = await this.#assertWritable(id);
      const parts = relPath.split('/'); let current = directory;
      for (const part of parts) {
        current = join(current, part);
        const info = await lstat(current).catch(() => null);
        if (!info) throw new Error('文件不存在。');
        if (info.isSymbolicLink()) throw new Error('技能不支持符号链接或特殊文件。');
        if (part !== parts[parts.length - 1] && !info.isDirectory()) throw new Error('技能文件路径无效。');
      }
      const resolved = resolve(current);
      if (resolved !== directory && !resolved.startsWith(directory + '/')) throw new Error('技能文件路径无效。');
      const st = await stat(current);
      if (!st.isFile() && !st.isDirectory()) throw new Error('技能不支持符号链接或特殊文件。');
      if (st.isDirectory() && (await readdir(current)).length) throw new Error('文件夹非空，请先清空后再删除。');
      await rm(current, { force: true, recursive: true });
      return { path: relPath, removed: true };
    });
  }

  /** Edit standard Skill metadata while preserving unknown frontmatter fields. */
  async updateMeta(id, patch = {}) {
    return this.locked(async () => {
      const directory = await this.#assertWritable(id);
      const skillPath = await checkedPath(directory, 'SKILL.md');
      const text = await readFile(skillPath, 'utf8');
      const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
      if (!match) throw new Error('SKILL.md 需要 YAML 头部。');
      const data = parse(match[1], { maxAliasCount: 20 });
      if (patch.description !== undefined) {
        if (typeof patch.description !== 'string' || !patch.description.trim() || patch.description.length > 1200)
          throw new Error('描述不能为空且不超过 1200 字符。');
        data.description = patch.description.trim();
      }
      if (patch.version !== undefined) data.version = String(patch.version).slice(0, 32);
      const body = text.slice(match[0].length);
      const tmp = join(directory, `.skill-${randomUUID()}`);
      try {
        await writeFile(tmp, '---\n' + stringify(data).trimEnd() + '\n---\n' + body, { flag: 'wx', mode: 0o600 });
        await rename(tmp, skillPath);
      } finally { await rm(tmp, { force: true }); }
      return this.entry(id);
    });
  }

  async #copyLocal(source, save) {
    const local = source.startsWith('~/') ? join(process.env.HOME, source.slice(2)) : source;
    if (!isAbsolute(local)) throw new Error('本地安装需要绝对路径。'); await plain(local, true); const base = await realpath(local);
    const walk = async directory => { for (const item of await readdir(directory, { withFileTypes: true })) {
      if (['.git', '.svn', 'node_modules', '__pycache__', '.DS_Store'].includes(item.name)) continue;
      const path = join(directory, item.name); await plain(path, item.isDirectory()); if (item.isDirectory()) await walk(path); else await save(relative(base, path), await readFile(path)); } };
    await walk(base);
  }

  async #downloadGithub(source, save, signal) {
    const url = new URL(source);
    if (url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('远程安装仅支持 github.com 仓库或 tree 链接。');
    const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
    if (parts.length < 2 || !parts.every(part => /^[\w.-]+$/.test(part)) || (parts.length > 2 && !['tree', 'blob'].includes(parts[2]))) throw new Error('GitHub 链接格式无效。');
    const [owner, repo] = parts; const ref = parts.length > 2 ? parts[3] : 'HEAD'; if (!ref) throw new Error('GitHub 链接缺少分支。');
    let prefix = parts.slice(4).join('/'); if (parts[2] === 'blob') { if (!prefix.endsWith('SKILL.md')) throw new Error('blob 链接必须指向 SKILL.md'); prefix = prefix.slice(0, -8).replace(/\/$/, ''); }
    const timeout = AbortSignal.timeout(60_000), fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const get = async (target, max) => { const response = await globalThis.fetch(target, { signal: fetchSignal, redirect: 'error', headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`GitHub 下载失败：HTTP ${response.status}`); let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('GitHub 响应过大。'); chunks.push(chunk); } return Buffer.concat(chunks); };
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const tree = JSON.parse((await get(`${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`, 5_000_000)).toString());
    if (tree.truncated) throw new Error('仓库过大，请改用本地技能目录。');
    const files = tree.tree.filter(item => item.type === 'blob' && (!prefix || item.path.startsWith(`${prefix}/`)) && safeRelative(prefix ? item.path.slice(prefix.length + 1) : item.path));
    if (!files.some(item => item.path === `${prefix ? `${prefix}/` : ''}SKILL.md`)) throw new Error('此目录没有 SKILL.md，请提供具体技能目录链接。');
    if (files.length > MAX_FILES || files.reduce((sum, item) => sum + (item.size ?? 0), 0) > MAX_TOTAL || files.some(item => item.size > MAX_FILE || item.mode === '120000')) throw new Error('技能包过大或包含符号链接。');
    for (const file of files) { const blob = JSON.parse((await get(`${api}/git/blobs/${file.sha}`, MAX_FILE * 2)).toString());
      if (blob.encoding !== 'base64') throw new Error('不支持的文件编码。'); await save(prefix ? file.path.slice(prefix.length + 1) : file.path, Buffer.from(blob.content, 'base64')); }
  }
}

export { validId as validSkillId };

/**
 * Read the execution-related metadata used by Agent integrations.
 *
 * The portable document parser remains the single source of truth for the
 * standard fields. This compatibility projection keeps product adapters from
 * reimplementing frontmatter parsing while preserving OpenClaw/Xiaoya-style
 * dependency declarations.
 */
export function skillMetadata(text) {
  const doc = parseSkillDoc(text);
  const meta = doc.metadata?.metadata?.xiaoya ?? doc.metadata?.metadata?.openclaw ?? {};
  const requires = meta?.requires ?? {};
  const bins = requires.bins ?? [];
  const anyBins = requires.anyBins ?? [];
  const os = meta.os ?? [];
  const requiredEnv = requires.env ?? [];
  if ([bins, anyBins, os, requiredEnv].some(values => !Array.isArray(values) || values.some(value => typeof value !== 'string'))) {
    throw new Error('技能依赖声明无效');
  }
  return {
    id: doc.id,
    description: doc.description,
    requirements: {bins, anyBins, os},
    requiredEnv,
  };
}
