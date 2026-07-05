import { h } from '../common/dom.js';
import { api } from '../common/api.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';
import { loadCurrentPageRecords, renderRuntime } from './runtime-actions.js';
import { renderMarkdown, stripLegacyMarkdownStyles } from './Markdown.js';
import { wrapMarkdownSelection, applyMarkdownHeading } from './MarkdownFormatting.js';
import { resolveAiPrompt } from './runtime-ports.js';
import { createMarkdownCodeEditor } from './MarkdownLineNumbers.js';
import { createMarkdownUploadButtons } from './MarkdownUploads.js';

export { renderMarkdown } from './Markdown.js';

const previewTimers = new WeakMap();

export function scheduleMarkdownPreview(cell, entity, record, field) {
  cancelMarkdownPreview(cell);
  previewTimers.set(cell, setTimeout(() => {
    previewTimers.delete(cell);
    openMarkdownPreview(entity, record, field);
  }, 220));
}

export function cancelMarkdownPreview(cell) {
  const timer = previewTimers.get(cell);
  if (timer) clearTimeout(timer);
  previewTimers.delete(cell);
}

export function openMarkdownPreview(entity, record, field) {
  const preview = h('article', { class: 'markdown-preview' });
  preview.innerHTML = renderMarkdown(record.data[field.id]);
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal markdown-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: `${field.label} · 预览` }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      preview,
      h('div', { class: 'modal-footer' }, [
        h('button', {
          text: '编辑',
          onclick: () => {
            backdrop.remove();
            openMarkdownRecordEditor(entity, record, field);
          }
        })
      ])
    ])
  ]);
  document.body.append(backdrop);
}

