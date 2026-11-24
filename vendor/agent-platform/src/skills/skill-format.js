import { parse } from 'yaml';

export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const VERSION_PATTERN = /^v\d+\.\d+$/;

/** Parse a portable Agent Skills entrypoint and preserve arbitrary YAML metadata. */
export function parseSkillDoc(text) {
  const match = String(text ?? '').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('SKILL.md 需要 YAML 头部（name / description，version 可选）。');
  let metadata;
  try { metadata = parse(match[1], { maxAliasCount: 20 }); }
  catch (error) { throw new Error(`SKILL.md 头部解析失败：${error.message}`); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('SKILL.md 头部须为 YAML 对象。');
  const id = metadata.name || metadata.id;
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : metadata.description;
  if (!SKILL_ID_PATTERN.test(id || '')) throw new Error('技能 name 应为小写英文、数字、短横线或下划线（最多 64 字符）。');
  if (typeof description !== 'string' || !description || description.length > 1200) throw new Error('技能 description 不能为空且不超过 1200 字符。');
  const version = metadata.version == null ? '' : String(metadata.version).slice(0, 32);
  return { id, description, version, metadata, body: String(text).slice(match[0].length) };
}

export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** Agent Skill bindings intentionally contain identity and version only. */
export function normalizeBinding(binding) {
  const value = typeof binding === 'string' ? { id: binding } : binding || {};
  if (!SKILL_ID_PATTERN.test(value.id || '')) throw new Error(`技能绑定无效：${JSON.stringify(binding)}`);
  return { id: value.id, version: value.version || 'latest' };
}
