import { h } from '../common/dom.js';
import { toast } from '../common/toast.js';
import { saveCurrentPackage } from './runtime-actions.js';
import { createMarkdownCodeEditor } from './MarkdownLineNumbers.js';

function escapeSource(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightTag(token) {
  if (token.startsWith('<!--')) return `<span class="html-token-comment">${escapeSource(token)}</span>`;
  if (/^<!doctype/i.test(token)) return `<span class="html-token-doctype">${escapeSource(token)}</span>`;
  const match = token.match(/^(<\/?)([\w:-]+)([\s\S]*?)(\/?>)$/);
  if (!match) return escapeSource(token);
  const [, opening, name, attributes, closing] = match;
  let highlightedAttributes = '';
  let cursor = 0;
  const attributePattern = /([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
  for (const attribute of attributes.matchAll(attributePattern)) {
    highlightedAttributes += escapeSource(attributes.slice(cursor, attribute.index));
    highlightedAttributes += `<span class="html-token-attribute">${escapeSource(attribute[1])}</span>`;
    highlightedAttributes += `<span class="html-token-punctuation">${escapeSource(attribute[2])}</span>`;
    highlightedAttributes += `<span class="html-token-value">${escapeSource(attribute[3])}</span>`;
    cursor = attribute.index + attribute[0].length;
  }
  highlightedAttributes += escapeSource(attributes.slice(cursor));
  return `<span class="html-token-punctuation">${escapeSource(opening)}</span><span class="html-token-tag">${escapeSource(name)}</span>${highlightedAttributes}<span class="html-token-punctuation">${escapeSource(closing)}</span>`;
}

function highlightTokens(source, pattern, classify) {
  let output = '';
  let cursor = 0;
  for (const token of source.matchAll(pattern)) {
    output += escapeSource(source.slice(cursor, token.index));
    output += `<span class="${classify(token[0])}">${escapeSource(token[0])}</span>`;
    cursor = token.index + token[0].length;
  }
  return output + escapeSource(source.slice(cursor));
}

function highlightJavaScript(source) {
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield)\b|\b\d+(?:\.\d+)?\b/g;
  return highlightTokens(source, pattern, (token) => {
    if (token.startsWith('//') || token.startsWith('/*')) return 'html-token-js-comment';
    if (/^["'`]/.test(token)) return 'html-token-js-string';
    if (/^\d/.test(token)) return 'html-token-number';
    return 'html-token-js-keyword';
  });
}

function highlightCss(source) {
  const pattern = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[0-9a-fA-F]{3,8}\b|@[\w-]+|--[\w-]+|[\w-]+(?=\s*:)|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms|deg)?\b|!important\b/g;
  return highlightTokens(source, pattern, (token) => {
    if (token.startsWith('/*')) return 'html-token-css-comment';
    if (/^["']/.test(token)) return 'html-token-css-string';
    if (token.startsWith('#') || /^\d/.test(token)) return 'html-token-number';
    if (token.startsWith('@') || token === '!important') return 'html-token-css-keyword';
    if (token.startsWith('--')) return 'html-token-css-variable';
    return 'html-token-css-property';
  });
}

export function highlightHtmlSource(source) {
  const input = String(source || '');
  const pattern = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[A-Za-z][^>]*>/gi;
  let output = '';
  let cursor = 0;
  let embeddedLanguage = '';
  for (const token of input.matchAll(pattern)) {
    const plainSource = input.slice(cursor, token.index);
    output += embeddedLanguage === 'script'
      ? highlightJavaScript(plainSource)
      : embeddedLanguage === 'style'
        ? highlightCss(plainSource)
        : escapeSource(plainSource);
    output += highlightTag(token[0]);
    const tag = token[0].match(/^<\/?\s*([\w:-]+)/)?.[1]?.toLowerCase();
    const isClosing = /^<\//.test(token[0]);
    if (isClosing && tag === embeddedLanguage) embeddedLanguage = '';
    else if (!isClosing && (tag === 'script' || tag === 'style') && !/\/>$/.test(token[0])) embeddedLanguage = tag;
    cursor = token.index + token[0].length;
  }
  const tail = input.slice(cursor);
  output += embeddedLanguage === 'script' ? highlightJavaScript(tail) : embeddedLanguage === 'style' ? highlightCss(tail) : escapeSource(tail);
  return `${output}\n`;
}

export function renderHtmlPage(page) {
  const textarea = h('textarea', {
    class: 'html-editor-input',
    value: page.content || '',
    placeholder: '输入完整的 HTML 页面源码…',
    spellcheck: 'false'
  });
  const codeEditor = createMarkdownCodeEditor(textarea);
  const syntaxHighlight = h('pre', { class: 'html-syntax-highlight', 'aria-hidden': 'true' });
  const syntaxEditor = h('div', { class: 'html-syntax-editor' }, [syntaxHighlight]);
  codeEditor.element.replaceChild(syntaxEditor, textarea);
  syntaxEditor.append(textarea);
  const createPreviewFrame = (pending = false) => h('iframe', {
    class: `html-file-preview${pending ? ' is-pending' : ''}`,
    title: `${page.title || '网页'}预览`,
    sandbox: 'allow-scripts allow-forms allow-modals allow-popups'
  });
  let activePreview = createPreviewFrame();
  const previewPane = h('section', { class: 'html-preview-pane' }, [activePreview]);
  const status = h('span', { class: 'markdown-file-status', text: '已保存' });
  let renderedPreviewContent = null;
  let requestedPreviewContent = null;
  let pendingPreview = null;
  let savedValue = textarea.value;
  let saving = false;
  let saveAgain = false;
  let autoSaveTimer = null;
  let previewWarmTimer = null;

  const refreshSyntaxHighlight = () => { syntaxHighlight.innerHTML = highlightHtmlSource(textarea.value); };
  const refreshPreview = () => {
    const content = textarea.value;
    if (renderedPreviewContent === content) {
      requestedPreviewContent = content;
      pendingPreview?.remove();
      pendingPreview = null;
      return;
    }
    if (requestedPreviewContent === content && pendingPreview) return;
    requestedPreviewContent = content;
    pendingPreview?.remove();
    pendingPreview = null;
    if (renderedPreviewContent === null) {
      renderedPreviewContent = content;
      activePreview.srcdoc = content;
      return;
    }
    const nextPreview = createPreviewFrame(true);
    pendingPreview = nextPreview;
    previewPane.append(nextPreview);
    nextPreview.addEventListener('load', () => {
      if (pendingPreview !== nextPreview || requestedPreviewContent !== content) {
        nextPreview.remove();
        return;
      }
      activePreview.remove();
      nextPreview.classList.remove('is-pending');
      activePreview = nextPreview;
      pendingPreview = null;
      renderedPreviewContent = content;
    }, { once: true });
    nextPreview.srcdoc = content;
  };
  const warmPreview = () => {
    if (previewWarmTimer) clearTimeout(previewWarmTimer);
    previewWarmTimer = setTimeout(refreshPreview, 220);
  };
  const refreshStatus = () => {
    status.textContent = textarea.value === savedValue ? '已保存' : '未保存';
    status.classList.toggle('is-dirty', textarea.value !== savedValue);
  };
  const save = async ({ silent = false } = {}) => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (saving) {
      saveAgain = true;
      return;
    }
    if (textarea.value === savedValue) return;
    saving = true;
    status.textContent = '保存中…';
    let succeeded = false;
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
      if (!silent) toast('网页已保存');
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

  textarea.addEventListener('input', () => {
    codeEditor.refresh();
    refreshSyntaxHighlight();
    refreshStatus();
    warmPreview();
    scheduleAutoSave();
  });
  textarea.addEventListener('scroll', () => {
    syntaxHighlight.scrollTop = textarea.scrollTop;
    syntaxHighlight.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
  refreshSyntaxHighlight();
  refreshPreview();

  const editButton = h('button', { type: 'button', class: 'secondary markdown-mode-button', text: '编辑' });
  const previewButton = h('button', { type: 'button', class: 'secondary markdown-mode-button active', text: '预览' });
  const openWindowButton = h('button', {
    type: 'button',
    class: 'secondary markdown-mode-button html-open-window-button',
    text: '新窗口打开',
    title: '在新窗口中打开当前网页',
    onclick: async () => {
      const appId = location.pathname.match(/^\/app\/([^/]+)/)?.[1] || new URLSearchParams(location.search).get('app') || '';
      if (!appId) return toast('无法确定当前软件，暂时不能打开预览。');
      const url = `/html-preview/${encodeURIComponent(decodeURIComponent(appId))}/${encodeURIComponent(page.id)}`;
      const needsRefresh = textarea.value !== savedValue;
      const previewWindow = window.open(url, '_blank');
      if (!previewWindow) return toast('新窗口被浏览器拦截，请允许弹出窗口后重试。');
      previewWindow.opener = null;
      if (needsRefresh) {
        await save({ silent: true });
        previewWindow.location.replace(url);
      }
    }
  });
  const editPane = h('section', { class: 'html-editor-pane', hidden: 'hidden' }, [codeEditor.element]);
  const saveButton = h('button', { type: 'button', hidden: 'hidden', text: '保存', title: 'Ctrl/⌘ + S', onclick: () => save() });
  const switchMode = (mode) => {
    const isPreview = mode === 'preview';
    editPane.hidden = isPreview;
    previewPane.hidden = !isPreview;
    saveButton.hidden = isPreview;
    editButton.classList.toggle('active', !isPreview);
    previewButton.classList.toggle('active', isPreview);
    if (isPreview) {
      if (previewWarmTimer) clearTimeout(previewWarmTimer);
      refreshPreview();
    } else {
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
      syntaxHighlight.scrollTop = 0;
      syntaxHighlight.scrollLeft = 0;
      codeEditor.element.querySelector('.markdown-line-numbers').scrollTop = 0;
      requestAnimationFrame(() => {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(0, 0);
        textarea.scrollTop = 0;
        textarea.scrollLeft = 0;
      });
    }
  };
  editButton.addEventListener('click', () => switchMode('edit'));
  previewButton.addEventListener('click', () => switchMode('preview'));

  const pageTitleLabel = h('strong', {
    class: 'markdown-file-name',
    text: page.title || '未命名网页',
    title: '双击修改网页名称'
  });
  pageTitleLabel.addEventListener('dblclick', () => {
    const input = h('input', {
      class: 'markdown-file-name-input',
      value: page.title || '未命名网页',
      'aria-label': '网页名称'
    });
    pageTitleLabel.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (shouldSave) => {
      if (finished) return;
      finished = true;
      if (!shouldSave) {
        input.replaceWith(pageTitleLabel);
        return;
      }
      const title = input.value.trim();
      if (!title) {
        input.replaceWith(pageTitleLabel);
        toast('网页名称不能为空。');
        return;
      }
      try {
        await save({ silent: true });
        while (saving) await new Promise((resolve) => setTimeout(resolve, 20));
        await saveCurrentPackage((pkg) => {
          const target = pkg.ui.pages.find((item) => item.id === page.id);
          if (target) {
            target.title = title;
            target.content = textarea.value;
          }
        });
        page.title = title;
        page.content = textarea.value;
        savedValue = textarea.value;
        pageTitleLabel.textContent = title;
        activePreview.title = `${title}预览`;
        if (pendingPreview) pendingPreview.title = `${title}预览`;
        document.querySelector('.page-nav-item.active .menu-item')?.replaceChildren(title);
        input.replaceWith(pageTitleLabel);
        refreshStatus();
        toast('网页名称已更新');
      } catch (error) {
        input.replaceWith(pageTitleLabel);
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

  return h('div', { class: 'html-file-page', 'data-page-id': page.id }, [
    h('div', { class: 'markdown-file-topbar html-file-topbar' }, [
      h('div', { class: 'markdown-file-heading' }, [
        pageTitleLabel,
        status
      ]),
      h('div', { class: 'markdown-file-mode-switch markdown-mode-switch', role: 'group', 'aria-label': '网页显示模式' }, [editButton, previewButton, openWindowButton]),
      h('div', { class: 'markdown-file-actions' }, [saveButton])
    ]),
    h('div', { class: 'html-file-layout' }, [editPane, previewPane])
  ]);
}
