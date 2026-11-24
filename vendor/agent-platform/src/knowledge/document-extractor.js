import {createHash} from 'node:crypto';
import {createSharedCache} from '../content/shared-cache.js';
const documentCache=createSharedCache({maxEntries:32});
import { OfficeParser } from 'officeparser';
import WordExtractor from 'word-extractor';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPPORTED = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function isBase64(value) {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let i = 0; i < value.length - padding; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  for (let i = value.length - padding; i < value.length; i++) if (value.charCodeAt(i) !== 61) return false;
  return true;
}

export async function extractKnowledgeDocument(input) {
  // Preserve parser validation; include the title because it is returned to callers.
  const key=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return documentCache.run(key,()=>parseKnowledgeDocument(input));
}
async function parseKnowledgeDocument({ title, contentBase64 }) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw Error('文件名无效');
  const extension = title.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (!SUPPORTED.has(extension)) throw Error('支持的文档格式：PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX');
  if (typeof contentBase64 !== 'string' || contentBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !isBase64(contentBase64)) throw Error('文件内容无效或超过 10 MB');
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw Error('文件内容无效或超过 10 MB');
  if (['.doc', '.xls', '.ppt'].includes(extension) && !buffer.subarray(0, OLE2_SIGNATURE.length).equals(OLE2_SIGNATURE)) throw Error('文件内容与旧版 Office 格式不匹配，或文件已损坏');
  let content;
  if (extension === '.doc') {
    const document = await new WordExtractor().extract(buffer);
    content = [document.getBody(), document.getFootnotes(), document.getEndnotes()].filter(text => typeof text === 'string' && text.trim()).join('\n\n');
  } else if (['.xls', '.ppt'].includes(extension)) {
    const { OfficeParser: LegacyOfficeParser } = await import('@jose.espana/docstream');
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'agent-platform-office-'));
    try {
      const temporaryFile = join(temporaryDirectory, `upload${extension}`);
      await writeFile(temporaryFile, buffer, { mode: 0o600, flag: 'wx' });
      // Path input selects the known extension directly and avoids a second content-type sniffer.
      const ast = await LegacyOfficeParser.parseOffice(temporaryFile, { outputErrorToConsole: false, extractAttachments: false, ocr: false });
      content = ast.toText();
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } else {
    const ast = await OfficeParser.parseOffice(buffer);
    const result = await ast.to('text', { includeImages: false, textConfig: { preserveLayout: false } });
    content = typeof result === 'string' ? result : result?.value;
  }
  if (typeof content !== 'string' || !content.trim()) throw Error(extension === '.pdf' ? '未提取到文本；如果这是扫描版 PDF，请先进行 OCR 识别' : '未能从文件中提取文本');
  if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw Error('提取的文本超过 2 MB，请拆分文档后导入');
  return { title: title.trim(), content };
}
