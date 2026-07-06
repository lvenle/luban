import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, stripLegacyMarkdownStyles } from '../public/app-runtime/Markdown.js';
import { wrapMarkdownSelection, applyMarkdownHeading, applyMarkdownLinePrefix, applyMarkdownOrderedList } from '../public/app-runtime/MarkdownFormatting.js';
import { highlightHtmlSource } from '../public/app-runtime/HtmlPage.js';

test('HTML source highlighter colors tags, attributes, values, declarations, and comments safely', () => {
  const highlighted = highlightHtmlSource(`<!doctype html>
<!-- 注释 -->
<style>:root { --brand: #2563eb; } body { color: var(--brand); margin: 12px; }</style>
<main class="hero">内容</main>
<script>const title = "页面"; // 注释
if (title) document.title = title;</script>`);
  assert.match(highlighted, /html-token-doctype/);
  assert.match(highlighted, /html-token-comment/);
  assert.match(highlighted, /html-token-tag/);
  assert.match(highlighted, /html-token-attribute/);
  assert.match(highlighted, /html-token-value/);
  assert.match(highlighted, /html-token-css-property/);
  assert.match(highlighted, /html-token-css-variable/);
  assert.match(highlighted, /html-token-js-keyword/);
  assert.match(highlighted, /html-token-js-string/);
  assert.match(highlighted, /html-token-js-comment/);
  assert.doesNotMatch(highlighted, /<main class=/);
});

