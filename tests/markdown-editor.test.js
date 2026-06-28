import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, stripLegacyMarkdownStyles } from '../public/app-runtime/Markdown.js';
import { wrapMarkdownSelection, applyMarkdownHeading, applyMarkdownLinePrefix, applyMarkdownOrderedList } from '../public/app-runtime/MarkdownFormatting.js';

test('markdown renderer escapes HTML and renders common markdown syntax', () => {
  const html = renderMarkdown('# 标题\n\n**加粗** `代码` <script>');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(renderMarkdown('> 引用内容'), /<blockquote>引用内容<\/blockquote>/);
  assert.equal(renderMarkdown('1. 第一项\n2. 第二项'), '<ol><li>第一项</li><li>第二项</li></ol>');
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
  assert.match(editor, /openMarkdownPreview\(entity, record, field\)[\s\S]*class: 'modal-footer'[\s\S]*text: '编辑'[\s\S]*openMarkdownRecordEditor\(entity, record, field\)/);
  assert.match(editor, /text: '编辑'/);
  assert.match(editor, /text: '预览'/);
  assert.match(editor, /markdown-editor-layout[\s\S]*markdown-preview-pane[\s\S]*markdown-editor-pane/);
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
  assert.match(editor, /markdown-pane-title', text: '编辑'[\s\S]*tools/);
  assert.match(styles, /\.markdown-pane-header[\s\S]*min-height: 36px;[\s\S]*align-items: center/);
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