export function openMarkdownRecordEditor(entity, record, field) {
  const textarea = h('textarea', { class: 'markdown-editor-input', value: stripLegacyMarkdownStyles(record.data[field.id]), placeholder: field.placeholder || '输入 Markdown 内容' });
  const codeEditor = createMarkdownCodeEditor(textarea);
  const preview = h('article', { class: 'markdown-preview' });
  const refreshPreview = () => { preview.innerHTML = renderMarkdown(textarea.value); codeEditor.refresh(); };
  const undoStack = [];
  let previousValue = textarea.value;
  let undoButton = null;
  const syncUndoButton = () => { if (undoButton) undoButton.disabled = undoStack.length === 0; };
  const rememberUndo = (value) => {
    if (undoStack.at(-1) === value) return;
    undoStack.push(value);
    if (undoStack.length > 100) undoStack.shift();
    syncUndoButton();
  };
  refreshPreview();
  textarea.addEventListener('input', () => {
    if (textarea.value !== previousValue) rememberUndo(previousValue);
    previousValue = textarea.value;
    refreshPreview();
  });
  const applyResult = (result) => {
    if (result.value !== textarea.value) rememberUndo(textarea.value);
    textarea.value = result.value;
    previousValue = result.value;
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    refreshPreview();
  };
  const wrapSelection = (prefix, suffix = prefix, placeholder = '文本') => applyResult(wrapMarkdownSelection(
    textarea.value, textarea.selectionStart, textarea.selectionEnd, prefix, suffix, placeholder
  ));
  const heading = h('select', { class: 'markdown-tool-select', title: '标题级别' });
  [['0', '正文'], ['1', '一级标题'], ['2', '二级标题'], ['3', '三级标题'], ['4', '四级标题'], ['5', '五级标题'], ['6', '六级标题']]
    .forEach(([value, text]) => heading.append(h('option', { value, text })));
  heading.addEventListener('change', () => {
    applyResult(applyMarkdownHeading(textarea.value, textarea.selectionStart, textarea.selectionEnd, Number(heading.value)));
    heading.value = '0';
  });
  undoButton = h('button', {
    type: 'button',
    class: 'secondary markdown-tool-button',
    text: '↶',
    title: '撤销',
    disabled: 'disabled',
    onclick: () => {
      if (!undoStack.length) return;
      textarea.value = undoStack.pop();
      previousValue = textarea.value;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      refreshPreview();
      syncUndoButton();
    }
  });
  const aiButton = field.type === 'ai' ? h('button', {
    type: 'button',
    class: 'secondary markdown-tool-button ai-regen',
    text: '⟳ AI',
    title: 'AI 重新生成',
    onclick: async (event) => {
      event.currentTarget.disabled = true;
      const orig = event.currentTarget.textContent;
      event.currentTarget.textContent = '⟳ …';
      try {
        const prompt = resolveAiPrompt(field.aiConfig?.prompt || '', entity, record);
        if (!prompt.trim()) return toast('AI 字段未设置提示词或触发字段为空。');
        const body = await api(`/api/apps/${state.currentApp.id}/ai-field`, {
          method: 'POST', body: JSON.stringify({ recordId: record.id, fieldId: field.id, prompt })
        });
        if (body.result) {
          rememberUndo(textarea.value);
          textarea.value = body.result;
          previousValue = body.result;
          refreshPreview();
        }
      } catch (error) {
        toast(`AI 生成失败：${error.message}`);
      } finally {
        event.currentTarget.disabled = false;
        event.currentTarget.textContent = orig;
      }
    }
  }) : null;

  const tools = h('div', { class: 'markdown-toolbar' }, [
    undoButton,
    heading,
    h('button', { type: 'button', class: 'secondary markdown-tool-button', text: 'B', title: '加粗', onclick: () => wrapSelection('**', '**', '加粗文本') }),
    h('button', { type: 'button', class: 'secondary markdown-tool-button italic', text: 'I', title: '斜体', onclick: () => wrapSelection('*', '*', '斜体文本') }),
    h('button', { type: 'button', class: 'secondary markdown-tool-button strike', text: 'S', title: '删除线', onclick: () => wrapSelection('~~', '~~', '删除线文本') }),
    ...createMarkdownUploadButtons(textarea, (previous) => {
      rememberUndo(previous);
      previousValue = textarea.value;
      refreshPreview();
    }),
    ...(aiButton ? [aiButton] : [])
  ]);
  const editButton = h('button', { type: 'button', class: 'secondary markdown-mode-button active', text: '编辑' });
  const previewButton = h('button', { type: 'button', class: 'secondary markdown-mode-button', text: '预览' });
  const editPane = h('section', { class: 'markdown-editor-pane markdown-modal-pane' }, [codeEditor.element]);
  const previewPane = h('section', { class: 'markdown-preview-pane markdown-modal-pane', hidden: 'hidden' }, [preview]);
  const switchMode = (mode) => {
    const isPreview = mode === 'preview';
    editPane.hidden = isPreview;
    previewPane.hidden = !isPreview;
    editButton.classList.toggle('active', !isPreview);
    previewButton.classList.toggle('active', isPreview);
    tools.hidden = isPreview;
    if (isPreview) refreshPreview();
    else requestAnimationFrame(() => textarea.focus());
  };
  editButton.addEventListener('click', () => switchMode('edit'));
  previewButton.addEventListener('click', () => switchMode('preview'));
  const backdrop = h('div', { class: 'modal-backdrop' }, [
    h('div', { class: 'modal wide-modal markdown-modal' }, [
      h('div', { class: 'toolbar' }, [
        h('h3', { text: `${field.label} · Markdown 编辑器` }),
        h('button', { class: 'ghost', text: '关闭', onclick: () => backdrop.remove() })
      ]),
      h('div', { class: 'markdown-modal-modebar' }, [
        h('div', { class: 'markdown-modal-mode-switch markdown-mode-switch', role: 'group', 'aria-label': 'Markdown 显示模式' }, [editButton, previewButton]),
        tools
      ]),
      h('div', { class: 'markdown-editor-layout markdown-modal-layout' }, [editPane, previewPane]),
      h('div', { class: 'modal-footer' }, [
        h('button', { class: 'secondary', text: '取消', onclick: () => backdrop.remove() }),
        h('button', { text: '保存', onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await api(`/api/apps/${state.currentApp.id}/records/${record.id}`, {
              method: 'PUT', body: JSON.stringify({ data: { ...record.data, [field.id]: textarea.value } })
            });
            backdrop.remove();
            await loadCurrentPageRecords();
            renderRuntime();
          } catch (error) {
            button.disabled = false;
            toast(error.message);
          }
        } })
      ])
    ])
  ]);
  document.body.append(backdrop);
  textarea.focus();
}