test('markdown renderer escapes HTML and renders common markdown syntax', () => {
  const html = renderMarkdown('# 标题\n\n**加粗** `代码` <script>');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(renderMarkdown('> 引用内容'), /<blockquote>引用内容<\/blockquote>/);
  assert.equal(renderMarkdown('1. 第一项\n2. 第二项'), '<ol><li>第一项</li><li>第二项</li></ol>');
  assert.match(renderMarkdown('![截图](/uploads/app/image.png)'), /<img src="\/uploads\/app\/image\.png" alt="截图" loading="lazy">/);
  assert.match(renderMarkdown('[需求文档](/uploads/app/spec.pdf)'), /<a href="\/uploads\/app\/spec\.pdf"[^>]*>需求文档<\/a>/);
  assert.doesNotMatch(renderMarkdown('[需求文档](/uploads/app/spec.pdf)'), /download=/);
  assert.match(renderMarkdown('[说明](/uploads/app/readme.txt)'), /target="_blank"/);
  assert.match(renderMarkdown('[网页](/uploads/app/report.html)'), /target="_blank"/);
  assert.doesNotMatch(renderMarkdown('[网页](/uploads/app/report.html)'), /download=/);
  assert.match(renderMarkdown('[数据包](/uploads/app/archive.zip)'), /download="数据包"/);
  assert.doesNotMatch(renderMarkdown('[数据包](/uploads/app/archive.zip)'), /target="_blank"/);
  assert.doesNotMatch(renderMarkdown('![\" onerror=\"x](/uploads/app/image.png)'), /" onerror=/);
});

test('markdown formatting helpers support bold, italic, and heading levels 1 through 6', () => {
  assert.equal(wrapMarkdownSelection('abc', 0, 3, '**').value, '**abc**');
  assert.equal(wrapMarkdownSelection('abc', 0, 3, '*').value, '*abc*');
  assert.equal(applyMarkdownHeading('标题', 0, 2, 1).value, '# 标题');
  assert.equal(applyMarkdownHeading('标题', 0, 2, 6).value, '###### 标题');
  assert.equal(applyMarkdownLinePrefix('甲\n乙', 0, 3, '- ').value, '- 甲\n- 乙');
  assert.equal(applyMarkdownOrderedList('甲\n乙\n丙', 0, 5).value, '1. 甲\n2. 乙\n3. 丙');
  assert.equal(applyMarkdownOrderedList('1. 甲\n1. 乙', 0, 9).value, '1. 甲\n2. 乙');
  assert.equal(stripLegacyMarkdownStyles('<span style="font-size: 18px">正文</span>'), '正文');
});

test('long text cells use click preview and double-click markdown editor', () => {
  const row = readFileSync(new URL('../public/app-runtime/TableRow.js', import.meta.url), 'utf8');
  const typed = readFileSync(new URL('../public/app-runtime/TypedViews.js', import.meta.url), 'utf8');
  const cellEditor = readFileSync(new URL('../public/app-runtime/CellEditor.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(row, /openMarkdownRecordEditor/);
  assert.match(row, /\['textarea', 'richText', 'ai'\]\.includes\(field\.type\)/);
  assert.match(typed, /openMarkdownRecordEditor/);
  assert.match(row, /openMarkdownRecordEditor\(entity, record, field\)/);
  assert.match(typed, /openMarkdownRecordEditor\(entity, record, field\)/);
  assert.match(cellEditor, /field\.type === 'textarea' \|\| field\.type === 'richText'[\s\S]*markdown-cell-content[\s\S]*renderMarkdown\(value\)/);
  assert.match(styles, /\.markdown-cell-content[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  const editor = readFileSync(new URL('../public/app-runtime/MarkdownEditor.js', import.meta.url), 'utf8');
  assert.match(editor, /createMarkdownCodeEditor\(textarea\)/);
  assert.match(editor, /createMarkdownUploadButtons\(textarea/);
  assert.match(editor, /openMarkdownPreview\(entity, record, field\)[\s\S]*class: 'modal-footer'[\s\S]*text: '编辑'[\s\S]*openMarkdownRecordEditor\(entity, record, field\)/);
  assert.match(editor, /markdown-mode-button active', text: '编辑'/);
  assert.match(editor, /markdown-mode-button', text: '预览'/);
  assert.match(editor, /switchMode\('edit'\)/);
  assert.match(editor, /switchMode\('preview'\)/);
  assert.match(editor, /markdown-editor-layout markdown-modal-layout/);
  assert.match(editor, /一级标题/);
  assert.match(editor, /六级标题/);
  assert.match(editor, /title: '加粗'/);
  assert.match(editor, /title: '斜体'/);
  assert.doesNotMatch(editor, /font-family/);
  assert.doesNotMatch(editor, /font-size/);
  assert.match(editor, /title: '删除线'/);
  assert.match(editor, /const undoStack = \[\][\s\S]*title: '撤销'[\s\S]*textarea\.value = undoStack\.pop\(\)/);
  assert.match(editor, /undoStack\.length > 100[\s\S]*undoStack\.shift\(\)/);
  assert.match(editor, /textarea\.addEventListener\('input'[\s\S]*rememberUndo\(previousValue\)/);
  assert.doesNotMatch(editor, /title: '行内代码'/);
  assert.doesNotMatch(editor, /title: '代码块'/);
  assert.doesNotMatch(editor, /title: '引用'/);
  assert.doesNotMatch(editor, /title: '无序列表'/);
  assert.doesNotMatch(editor, /title: '有序列表'/);
  assert.doesNotMatch(editor, /title: '任务列表'/);
  assert.doesNotMatch(editor, /title: '链接'/);
  assert.doesNotMatch(editor, /title: '分割线'/);
  assert.match(editor, /tools\.hidden = isPreview/);
  assert.match(editor, /markdown-modal-mode-switch markdown-mode-switch/);
  assert.match(styles, /\.markdown-modal-modebar[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.markdown-modal-mode-switch[\s\S]*grid-column: 2;[\s\S]*justify-self: center/);
});

test('all modal action footers align to the bottom right', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.modal-footer,[\s\S]*\.modal > \.row:last-child[\s\S]*justify-content: flex-end/);
});

test('all modal close buttons stay in the top-right with a distinct background', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const markdown = readFileSync(new URL('../public/app-runtime/MarkdownEditor.js', import.meta.url), 'utf8');
  assert.match(css, /\.modal > \.toolbar > button:last-child,[\s\S]*margin-left: auto;[\s\S]*background: #f1f5f9;/);
  assert.match(css, /\.modal > \.toolbar > button:last-child:hover,[\s\S]*background: #e2e8f0;/);
  assert.match(markdown, /Markdown 编辑器[\s\S]*text: '关闭'/);
});

test('sidebar creates an editable markdown file without opening a file picker', () => {
  const sidebar = readFileSync(new URL('../public/app-runtime/Sidebar.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../public/app-runtime/MarkdownPage.js', import.meta.url), 'utf8');
  const pageTypes = readFileSync(new URL('../public/app-runtime/PageTypes.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(sidebar, /text: '\+ 新建文档'/);
  assert.doesNotMatch(sidebar, /text: '\+ 添加文件'/);
  assert.match(sidebar, /buildMarkdownPage\(uniquePageTitle\([^)]*'未命名文档'\)\)/);
  assert.doesNotMatch(sidebar, /`\$\{fileName\}\.md`/);
  assert.doesNotMatch(sidebar, /type: 'file'/);
  assert.match(sidebar, /navKind: 'markdown'/);
  assert.match(pageTypes, /page\.navKind === 'markdown'/);
  assert.match(page, /renderMarkdown\(textarea\.value\)/);
  assert.match(page, /createMarkdownCodeEditor\(textarea\)/);
  assert.match(page, /createMarkdownUploadButtons\(textarea/);
  assert.match(page, /target\.content = content/);
  assert.match(page, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(page, /setTimeout\(\(\) => save\(\{ silent: true \}\), 800\)/);
  assert.match(page, /saveAgain \|\| \(succeeded && textarea\.value !== savedValue\)/);
  assert.match(page, /text: '编辑'/);
  assert.match(page, /text: '预览'/);
  assert.match(page, /markdown-mode-button active', text: '预览'/);
  assert.match(page, /markdown-editor-pane markdown-file-pane', hidden: 'hidden'/);
  assert.match(page, /markdown-format-toolbar', hidden: 'hidden'/);
  assert.match(page, /switchMode\('edit'\)/);
  assert.match(page, /switchMode\('preview'\)/);
  assert.match(page, /previewPane\.hidden = !isPreview/);
  assert.match(page, /fileNameLabel\.addEventListener\('dblclick'/);
  assert.match(page, /target\.fileName = fileName/);
  assert.match(page, /target\.title = fileName/);
  assert.match(page, /const fileName = rawName/);
  assert.doesNotMatch(page, /`\$\{rawName\}\.md`/);
  assert.match(page, /class: 'markdown-file-mode-switch markdown-mode-switch'/);
  assert.match(styles, /\.markdown-file-topbar[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.markdown-file-mode-switch[\s\S]*justify-self: center/);
  const lineNumbers = readFileSync(new URL('../public/app-runtime/MarkdownLineNumbers.js', import.meta.url), 'utf8');
  assert.match(lineNumbers, /textarea\.value\.split\('\\n'\)\.length/);
  assert.match(lineNumbers, /textarea\.setAttribute\('wrap', 'off'\)/);
  assert.match(lineNumbers, /numbers\.scrollTop = textarea\.scrollTop/);
  assert.match(styles, /\.markdown-line-numbers[\s\S]*text-align: right/);
  const uploads = readFileSync(new URL('../public/app-runtime/MarkdownUploads.js', import.meta.url), 'utf8');
  assert.match(uploads, /text: isImage \? '图片' : '附件'/);
  assert.match(uploads, /\/uploads\?\$\{params\.toString\(\)\}/);
  assert.match(uploads, /kind === 'image' \? `!\[/);
  const routeHelpers = readFileSync(new URL('../src/routes/_helpers.js', import.meta.url), 'utf8');
  assert.match(routeHelpers, /'\.html', '\.htm'/);
  assert.match(routeHelpers, /content-security-policy'[\s\S]*sandbox; default-src 'none'/);
});

test('sidebar creates standalone HTML pages with preview-first source editing', () => {
  const sidebar = readFileSync(new URL('../public/app-runtime/Sidebar.js', import.meta.url), 'utf8');
  const pageTypes = readFileSync(new URL('../public/app-runtime/PageTypes.js', import.meta.url), 'utf8');
  const htmlPage = readFileSync(new URL('../public/app-runtime/HtmlPage.js', import.meta.url), 'utf8');
  const addPage = readFileSync(new URL('../src/ai/tools/add-page.js', import.meta.url), 'utf8');
  const updatePage = readFileSync(new URL('../src/ai/tools/update-page.js', import.meta.url), 'utf8');
  assert.match(sidebar, /text: '\+ 新建网页'/);
  assert.doesNotMatch(sidebar, /text: '\+ 新建页面'/);
  assert.match(sidebar, /navKind: 'webpage'/);
  assert.match(pageTypes, /page\.navKind === 'webpage'/);
  assert.match(htmlPage, /sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups'/);
  assert.match(htmlPage, /markdown-mode-button active', text: '预览'/);
  assert.match(htmlPage, /createPreviewFrame\(true\)[\s\S]*nextPreview\.addEventListener\('load'/);
  assert.match(htmlPage, /activePreview\.remove\(\)[\s\S]*activePreview = nextPreview/);
  assert.match(htmlPage, /previewWarmTimer = setTimeout\(refreshPreview, 220\)/);
  assert.match(htmlPage, /textarea\.setSelectionRange\(0, 0\)[\s\S]*textarea\.scrollTop = 0/);
  assert.match(htmlPage, /replaceChild\(syntaxEditor, textarea\);\n\s*syntaxEditor\.append\(textarea\)/);
  assert.match(htmlPage, /title: '双击修改网页名称'/);
  assert.match(htmlPage, /target\.title = title/);
  assert.match(htmlPage, /page-nav-item\.active \.menu-item/);
  assert.match(htmlPage, /text: '新窗口打开'/);
  assert.match(htmlPage, /`\/html-preview\/\$\{encodeURIComponent\(decodeURIComponent\(appId\)\)\}\/\$\{encodeURIComponent\(page\.id\)\}`/);
  assert.match(htmlPage, /previewWindow\.opener = null/);
  assert.doesNotMatch(htmlPage, /URL\.createObjectURL\(new Blob/);
  assert.match(addPage, /'webpage'/);
  assert.match(addPage, /content: args\.content/);
  assert.match(updatePage, /targetPage\.content = args\.content/);
});

test('sidebar restores explicit view creation and keeps page names when collapsed', () => {
  const sidebar = readFileSync(new URL('../public/app-runtime/Sidebar.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const runtimeFrame = readFileSync(new URL('../public/app-runtime/RuntimeFrame.js', import.meta.url), 'utf8');
  assert.match(sidebar, /item\('新建视图', 'page'/);
  assert.match(sidebar, /\['', '— 请选择视图 —'\]/);
  assert.match(sidebar, /createButton\.disabled = !entityId \|\| !type/);
  assert.match(sidebar, /state\.sidebarCollapsed[\s\S]*collapsed-page-list[\s\S]*renderPageNavItem/);
  assert.match(sidebar, /sidebar-collapsed-head[\s\S]*createMenu/);
  assert.match(sidebar, /Array\.from\(fullTitle\)\.slice\(0, 4\)\.join/);
  assert.match(sidebar, /createTrigger\('sidebar-footer-create', '\+ 新建'/);
  assert.doesNotMatch(sidebar, /sidebar-toggle|text: state\.sidebarCollapsed \? '展开' : '收起'/);
  assert.match(styles, /\.runtime\.sidebar-collapsed \.page-nav-item[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.sidebar-footer \{[\s\S]*padding: 8px 2px 2px/);
  assert.match(styles, /\.desktop-runtime-shell \{[\s\S]*height: 100dvh[\s\S]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.desktop-runtime-shell \.runtime \{[\s\S]*height: 100%/);
  assert.match(styles, /var\(--sidebar-collapsed-width, 112px\)/);
  assert.match(runtimeFrame, /state\.sidebarCollapsedWidth = clampCollapsedSidebarWidth/);
  assert.match(runtimeFrame, /--sidebar-collapsed-width/);
  assert.match(runtimeFrame, /state\.currentApp\?\.id[\s\S]*sidebarLayoutKey\('sidebar-collapsed'\)/);
  assert.doesNotMatch(runtimeFrame, /globalStorageKey\('sidebar-collapsed'\)/);
  assert.match(sidebar, /document\.addEventListener\('pointerdown'[\s\S]*closePageMenus/);
  assert.match(sidebar, /pageMenuController\?\.abort\(\)/);
  assert.match(styles, /\.page-nav-item:hover,[\s\S]*background: #e4e9f0/);
  assert.match(styles, /\.page-nav-item \.menu-item:hover,[\s\S]*background: transparent/);
  assert.match(styles, /\.page-nav-item:hover \.page-menu\.ghost:not\(:hover\),[\s\S]*background: transparent/);
  assert.match(styles, /\.page-nav-item \.page-menu\.ghost \{[\s\S]*width: 24px;[\s\S]*height: 24px/);
  assert.match(styles, /\.page-nav-item \.page-menu\.ghost:hover \{[\s\S]*background: #cdd5df/);
});
