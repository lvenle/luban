import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { state } from '../app-context.js';
import { renderMarkdown, stripLegacyMarkdownStyles } from './Markdown.js';
import { wrapMarkdownSelection, applyMarkdownHeading } from './MarkdownFormatting.js';
import { saveCurrentPackage } from './runtime-actions.js';
import { createMarkdownCodeEditor } from './MarkdownLineNumbers.js';
import { createMarkdownUploadButtons } from './MarkdownUploads.js';

export function renderMarkdownPage(page) {
  const textarea = h('textarea', {
    class: 'markdown-editor-input markdown-file-input',
    value: stripLegacyMarkdownStyles(page.content || ''),
    placeholder: '开始输入 Markdown…',
    spellcheck: 'true'
  });
  const codeEditor = createMarkdownCodeEditor(textarea);
  const preview = h('article', { class: 'markdown-preview markdown-file-preview' });
  const status = h('span', { class: 'markdown-file-status', text: '已保存' });
  let savedValue = textarea.value;
  let saving = false;
  let saveAgain = false;
  let autoSaveTimer = null;

  const refreshPreview = () => { preview.innerHTML = renderMarkdown(textarea.value); };
  const refreshStatus = () => {
    status.textContent = textarea.value === savedValue ? '已保存' : '未保存';
    status.classList.toggle('is-dirty', textarea.value !== savedValue);
  };
  const applyResult = (result) => {
    textarea.value = result.value;
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    codeEditor.refresh();
    refreshPreview();
    refreshStatus();
    scheduleAutoSave();
  };
  const wrapSelection = (prefix, suffix = prefix, placeholder = '文本') => applyResult(
    wrapMarkdownSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd, prefix, suffix, placeholder)
  );
  const save = async ({ silent = false } = {}) => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (saving) {
      saveAgain = true;
      return;
    }
    if (textarea.value === savedValue) return;
    saving = true;
    let succeeded = false;
    status.textContent = '保存中…';
    try {
      const content = textarea.value;
      await saveCurrentPackage((pkg) => {
        const target = pkg.ui.pages.find((item) => item.id === page.id);
        if (target) target.content = content;
      });
      page.content = content;
      savedValue = content;
      succeeded = true;
      refreshStatus();
      if (!silent) toast('Markdown 文件已保存');
    } catch (error) {
      status.textContent = '保存失败';
      status.classList.add('is-dirty');
      toast(error.message);
    } finally {
      saving = false;
      if (saveAgain || (succeeded && textarea.value !== savedValue)) {
        saveAgain = false;
        save({ silent: true });
      }
    }
  };

  const scheduleAutoSave = () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    status.textContent = '等待自动保存…';
    status.classList.add('is-dirty');
    autoSaveTimer = setTimeout(() => save({ silent: true }), 800);
  };

  const heading = h('select', { class: 'markdown-tool-select', title: '标题级别' });
  [['0', '正文'], ['1', '一级标题'], ['2', '二级标题'], ['3', '三级标题'], ['4', '四级标题'], ['5', '五级标题'], ['6', '六级标题']]
    .forEach(([value, text]) => heading.append(h('option', { value, text })));
  heading.addEventListener('change', () => {
    applyResult(applyMarkdownHeading(textarea.value, textarea.selectionStart, textarea.selectionEnd, Number(heading.value)));
    heading.value = '0';
  });
  textarea.addEventListener('input', () => { refreshPreview(); refreshStatus(); scheduleAutoSave(); });
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  refreshPreview();

  const editButton = h('button', { type: 'button', class: 'secondary markdown-mode-button', text: '编辑' });
  const previewButton = h('button', { type: 'button', class: 'secondary markdown-mode-button active', text: '预览' });
  const editPane = h('section', { class: 'markdown-editor-pane markdown-file-pane', hidden: 'hidden' }, [codeEditor.element]);
  const previewPane = h('section', { class: 'markdown-preview-pane markdown-file-pane' }, [preview]);
  const formatToolbar = h('div', { class: 'markdown-toolbar markdown-format-toolbar', hidden: 'hidden' }, [
    heading,
    h('button', { type: 'button', class: 'secondary markdown-tool-button', text: 'B', title: '加粗', onclick: () => wrapSelection('**', '**', '加粗文本') }),
    h('button', { type: 'button', class: 'secondary markdown-tool-button italic', text: 'I', title: '斜体', onclick: () => wrapSelection('*', '*', '斜体文本') }),
    h('button', { type: 'button', class: 'secondary markdown-tool-button strike', text: 'S', title: '删除线', onclick: () => wrapSelection('~~', '~~', '删除线文本') }),
    ...createMarkdownUploadButtons(textarea, () => {
      codeEditor.refresh();
      refreshPreview();
      refreshStatus();
      scheduleAutoSave();
    }),
    h('button', { type: 'button', text: '保存', title: 'Ctrl/⌘ + S', onclick: () => save() })
  ]);
  const switchMode = (mode) => {
    const isPreview = mode === 'preview';
    editPane.hidden = isPreview;
    previewPane.hidden = !isPreview;
    editButton.classList.toggle('active', !isPreview);
    previewButton.classList.toggle('active', isPreview);
    formatToolbar.hidden = isPreview;
    if (isPreview) refreshPreview();
    else requestAnimationFrame(() => textarea.focus());
  };
  editButton.addEventListener('click', () => switchMode('edit'));
  previewButton.addEventListener('click', () => switchMode('preview'));
  const fileNameLabel = h('strong', { class: 'markdown-file-name', text: page.fileName || page.title, title: '双击修改文件名' });
  fileNameLabel.addEventListener('dblclick', () => {
    const input = h('input', { class: 'markdown-file-name-input', value: page.fileName || page.title, 'aria-label': 'Markdown 文件名' });
    fileNameLabel.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (shouldSave) => {
      if (finished) return;
      finished = true;
      if (!shouldSave) {
        input.replaceWith(fileNameLabel);
        return;
      }
      const rawName = input.value.trim().replace(/[\\/]/g, '-');
      if (!rawName) {
        input.replaceWith(fileNameLabel);
        return toast('文件名不能为空。');
      }
      const fileName = rawName;
      try {
        await save({ silent: true });
        while (saving) await new Promise((resolve) => setTimeout(resolve, 20));
        await saveCurrentPackage((pkg) => {
          const target = pkg.ui.pages.find((item) => item.id === page.id);
          if (target) {
            target.fileName = fileName;
            target.title = fileName;
            target.content = textarea.value;
          }
        });
        page.fileName = fileName;
        page.title = fileName;
        savedValue = textarea.value;
        fileNameLabel.textContent = fileName;
        document.querySelector('.page-nav-item.active .menu-item')?.replaceChildren(fileName);
        input.replaceWith(fileNameLabel);
        refreshStatus();
      } catch (error) {
        input.replaceWith(fileNameLabel);
        toast(error.message);
      }
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
  });

  return h('div', { class: 'markdown-file-page', 'data-page-id': page.id }, [
    h('div', { class: 'markdown-file-topbar' }, [
      h('div', { class: 'markdown-file-heading' }, [
        fileNameLabel,
        status
      ]),
      h('div', { class: 'markdown-file-mode-switch markdown-mode-switch', role: 'group', 'aria-label': 'Markdown 显示模式' }, [editButton, previewButton]),
      h('div', { class: 'markdown-file-actions' }, [
        formatToolbar
      ])
    ]),
    h('div', { class: 'markdown-file-layout' }, [editPane, previewPane])
  ]);
}
