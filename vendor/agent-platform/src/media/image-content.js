import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { persistMediaReferences } from './persist-references.js';

/**
 * 大对象只存引用（决策 D1）：把"发给模型看的 base64 data URL"拆成"留文件的图片本体 + 事件里只存引用"。
 *
 * 模型看到的是 base64；事件日志里只存引用。两者通过同一个 path 对应：
 * - 落库前：content 里的 image_url.data URL → image_ref（{type:'image_ref', attachment:{path, mimeType, sha256, bytes, kind, source}}）
 * - 调模型前：image_ref → image_url.data URL（从文件读回 base64，仅在内存）
 *
 * 关键边界：
 * - 字符串 content（提示词纯文本）原样返回。
 * - 数组 content 里其它类型（text / tool_use / tool_result）原样保留。
 * - 一个 content 里同时有 text + image 时，refs 与 base64 parts 的顺序保持一致。
 * - 已存在的 image_url 不是 data URL（例如外部 https URL）原样保留，不强制转 base64。
 */

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.+)$/s;

export function buildImageRefAttachment(attachment, mimeType) {
  return {
    path: String(attachment.path),
    kind: String(attachment.kind || 'image'),
    source: attachment.source ? String(attachment.source) : undefined,
    quality: attachment.quality ? String(attachment.quality) : undefined,
    mimeType: mimeType ? String(mimeType) : undefined
  };
}

/**
 * 从 data URL 同步构造 image_ref。返回 ref 自身及 ref 在 content 数组中的占位信息。
 * 用于一次性把历史事件里的 base64 抽到文件、再更新事件。
 */
export async function imageRefFromDataUrl({ dataUrl, attachment, mimeType, writeFile }) {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new Error('image_url.url 不是 data URL，无法抽取');
  const buffer = Buffer.from(match[2], 'base64');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const path = attachment && attachment.path ? String(attachment.path) : undefined;
  if (writeFile && path) {
    await writeFile(path, buffer);
  }
  return {
    type: 'image_ref',
    attachment: {
      path,
      mimeType: mimeType || match[1] || 'image/png',
      bytes: buffer.length,
      sha256,
      kind: attachment?.kind || 'image',
      source: attachment?.source
    }
  };
}

/**
 * 把 content 里的 image_url.data URL 替换为 image_ref。
 * - content 为字符串：原样返回，无变化。
 * - content 为数组：逐项检查；找到 image_url 且 url 是 data URL 时替换；其它保留。
 * - 返回 { content, refs }，refs 是替换产出的引用列表（用于调用方记录附加到 attachments）。
 */
export function stripImageContentForPersist(content, {directory} = {}) {
  if (typeof content === 'string' || !Array.isArray(content)) return { content, refs: [] };
  const next = [];
  const refs = [];
  for (const part of content) {
    if (part && part.type === 'image_url' && typeof part.image_url?.url === 'string' && DATA_URL_PATTERN.test(part.image_url.url)) {
      if (!directory) throw new Error('持久化内联图片必须提供存储目录');
      const ref = persistMediaReferences(part, directory);
      if (!ref.attachment?.path) throw new Error('图片数据无法持久化');
      next.push(ref);
      refs.push(ref);
    } else {
      next.push(part);
    }
  }
  return { content: next, refs };
}

/**
 * 把 ref 还原成 image_url.data URL，使用传入的 readFile（默认 node:fs/promises.readFile）。
 * 仅在调模型前在内存里完成。
 */
export async function resolveImageRefs(content, reader = readFile) {
  if (!Array.isArray(content)) return content;
  const next = [];
  for (const part of content) {
    if (part && part.type === 'image_ref' && part.attachment && part.attachment.path) {
      const mime = part.attachment.mimeType || 'image/png';
      const base64 = (await reader(part.attachment.path)).toString('base64');
      next.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
    } else {
      next.push(part);
    }
  }
  return next;
}
