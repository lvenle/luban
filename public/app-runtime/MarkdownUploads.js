import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';

function safeMarkdownLabel(name) {
  return String(name || '附件').replace(/\\/g, '\\\\').replace(/([\[\]])/g, '\\$1');
}

function insertUpload(textarea, file, kind, onInsert) {
  const previousValue = textarea.value;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const label = safeMarkdownLabel(file.name);
  const markdown = kind === 'image' ? `![${label}](${file.url})` : `[${label}](${file.url})`;
  textarea.value = `${previousValue.slice(0, start)}${markdown}${previousValue.slice(end)}`;
  const cursor = start + markdown.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  onInsert(previousValue);
}

function createUploadButton({ textarea, kind, onInsert }) {
  const isImage = kind === 'image';
  const button = h('button', {
    type: 'button',
    class: 'secondary markdown-upload-button',
    text: isImage ? '图片' : '附件',
    title: isImage ? '上传图片' : '上传附件'
  });
  button.addEventListener('click', () => {
    const input = h('input', { type: 'file', accept: isImage ? 'image/*' : undefined });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (isImage && !file.type.startsWith('image/')) return toast('请选择图片文件。');
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = '上传中…';
      try {
        const params = new URLSearchParams({ name: file.name });
        const body = await api(`/api/apps/${state.currentApp.id}/uploads?${params.toString()}`, {
          method: 'POST',
          body: await file.arrayBuffer(),
          headers: { 'content-type': file.type || 'application/octet-stream' }
        });
        insertUpload(textarea, body.file, kind, onInsert);
        toast(isImage ? '图片已插入' : '附件已插入');
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
    input.click();
  });
  return button;
}

export function createMarkdownUploadButtons(textarea, onInsert) {
  return [
    createUploadButton({ textarea, kind: 'image', onInsert }),
    createUploadButton({ textarea, kind: 'attachment', onInsert })
  ];
}
